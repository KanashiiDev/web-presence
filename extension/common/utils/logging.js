// Logs
function _wpLogState() {
  const key = "__WP_LOG_STATE__";
  if (!Object.prototype.hasOwnProperty.call(globalThis, key) || !globalThis[key]) {
    globalThis[key] = {
      cache: null,
      initialized: false,
      listenerBound: false,
      pendingLoad: null,
    };
  }
  return globalThis[key];
}

function _wpLogReadSetting() {
  if (typeof CONFIG === "undefined" || CONFIG === null) return false;
  const configured = CONFIG.debugMode;
  if (configured === 1 || configured === true) return true;
  if (configured === 0 || configured === false) return false;
  return false;
}

function _wpLogApplyStoredValue(value) {
  const state = _wpLogState();
  state.cache = value === 1 || value === true ? true : value === 0 || value === false ? false : _wpLogReadSetting();
  state.initialized = true;
  return state.cache;
}

async function _loadDebugMode(force = false) {
  const state = _wpLogState();
  if (state.initialized && !force) return state.cache;
  // Single in-flight load: concurrent callers share one pending promise.
  if (state.pendingLoad) return state.pendingLoad;

  state.pendingLoad = (async () => {
    try {
      const stored = await browser.storage.local.get("debugMode");
      return _wpLogApplyStoredValue(stored?.debugMode);
    } catch {
      return _wpLogApplyStoredValue(undefined);
    } finally {
      state.pendingLoad = null;
    }
  })();

  return state.pendingLoad;
}

function _wpBindStorageListener() {
  const state = _wpLogState();
  if (state.listenerBound) return;
  try {
    if (typeof browser !== "undefined" && browser.storage?.onChanged?.addListener) {
      browser.storage.onChanged.addListener((changes) => {
        if (changes && Object.prototype.hasOwnProperty.call(changes, "debugMode")) {
          _wpLogApplyStoredValue(changes.debugMode?.newValue);
        }
      });
      state.listenerBound = true; // only marked once the listener really exists
    }
  } catch {}
}

// Lazy initialization: the cache is warmed and the storage listener bound on first
// use. This is a FUNCTION declaration, not a top level statement, so that the build
// pipeline (which only extracts declarations) can never drop it from a bundle.
function _wpLogEnsureInit() {
  const state = _wpLogState();
  if (state.listenerBound) return state.cache;
  _wpBindStorageListener();
  _loadDebugMode().catch(() => _wpLogApplyStoredValue(undefined));
  return state.cache;
}

function detectBrowser() {
  const url = browser.runtime.getURL("");

  if (url.startsWith("moz-extension://")) {
    return "firefox";
  }

  return "chrome";
}

// Metadata keys accepted as the trailing argument of log functions.
// A trailing plain object whose keys are all in this set is treated as
// optional log metadata rather than a log argument.
const LOG_META_KEYS = new Set(["tabId", "tabUrl", "hostname", "parserId"]);

function _extractLogMeta(args) {
  const last = args[args.length - 1];
  if (last && typeof last === "object" && !Array.isArray(last)) {
    const keys = Object.keys(last);
    if (keys.length > 0 && keys.every((k) => LOG_META_KEYS.has(k))) {
      return { meta: last, args: args.slice(0, -1) };
    }
  }
  return { meta: null, args };
}

// Debug mode checks.
// Synchronous: the value is cached in memory, refreshed by a storage listener.
function getDebugMode() {
  _wpLogEnsureInit();
  const state = _wpLogState();
  return state.initialized && state.cache !== null ? state.cache : _wpLogReadSetting();
}

function getDebugModeSync() {
  return getDebugMode();
}

// Write helper
function _writeDebugLog(level, args, meta) {
  _wpLogEnsureInit();
  const _LOG_SOURCE = (() => {
    if (typeof window === "undefined") return "background";
    if (location.protocol === "moz-extension:" && location.pathname === "/_generated_background_page.html") return "background";
    return "content";
  })();

  const _IS_BACKGROUND = _LOG_SOURCE === "background";
  try {
    if (_IS_BACKGROUND) {
      if (typeof debugLog === "function") {
        debugLog(level, _LOG_SOURCE, args, meta);
      }
    } else {
      if (typeof browser !== "undefined" && browser?.runtime?.sendMessage) {
        const payload = { action: "debug_log", level, source: _LOG_SOURCE, args: args.map(String) };
        if (meta) {
          payload.tabId = meta.tabId;
          payload.tabUrl = meta.tabUrl;
          payload.hostname = meta.hostname;
          payload.parserId = meta.parserId;
        }
        browser.runtime.sendMessage(payload).catch(() => {});
      }
    }
  } catch {}
}

// Structured log builder (fields: ctx, event, level, timestamp + caller supplied context)
function _buildStructuredLog(level, ctx, event, data) {
  const payload = {
    level: level,
    ctx: ctx,
    event: event,
    timestamp: Date.now(),
  };
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const key of Object.keys(data)) payload[key] = data[key];
  } else if (data !== undefined && data !== null) {
    payload.detail = data;
  }
  return payload;
}

// Structured logging helpers.
// Read-only: they never log complete media payloads or user settings.
const logInfoStructured = (ctx, event, data, meta) => {
  _writeDebugLog("info", [_buildStructuredLog("info", ctx, event, data)], meta);
  if (getDebugMode()) {
    console.info("%c[WEB-PRESENCE - INFO]", "color:#2196f3; font-weight:bold;", ctx, event, data || "");
  }
};

const logWarnStructured = (ctx, event, data, meta) => {
  _writeDebugLog("warn", [_buildStructuredLog("warn", ctx, event, data)], meta);
  if (getDebugMode()) {
    console.warn("[WEB-PRESENCE - WARN]", ctx, event, data || "");
  }
};

const logErrorStructured = (ctx, event, data, meta) => {
  _writeDebugLog("error", [_buildStructuredLog("error", ctx, event, data)], meta);
  if (getDebugMode()) {
    console.error("[web-presence - ERROR]", ctx, event, data || "");
  }
};

const logDebugStructured = (ctx, event, data, meta) => {
  _writeDebugLog("debug", [_buildStructuredLog("debug", ctx, event, data)], meta);
  if (getDebugMode()) {
    console.debug("[web-presence - DEBUG]", ctx, event, data || "");
  }
};

// Log functions
const logInfo = async (...args) => {
  const { meta, args: cleanArgs } = _extractLogMeta(args);

  const _shouldPersist = (args) => {
    return typeof args[0] === "string" && /^\[[\w\s:\/\-]+\]/.test(args[0]);
  };

  const _stripConsoleFormatting = (args) => {
    if (typeof args[0] !== "string" || !args[0].includes("%c")) return args;
    const msg = args[0].replace(/%c/g, "");
    const cleaned = [msg];
    let cssSkip = (args[0].match(/%c/g) || []).length;
    for (let i = 1; i < args.length; i++) {
      if (cssSkip > 0 && typeof args[i] === "string" && args[i].includes("color:")) {
        cssSkip--;
        continue;
      }
      cleaned.push(args[i]);
    }
    return cleaned;
  };

  // Only those starting with [TAG] in IndexedDB
  if (_shouldPersist(cleanArgs)) {
    _writeDebugLog("info", _stripConsoleFormatting(cleanArgs), meta);
  }

  if (getDebugMode()) {
    const prefix = "[WEB-PRESENCE - INFO]";
    if (typeof cleanArgs[0] === "string" && cleanArgs[0].includes("%c")) {
      console.info(`%c${prefix}%c ${cleanArgs[0]}`, "color:#2196f3; font-weight:bold;", "color:#fff;", ...cleanArgs.slice(1));
    } else {
      console.info(`%c${prefix}`, "color:#2196f3; font-weight:bold;", ...cleanArgs);
    }
  }
};

const logWarn = async (...args) => {
  const { meta, args: cleanArgs } = _extractLogMeta(args);

  _writeDebugLog("warn", cleanArgs, meta);

  if (getDebugMode()) {
    const prefix = "%c[WEB-PRESENCE - WARN]%c";
    const prefixCSS = ["color:#ff9800; font-weight:bold;", "color:#fff;"];
    console.log(prefix, ...prefixCSS, ...cleanArgs);
  }
};

const errorFilter = (() => {
  const ignorePatterns = [
    /No tab with id/i,
    /extension context invalidated/i,
    /could not establish connection/i,
    /browser is shutting down/i,
    /failed to fetch/i,
    /update failed after all retries/i,
    /update failed \(no response\)/i,
    /Request timed out/i,
    /signal is aborted without reason/i,
    /Nonexistent script ID/i,
    /Cannot read properties of undefined \(reading \'getScripts\'\)/i,
    /No compatible userscript API available/i,
  ];

  const normalizeError = (err) => {
    if (!err) return "";
    if (typeof err === "string") return err;
    return err.message || err.stack || String(err);
  };

  const shouldIgnore = (error) => {
    const text = normalizeError(error);
    return ignorePatterns.some((re) => re.test(text));
  };

  return { shouldIgnore };
})();

const logError = (...a) => {
  const { meta, args: cleanArgs } = _extractLogMeta(a);

  const safeStringify = (obj) => {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
  };

  const shouldIgnoreAny = cleanArgs.some((arg) => errorFilter.shouldIgnore(arg));

  if (!shouldIgnoreAny) {
    _writeDebugLog("error", cleanArgs, meta);

    if (getDebugMode()) {
      console.error(
        "[web-presence - ERROR]",
        ...cleanArgs.map((arg) => {
          if (arg instanceof Error) {
            return `${arg.name || ""} ${arg.message || ""} ${arg.stack || ""}`;
          } else if (typeof arg === "object" && arg !== null) {
            return safeStringify(arg);
          }
          return arg?.toString?.() || "";
        }),
      );
    }
  }
};
