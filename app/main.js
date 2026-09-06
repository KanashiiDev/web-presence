// CLI FLAGS
const { app, Menu } = require("electron");

app.setName("web-presence-bridge");
app.commandLine.appendSwitch("lang", "en-US");
app.disableHardwareAcceleration();

for (const flag of [
  "disable-gpu",
  "disable-gpu-compositing",
  "disable-software-rasterizer",
  "disable-extensions",
  "disable-component-update",
  "disable-breakpad",
  "disable-crash-reporter",
  "disable-sync",
  "disable-default-apps",
  "disable-translate",
  "disable-plugins",
  "disable-speech-api",
  "disable-print-preview",
  "disable-pdf-extension",
  "no-default-browser-check",
  "disable-hang-monitor",
])
  app.commandLine.appendSwitch(flag);

app.commandLine.appendSwitch("js-flags", "--max-old-space-size=192 --optimize-for-size --expose-gc");

if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform", "x11");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.commandLine.appendSwitch("disable-features", "VizDisplayCompositor,UseChromeOSDirectVideoDecoder,Vulkan");
  app.commandLine.appendSwitch("enable-features", "AppIndicator,Unity");
}

// IMPORTS
const path = require("path");
const fs = require("fs");

const ConfigManager = require("./scripts/configManagement");
const { log, configureLogging } = require("./scripts/electron-log");
const { state } = require("./state");
const Utils = require("./utils");
const ServerManager = require("./managers/server");
const TrayManager = require("./managers/tray");
const Updater = require("./managers/updater");

// CONSOLE SAFETY
Utils.safeConsoleWrap(log);

// SINGLE-INSTANCE LOCK
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => state.tray?.popUpContextMenu());

// APP READY
let isAppInitialized = false;

app.whenReady().then(async () => {
  if (isAppInitialized) {
    log.warn("App already initialized, skipping duplicate initialization");
    return;
  }
  isAppInitialized = true;
  log.info("App initialization started");

  try {
    await initializeApp();
  } catch (err) {
    Utils.handleCriticalError("App initialization failed", err);
  }
});

// INITIALIZATION
async function initializeApp() {
  try {
    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "config.json");
    const logFilePath = path.join(userDataPath, "logs.json");
    const historyFilePath = path.join(userDataPath, "history.json");

    ConfigManager.initialize(userDataPath, log);

    configureLogging({
      logDir: path.join(userDataPath, "logs"),
      maxSize: ConfigManager.config.MAX_LOG_SIZE,
      rotationInterval: ConfigManager.config.LOG_ROTATION_INTERVAL,
    });

    Utils.init({ userDataPath, log, logFilePath, historyFilePath, dbPath, config: ConfigManager.config });

    app.setAppUserModelId?.("com.kanashiidev.web.presence");
    if (process.platform === "darwin") app.dock.hide();
    Menu.setApplicationMenu(null);

    process.platform === "linux" ? setTimeout(() => TrayManager.createTrayWithRetry(), 500) : TrayManager.createTrayWithRetry();

    Updater.setupAutoUpdater();
    _startServer();
  } catch (err) {
    Utils.handleCriticalError("Initialization failed", err);
  }
}

// START SERVER
function _startServer() {
  const startWithFallback = () =>
    ServerManager.startServer().catch((err) => {
      log.error("Initial server start failed:", err);
      ServerManager.scheduleServerRestart();
    });

  if (!app.isPackaged) return startWithFallback();

  try {
    log.info("Pre-warming: Reading server file to cache...");
    fs.readFileSync(Utils.getServerPath("server.js"), "utf8");
    log.info("Pre-warming completed");
    setTimeout(startWithFallback, 100);
  } catch (err) {
    log.warn("Pre-warming failed, starting server normally:", err.message);
    startWithFallback();
  }
}

// QUIT HANDLING
app.on("before-quit", async (event) => {
  event.preventDefault();
  log.info("Application is quitting, cleaning up...");
  TrayManager.destroyTray();
  if (state.serverProcess) {
    try {
      await ServerManager.stopServer();
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      log.error("Error stopping server during quit:", err);
    }
  }
  app.exit(0);
});

app.on("will-quit", () => TrayManager.destroyTray());

// PROCESS ERROR HANDLERS
process.on("uncaughtException", (err) => Utils.handleCriticalError("Uncaught Exception", err));
process.on("unhandledRejection", (reason, promise) => log.error("Unhandled rejection at:", promise, "reason:", reason));
