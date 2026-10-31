const { app, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const { state } = require("./state");
const path = require("path");
const fs = require("fs");

let _userDataPath = null;
let _log = null;
let _logFilePath = null;
let _historyFilePath = null;
let _dbPath = null;
let _config = null;

function init({ log, userDataPath, logFilePath, historyFilePath, dbPath, config }) {
  _userDataPath = userDataPath;
  _log = log;
  _logFilePath = logFilePath;
  _historyFilePath = historyFilePath;
  _dbPath = dbPath;
  _config = config;
}

// Getters — called by other modules after init
const getUserDataPath = () => _userDataPath;
const getLogFilePath = () => _logFilePath;
const getHistoryFilePath = () => _historyFilePath;
const getDbPath = () => _dbPath;
const getConfig = () => _config;

// Console Safety
// Wrap console methods to avoid uncaught write errors (EIO) in packaged environments.
// This will swallow EIO write errors and attempt to surface a short warning via electron-log (if available).
function safeConsoleWrap(log) {
  const methods = ["log", "info", "error"];
  for (const m of methods) {
    const orig = console[m];
    if (!orig || typeof orig !== "function") continue;
    console[m] = function (...args) {
      try {
        return orig.apply(console, args);
      } catch (err) {
        try {
          if (err && err.code === "EIO") {
            // Suppress EIO - try to record it to electron-log without throwing.
            if (log && typeof log.warn === "function") {
              try {
                // convert args to short string
                const msg = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
                log.warn(`Console write EIO suppressed: ${msg}`);
              } catch (_) {}
            }
            return;
          }
        } catch (_) {
          // ignore any secondary errors while attempting diagnostics
        }
        // If it's a different error or we couldn't handle it, swallow to avoid crashing the app.
      }
    };
  }
}

// Paths
const isPackaged = require("electron").app.isPackaged;
const RESOURCE_ROOT = process.env.WEB_PRESENCE_NIX === "true" ? path.dirname(process.argv[1]) : process.resourcesPath;

function getAppPath(...p) {
  return path.join(__dirname, ...p);
}

function getServerPath(...p) {
  return path.join(__dirname, "..", "server", ...p);
}

function getResourcePath(...p) {
  return isPackaged ? path.join(RESOURCE_ROOT, ...p) : path.join(__dirname, "..", ...p);
}

function getIconPath(size = null) {
  const baseDir = getAppPath("assets", "icon");

  let fileName;
  switch (process.platform) {
    case "win32":
      fileName = size ?? "icon.ico";
      break;
    case "darwin":
      fileName = "24x24.png";
      break;
    default:
      fileName = "48x48.png";
      break;
  }

  const iconPath = path.join(baseDir, fileName);
  if (fs.existsSync(iconPath)) return iconPath;

  _log?.warn(`Tray icon not found: ${iconPath}`);
  const fallback = path.join(baseDir, "icon.png");
  return fs.existsSync(fallback) ? fallback : null;
}

const icons = {
  notification: getIconPath(),
  message: getIconPath("32x32.png"),
  tray: getIconPath("24x24.png"),
  tray_win: getIconPath("16x16.png"),
};

// File Logging
const MAX_LOG_ENTRIES = 3000;
let _logToFileWarned = false;

function logToFile(error, type = "UnknownError") {
  try {
    if (!_logFilePath) return;

    let entries = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(_logFilePath, "utf-8"));
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      entries = [];
    }

    entries.push({
      timestamp: new Date().toISOString(),
      type,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    });
    if (entries.length > MAX_LOG_ENTRIES) entries = entries.slice(-MAX_LOG_ENTRIES);

    fs.writeFileSync(_logFilePath, JSON.stringify(entries, null, 2));
  } catch (err) {
    // Logging must never take the app down; report once instead of once per line.
    if (!_logToFileWarned) {
      _logToFileWarned = true;
      try {
        _log?.warn(`[Log] Cannot write ${_logFilePath} (${err.code ?? err.message})`);
      } catch (_) {}
    }
  }
}

async function openUrl(url) {
  if (process.platform === "linux" && process.env.WEB_PRESENCE_NIX === "true") {
    const uid = process.getuid();
    const env = { ...process.env };

    // XDG_RUNTIME_DIR
    if (!env.XDG_RUNTIME_DIR) {
      env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    }

    // DBus session
    if (!env.DBUS_SESSION_BUS_ADDRESS) {
      env.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${uid}/bus`;
    }

    // NixOS library conflict fixes
    delete env.LD_LIBRARY_PATH;
    delete env.GIO_EXTRA_MODULES;
    delete env.GDK_PIXBUF_MODULE_FILE;
    delete env.GTK_PATH;

    // Spawn xdg-open with the modified environment
    const child = spawn("xdg-open", [url], {
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (child.stdout) child.stdout.unref();
    if (child.stderr) child.stderr.unref();

    child.on("error", (err) => _log.error("[openUrl] xdg-open error:", err.message));
    child.unref();
    return;
  }

  await shell.openExternal(url);
}

// Shell Helpers
function openStatus() {
  const url = `http://localhost:${_config?.PORT}`;
  openUrl(url);
}

function openLogs() {
  const logPath = _log.transports.file.getFile().path;
  if (!fs.existsSync(logPath)) {
    dialog.showMessageBox({
      type: "info",
      buttons: ["OK"],
      title: "Log File",
      message: "Log file does not exist yet",
      detail: "The application needs to run for a while to generate logs.",
      icon: icons.message,
    });
    return;
  }
  shell.openPath(logPath).catch((err) => {
    _log.error("Failed to open logs:", err);
    dialog.showErrorBox("Error", `Could not open log file. Try viewing it manually at: ${logPath}`);
  });
}

function openConfig() {
  if (!fs.existsSync(_dbPath)) {
    dialog.showMessageBox({
      type: "info",
      buttons: ["OK"],
      title: "Config File",
      message: "Config file does not exist yet",
      detail: "The application will create it on first run or after saving settings.",
      icon: icons.message,
    });
    return;
  }
  shell
    .openPath(_dbPath)
    .then((result) => {
      if (result) dialog.showErrorBox("Error", `Could not open config file. Try viewing it manually at: ${_dbPath}`);
    })
    .catch((err) => {
      console.error("Failed to open config:", err);
      dialog.showErrorBox("Error", `Could not open config file. Try viewing it manually at: ${_dbPath}`);
    });
}

// Error Handling
let _criticalErrorShown = false;

// Reports a critical error without taking the app down. Quits only if, after the dialog, there is no tray
// left for the user to interact with (nothing to stay alive for).
function handleCriticalError(message, error) {
  try {
    (_log ?? console).error(message, error);
  } catch (_) {}

  // One dialog per session: a burst of errors must not stack modal dialogs.
  if (_criticalErrorShown) return;
  _criticalErrorShown = true;

  Promise.resolve()
    .then(() =>
      dialog.showMessageBox({
        type: "error",
        buttons: ["OK", "Open Logs"],
        title: "Application Error",
        message: `${message}: ${error?.message ?? String(error)}`,
        detail: error?.stack ?? undefined,
        icon: icons.message,
      }),
    )
    .then(({ response }) => {
      if (response === 1 && _log) openLogs();
    })
    .catch(() => {})
    .finally(() => {
      // Evaluated after the dialog closes: on Linux the tray is created with a delayed retry.
      let hasTray = false;
      try {
        hasTray = !!state.tray && !state.tray.isDestroyed();
      } catch (_) {}
      if (!hasTray) app.quit();
    });
}

module.exports = {
  init,
  safeConsoleWrap,
  getAppPath,
  getResourcePath,
  getServerPath,
  getIconPath,
  getUserDataPath,
  getLogFilePath,
  getHistoryFilePath,
  getDbPath,
  getConfig,
  icons,
  logToFile,
  openStatus,
  openLogs,
  openConfig,
  handleCriticalError,
};
