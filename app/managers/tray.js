const { app, Tray, Menu, Notification, nativeImage, dialog, shell } = require("electron");
const { exec } = require("child_process");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { state } = require("../state");
const ConfigManager = require("../scripts/configManagement");
const { log } = require("../scripts/electron-log");
const { icons, getIconPath, getResourcePath, openStatus, openLogs, openConfig, getConfig } = require("../utils");

const ServerManager = () => require("./server");
const Autostart = () => require("./autostart");
const Updater = () => require("./updater");

let currentMenu = null;

const updateMenuState = {
  visible: false,
  label: "New Update Available",
  releaseUrl: null,
  isInstallable: false,
};

function setUpdateMenuState(options) {
  Object.assign(updateMenuState, options);
  updateTrayMenu();
}

// Create
function createTray() {
  const iconPath = getIconPath();
  if (!iconPath) throw new Error("Tray icon path not found");

  let trayIcon = nativeImage.createFromPath(iconPath);
  if (trayIcon.isEmpty()) throw new Error("Failed to load tray icon");

  if (process.platform === "darwin") {
    trayIcon.setTemplateImage(true);
    const { width, height } = trayIcon.getSize();
    if (width > 22 || height > 22) trayIcon = trayIcon.resize({ width: 22, height: 22, quality: "best" });
  } else if (process.platform === "linux") {
    const { width, height } = trayIcon.getSize();
    if (width > 24 || height > 24) trayIcon = trayIcon.resize({ width: 24, height: 24, quality: "best" });
  }

  state.tray = new Tray(trayIcon);
  state.tray.setToolTip("Web Presence Bridge");

  const openMenu = () => state.tray.popUpContextMenu();
  state.tray.on("click", openMenu);
  if (process.platform !== "darwin") state.tray.on("right-click", openMenu);

  updateTrayMenu();
  log.info("Tray created successfully");
}

function createTrayWithRetry(maxAttempts = 10, delay = 200) {
  let attempts = 0;
  (function tryCreateTray() {
    attempts++;
    try {
      createTray();
    } catch (err) {
      log.warn(`Tray creation failed (attempt ${attempts}/${maxAttempts}):`, err.message);
      if (attempts < maxAttempts) {
        setTimeout(tryCreateTray, delay);
      } else {
        log.error("Tray could not be created after multiple attempts");
        showTrayFallbackNotification();
      }
    }
  })();
}

function destroyTray() {
  currentMenu = null;
  if (!state.tray || state.tray.isDestroyed()) return;
  try {
    state.tray.removeAllListeners();
    state.tray.setContextMenu(null);
    state.tray.destroy();
    state.tray = null;
  } catch (err) {
    try {
      log.warn("Tray cleanup warning:", err.message);
    } catch (_) {}
  }
}

// Menu
function updateTrayMenu() {
  if (!state.tray || state.tray.isDestroyed()) return;

  const config = getConfig();
  const sm = ServerManager();
  const as = Autostart();
  const up = Updater();

  try {
    currentMenu = null;

    const menuTemplate = [
      { label: `Version: ${app.getVersion()}`, enabled: false },
      { type: "separator" },
      {
        label: state.isServerRunning ? "Stop Server" : "Start Server",
        click: () => (state.isServerRunning ? sm.stopServer() : sm.startServer()),
      },
      {
        label: "Restart Server",
        enabled: state.isServerRunning,
        click: () => sm.restartServer().catch((err) => dialog.showErrorBox("Restart Error", err.message)),
      },
      { type: "separator" },
      {
        label: "Run at Startup",
        type: "checkbox",
        checked: as.isAutoStartEnabled(),
        click: (item) => {
          as.setAutoStart(item.checked);
          updateTrayMenu();
        },
      },
      {
        label: "Check for Updates",
        click: () => up.runManualUpdateCheck(),
      },
      {
        label: "Debug",
        submenu: [
          { label: `Status: ${state.isServerRunning ? "Running" : "Stopped"}`, enabled: false },
          { label: `RPC: ${state.isRpcConnected ? "Connected" : "Disconnected"}`, enabled: false },
          { label: `Port: ${config?.PORT ?? "3000"}`, enabled: false },
          { label: "Config", click: () => openConfig() },
          { type: "separator" },
          { label: "Open Logs", click: () => openLogs() },
          _buildLinuxDiagnosticItem(),
          {
            label: "Log Activity Updates",
            type: "checkbox",
            checked: config?.LOG_MEDIA_UPDATE,
            click: (item) => {
              ConfigManager.updateConfigValue("LOG_MEDIA_UPDATE", !!item.checked);
              log.info(`Log Activity Updates ${config.LOG_MEDIA_UPDATE ? "enabled" : "disabled"} successfully.`);
              sm.updateServerSettings();
              updateTrayMenu();
            },
          },
        ],
      },
      { label: "Open Dashboard", click: () => openStatus(), enabled: state.isServerRunning },
      { type: "separator" },
      { label: "Exit", click: () => app.quit() },
    ];

    if (updateMenuState.visible) {
      menuTemplate.unshift(
        {
          label: updateMenuState.label,
          click: () => {
            if (updateMenuState.isInstallable) {
              autoUpdater.quitAndInstall();
            } else if (updateMenuState.releaseUrl) {
              shell.openExternal(updateMenuState.releaseUrl);
            }
          },
        },
        { type: "separator" },
      );
    }

    currentMenu = Menu.buildFromTemplate(menuTemplate);
    state.tray.setContextMenu(currentMenu);
    state.tray.setToolTip(`Web Presence Bridge\nServer: ${state.isServerRunning ? "Running" : "Stopped"}\nRPC: ${state.isRpcConnected ? "Connected" : "Disconnected"}`);
  } catch (err) {
    log.error("Error updating tray menu:", err);
  }
}

// Private Helpers
function _buildLinuxDiagnosticItem() {
  return {
    label: "Run IPC Diagnostic (Linux)",
    visible: process.platform === "linux",
    enabled: process.platform === "linux",
    click: () => {
      const scriptPath = getResourcePath("discord_ipc_diagnostic.sh");
      const outputFile = path.join(app.getPath("userData"), "discord_ipc_diagnostic_result.txt");
      const tempScript = path.join(os.tmpdir(), "discord_ipc_diagnostic_temp.sh");

      try {
        const fixed = fs.readFileSync(scriptPath, "utf8").replace(/\r\n|\r/g, "\n");
        fs.writeFileSync(tempScript, fixed, { mode: 0o755 });
      } catch (err) {
        log.error("Script preparation failed:", err);
        dialog.showMessageBox({ type: "error", title: "Script Error", message: "Could not prepare diagnostic script.", detail: err.message, icon: icons.message });
        return;
      }

      exec(`bash "${tempScript}" > "${outputFile}" 2>&1`, (err) => {
        const exitCode = err?.code ?? 0;
        try {
          fs.unlinkSync(tempScript);
        } catch (_) {}

        const results = {
          0: { type: "info", title: "Discord RPC Ready", message: "No issues detected. Your system is ready for Discord RPC." },
          1: {
            type: "error",
            title: "Critical Issues Found",
            message: "Critical problems detected that will prevent RPC from working.\n\nPlease review the diagnostic report and follow the fix instructions.",
          },
          2: {
            type: "warning",
            title: "Warnings Detected",
            message: "Some issues detected. RPC may work but could have problems.\n\nPlease review the diagnostic report.",
          },
        };
        const { type, title, message } = results[exitCode] ?? {
          type: "error",
          title: "Diagnostic Failed",
          message: "Could not run diagnostic script.\n\nPlease check if the script file exists.",
        };

        dialog
          .showMessageBox({
            type,
            title,
            message,
            detail: `Diagnostic report saved to:\n${outputFile}`,
            buttons: ["Open Report", "Close"],
            icon: icons.message,
            defaultId: 0,
          })
          .then(async ({ response }) => {
            if (response === 0) {
              const result = await shell.openPath(outputFile);
              if (result) dialog.showErrorBox("Open Path Failed", result);
            }
          });
      });
    },
  };
}

function showTrayFallbackNotification() {
  new Notification({
    title: "Web Presence Bridge - Running in Background",
    body: "The app is running but system tray is not available. Use app indicator or check system settings.",
    icon: icons.notification,
  }).show();

  dialog.showMessageBox({
    type: "info",
    title: "System Tray Not Available",
    message: "Web Presence Bridge is running in background mode",
    detail:
      "Your desktop environment may not support system tray icons. The application will continue to run. You can access it through application indicators or system menu.",
    buttons: ["OK"],
    icon: icons.message,
  });
}

module.exports = { createTray, createTrayWithRetry, destroyTray, updateTrayMenu, setUpdateMenuState, showTrayFallbackNotification };
