const STORAGE_KEY = "userScriptsList";

// JSON.stringify escapes the value safely for injection into generated code.
function q(value) {
  return JSON.stringify(value == null ? "" : String(value));
}

// One session nonce per user script id ("userScriptNonces"); the generated code
// echoes it on every USER_SCRIPT_* message and mainParser.js validates it.
const USER_SCRIPT_NONCES_KEY = "userScriptNonces";

// Only ids safe to embed in the generated script are accepted.
const VALID_SCRIPT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

// Init block inside the single script editor:
//   // @init-code-start
//   ...runs ONCE at injection (document_start), outside the polling loop...
//   // @init-code-end
// The end marker also accepts "@init code-end". Only the first block is extracted.
const INIT_BLOCK_RE = /^[ \t]*\/\/[ \t]*@init-code-start[^\r\n]*\r?\n([\s\S]*?)^[ \t]*\/\/[ \t]*@init[- ]code-end[^\r\n]*(?:\r?\n|$)/m;

// Splits a script into its init part (marked block + optional legacy script.initCode field)
// and the polling part. A start marker without an end marker is ignored (both stay comments).
function splitInitCode(script, warn = true) {
  const code = typeof script?.code === "string" ? script.code : "";
  const legacy = typeof script?.initCode === "string" ? script.initCode.trim() : "";
  const match = INIT_BLOCK_RE.exec(code);

  if (!match) {
    if (warn && /@init-code-start/.test(code)) {
      logWarn("[userScriptWorker]: @init-code-start without a matching @init-code-end, init block ignored:", script?.id);
    }
    return { initCode: legacy, mainCode: code };
  }

  const block = match[1].trim();
  return {
    initCode: [legacy, block].filter(Boolean).join("\n"),
    mainCode: code.slice(0, match.index) + code.slice(match.index + match[0].length),
  };
}

// No per-script runAt setting: init code has to run before page scripts, so a script that has an
// init block is injected at document_start; everything else at document_idle. (The polling code is
// gated on DOMContentLoaded anyway, so the injection time does not matter for it.)
function resolveRunAt(initCode) {
  return initCode ? "document_start" : "document_idle";
}

function generateSessionNonce() {
  try {
    if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (_) {}
  // Not cryptographic: the generated code is only ever injected by the browser.
  return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function getUserScriptNonces() {
  const result = await browser.storage.local.get(USER_SCRIPT_NONCES_KEY);
  return result[USER_SCRIPT_NONCES_KEY] ?? {};
}

// Re-registration reuses the existing nonce so registered scripts stay validated.
async function getOrCreateScriptNonce(id) {
  if (!id) return null;

  const map = await getUserScriptNonces();
  if (map[id]) return map[id];

  const nonce = generateSessionNonce();
  map[id] = nonce;
  await browser.storage.local.set({ [USER_SCRIPT_NONCES_KEY]: map });
  return nonce;
}

// URL pattern validation and normalization
class PatternValidator {
  // "/body/" or "/body/i" → { source: "body", flags: "" | "i" }; anything else is used as-is
  static unwrap(pattern) {
    const text = pattern.trim();
    if (text.startsWith("/") && text.endsWith("/")) return { source: text.slice(1, -1), flags: "" };
    if (text.startsWith("/") && text.endsWith("/i")) return { source: text.slice(1, -2), flags: "i" };
    return { source: text, flags: "" };
  }

  // Already in "/body/" or "/body/i" form
  static isWrapped(text) {
    return text.startsWith("/") && (text.endsWith("/") || text.endsWith("/i"));
  }

  // Regex string → JS RegExp object
  static toRegex(pattern) {
    if (!pattern) return /.*/;

    try {
      const { source, flags } = PatternValidator.unwrap(pattern);
      return new RegExp(source, flags);
    } catch (err) {
      logWarn("Invalid regex pattern:", pattern, err);
      return /.*/;
    }
  }

  // Input string → list of normalized patterns
  static normalizePatterns(patterns) {
    if (!patterns) return [];
    if (typeof patterns === "string") patterns = patterns.split(/\s*,\s*/);

    return patterns
      .map((p) => {
        const trimmed = p.trim();
        if (!trimmed) return "";
        return PatternValidator.isWrapped(trimmed) ? trimmed : `/${trimmed}/`;
      })
      .filter(Boolean);
  }

  // Return the pattern list as regex and normalized list
  static processPatterns(patterns) {
    const list = this.normalizePatterns(patterns);
    const regexList = [];
    const invalidPatterns = [];

    for (const pattern of list) {
      const { source } = PatternValidator.unwrap(pattern);

      try {
        new RegExp(source);
        regexList.push(this.toRegex(pattern));
      } catch {
        invalidPatterns.push(pattern);
        regexList.push(/.*/);
      }
    }

    if (invalidPatterns.length) {
      logWarn("[userScriptWorker]: Invalid URL patterns replaced with /.*/:", invalidPatterns.join(", "));
    }

    return { regexList, normalizedList: list, invalidPatterns };
  }
}

// Storage management
class ScriptStorage {
  constructor(storageKey) {
    this.storageKey = storageKey;
  }

  async getScripts() {
    try {
      const result = await browser.storage.local.get(this.storageKey);
      return result[this.storageKey] || [];
    } catch (error) {
      logError("[userScriptWorker]: Failed to get scripts from storage:", error);
      return [];
    }
  }

  async saveScripts(scripts) {
    try {
      await browser.storage.local.set({ [this.storageKey]: scripts });
    } catch (error) {
      logError("[userScriptWorker]: Failed to save scripts to storage:", error);
      throw error;
    }
  }
}

// UserScript management
class UserScriptManager {
  constructor() {
    this.storage = new ScriptStorage(STORAGE_KEY);
    this.validator = PatternValidator;
    this.registeredScripts = new Map();
    // Serializes bulk registration; overlapping callers must not interleave.
    this._registrationMutex = typeof createMutex === "function" ? createMutex() : null;
  }

  buildTrackDataScript(script, nonce) {
    const { normalizedList } = PatternValidator.processPatterns(script.urlPatterns);

    // initCode runs ONCE, immediately at injection (before the DOM exists at document_start),
    // outside the 4s polling loop. Use it for fetch/XHR/history hooks; share results with the
    // polling code through the `shared` object. Async is allowed (top-level await).
    const { initCode, mainCode } = splitInitCode(script);
    const runAt = resolveRunAt(initCode);
    const initBlock = initCode ? `(async function () {\n${initCode}\n})().catch(function (err) { __userScriptLog('error', 'init.failed', { error: err }); });` : "";

    // setMemo is used by this script -> run a silent first pass right away (see startScriptExecution)
    const usesSetMemo = /\bsetMemo\s*\(/.test(mainCode);

    // Values interpolated into the generated code below (all escaped or plain booleans).
    const debugEnabled = Boolean(script.debug);
    const idLiteral = q(script.id);
    const primaryDomain = Array.isArray(script.domain) ? script.domain[0] : script.domain;
    const domainList = Array.isArray(script.domain) ? script.domain : [script.domain];
    const domainLiteral = q(primaryDomain);
    const domainsJson = JSON.stringify(domainList);
    const iframeSelectorsJson = JSON.stringify(script.iframeSelectors || null);
    const watchAutoDetectLiteral = q(script.watchAutoDetect || "disable");

    return `
    // AUTO-GENERATED-UTILS
    // _INLINE_UTILS
    function normalizeTrackData(input) {
      const seen = new WeakSet();

      function clean(value, path) {
        path = path || "root";

        if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          return value;
        }

        if (typeof value === "undefined") return null;

        if (
          value instanceof Node ||
          value instanceof Window ||
          value instanceof Document ||
          value instanceof HTMLCollection ||
          value instanceof NodeList ||
          value instanceof Element
        ) {
          if (${debugEnabled}) console.warn("Dropped DOM value at:", path);
          return null;
        }

        if (typeof value !== "object") return null;

        if (seen.has(value)) return null;
        seen.add(value);

        if (Array.isArray(value)) {
          return value.map((v, i) => clean(v, path + "[" + i + "]"));
        }

        const out = {};
        for (const key in value) {
          const v = clean(value[key], path + "." + key);
          if (v !== undefined) out[key] = v;
        }
        return out;
      }

      return clean(input, "root");
    }

    // MAIN
    (async function () {
      // ---------- State ----------
      const trackState = {};
      const __INTERVAL_DELAY = 4000;
      // Session nonce: lets mainParser.js tell registered scripts from page-forged postMessages.
      const __nonce = ${q(nonce)};
      const __userScriptUsedSettings = [];
      let __clearCalled = false;
      let __dryRun = false;
      // Persistent state shared between initCode (hooks) and the polling code.
      const shared = Object.create(null);
      const __onceKeys = Object.create(null);

      // ---------- Messaging ----------
      // Messages posted before mainParser.js is listening are buffered and flushed once the
      // parser is ready. Without this, an early USER_SCRIPT_MEMO_SET is lost for good because
      // setMemo only sends keys that changed locally.
      const __outbox = [];
      let __parserIsReady = false;
      let __parserReadyP = null;

      function __send(msg) {
        if (__parserIsReady) {
          window.postMessage(msg, "*");
          return;
        }
        if (__outbox.length >= 500) __outbox.shift();
        __outbox.push(msg);
      }

      // Posts message and resolves with the first reply of responseType carrying the same requestId.
      // On timeout, onTimeout(resolve, reject) decides how the promise settles.
      function __requestResponse(message, responseType, timeoutMs, onTimeout) {
        return new Promise((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeoutId);
            window.removeEventListener("message", handleResponse);
          };

          const timeoutId = setTimeout(() => {
            cleanup();
            onTimeout(resolve, reject);
          }, timeoutMs);

          function handleResponse(event) {
            if (event.source !== window) return;
            const msg = event.data;
            if (!msg || msg.type !== responseType || msg.requestId !== message.requestId) return;

            cleanup();
            resolve(msg);
          }

          window.addEventListener("message", handleResponse);
          window.postMessage(message, "*");
        });
      }

      function __sendClearActivity() {
        window.postMessage({
          type: "USER_SCRIPT_CLEAR_ACTIVITY",
          nonce: __nonce,
          id: ${idLiteral},
          domain: ${domainLiteral},
        }, "*");
      }

      // ---------- Parser readiness ----------
      function waitForParserReady() {
        if (!__parserReadyP) {
          __parserReadyP = __waitForParserReadyImpl().then(() => {
            __parserIsReady = true;
            while (__outbox.length) window.postMessage(__outbox.shift(), "*");
          });
        }
        return __parserReadyP;
      }

      function __waitForParserReadyImpl() {
        const __t0 = Date.now();
        return new Promise((resolve) => {
          if (window.__parserSystemReady) return resolve();

          let isSettled = false;
          const cleanup = () => {
            if (isSettled) return;
            isSettled = true;
            window.removeEventListener("message", messageHandler);
            clearTimeout(timeoutId);
          };

          const timeoutId = setTimeout(() => {
            cleanup();
            __userScriptLog("warn", "waitForParserReady.timeout", { waitedMs: 8000 });
            resolve();
          }, 8000);

          function messageHandler(event) {
            if (event.source !== window) return;
            if (event.data?.type === "PARSER_READY") {
              cleanup();
              __userScriptLog("info", "waitForParserReady.resolved", { waitedMs: Date.now() - __t0 });
              resolve();
            }
          }

          window.addEventListener("message", messageHandler);
          window.postMessage({ type: "QUERY_PARSER_READY", nonce: __nonce, id: ${idLiteral} }, "*");
        });
      }

      // Resolves when the DOM is parsed; immediate at document_idle.
      function __domReady() {
        return new Promise((resolve) => {
          if (document.readyState !== "loading") return resolve();
          document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
        });
      }

      // ---------- Helpers exposed to the script ----------
      function once(key, fn) {
        if (__onceKeys[key]) return;
        __onceKeys[key] = true;
        return fn();
      }

      function useSetting(key, label, type, defaultValue) {
        __userScriptUsedSettings.push({ key, label, type, defaultValue });
        // Wait for the parser first so the 5s timeout only measures the round trip.
        return waitForParserReady().then(() => {
          const message = {
            type: "USER_SCRIPT_USE_SETTING_REQUEST",
            requestId: "useSetting_" + Date.now() + "_" + Math.random(),
            nonce: __nonce,
            id: ${idLiteral},
            key,
            label,
            inputType: type,
            defaultValue
          };

          return __requestResponse(message, "USER_SCRIPT_USE_SETTING_RESPONSE", 5000, (resolve, reject) => {
            __userScriptLog("error", "useSetting.timeout", { key: key, waitedMs: 5000 });
            reject(new Error("useSetting timeout"));
          }).then((msg) => msg.value);
        });
      }

      function getIframeData() {
        const message = {
          type: "USER_SCRIPT_IFRAME_DATA_REQUEST",
          requestId: "iframeData_" + Date.now() + "_" + Math.random(),
          nonce: __nonce,
          id: ${idLiteral},
          iframeSelectors: ${iframeSelectorsJson},
        };

        return __requestResponse(message, "USER_SCRIPT_IFRAME_DATA_RESPONSE", 12000, (resolve) => resolve(null))
          .then((msg) => msg?.data || null);
      }

      function __ClearSignal() {}
      __ClearSignal.prototype = Object.create(Error.prototype);

      function clearActivity() {
        __clearCalled = true;
        throw new __ClearSignal();
      }

      // ---------- History save block ----------
      // Per script/tab. The script can call blockHistorySave(reason) / allowHistorySave()
      // to skip history writes while a condition matches (e.g. location.href).
      // Only one log per block.
      let __historyBlocked = false;
      let __historyBlockReason = null;
      let __historyBlockLogged = false;

      function blockHistorySave(reason) {
        __historyBlocked = true;
        __historyBlockReason = typeof reason === "string" ? reason : null;
        __sendHistoryBlock();
        if (!__historyBlockLogged) {
          __historyBlockLogged = true;
          __userScriptLogOnce("info", "history.blocked", "History save blocked by script", 0, {
            reason: __historyBlockReason,
          });
        }
      }

      function allowHistorySave() {
        __historyBlocked = false;
        __historyBlockReason = null;
        __historyBlockLogged = false;
        __sendHistoryBlock();
      }

      function __sendHistoryBlock() {
        __send({
          type: "USER_SCRIPT_HISTORY_BLOCK",
          nonce: __nonce,
          id: ${idLiteral},
          blocked: __historyBlocked,
          reason: __historyBlockReason,
        });
      }

      // ---------- Logging bridge ----------
      const __userScriptLogOnceKeys = Object.create(null);
      const __userScriptLogLastContent = Object.create(null);

      // Deduplicate: if the content is unchanged from the last log for this event, skip posting.
      // Prevents spam from polls like trackData.summary that repeat every loop.
      function __isDuplicateLog(event, data) {
        const signature = JSON.stringify({ ...data });
        if (__userScriptLogLastContent[event] === signature) return true;
        __userScriptLogLastContent[event] = signature;
        return false;
      }

      function __userScriptLog(level, event, data = {}) {
        try {
          if (level !== "error" && __isDuplicateLog(event, data)) return;

          const logData = { ...data };

          if (level === "error" && data.error instanceof Error) {
            logData.errorName = data.error.name || "Error";
            logData.errorMessage = data.error.message ? String(data.error.message).slice(0, 500) : "";
            logData.errorStack = data.error.stack ? String(data.error.stack).slice(0, 1000) : "";
            delete logData.error;
          }

          const emptyKey = Object.keys(data).find((key) => data[key] === null || data[key] === undefined || data[key] === "");
          if (emptyKey !== undefined) logData.emptyField = emptyKey;

          __send({
            type: "USER_SCRIPT_LOG",
            nonce: __nonce,
            id: ${idLiteral},
            level: level,
            event: String(event).slice(0, 120),
            data: logData,
          });
        } catch (err) {
          console.warn("[Web Presence] userScript log forwarding failed:", err);
        }
      }

      function __userScriptLogOnce(level, event, message, windowMs = 10000, data = {}) {
        const key = event + " " + message;
        const now = Date.now();
        const last = __userScriptLogOnceKeys[key];
        if (last && now - last < windowMs) return;
        __userScriptLogOnceKeys[key] = now;

        // Evict stale once-keys so the map cannot grow unboundedly for the
        // lifetime of the tab. Entries older than 5 minutes no longer suppress
        // any future message and are safe to drop.
        const cutoff = now - 300000;
        for (const k of Object.keys(__userScriptLogOnceKeys)) {
          if (__userScriptLogOnceKeys[k] <= cutoff) delete __userScriptLogOnceKeys[k];
        }

        __userScriptLog(level, event, { detail: message, ...data });
      }

      // ---------- Console output (debug / error groups) ----------
      function __timeString() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
      }

      function __openLogGroup(kind, accentColor, title) {
        const style = (color) => "color: " + color + "; font-weight: bold; font-size: 14px;";
        console.groupCollapsed(
          "%c Web Presence - USERSCRIPT " + kind + " [%c" + __timeString() + "%c]: %c" + title,
          style(accentColor),
          style("#cfa600ff"),
          style(accentColor),
          style("#efefefff")
        );
      }

      function __printDebug(trackData) {
        const activity = trackData.activity;
        const autoDetect = ${watchAutoDetectLiteral} === "enable";

        __openLogGroup("DEBUG", "#7bd583ff", trackData.title);
        console.log("%cScript Information:", "color: #ffb86c; font-weight: bold; font-size: 13px;");
        console.log("  • Title:       ", trackData.title);
        console.log("  • Domain:      ", trackData.domain);
        console.log("  • Url Patterns:", trackData.urlPatterns || "—");
        console.log("  • Mode:        ", trackData.mode);
        console.log("%cActivity Information:", "color: #8be9fd; font-weight: bold; font-size: 13px;");
        console.log("  • Title:      ", activity.title || "Unknown");
        console.log("  • Artist:     ", activity.artist || "Unknown");
        console.log("  • Source:     ", activity.source || trackData.title || "Unknown");
        console.log("  • Activity URL:   ", activity.link || "N/A");
        console.log("  • Image:      ", activity.image || "Default Image");
        console.log("  • Duration:   ", autoDetect ? "Auto-Detect" : activity.duration ?? "N/A");
        console.log("  • Time Passed:", autoDetect ? "Auto-Detect" : activity.timePassed ?? "N/A");
        console.log("  • isPlaying:  ", autoDetect ? "Auto-Detect" : activity.isPlaying ?? "N/A");
        console.log("  • Buttons:    ", activity.buttons ?? "N/A");
        console.groupEnd();
      }

      function __printTrackingError(error) {
        __openLogGroup("ERROR", "#ff5555ff", "Tracking Failed");
        console.log("%cError Details:", "color: #ff5555; font-weight: bold; font-size: 13px;");
        console.log("  • Message :", error.message || String(error));
        if (error.stack) console.log("  • Stack   :", error.stack);
        console.groupEnd();
      }

      // ---------- Memo (setMemo / getMemo) ----------
      // Tab-scoped, memory-only data shared between pages of the same host.
      const __memoCache = Object.create(null);
      let __memoLoaded = false;

      function __isUnsafeKey(key) {
        return key === "__proto__" || key === "constructor" || key === "prototype";
      }

      function __memoWarn(msg) {
        __userScriptLog("warn", "memo.warn", { msg });
      }

      function __memoScope(scope) {
        let s = null;
        if (typeof scope === "number") s = Number.isFinite(scope) ? String(scope) : null;
        else if (typeof scope === "string") s = scope.trim() || null;
        return __isUnsafeKey(s) ? null : s;
      }

      function __memoRequest(type) {
        return waitForParserReady().then(() => {
          const message = {
            type,
            requestId: "memo_" + Date.now() + "_" + Math.random(),
            nonce: __nonce,
            id: ${idLiteral},
          };

          return __requestResponse(message, "USER_SCRIPT_MEMO_RESPONSE", 3000, (resolve) => {
            __userScriptLogOnce("warn", "memo.request.timeout", "memo request timed out", 10000, { waitedMs: 3000 });
            resolve(null);
          }).then((msg) => msg?.data || null);
        });
      }

      // Loads the tab's memo from the background once; retried until it succeeds
      async function __refreshMemo() {
        if (__memoLoaded) return;

        const data = await __memoRequest("USER_SCRIPT_MEMO_GET");
        if (!data || typeof data !== "object") {
          // no answer, try again next iteration (only the first failure is logged)
          __userScriptLogOnce("warn", "refreshMemo.noAnswer", "no memo response received, will retry on the next loop");
          return;
        }

        for (const scope of Object.keys(data)) {
          if (!__memoScope(scope) || !data[scope] || typeof data[scope] !== "object") continue;

          const bucket = __memoCache[scope] || (__memoCache[scope] = Object.create(null));
          for (const key of Object.keys(data[scope])) {
            if (__isUnsafeKey(key)) continue;
            if (!(key in bucket)) bucket[key] = data[scope][key]; // local setMemo writes win
          }
        }

        __memoLoaded = true;
        __userScriptLog("info", "refreshMemo.loaded", { scopes: Object.keys(data).length });
      }

      function setMemo(obj, scope) {
        const s = __memoScope(scope);
        if (s === null) {
          __memoWarn("setMemo: scope is empty or invalid, memo was not saved.");
          return;
        }
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
          __memoWarn("setMemo: first argument must be a plain object.");
          return;
        }

        const data = normalizeTrackData(obj);
        if (!data || typeof data !== "object") return;

        const bucket = __memoCache[s] || (__memoCache[s] = Object.create(null));
        const changed = {};
        let hasChange = false;

        for (const key of Object.keys(data)) {
          if (!key || __isUnsafeKey(key)) continue;

          const value = data[key];
          if (JSON.stringify(bucket[key] ?? null) === JSON.stringify(value)) continue;

          if (value === null) delete bucket[key];
          else bucket[key] = value;
          changed[key] = value;
          hasChange = true;
        }

        if (!hasChange) return;
        __send({ type: "USER_SCRIPT_MEMO_SET", nonce: __nonce, id: ${idLiteral}, scope: s, data: changed });
      }

      function getMemo(key, scope) {
        if (typeof key !== "string" || !key) {
          __memoWarn("getMemo: key must be a non-empty string.");
          return null;
        }

        const s = __memoScope(scope);
        if (s === null) {
          __memoWarn("getMemo: scope is empty or invalid.");
          return null;
        }

        const bucket = __memoCache[s];
        const value = bucket ? bucket[key] : undefined;
        return value === undefined ? null : value;
      }

      // ---------- Track state ----------
      const __asText = (value) => (typeof value === "string" || typeof value === "number" ? String(value) : null);
      const __asNumberOrString = (value) => (typeof value === "number" || typeof value === "string" ? value : null);

      // Takes the values the script left in scope (see updateTrackData) and normalizes them.
      function __applyTrackState(raw) {
        const finalLink = __asText(raw.activityUrl) ?? __asText(raw.link);

        trackState.title = __asText(raw.title);
        if (!trackState.title) {
          __userScriptLogOnce("info", "updateTrackData.noTitle", "title is empty, RPC update will be skipped", 10000);
        }
        trackState.artist = __asText(raw.artist);
        trackState.image = __asText(raw.image);
        trackState.source = __asText(raw.source);
        trackState.activityUrl = finalLink;
        trackState.link = finalLink;
        trackState.timePassed = __asNumberOrString(raw.timePassed);
        trackState.duration = __asNumberOrString(raw.duration);
        trackState.isPlaying = raw.isPlaying == null ? null : Boolean(raw.isPlaying);
        trackState.buttons = Array.isArray(raw.buttons) ? raw.buttons : null;
      }

      function __buildTrackData() {
        return {
          id: ${idLiteral},
          version: ${q(script.version || "1.0.0")},
          domain: ${domainLiteral},
          domains: ${domainsJson},
          authors: ${JSON.stringify(script.authors || [])},
          authorsLinks: ${JSON.stringify(script.authorsLinks || [])},
          homepage: ${q(script.homepage || "")},
          description: ${q(script.description || "")},
          urlPatterns: ${JSON.stringify(normalizedList)},
          title: ${q(script.title || "Unknown")},
          category: ${JSON.stringify(script.category || [])},
          mode: ${q(script.mode || "listen")},
          watchAutoDetect: ${watchAutoDetectLiteral},
          iframeSelectors: ${iframeSelectorsJson},
          isLibraryActivity: ${Boolean(script.storeScriptId)},
          activity: normalizeTrackData({ ...trackState })
        };
      }

      // Flags say whether a value exists; the track* fields carry the (clipped) values themselves.
      // timePassed is left out on purpose: it changes every loop and would defeat the dedupe
      // in __userScriptLog. Empty values are omitted instead of sent as null/"" so they do not
      // trigger the emptyField marker.
      function __logTrackSummary(trackData) {
        const act = trackData.activity;
        const clip = (value, max = 80) => {
          const text = String(value ?? "");
          return text.length > max ? text.slice(0, max) + "\u2026" : text;
        };
        const optional = (key, value) => (value ? { [key]: value } : {});

        __userScriptLog("info", "trackData.summary", {
          titleSet: Boolean(act?.title),
          artistSet: Boolean(act?.artist),
          sourceSet: Boolean(act?.source),
          linkSet: Boolean(act?.link),
          timePassedSet: act?.timePassed != null,
          durationSet: act?.duration != null,
          isPlaying: act?.isPlaying ?? false,
          buttonCount: act?.buttons?.length ?? 0,
          ...optional("trackTitle", clip(act?.title)),
          ...optional("trackArtist", clip(act?.artist)),
          ...optional("trackSource", clip(act?.source, 40)),
          ...(act?.duration != null ? { duration: act.duration } : {}),
        });
      }

      // ---------- Polling ----------
      async function updateTrackData() {
        try {
          __clearCalled = false;
          await __refreshMemo();
          // UserScript
          ${mainCode}

          if (__dryRun) {
            __userScriptLogOnce("info", "updateTrackData.dryRun", "dry run skipped sending track data", 10000);
            return;
          }
          if (__clearCalled) {
            __userScriptLogOnce("info", "updateTrackData.clear", "clear called, sending clear activity", 10000);
            __sendClearActivity();
            return;
          }

          // The script's own variables are read here (not in a helper) so they stay in scope.
          // typeof keeps undeclared ones from throwing.
          __applyTrackState({
            title: typeof title === "undefined" ? null : title,
            artist: typeof artist === "undefined" ? null : artist,
            image: typeof image === "undefined" ? null : image,
            source: typeof source === "undefined" ? null : source,
            activityUrl: typeof activityUrl === "undefined" ? null : activityUrl,
            link: typeof link === "undefined" ? null : link,
            timePassed: typeof timePassed === "undefined" ? null : timePassed,
            duration: typeof duration === "undefined" ? null : duration,
            isPlaying: typeof isPlaying === "undefined" ? null : isPlaying,
            buttons: typeof buttons === "undefined" ? null : buttons,
          });

          const trackData = __buildTrackData();

          if (${debugEnabled}) __printDebug(trackData);
          __logTrackSummary(trackData);

          window.postMessage({
            type: "USER_SCRIPT_TRACK_DATA",
            nonce: __nonce,
            data: { ...trackData, iframeSelectors: ${iframeSelectorsJson} }
          }, "*");
          __userScriptLogOnce("info", "updateTrackData.sent", "track data sent", 30000);
        } catch (error) {
          if (__dryRun) return;

          if (error instanceof __ClearSignal) {
            __userScriptLog("info", "updateTrackData.cleared", {});
            __sendClearActivity();
            return;
          }

          // Summary only: the full payload stays in the local groupCollapsed output.
          __userScriptLog("error", "updateTrackData.failed", { error: error });
          __printTrackingError(error);
        }
      }

      // ---------- Startup ----------
      async function startScriptExecution() {
        __userScriptLog("info", "script.start", { intervalMs: __INTERVAL_DELAY, runAt: ${q(runAt)}, readyState: document.readyState });

        // initCode (hooks): once, right now, even if the DOM does not exist yet
        ${initBlock}

        // everything below reads the DOM, so wait for it (no-op at document_idle)
        await __domReady();

        if (${usesSetMemo}) {
          // silent first pass: only the setMemo side effects run, nothing is sent to the parser
          __dryRun = true;
          try {
            await updateTrackData();
          } catch {}
          __dryRun = false;
        }

        await waitForParserReady();

        async function loop() {
          try {
            await updateTrackData();
          } catch (err) {
            __userScriptLogOnce("error", "loop.error", err && err.message ? String(err.message).slice(0, 300) : "loop error", 5000, { error: err });
          } finally {
            setTimeout(loop, __INTERVAL_DELAY);
          }
        }
        loop();
      }

      startScriptExecution();
      window.addEventListener("pagehide", () => {
        __userScriptLog("info", "script.stop", {});
      }, { once: true });
    })();
    `;
  }

  resolveWorld(code) {
    const lines = code.split("\n");
    const userScriptIndex = lines.findIndex((line) => line.trim().startsWith("// UserScript"));
    if (userScriptIndex === -1) return "USER_SCRIPT";

    const headerSlice = lines.slice(userScriptIndex, userScriptIndex + 5).join("\n");
    const match = headerSlice.match(/\/\/\s*@world\s+(main|isolated)/);
    if (!match) return "USER_SCRIPT";

    return match[1] === "main" ? "MAIN" : "USER_SCRIPT";
  }

  // "*" would produce the *://*/* match pattern, so wildcard domains are rejected.
  isWildcardDomain(domain) {
    return (
      String(domain)
        .replace(/^www\./, "")
        .trim() === "*"
    );
  }

  // Domain list → browser match patterns ("*.example.com" also covers the bare domain)
  buildMatchPatterns(domains) {
    return domains.flatMap((d) => {
      const cleanDomain = d.replace(/^www\./, "");

      if (d.startsWith("*.")) {
        return [`*://${cleanDomain}/*`, `*://*.${cleanDomain}/*`];
      }
      return [`*://${cleanDomain}/*`, `*://www.${cleanDomain}/*`];
    });
  }

  async registerUserScript(script) {
    try {
      if (!script.id) {
        script.id = generateParserKey(script.domain, script.urlPatterns, script.authors || []);
      }

      if (!VALID_SCRIPT_ID_RE.test(script.id)) {
        logWarn("[userScriptWorker]: Rejected user script with invalid id:", script.id);
        return { ok: false, error: "Invalid script id" };
      }

      const domains = (Array.isArray(script.domain) ? script.domain : [script.domain]).filter(Boolean);

      if (domains.some((d) => this.isWildcardDomain(d))) {
        logWarn("[userScriptWorker]: Rejected user script with wildcard domain:", script.id);
        return { ok: false, error: "Wildcard domain not allowed" };
      }

      const matches = this.buildMatchPatterns(domains);

      const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
      const isEnabled = parserEnabledState[`enable_${script.id}`] !== false;
      if (!isEnabled) return { ok: true, skipped: true, reason: "Script is disabled" };

      // Checked before the nonce is created so a failed registration leaves nothing in storage.
      if (!browser.userScripts?.register) throw new Error("No compatible userscript API available");

      const trackingCode = this.buildTrackDataScript(script, await getOrCreateScriptNonce(script.id));
      const world = this.resolveWorld(trackingCode);
      const runAt = resolveRunAt(splitInitCode(script, false).initCode);

      // register() throws "Duplicate script ID" if one is already registered.
      const existingScripts = await browser.userScripts.getScripts();
      if (Array.isArray(existingScripts) && existingScripts.some((s) => s.id === script.id)) {
        await browser.userScripts.unregister({ ids: [script.id] });
      }

      const registeredUserScript = await browser.userScripts.register([
        {
          id: script.id,
          js: [{ code: trackingCode }],
          matches,
          runAt,
          world,
        },
      ]);
      this.registeredScripts.set(script.id, registeredUserScript);

      logInfo("[userScriptWorker]: Registered user script:", script.id);
      return { ok: true, registrationId: script.id, raw: registeredUserScript };
    } catch (error) {
      logError("[userScriptWorker]: Failed to register user script:", error);
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async unregisterUserScript(script, skipStorageUpdate = false) {
    if (!script?.id) return { ok: true, skipped: true, reason: "No script ID provided" };

    try {
      const existingScripts = await browser.userScripts.getScripts();
      const scriptExists = existingScripts.some((s) => s.id === script.id);

      if (!scriptExists) {
        return { ok: true, skipped: true, reason: "Script not registered" };
      }
      await browser.userScripts.unregister({ ids: [script.id] });

      const registeredUserScript = this.registeredScripts.get(script.id);
      if (registeredUserScript) await registeredUserScript.unregister();

      this.registeredScripts.delete(script.id);

      if (!skipStorageUpdate) {
        const scripts = await this.storage.getScripts();
        const scriptIndex = scripts.findIndex((s) => s.id === script.id);
        if (scriptIndex >= 0) {
          scripts[scriptIndex].registered = false;
          await this.storage.saveScripts(scripts);
        }
      }

      logInfo("[userScriptWorker]: Unregistered user script:", script.id);
      await this.delay(50);
      return { ok: true };
    } catch (error) {
      if (!error?.message?.includes("Nonexistent script ID")) {
        logError("[userScriptWorker]: Failed to unregister user script:", error);
      }
      return { ok: true };
    }
  }

  // Re-registers one script and files its id under results.successful / failed / disabled.
  async registerOneScript(script, parserEnabledState, results) {
    if (!script.id) script.id = generateParserKey(script.domain, script.urlPatterns, script.authors || []);

    const enabledKey = `enable_${script.id}`;
    if (parserEnabledState[enabledKey] === undefined) {
      parserEnabledState[enabledKey] = true;
    }

    await this.unregisterUserScript(script, true);

    if (parserEnabledState[enabledKey] === false) {
      script.registered = false;
      results.disabled.push(script.id);
      return;
    }

    await this.delay(50);
    const registrationResult = await this.registerUserScript(script);

    if (registrationResult.ok && !registrationResult.skipped) {
      script.registered = true;
      results.successful.push(script.id);
    } else if (registrationResult.skipped) {
      results.disabled.push(script.id);
    } else {
      script.registered = false;
      results.failed.push({ id: script.id, error: registrationResult.error });
    }
  }

  registerAllScripts() {
    const run = async () => {
      const scripts = await this.storage.getScripts();
      const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
      const results = { successful: [], failed: [], disabled: [] };

      for (const script of scripts) {
        try {
          await this.registerOneScript(script, parserEnabledState, results);
        } catch (error) {
          logError(`[userScriptWorker]: Error processing script ${script.id}:`, error);
          script.registered = false;
          results.failed.push({ id: script.id, error: error.message });
        }
      }

      await this.storage.saveScripts(scripts);

      logInfo(
        `[userScriptWorker]: Registration complete - successful: ${results.successful.length}, failed: ${results.failed.length}, disabled: ${results.disabled.length}`,
      );

      return results;
    };

    // Serialized so overlapping bulk runs cannot interleave per script.
    if (this._registrationMutex) return this._registrationMutex(run);
    return run();
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export main functionality
const scriptManager = new UserScriptManager();
