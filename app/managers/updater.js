const { app, Notification, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const semver = require("semver");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execSync } = require("child_process");

const { state } = require("../state");
const ConfigManager = require("../scripts/configManagement");
const { setUpdateMenuState } = require("./tray");
const { log } = require("../scripts/electron-log");
const { icons } = require("../utils");

const GITHUB_RELEASES_API = "https://api.github.com/repos/KanashiiDev/web-presence/releases/latest";
const GITHUB_RELEASES_URL = "https://github.com/KanashiiDev/web-presence/releases/latest";
const INSTALL_ARCH_SCRIPT_URL = "https://raw.githubusercontent.com/KanashiiDev/web-presence/main/scripts/install-arch.sh";
const INSTALL_ARCH_CMD = `curl -fsSL ${INSTALL_ARCH_SCRIPT_URL} | bash`;

// Install method detection
/**
 * Returns: "appimage" | "appimage-anylinux" | "pacman" | "nixos" | "deb" | "rpm" | "win32" | "darwin"
 *
 * Detection order:
 * 1. Platform (win32, darwin)
 * 2. anylinux AppImage (WEB_PRESENCE_ANYLINUX env — set at build time)
 * 3. AppImage env var (standard electron-builder AppImage)
 * 4. NixOS wrapper env var (reliable, set by makeWrapper in package.nix)
 * 5. /etc/os-release fallback for NixOS (in case wrapper env is missing)
 * 6. Package manager presence checks (pacman, dpkg, rpm)
 * 7. AppImage fallback for unknown Linux
 */
function detectInstallMethod() {
  const platform = process.platform;
  if (platform === "win32") return "win32";
  if (platform === "darwin") return "darwin";

  if (process.env.APPIMAGE) {
    // anylinux AppImages carry WEB_PRESENCE_ANYLINUX=1 baked in at build time.
    // electron-updater cannot update these (no latest-linux.yml), so we fall
    // back to the GitHub Releases page instead of attempting an auto-update.
    if (process.env.WEB_PRESENCE_ANYLINUX === "1") return "appimage-anylinux";
    return "appimage";
  }

  // NixOS: check wrapper env first (most reliable), then /etc/os-release as fallback
  if (process.env.WEB_PRESENCE_NIX === "true") return "nixos";
  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf8");
    if (/^ID=nixos/im.test(osRelease)) return "nixos";
  } catch (_) {}

  try {
    execSync("pacman -Q web-presence-bridge 2>/dev/null", { stdio: "pipe" });
    return "pacman";
  } catch (_) {}
  try {
    execSync("dpkg -s web-presence-bridge 2>/dev/null", { stdio: "pipe" });
    return "deb";
  } catch (_) {}
  try {
    execSync("rpm -q web-presence-bridge 2>/dev/null", { stdio: "pipe" });
    return "rpm";
  } catch (_) {}

  return "appimage"; // best fallback for unknown Linux
}

// electron-updater can handle the full cycle for these methods
function canAutoUpdate(method) {
  return method === "win32" || method === "darwin" || method === "appimage";
  // "appimage-anylinux" intentionally excluded — no latest-linux.yml produced
  // by the anylinux build, so electron-updater would fail. GitHub Releases
  // page is used instead via _checkGitHubRelease().
}

// Maps Node's process.arch to the arch suffix used in release asset filenames.
// Each package format uses a different naming convention:
//   pacman  → x64 / arm64
//   rpm     → x86_64 / aarch64
//   deb     → amd64 / arm64
//   AppImage→ x86_64 / aarch64
function getArch(format) {
  const arch = process.arch;
  switch (format) {
    case "pacman":
      if (arch === "x64") return "x64";
      if (arch === "arm64") return "arm64";
      return arch;
    case "rpm":
    case "appimage":
    case "appimage-anylinux":
      if (arch === "x64") return "x86_64";
      if (arch === "arm64") return "aarch64";
      return arch;
    case "deb":
      if (arch === "x64") return "amd64";
      if (arch === "arm64") return "arm64";
      return arch;
    default:
      if (arch === "x64") return "x86_64";
      if (arch === "arm64") return "aarch64";
      return arch;
  }
}

// GitHub Releases version check
// Used by Arch/NixOS/deb/rpm/appimage-anylinux where electron-updater can't do the install.
// For AppImage/Win/Mac electron-updater handles it natively.
async function fetchLatestVersion() {
  const res = await fetch(GITHUB_RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `web-presence-bridge/${app.getVersion()}`,
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  return {
    version: data.tag_name?.replace(/^v/, ""),
    name: data.name,
    url: data.html_url,
    assets: (data.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url })),
  };
}

// Per-method update instructions
function getUpdateInstructions(method, version, assets = []) {
  switch (method) {
    case "pacman": {
      const pkgArch = getArch("pacman");
      const asset = assets.find((a) => a.name.endsWith(`${pkgArch}.pkg.tar.zst`));

      const detailLines = [`Version ${version} is available.`, "", "Option 1 - Run the one-shot installer (recommended):", "", `  ${INSTALL_ARCH_CMD}`];

      if (asset) {
        detailLines.push("", "Option 2 - Install the package directly with pacman:", "", `  curl -LO ${asset.url}`, `  sudo pacman -U ${asset.name}`);
      }

      detailLines.push("", "Option 3 - Download manually from GitHub Releases.");

      return {
        title: "Update Available - Arch Linux",
        detail: detailLines.join("\n"),
        primaryBtn: "Open Releases",
        primaryFn: () => shell.openExternal(GITHUB_RELEASES_URL),
        secondaryBtn: "Copy installer command",
        secondaryFn: () => require("electron").clipboard.writeText(INSTALL_ARCH_CMD),
      };
    }

    case "nixos":
      return {
        title: "Update Available - NixOS",
        detail: [
          `Version ${version} is available.`,
          "",
          "Option 1 - Update your flake input and rebuild:",
          "",
          "  nix flake update web-presence-bridge",
          "  nixos-rebuild switch --flake .",
          "",
          "Option 2 - If you use home-manager:",
          "",
          "  nix flake update web-presence-bridge",
          "  home-manager switch --flake .",
          "",
          "Option 3 - Download the AppImage directly from GitHub Releases",
          "  (no system changes required).",
        ].join("\n"),
        primaryBtn: "Open Releases",
        primaryFn: () => shell.openExternal(GITHUB_RELEASES_URL),
        secondaryBtn: "Copy flake update command",
        secondaryFn: () => require("electron").clipboard.writeText("nix flake update web-presence-bridge"),
      };

    case "deb": {
      const pkgArch = getArch("deb");
      const asset = assets.find((a) => a.name.endsWith(`${pkgArch}.deb`));
      return {
        title: "Update Available - Debian/Ubuntu",
        detail: [
          `Version ${version} is available.`,
          "",
          asset
            ? `Download and install the new .deb:\n\n  curl -LO ${asset.url}\n  sudo dpkg -i ${asset.name}`
            : `Download the new .deb from GitHub Releases and install:\n\n  sudo dpkg -i web-presence-${version}-${pkgArch}.deb`,
        ].join("\n"),
        primaryBtn: "Download .deb",
        primaryFn: () => shell.openExternal(GITHUB_RELEASES_URL),
      };
    }

    case "rpm": {
      const pkgArch = getArch("rpm");
      const asset = assets.find((a) => a.name.endsWith(`${pkgArch}.rpm`));
      return {
        title: "Update Available - RPM",
        detail: [
          `Version ${version} is available.`,
          "",
          asset
            ? `Download and install the new .rpm:\n\n  curl -LO ${asset.url}\n  sudo rpm -Uvh ${asset.name}`
            : `Download the new .rpm from GitHub Releases and install:\n\n  sudo rpm -Uvh web-presence-${version}-${pkgArch}.rpm`,
        ].join("\n"),
        primaryBtn: "Download .rpm",
        primaryFn: () => shell.openExternal(GITHUB_RELEASES_URL),
      };
    }

    case "appimage-anylinux": {
      const pkgArch = getArch("appimage-anylinux");
      const asset = assets.find((a) => a.name.includes("anylinux") && a.name.includes(pkgArch) && a.name.endsWith(".AppImage"));
      return {
        title: "Update Available",
        detail: [
          `Version ${version} is available.`,
          "",
          asset
            ? `Download the new AppImage:\n\n  curl -LO ${asset.url}\n  chmod +x ${asset.name}\n  ./${asset.name}`
            : "Download the new anylinux AppImage from GitHub Releases.",
          "",
          "The new AppImage is self-contained and works on any Linux distro.",
        ].join("\n"),
        primaryBtn: "Open Releases",
        primaryFn: () => shell.openExternal(GITHUB_RELEASES_URL),
        ...(asset && {
          secondaryBtn: "Copy download command",
          secondaryFn: () => require("electron").clipboard.writeText(`curl -LO ${asset.url} && chmod +x ${asset.name}`),
        }),
      };
    }

    default:
      return {
        title: "Update Available",
        detail: `Version ${version} is available on GitHub Releases.`,
        primaryBtn: "Open Releases",
        primaryFn: () => shell.openExternal(GITHUB_RELEASES_URL),
      };
  }
}

// Tray label
function trayLabel(method, version) {
  const labels = {
    pacman: `Update ${version} - Arch (pacman)`,
    nixos: `Update ${version} - NixOS (nix flake)`,
    deb: `Update ${version} - Download .deb`,
    rpm: `Update ${version} - Download .rpm`,
    "appimage-anylinux": `Update ${version} - Download AppImage`,
  };
  return labels[method] ?? `Download Update ${version}`;
}

// Manual update check dialog
function showUpdateDialog(version, method, instructions) {
  const buttons = [instructions.primaryBtn, ...(instructions.secondaryBtn ? [instructions.secondaryBtn] : []), "Close"];

  dialog
    .showMessageBox({
      type: "info",
      title: `Web Presence Bridge - ${instructions.title}`,
      message: `Version ${version} is available`,
      detail: instructions.detail,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      icon: icons.message,
    })
    .then(({ response }) => {
      if (response === 0) instructions.primaryFn?.();
      else if (response === 1 && instructions.secondaryFn) instructions.secondaryFn();
    });
}

// Notification
function showManualUpdateNotification(version, method, instructions) {
  const bodies = {
    pacman: `${version} available - run the installer script to update`,
    nixos: `${version} available - nix flake update web-presence-bridge`,
    deb: `${version} available - download new .deb`,
    rpm: `${version} available - download new .rpm`,
    "appimage-anylinux": `${version} available - download new AppImage`,
  };

  let icon = icons.notification;
  if (icon) icon = path.resolve(icon);

  const n = new Notification({
    title: "Web Presence Bridge - Update Available",
    body: bodies[method] ?? `${version} available`,
    icon,
  });
  n.on("click", () => showUpdateDialog(version, method, instructions));
  n.show();
}

function showModernNotification(version, { isWindows } = {}) {
  let icon = icons.notification;
  if (process.platform === "linux" && icon) icon = path.resolve(icon);

  const n = new Notification({
    title: "Update Ready",
    body: `${version} - Click tray icon to install`,
    icon,
    timeoutType: "never",
    urgency: process.platform === "darwin" ? undefined : "critical",
  });

  const doInstall = () => {
    log.info("[Updater] Installing update...");
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  };

  n.on("click", doInstall);
  if (isWindows) n.on("action", doInstall);
  n.show();
}

// Core setup
function setupAutoUpdater() {
  const method = detectInstallMethod();
  const autoCapable = canAutoUpdate(method);

  log.info(`[Updater] Install method: ${method} | Auto-update capable: ${autoCapable}`);

  if (autoCapable) {
    // electron-updater handles everything for AppImage / Win / Mac
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("update-available", (info) => {
      log.info(`[Updater] Update available: ${info.version} - downloading...`);
    });

    autoUpdater.on("update-downloaded", (info) => {
      const v = info.releaseName ?? info.version ?? "new version";
      log.info(`[Updater] Downloaded: ${v}`);

      const isWindows = process.platform === "win32";
      if (isWindows && parseInt(os.release().split(".")[0], 10) < 10) {
        state.tray?.displayBalloon({ icon: icons.notification, title: "Update Ready", content: `${v} - Restart to install` });
      } else {
        showModernNotification(v, { isWindows });
      }

      setUpdateMenuState({ visible: true, label: `Install Update - ${v}`, releaseUrl: null, isInstallable: true });
    });

    autoUpdater.on("error", (err) => {
      const msg = typeof err?.message === "string" ? err.message.split("\n")[0].trim() : String(err);
      log.error(`[Updater] Error: ${msg}`);
    });

    autoUpdater.checkForUpdates().catch((err) => {
      log.error(`[Updater] Initial check failed: ${err.message?.split("\n")[0] ?? err}`);
    });

    // Background interval check - only for auto-capable methods (AppImage / Win / Mac)
    if (ConfigManager.config.AUTO_UPDATE_CHECK) {
      setInterval(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          const msg = typeof err?.message === "string" ? err.message.split("\n")[0].trim() : String(err);
          log.error(`[Updater] Background check failed: ${msg}`);
        });
      }, ConfigManager.config.UPDATE_CHECK_INTERVAL);
    }
  } else {
    // Arch / NixOS / deb / rpm / appimage-anylinux
    // Check GitHub Releases API directly
    _checkGitHubRelease(method);
  }
}

async function _checkGitHubRelease(method) {
  try {
    const release = await fetchLatestVersion();
    if (!release.version) return;

    if (semver.gt(release.version, app.getVersion())) {
      log.info(`[Updater] New version on GitHub: ${release.version} (current: ${app.getVersion()})`);
      const instructions = getUpdateInstructions(method, release.version, release.assets);
      showManualUpdateNotification(release.version, method, instructions);
      setUpdateMenuState({
        visible: true,
        label: trayLabel(method, release.version),
        releaseUrl: GITHUB_RELEASES_URL,
        isInstallable: false,
      });
    } else {
      log.info(`[Updater] Already up to date (${app.getVersion()})`);
    }
  } catch (err) {
    log.error(`[Updater] GitHub release check failed: ${err.message}`);
  }
}

// Manual check (tray menu)
async function runManualUpdateCheck() {
  const method = detectInstallMethod();
  log.info("[Updater] Manual update check triggered");

  try {
    if (canAutoUpdate(method)) {
      const result = await autoUpdater.checkForUpdates();
      const remote = result?.updateInfo?.version;

      if (remote && semver.gt(remote, app.getVersion())) {
        dialog.showMessageBox({
          type: "info",
          buttons: ["OK"],
          title: "Web Presence Bridge - Update Available",
          message: `Version ${remote} is available.`,
          detail: "Downloading automatically. Install from the tray menu when ready.",
          icon: icons.message,
        });
      } else {
        _showUpToDate();
      }
    } else {
      const release = await fetchLatestVersion();
      if (release.version && semver.gt(release.version, app.getVersion())) {
        showUpdateDialog(release.version, method, getUpdateInstructions(method, release.version, release.assets));
      } else {
        _showUpToDate();
      }
    }
  } catch (err) {
    log.error("[Updater] Manual check failed:", err);
    dialog.showMessageBox({
      type: "error",
      buttons: ["OK"],
      title: "Web Presence Bridge - Update Check Failed",
      message: "Could not check for updates.",
      detail: err.message,
      icon: icons.message,
    });
  }
}

function _showUpToDate() {
  dialog.showMessageBox({
    type: "info",
    buttons: ["OK"],
    title: "Web Presence Bridge - Up to Date",
    message: "You're using the latest version.",
    detail: `Version: ${app.getVersion()}`,
    icon: icons.message,
  });
}

module.exports = { setupAutoUpdater, runManualUpdateCheck, detectInstallMethod };
