const STORAGE_KEY = "userScriptsList";

// JSON.stringify escapes the value safely for injection into generated code.
function q(value) {
  return JSON.stringify(value == null ? "" : String(value));
}

// One session nonce per user script id ("userScriptNonces"); the generated code
// echoes it on every USER_SCRIPT_* message and mainParser.js validates it.
const USER_SCRIPT_NONCES_KEY = "userScriptNonces";

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
  // Regex string → JS RegExp object
  static toRegex(pattern) {
    if (!pattern) return /.*/;
    try {
      let cleanPattern = pattern.trim();
      if (cleanPattern.startsWith("/") && cleanPattern.endsWith("/")) {
        cleanPattern = cleanPattern.slice(1, -1);
      } else if (cleanPattern.startsWith("/") && cleanPattern.endsWith("/i")) {
        cleanPattern = cleanPattern.slice(1, -2);
        return new RegExp(cleanPattern, "i");
      }

      return new RegExp(cleanPattern);
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

        if (trimmed.startsWith("/") && (trimmed.endsWith("/") || trimmed.endsWith("/i"))) {
          return trimmed;
        }
        return `/${trimmed}/`;
      })
      .filter(Boolean);
  }

  // Return the pattern list as regex and normalized list
  static processPatterns(patterns) {
    const list = this.normalizePatterns(patterns);
    const regexList = [];
    const invalidPatterns = [];

    for (const p of list) {
      let clean = p.trim();
      if (clean.startsWith("/") && clean.endsWith("/i")) clean = clean.slice(1, -2);
      else if (clean.startsWith("/") && clean.endsWith("/")) clean = clean.slice(1, -1);

      try {
        new RegExp(clean);
        regexList.push(this.toRegex(p));
      } catch {
        invalidPatterns.push(p);
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
    // setMemo is used by this script -> run a silent first pass right away (see startScriptExecution)
    const usesSetMemo = /\bsetMemo\s*\(/.test(script.code || "");

    return `
    // AUTO-GENERATED-UTILS
    // _INLINE_UTILS
    function normalizeTrackData(input) {
      const seen = new WeakSet();

      function clean(value, path) {
        path = path || "root";

        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
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
          if (${Boolean(script.debug)}) {
            console.warn("Dropped DOM value at:", path);
          }
          return null;
        }

        if (typeof value === "object") {
          if (seen.has(value)) return null;
          seen.add(value);
        }

        if (Array.isArray(value)) {
          return value.map((v, i) => clean(v, path + "[" + i + "]"));
        }

        if (typeof value === "object") {
          const out = {};
          for (const key in value) {
            const nextPath = path + "." + key;
            const v = clean(value[key], nextPath);
            if (v !== undefined) out[key] = v;
          }
          return out;
        }

        return null;
      }

      return clean(input, "root");
    }
    // MAIN
    (async function() {
      const trackState = {};
      // Session nonce: lets mainParser.js tell registered scripts from page-forged postMessages.
      const __nonce = ${q(nonce)};
        const __userScriptUsedSettings = [];
        let __clearCalled = false;
        function waitForParserReady() {
          return new Promise((resolve) => {
            if (window.__parserSystemReady) return resolve();

            let isSettled = false;
            const cleanup = () => {
              if (!isSettled) {
                isSettled = true;
                window.removeEventListener("message", messageHandler);
                clearTimeout(timeoutId);
              }
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
                __userScriptLog("info", "waitForParserReady.resolved", { waitedMs: 8000 });
                resolve();
              }
            }

            window.addEventListener("message", messageHandler);
            window.postMessage({ type: "QUERY_PARSER_READY" }, "*");
          });
        }
        function useSetting(key, label, type, defaultValue) {
          __userScriptUsedSettings.push({ key, label, type, defaultValue });
          return new Promise((resolve, reject) => {
            const requestId = \`useSetting_\${Date.now()}_\${Math.random()}\`;

            const cleanup = () => {
              clearTimeout(timeoutId);
              window.removeEventListener("message", handleResponse);
            };

            const timeoutId = setTimeout(() => {
              cleanup();
              __userScriptLog("error", "useSetting.timeout", { key: key, waitedMs: 5000 });
              reject(new Error("useSetting timeout"));
            }, 5000);

            function handleResponse(event) {
              if (event.source !== window) return;
              const msg = event.data;
              if (!msg || msg.type !== "USER_SCRIPT_USE_SETTING_RESPONSE" || msg.requestId !== requestId) return;

              cleanup();
              resolve(msg.value);
            }

            window.addEventListener("message", handleResponse);

            window.postMessage({
              type: "USER_SCRIPT_USE_SETTING_REQUEST",
              requestId,
              nonce: __nonce,
              id: ${q(script.id)},
              key,
              label,
              inputType: type,
              defaultValue
            }, "*");
          });
        }
        function clearActivity() {
          __clearCalled = true;
          throw new __ClearSignal();
        }
        function __ClearSignal() {}
        __ClearSignal.prototype = Object.create(Error.prototype);
        // MEMO (setMemo / getMemo): tab-scoped, memory-only data shared between pages of the same host
        const __memoCache = Object.create(null);
        let __dryRun = false;
        let __memoLoaded = false;
        // Userscript logging bridge
        const __userScriptLogOnceKeys = Object.create(null);
        const __userScriptLogLastContent = Object.create(null);
        function __userScriptLog(level, event, data = {}) {
          try {
            // Deduplicate: if the meaningful content (excluding ts) is unchanged
            // from the last log for this event, skip posting. Prevents spam from
            // polls like trackData.summary where only the timestamp changes.
            if (level !== "error") {
              const signature = JSON.stringify({ ...data });
              const lastSignature = __userScriptLogLastContent[event];
              if (lastSignature === signature) return;
              __userScriptLogLastContent[event] = signature;
            }

            const logData = {
              scriptId: ${q(script.id)},
              title: ${q(script.title)},
              domain: ${q(Array.isArray(script.domain) ? script.domain[0] : script.domain)},
              source: "mainParser:userScript",
              ts: Date.now(),
              ...data,
            };

            if (level === "error" && data.error instanceof Error) {
              logData.errorName = data.error.name || "Error";
              logData.errorMessage = data.error.message ? String(data.error.message).slice(0, 500) : "";
              logData.errorStack = data.error.stack ? String(data.error.stack).slice(0, 1000) : "";
              delete logData.error;
            }

            for (const key of Object.keys(data)) {
              const val = data[key];
              if (val === null || val === undefined || val === "") {
                logData.emptyField = key;
                break;
              }
            }

            window.postMessage({
              type: "USER_SCRIPT_LOG",
              nonce: __nonce,
              id: ${q(script.id)},
              level: level,
              event: String(event).slice(0, 120),
              data: logData,
            }, "*");
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
            if (__userScriptLogOnceKeys[k] <= cutoff) {
              delete __userScriptLogOnceKeys[k];
            }
          }

          __userScriptLog(level, event, { detail: message, ...data });
        }
        function __memoWarn(msg) {
          __userScriptLog("warn", "memo.warn", { msg });
        }
        function __memoScope(scope) {
          let s = null;
          if (typeof scope === "number") s = Number.isFinite(scope) ? String(scope) : null;
          else if (typeof scope === "string") s = scope.trim() || null;
          if (s === "__proto__" || s === "constructor" || s === "prototype") return null;
          return s;
        }
        function __memoRequest(type) {
          return new Promise((resolve) => {
            const requestId = "memo_" + Date.now() + "_" + Math.random();

            const cleanup = () => {
              clearTimeout(timeoutId);
              window.removeEventListener("message", handleResponse);
            };

            const timeoutId = setTimeout(() => {
              cleanup();
              __userScriptLogOnce("warn", "memo.request.timeout", "memo request timed out", 10000, { waitedMs: 3000 });
              resolve(null);
            }, 3000);

            function handleResponse(event) {
              if (event.source !== window) return;
              const msg = event.data;
              if (!msg || msg.type !== "USER_SCRIPT_MEMO_RESPONSE" || msg.requestId !== requestId) return;

              cleanup();
              resolve(msg.data || null);
            }

            window.addEventListener("message", handleResponse);
            window.postMessage({ type, requestId, nonce: __nonce, id: ${q(script.id)} }, "*");
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
              if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
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
            if (!key || key === "__proto__" || key === "constructor" || key === "prototype") continue;
            const value = data[key];
            if (JSON.stringify(bucket[key] ?? null) === JSON.stringify(value)) continue;
            if (value === null) delete bucket[key];
            else bucket[key] = value;
            changed[key] = value;
            hasChange = true;
          }
          if (!hasChange) return;
          window.postMessage({ type: "USER_SCRIPT_MEMO_SET", nonce: __nonce, id: ${q(script.id)}, scope: s, data: changed }, "*");
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
        function getIframeData() {
          return new Promise((resolve) => {
            const requestId = \`iframeData_\${Date.now()}_\${Math.random()}\`;

            const cleanup = () => {
              clearTimeout(timeoutId);
              window.removeEventListener("message", handleResponse);
            };

            const timeoutId = setTimeout(() => {
              cleanup();
              resolve(null);
            }, 12000);

            function handleResponse(event) {
              if (event.source !== window) return;
              const msg = event.data;
              if (!msg || msg.type !== "USER_SCRIPT_IFRAME_DATA_RESPONSE" || msg.requestId !== requestId) return;
              
              cleanup();
              resolve(msg.data || null);
            }

            window.addEventListener("message", handleResponse);

            window.postMessage({
              type: "USER_SCRIPT_IFRAME_DATA_REQUEST",
              requestId,
              nonce: __nonce,
              id: ${q(script.id)},
              iframeSelectors: ${JSON.stringify(script.iframeSelectors || null)},
            }, "*");
          });
        }
        // update trackData
        async function updateTrackData() {
          try {
            __clearCalled = false;
            await __refreshMemo();
            // UserScript
            ${script.code || ""}

            if (__dryRun) return;
            if (__clearCalled) {
              window.postMessage({
                type: "USER_SCRIPT_CLEAR_ACTIVITY",
                nonce: __nonce,
                id: ${q(script.id)},
                domain: ${q(Array.isArray(script.domain) ? script.domain[0] : script.domain)},
              }, "*");
              return;
            }

            const resolvedSongUrl = typeof songUrl === "undefined" || songUrl == null ? null : typeof songUrl === "string" || typeof songUrl === "number" ? String(songUrl) : null;
            const resolvedLink = typeof link === "undefined" || link == null ? null : typeof link === "string" || typeof link === "number" ? String(link) : null;
            const finalLink = resolvedSongUrl ?? resolvedLink;
            // update trackState
            trackState.title = typeof title === "undefined" || title == null ? null : typeof title === "string" || typeof title === "number" ? String(title) : null;
            trackState.artist = typeof artist === "undefined" || artist == null ? null : typeof artist === "string" || typeof artist === "number" ? String(artist) : null;
            trackState.image = typeof image === "undefined" || image == null ? null : typeof image === "string" || typeof image === "number" ? String(image) : null;
            trackState.source = typeof source === "undefined" || source == null ? null : typeof source === "string" || typeof source === "number" ? String(source) : null;
            trackState.songUrl = finalLink;
            trackState.link = finalLink;
            trackState.timePassed = typeof timePassed === "undefined" || timePassed == null ? null : typeof timePassed === "number" || typeof timePassed === "string" ? timePassed : null;
            trackState.duration = typeof duration === "undefined" || duration == null ? null : typeof duration === "number" || typeof duration === "string" ? duration : null;
            trackState.isPlaying = typeof isPlaying === "undefined" || isPlaying == null ? null : Boolean(isPlaying);
            trackState.buttons = typeof buttons === "undefined" || buttons == null ? null : Array.isArray(buttons) ? buttons : null;

            // Track Data
            const trackData = {
              id: ${q(script.id)},
              version: ${q(script.version || "1.0.0")},
              domain: ${q(Array.isArray(script.domain) ? script.domain[0] : script.domain)},
              domains: ${JSON.stringify(Array.isArray(script.domain) ? script.domain : [script.domain])},
              authors: ${JSON.stringify(script.authors || [])},
              authorsLinks: ${JSON.stringify(script.authorsLinks || [])},
              homepage: ${q(script.homepage || "")},
              description: ${q(script.description || "")},
              urlPatterns: ${JSON.stringify(normalizedList)},
              title: ${q(script.title || "Unknown")},
              category: ${JSON.stringify(script.category || [])},
              mode: ${q(script.mode || "listen")},
              watchAutoDetect: ${q(script.watchAutoDetect || "disable")},
              iframeSelectors: ${JSON.stringify(script.iframeSelectors || null)},
              isLibraryActivity: ${Boolean(script.storeScriptId)},
              song: normalizeTrackData({ ...trackState })
            };

            // Debug Mode
            if (${Boolean(script.debug)} && trackData) {
              const now = new Date();
              const timeString = \`\${String(now.getHours()).padStart(2,'0')}:\${String(now.getMinutes()).padStart(2,'0')}:\${String(now.getSeconds()).padStart(2,'0')}\`;
              console.groupCollapsed(\`%c Web Presence - USERSCRIPT DEBUG [%c\${timeString}%c]: %c\${trackData.title}\`,
                "color: #7bd583ff; font-weight: bold; font-size: 14px;",
                "color: #cfa600ff; font-weight: bold; font-size: 14px;",
                "color: #7bd583ff; font-weight: bold; font-size: 14px;",
                "color: #efefefff; font-weight: bold; font-size: 14px;"
              );
              console.log("%cScript Information:", "color: #ffb86c; font-weight: bold; font-size: 13px;");
              console.log("  • Title:       ", trackData.title);
              console.log("  • Domain:      ", trackData.domain);
              console.log("  • Url Patterns:", trackData.urlPatterns || "—");
              console.log("  • Mode:        ", trackData.mode);
              const song = trackData.song;
              console.log("%cSong Information:", "color: #8be9fd; font-weight: bold; font-size: 13px;");
              console.log("  • Title:      ", song.title || "Unknown");
              console.log("  • Artist:     ", song.artist || "Unknown");
              console.log("  • Source:     ", song.source || trackData.title || "Unknown");
              console.log("  • Song URL:   ", song.link || "N/A");
              console.log("  • Image:      ", song.image || "Default Image");
              console.log("  • Duration:   ", ${q(script.watchAutoDetect || "disable")} === "enable" ? "Auto-Detect" : song.duration ?? "N/A");
              console.log("  • Time Passed:", ${q(script.watchAutoDetect || "disable")} === "enable" ? "Auto-Detect" : song.timePassed ?? "N/A");
              console.log("  • isPlaying:  ", ${q(script.watchAutoDetect || "disable")} === "enable" ? "Auto-Detect" : song.isPlaying ?? "N/A");
              console.log("  • Buttons:    ", song.buttons ?? "N/A");
              console.groupEnd();
            }

            __userScriptLog("info", "trackData.summary", {
              title: Boolean(trackData.title),
              artist: Boolean(trackData.song?.artist),
              source: Boolean(trackData.song?.source),
              link: Boolean(trackData.song?.link),
              positionSet: trackData.song?.position != null,
              durationSet: trackData.song?.duration != null,
              isPlaying: trackData.song?.isPlaying ?? false,
              buttonCount: trackData.song?.buttons?.length ?? 0,
            });

            window.postMessage({ type: "USER_SCRIPT_TRACK_DATA", nonce: __nonce, data: { ...trackData, iframeSelectors: ${JSON.stringify(script.iframeSelectors || null)},}}, "*");
            __userScriptLogOnce("info", "updateTrackData.sent", "track data sent", 30000);
          } catch (error) {
            if (__dryRun) return;
            if (error instanceof __ClearSignal) {
              __userScriptLog("info", "updateTrackData.cleared", {});
              window.postMessage({
                type: "USER_SCRIPT_CLEAR_ACTIVITY",
                nonce: __nonce,
                id: ${q(script.id)},
                domain: ${q(Array.isArray(script.domain) ? script.domain[0] : script.domain)},
              }, "*");
              return;
            }
            // Summary only: the full payload stays in the local groupCollapsed output.
            __userScriptLog("error", "updateTrackData.failed", { error: error });
            const now = new Date();
            const timeString = \`\${String(now.getHours()).padStart(2,'0')}:\${String(now.getMinutes()).padStart(2,'0')}:\${String(now.getSeconds()).padStart(2,'0')}\`;
            console.groupCollapsed(\`%c Web Presence - USERSCRIPT ERROR [%c\${timeString}%c]: %cTracking Failed\`,
              "color: #ff5555ff; font-weight: bold; font-size: 14px;",
              "color: #cfa600ff; font-weight: bold; font-size: 14px;",
              "color: #ff5555ff; font-weight: bold; font-size: 14px;",
              "color: #efefefff; font-weight: bold; font-size: 14px;"
            );
            console.log("%cError Details:", "color: #ff5555; font-weight: bold; font-size: 13px;");
            console.log("  • Message :", error.message || String(error));
            if (error.stack) console.log("  • Stack   :", error.stack);
            console.groupEnd();
          }
        }
      async function startScriptExecution() {
        __userScriptLog("info", "script.start", { intervalMs: 4000 });
        if (${Boolean(usesSetMemo)}) {
          // silent first pass: only the setMemo side effects run, nothing is sent to the parser
          __dryRun = true;
          try {
            await updateTrackData();
          } catch {}
          __dryRun = false;
        }
        await waitForParserReady();
        const INTERVAL_DELAY = 4000;
        async function loop() {
          try {
            await updateTrackData();
          } catch (err) {
            __userScriptLogOnce("error", "loop.error", err && err.message ? String(err.message).slice(0, 300) : "loop error", 5000, { error: err });
          } finally {
            setTimeout(loop, INTERVAL_DELAY);
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
    if (userScriptIndex === -1) {
      return "USER_SCRIPT";
    }
    const headerSlice = lines.slice(userScriptIndex, userScriptIndex + 5).join("\n");
    const match = headerSlice.match(/\/\/\s*@world\s+(main|isolated)/);
    if (!match) return "USER_SCRIPT";
    return match[1] === "main" ? "MAIN" : "USER_SCRIPT";
  }

  async registerUserScript(script) {
    try {
      if (!script.id) {
        script.id = generateParserKey(script.domain, script.urlPatterns, script.authors || []);
      }
      // Only ids safe to embed in the generated script are accepted.
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(script.id)) {
        logWarn("[userScriptWorker]: Rejected user script with invalid id:", script.id);
        return { ok: false, error: "Invalid script id" };
      }
      const manifest = browser.runtime.getManifest();
      const isMV3 = manifest.manifest_version === 3;

      const domains = (Array.isArray(script.domain) ? script.domain : [script.domain]).filter(Boolean);

      // A "*" domain would produce the *://*/* match pattern; wildcard domains are rejected.
      const hasWildcardDomain = domains.some(
        (d) =>
          String(d)
            .replace(/^www\./, "")
            .trim() === "*",
      );
      if (hasWildcardDomain) {
        logWarn("[userScriptWorker]: Rejected user script with wildcard domain:", script.id);
        return { ok: false, error: "Wildcard domain not allowed" };
      }

      const matches = domains.flatMap((d) => {
        const cleanDomain = d.replace(/^www\./, "");

        if (d.startsWith("*.")) {
          return [`*://${cleanDomain}/*`, `*://*.${cleanDomain}/*`];
        } else {
          return [`*://${cleanDomain}/*`, `*://www.${cleanDomain}/*`];
        }
      });

      const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
      const isEnabled = parserEnabledState[`enable_${script.id}`] !== false;

      if (!isEnabled) return { ok: true, skipped: true, reason: "Script is disabled" };

      const trackingCode = this.buildTrackDataScript(script, await getOrCreateScriptNonce(script.id));

      const world = this.resolveWorld(trackingCode);

      if (!browser.userScripts?.register) throw new Error("No compatible userscript API available");

      let registeredUserScript = null;

      if (isMV3) {
        // register() throws "Duplicate script ID" if one is already registered.
        const existingScripts = await browser.userScripts.getScripts();
        if (Array.isArray(existingScripts) && existingScripts.some((s) => s.id === script.id)) {
          await browser.userScripts.unregister({ ids: [script.id] });
        }

        registeredUserScript = await browser.userScripts.register([
          {
            id: script.id,
            js: [{ code: trackingCode }],
            matches,
            runAt: script.runAt || "document_end",
            world,
          },
        ]);
        this.registeredScripts.set(script.id, registeredUserScript);
      }

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
      const manifest = browser.runtime.getManifest();
      const isMV3 = manifest.manifest_version === 3;

      if (isMV3) {
        const existingScripts = await browser.userScripts.getScripts();
        const scriptExists = existingScripts.some((s) => s.id === script.id);

        if (!scriptExists) {
          return { ok: true, skipped: true, reason: "Script not registered" };
        }
        await browser.userScripts.unregister({ ids: [script.id] });
      }

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
      if (!error.message.includes("Nonexistent script ID")) {
        logError("[userScriptWorker]: Failed to unregister user script:", error);
      }
      return { ok: true };
    }
  }

  registerAllScripts() {
    const run = async () => {
      const scripts = await this.storage.getScripts();
      const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
      const results = { successful: [], failed: [], disabled: [] };

      for (const script of scripts) {
        try {
          if (!script.id) script.id = generateParserKey(script.domain, script.urlPatterns, script.authors || []);

          if (parserEnabledState[`enable_${script.id}`] === undefined) {
            parserEnabledState[`enable_${script.id}`] = true;
          }

          await this.unregisterUserScript(script, true);

          if (parserEnabledState[`enable_${script.id}`] === false) {
            script.registered = false;
            results.disabled.push(script.id);
            continue;
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
