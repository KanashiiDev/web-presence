// Logs
// Write helper
function _writeDebugLog(level, args) {
  const _LOG_SOURCE = (() => {
    if (typeof window === "undefined") return "background";
    return "content";
  })();

  const _IS_BACKGROUND = _LOG_SOURCE === "background";
  try {
    if (_IS_BACKGROUND) {
      if (typeof debugLog === "function") {
        debugLog(level, _LOG_SOURCE, args);
      }
    } else {
      if (typeof browser !== "undefined" && browser?.runtime?.sendMessage) {
        browser.runtime.sendMessage({ action: "debug_log", level, source: _LOG_SOURCE, args: args.map(String) }).catch(() => {});
      }
    }
  } catch {}
}

// Debug mode check
const getDebugMode = async () => {
  try {
    const stored = await browser.storage.local.get("debugMode");
    return stored?.debugMode === 1 ? true : stored?.debugMode === 0 ? false : (CONFIG?.debugMode ?? false);
  } catch {
    return CONFIG?.debugMode ?? false;
  }
};

// Log functions
const logInfo = async (...args) => {
  if (!(await getDebugMode())) return;

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
  if (_shouldPersist(args)) {
    _writeDebugLog("info", _stripConsoleFormatting(args));
  }

  const prefix = "[WEB-PRESENCE - INFO]";
  if (typeof args[0] === "string" && args[0].includes("%c")) {
    console.info(`%c${prefix}%c ${args[0]}`, "color:#2196f3; font-weight:bold;", "color:#fff;", ...args.slice(1));
  } else {
    console.info(`%c${prefix}`, "color:#2196f3; font-weight:bold;", ...args);
  }
};

const logWarn = async (...args) => {
  if (!(await getDebugMode())) return;

  _writeDebugLog("warn", args);

  const prefix = "%c[WEB-PRESENCE - WARN]%c";
  const prefixCSS = ["color:#ff9800; font-weight:bold;", "color:#fff;"];
  console.log(prefix, ...prefixCSS, ...args);
};

const errorFilter = (() => {
  const ignorePatterns = [
    /No tab with id/i,
    /extension context invalidated/i,
    /could not establish connection/i,
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

  const shouldIgnoreAny = a.some((arg) => errorFilter.shouldIgnore(arg));

  if (!shouldIgnoreAny) {
    _writeDebugLog("error", a);

    console.error(
      "[web-presence - ERROR]",
      ...a.map((arg) => {
        if (arg instanceof Error) {
          return `${arg.name || ""} ${arg.message || ""} ${arg.stack || ""}`;
        } else if (typeof arg === "object" && arg !== null) {
          return safeStringify(arg);
        }
        return arg?.toString?.() || "";
      }),
    );
  }
};

function detectBrowser() {
  const url = browser.runtime.getURL("");

  if (url.startsWith("moz-extension://")) {
    return "firefox";
  }

  return "chrome";
}
