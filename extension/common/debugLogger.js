const DEBUG_DB_NAME = "DebugDB";
const DEBUG_STORE_NAME = "logs";
const DEBUG_DB_VERSION = 1;
const DEBUG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEBUG_MAX_ENTRIES = 2000;
const _memoryLogs = [];
const MEMORY_ONLY_TAGS = ["[main"];
const MEMORY_LOG_MAX = 500;

function _isMemoryOnly(msg) {
  return MEMORY_ONLY_TAGS.some((tag) => msg.startsWith(tag));
}

const _IS_BACKGROUND_CTX = typeof window === "undefined";
let isSyncing = false;

function _isDuplicateEntry(entry, level, source, msg) {
  return entry?.level === level && entry?.source === source && entry?.msg === msg;
}

function pushMemoryLog(level, source, msg) {
  const now = Date.now();

  if (_IS_BACKGROUND_CTX) {
    state._memoryLogs ??= [];
    const last = state._memoryLogs.at(-1);

    if (_isDuplicateEntry(last, level, source, msg)) {
      last.count = (last.count ?? 1) + 1;
      last.ts = now;
    } else {
      state._memoryLogs.push({ ts: now, level, source, msg, count: 1 });
      // Trim in-place to avoid allocating a new array on every overflow
      if (state._memoryLogs.length > 1000) state._memoryLogs.splice(0, state._memoryLogs.length - 1000);
    }

    // Notify any open settings/popup pages; ignore if no listener present
    browser.runtime.sendMessage({ action: "MEMORY_LOGS_UPDATED", newEntries: [state._memoryLogs.at(-1)] }).catch(() => {});
    return;
  }

  // Non-background contexts: buffer locally then sync to background
  const last = _memoryLogs.at(-1);
  if (_isDuplicateEntry(last, level, source, msg)) {
    last.count = (last.count ?? 1) + 1;
    last.ts = now;
    return;
  }

  _memoryLogs.push({ ts: now, level, source, msg, count: 1 });
  if (_memoryLogs.length > MEMORY_LOG_MAX) _memoryLogs.shift();
  syncMemoryLogsWithBackground();
}

function syncMemoryLogsWithBackground() {
  // Guard kept for safety even though this is only called from non-background contexts
  if (_IS_BACKGROUND_CTX || isSyncing || _memoryLogs.length === 0) return;

  isSyncing = true;
  let syncFailed = false;
  const countToSend = _memoryLogs.length;
  // Snapshot the slice so later pushes don't affect the in-flight payload
  const logsToSend = _memoryLogs.slice(0, countToSend);

  browser.runtime
    .sendMessage({ action: "APPEND_MEMORY_LOGS", payload: logsToSend })
    .then((response) => {
      if (response?.ok) _memoryLogs.splice(0, countToSend);
    })
    .catch((err) => {
      syncFailed = true;
      if (err?.message?.includes("Could not establish connection") || err?.message?.includes("Receiving end does not exist")) return;
      console.error("[debugLogger] Sync failed:", err);
    })
    .finally(() => {
      isSyncing = false;
      if (!syncFailed && _memoryLogs.length > 0) setTimeout(syncMemoryLogsWithBackground, 500);
    });
}

// Singleton DB promise; reset on unexpected close so callers can recover
let _dbPromise = null;

function _openDebugDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DEBUG_DB_NAME, DEBUG_DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DEBUG_STORE_NAME)) {
        db.createObjectStore(DEBUG_STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };

    req.onsuccess = (e) => {
      const db = e.target.result;
      // Reset singleton if the connection is closed externally
      db.onclose = () => {
        _dbPromise = null;
      };
      resolve(db);
    };

    req.onerror = (e) => reject(e.target.error);
    req.onblocked = () => reject(new Error("debugLogger: IndexedDB blocked"));
  }).catch((err) => {
    // Clear cached promise so the next call retries the open
    _dbPromise = null;
    return Promise.reject(err);
  });

  return _dbPromise;
}

// Serialization helpers
function _safeSerialise(value) {
  if (value == null) return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
  if (typeof value !== "object") return value;

  try {
    const seen = new WeakSet();
    return JSON.parse(
      JSON.stringify(value, (_, v) => {
        if (v !== null && typeof v === "object") {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        if (typeof v === "function") return `[Function: ${v.name || "anonymous"}]`;
        if (v instanceof Error) return `${v.name}: ${v.message}`;
        return v;
      }),
    );
  } catch {
    return String(value);
  }
}

function _stripConsoleFormatting(args) {
  if (typeof args[0] !== "string" || !args[0].includes("%c")) return args;

  const raw = args[0];
  const msg = raw.replace(/%c/g, "");
  const cleaned = [msg];
  let cssSkip = (raw.match(/%c/g) ?? []).length;

  for (let i = 1; i < args.length; i++) {
    if (cssSkip > 0 && typeof args[i] === "string" && args[i].includes("color:")) {
      cssSkip--;
      continue;
    }
    cleaned.push(args[i]);
  }

  return cleaned;
}

function _formatMsg(args) {
  return args.map(_safeSerialise).join(" ");
}

// Public API
async function debugLog(level, source, args) {
  try {
    const db = await _openDebugDB();
    // Strip formatting once and reuse for both the memory-only check and the final message
    const clean = _stripConsoleFormatting(args);
    const msg = _formatMsg(clean);

    if (_isMemoryOnly(msg)) {
      pushMemoryLog(level, source, msg);
      return;
    }

    const tx = db.transaction(DEBUG_STORE_NAME, "readwrite");
    const store = tx.objectStore(DEBUG_STORE_NAME);
    const now = Date.now();
    tx.onerror = (e) => console.error("[debugLogger] tx error:", e.target.error);

    store.openCursor(null, "prev").onsuccess = (e) => {
      const cursor = e.target.result;
      if (_isDuplicateEntry(cursor?.value, level, source, msg)) {
        cursor.update({ ...cursor.value, count: (cursor.value.count ?? 1) + 1, ts: now });
      } else {
        store.add({ ts: now, level, source, msg, count: 1 });
      }
    };
  } catch (err) {
    console.error("[debugLogger] write failed:", err);
  }
}

async function debugLogCleanup() {
  try {
    const db = await _openDebugDB();
    const cutoff = Date.now() - DEBUG_MAX_AGE_MS;
    const tx = db.transaction(DEBUG_STORE_NAME, "readwrite");
    const store = tx.objectStore(DEBUG_STORE_NAME);

    // Delete records older than 24 hours
    await new Promise((resolve) => {
      store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return resolve();
        if (cursor.value.ts < cutoff) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });

    // If it still exceeds the max, delete the oldest N record
    const count = await new Promise((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (count > DEBUG_MAX_ENTRIES) {
      const deleteCount = count - DEBUG_MAX_ENTRIES;
      let deleted = 0;
      await new Promise((resolve) => {
        store.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor || deleted >= deleteCount) return resolve();
          cursor.delete();
          deleted++;
          cursor.continue();
        };
      });
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("[debugLogger] cleanup failed:", err);
  }
}

async function debugLogReadAll() {
  try {
    const db = await _openDebugDB();
    const store = db.transaction(DEBUG_STORE_NAME, "readonly").objectStore(DEBUG_STORE_NAME);
    return await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[debugLogger] read failed:", err);
    return [];
  }
}

async function debugLogClear() {
  try {
    const db = await _openDebugDB();
    const store = db.transaction(DEBUG_STORE_NAME, "readwrite").objectStore(DEBUG_STORE_NAME);
    await new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[debugLogger] clear failed:", err);
  }
}
