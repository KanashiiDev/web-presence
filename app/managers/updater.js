const { app, Notification, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const { execSync, spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const { state } = require("../state");
const runtimeInfo = require("../runtime-info");
const fingerprint = require("../fingerprint");
const rawFs = runtimeInfo.rawFs;
const ConfigManager = require("../scripts/configManagement");
const { setUpdateMenuState } = require("./tray");
const { log } = require("../scripts/electron-log");
const { icons } = require("../utils");

const GITHUB_RELEASES_API = "https://api.github.com/repos/KanashiiDev/web-presence/releases/latest";
const GITHUB_RELEASES_URL = "https://github.com/KanashiiDev/web-presence/releases/latest";
// Pin install script to the release tag (not "main" / running version): a compromised branch can't serve a malicious installer.
const getInstallArchCmd = (version) => `curl -fsSL https://raw.githubusercontent.com/KanashiiDev/web-presence/v${version}/scripts/install-arch.sh | bash`;

// Runtime update channel constants
const STAGING_TMP_SUFFIX = ".tmp";
const DOWNLOAD_TIMEOUT_MS = 60 * 1000; // 60 second download timeout

// Guard against concurrent manual/automatic update checks.
let updateCheckInProgress = false;

// Install method detection cache (avoids repeated execSync / fs calls).
let installMethodCache = null;

// Failed runtime versions (staging/activation rollbacks); prevents re-downloading known-bad versions. Implemented in runtime-info.js, shared with bootstrap.js.
function recordFailedVersion(version) {
  runtimeInfo.recordFailedVersion(app.getPath("userData"), version);
}

function isFailedVersion(version) {
  return runtimeInfo.isFailedVersion(app.getPath("userData"), version);
}

// macOS needs a real Developer ID signature; ad-hoc builds fail silently via Squirrel.Mac. Flip to true once signed + notarized.
const MAC_AUTO_UPDATE_SUPPORTED = false;

/** Install method: "appimage" | "appimage-anylinux" | "pacman" | "nixos" | "deb" | "win32" | "darwin".
 * Detection: platform → anylinux AppImage → AppImage env → NixOS wrapper → /etc/os-release → package managers → AppImage fallback.
 * "darwin" doesn't imply auto-update; canAutoUpdate() gates on MAC_AUTO_UPDATE_SUPPORTED.
 */
function detectInstallMethod() {
  if (installMethodCache) return installMethodCache;

  const platform = process.platform;
  if (platform === "win32") return (installMethodCache = "win32");
  if (platform === "darwin") return (installMethodCache = "darwin");

  if (process.env.APPIMAGE) {
    if (process.env.WEB_PRESENCE_ANYLINUX === "1") return (installMethodCache = "appimage-anylinux");
    return (installMethodCache = "appimage");
  }

  if (process.env.WEB_PRESENCE_NIX === "true") return (installMethodCache = "nixos");
  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf8");
    if (/^ID=nixos/im.test(osRelease)) return (installMethodCache = "nixos");
  } catch (_) {}

  // Query by package name ("web-presence"), not binary name ("web-presence-bridge", only /usr/bin symlink).
  const PKG_NAME = "web-presence";

  try {
    execSync(`pacman -Q ${PKG_NAME}`, { stdio: "ignore" });
    return (installMethodCache = "pacman");
  } catch (_) {}
  try {
    execSync(`dpkg -s ${PKG_NAME}`, { stdio: "ignore" });
    return (installMethodCache = "deb");
  } catch (_) {}
  try {
    execSync(`rpm -q ${PKG_NAME}`, { stdio: "ignore" });
    return (installMethodCache = "rpm");
  } catch (_) {}

  return (installMethodCache = "appimage"); // best fallback for unknown Linux
}

// electron-updater handles these methods fully.
function canAutoUpdate(method) {
  // macOS is excluded while the build is ad-hoc signed
  if (method === "darwin" && !MAC_AUTO_UPDATE_SUPPORTED) return false;
  return method === "win32" || method === "darwin" || method === "appimage";
  // "appimage-anylinux" excluded - no latest-linux.yml produced by the build.
}

// Maps Node's process.arch to the arch suffix used in release asset filenames.
// pacman → x64/arm64, rpm → x86_64/aarch64, deb → amd64/arm64, AppImage → x86_64/aarch64.
function getArch(format) {
  const arch = process.arch;
  switch (format) {
    case "darwin":
      // mac artifacts use the raw process arch in the filename (x64 / arm64)
      return arch;
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

// GitHub Releases version check. Used where electron-updater can't install
// (unsigned macOS, Arch, NixOS, deb, rpm, appimage-anylinux).
async function fetchLatestVersion() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { ...githubHeaders(), Accept: "application/vnd.github+json" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    return {
      version: data.tag_name?.replace(/^v/, ""),
      name: data.name,
      url: data.html_url,
      assets: (data.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url })),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// --- Runtime update channel (custom updater) ---
// Full app-code updates that never touch Electron. latest.json + <version>-runtime.asar are assets; download verified and staged into <userData>/runtime/staging, applied by bootstrap on next launch. See app/runtime-info.js.

const LATEST_JSON_NAME = "latest.json";

function githubHeaders() {
  return { "User-Agent": `web-presence-bridge/${app.getVersion()}` };
}

// Reads latest.json from release assets. null when the release predates the
// runtime channel (binary channel is used instead).
async function fetchUpdateMeta(assets) {
  const asset = assets?.find((a) => a.name === LATEST_JSON_NAME);
  if (!asset) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(asset.url, {
      headers: { ...githubHeaders() },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    try {
      const meta = await res.json();
      return meta?.version && meta?.runtime?.file && meta?.runtime?.sha256 ? meta : null;
    } catch (_) {
      return null;
    }
  } finally {
    clearTimeout(timeout);
  }
}

// latest.json must match the release being offered and be newer than the running code, else it's staged, applied, and re-downloaded forever.
function _validateMetaForRelease(meta, release, current) {
  if (!meta) return null;
  if (meta.version !== release.version) {
    log.warn(`[Updater] latest.json (${meta.version}) does not match release ${release.version} - ignoring runtime channel`);
    return null;
  }
  if (!runtimeInfo.safeSemverGt(meta.version, current)) return null; // up to date, nothing to stage
  return meta;
}

// Release vs runtime channel policy:
//   major bump                                → release channel
//   binary fingerprint missing / different    → release channel
//   anything else (minor/patch code change)   → runtime channel
// The fingerprint (scripts/writeBinaryFingerprint.js) covers everything a runtime bundle can't carry: shipped-only code (bootstrap, runtime-info, update-keys, fingerprint), the Electron version, package.json main+build, extraResources and native modules. It is compared against the INSTALLED binary's fingerprint, never the running runtime's own copy.
// Semver parse failure → release channel (safe default). Reasons are logged here.
function shouldUseReleaseChannel(currentVersion, newVersion, meta) {
  if (!runtimeInfo.isValidVersion(currentVersion) || !runtimeInfo.isValidVersion(newVersion)) {
    log.info(`[Updater] Unparseable version (${currentVersion} → ${newVersion}) - using release channel`);
    return true;
  }

  const curr = currentVersion.split(".").map(Number);
  const next = newVersion.split(".").map(Number);

  // Rule 1: major bump → release channel (bootstrap also drops the runtime on an app major change).
  if (next[0] !== curr[0]) {
    log.info(`[Updater] Major version bump (${currentVersion} → ${newVersion})`);
    return true;
  }

  // Rule 2: the release needs a different binary than the installed one.
  const shipped = fingerprint.getShippedFingerprint();
  const offered = meta?.runtime?.binaryFingerprint;
  if (!shipped || !offered) {
    log.info(`[Updater] Binary fingerprint unavailable (installed: ${shipped ? "ok" : "missing"}, release: ${offered ? "ok" : "missing"})`);
    return true;
  }
  if (shipped !== offered) {
    log.info(
      `[Updater] Binary fingerprint changed (${shipped.slice(0, 12)} → ${offered.slice(0, 12)}): shipped-only code, Electron, native modules, resources or build config differ`,
    );
    return true;
  }

  // Rule 3: same binary requirements → runtime channel.
  return false;
}

// Downloads + verifies runtime asar into staging; never touches active bundle (applied by bootstrap on next launch).
// Temp file → size+sha256+signature → atomic promote. Metadata written after success; failed attempt preserves prior valid artifact, cleans temp. Windows rename can't replace existing file, so target is moved aside first.
async function stageRuntimeUpdate(meta, assets) {
  const asset = assets.find((a) => a.name === meta.runtime.file);
  if (!asset) {
    log.warn(`[Updater] Runtime asset missing in release: ${meta.runtime.file}`);
    return false;
  }

  // Never re-download a failed-and-rolled-back version.
  if (isFailedVersion(meta.version)) {
    log.info(`[Updater] Skipping previously failed runtime version ${meta.version}`);
    return false;
  }

  const userData = app.getPath("userData");
  const stagingDir = runtimeInfo.getStagingDir(userData);
  const target = runtimeInfo.getStagingAsarPath(userData);
  const tmpTarget = target + STAGING_TMP_SUFFIX;
  const backupTarget = target + ".old";
  const metaPath = runtimeInfo.getStagingMetaPath(userData);

  let targetExisted = false;
  let backupExisted = false;
  let promoted = false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    rawFs.mkdirSync(stagingDir, { recursive: true });

    log.info(`[Updater] Downloading runtime update ${meta.version}...`);
    const res = await fetch(asset.url, {
      headers: { ...githubHeaders() },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    // Verify declared size against the Content-Length header.
    const contentLength = res.headers.get("content-length");
    if (contentLength !== null) {
      const declaredSize = Number(contentLength);
      if (meta.runtime.size != null && declaredSize !== meta.runtime.size) {
        throw new Error(`Size mismatch: server reports ${declaredSize}, metadata declares ${meta.runtime.size}`);
      }
    }

    await pipeline(Readable.fromWeb(res.body), rawFs.createWriteStream(tmpTarget));

    // Verify downloaded byte count against the declared size, independent of
    // Content-Length.
    if (meta.runtime.size != null) {
      const actualSize = rawFs.statSync(tmpTarget).size;
      if (actualSize !== meta.runtime.size) {
        throw new Error(`Size mismatch: downloaded ${actualSize} bytes, metadata declares ${meta.runtime.size}`);
      }
    }

    clearTimeout(timeout);

    const hash = await runtimeInfo.fileSha256(tmpTarget);
    if (hash !== meta.runtime.sha256) throw new Error(`Checksum mismatch (got ${hash.slice(0, 12)}...)`);

    // package.json version not read: Electron fs only treats ".asar" as archives (temp is ".asar.tmp"), locking risk on Windows. Integrity via sha256 + signature; prepareRelease verifies embedded version.

    _verifyRuntimeSignature(meta);

    // Back up prior valid staged artifact before promotion (Windows rename can't replace existing file).
    targetExisted = rawFs.existsSync(target);
    if (targetExisted) {
      try {
        rawFs.renameSync(target, backupTarget);
      } catch (_) {
        // Fallback: copy then delete when rename is blocked.
        const data = rawFs.readFileSync(target);
        rawFs.writeFileSync(backupTarget, data);
        rawFs.rmSync(target, { force: true });
      }
      backupExisted = true;
    }

    // Atomic promotion: temp -> final staged artifact.
    rawFs.renameSync(tmpTarget, target);
    promoted = true;

    // Write metadata only after successful validation + promotion.
    rawFs.writeFileSync(
      metaPath,
      JSON.stringify({
        version: meta.version,
        runtime: {
          file: meta.runtime.file,
          sha256: meta.runtime.sha256,
          size: meta.runtime.size,
          signature: meta.runtime.signature,
          binaryFingerprint: meta.runtime.binaryFingerprint,
        },
        stagedAt: Date.now(),
      }),
    );

    // Clean up backup on success.
    if (backupExisted) {
      try {
        rawFs.rmSync(backupTarget, { force: true });
      } catch (_) {}
    }

    log.info(`[Updater] Runtime update ${meta.version} staged - will apply on next launch`);
    return true;
  } catch (err) {
    clearTimeout(timeout);
    log.error(`[Updater] Runtime staging failed: ${err.message}`);

    // Clean up temp file from this attempt.
    try {
      rawFs.rmSync(tmpTarget, { force: true });
    } catch (_) {}

    // Restore previously valid staging if we moved it aside.
    if (backupExisted && rawFs.existsSync(backupTarget)) {
      try {
        if (rawFs.existsSync(target)) rawFs.rmSync(target, { force: true });
        rawFs.renameSync(backupTarget, target);
      } catch (_) {}
    } else if (promoted && rawFs.existsSync(target)) {
      // Metadata write failed after promotion: remove orphaned ASAR so bootstrap doesn't load an ASAR without metadata.
      try {
        rawFs.rmSync(target, { force: true });
      } catch (_) {}
    }

    if (isIntegrityError(err)) {
      recordFailedVersion(meta.version);
    } else {
      log.info(`[Updater] Transient failure for ${meta.version}, not blacklisting: ${err.message}`);
    }
    return false;
  }
}

// Integrity failure (checksum/signature/size/embedded-version) → blacklist version. Transient (network/timeout/HTTP) does not.
function isIntegrityError(err) {
  const msg = err?.message ?? "";
  return (
    msg.includes("Checksum mismatch") ||
    msg.includes("signature verification failed") ||
    msg.includes("Size mismatch") ||
    msg.includes("Embedded version") ||
    msg.includes("Malformed update signature") ||
    msg.includes("Release is unsigned") ||
    msg.includes("Release is not signed")
  );
}

// Canonical signed payload (version+sha256+binaryFingerprint). Matches prepareRelease.js and bootstrap.js. UTF-8 JSON (not raw hex) prevents length-extension/binding attacks.
function canonicalUpdatePayload(meta) {
  return JSON.stringify({
    version: meta.version,
    sha256: meta.runtime.sha256,
    binaryFingerprint: meta.runtime.binaryFingerprint ?? null,
  });
}

// ed25519 layer over sha256: app/update-keys.js (via generateUpdateKeys.js) must exist; packaged builds require a valid signature.
function _verifyRuntimeSignature(meta) {
  let keys;
  try {
    keys = require("../update-keys");
  } catch (_) {
    keys = null;
  }

  const payload = canonicalUpdatePayload(meta);
  const payloadBuf = Buffer.from(payload, "utf8");

  if (!keys) {
    if (app.isPackaged) {
      throw new Error("Release is unsigned but this packaged build requires signatures");
    }
    // Dev mode: checksum-only, signature not configured.
    return;
  }

  if (!meta.runtime.signature) {
    throw new Error("Release is not signed but this build requires signatures");
  }

  let signatureBuf;
  try {
    signatureBuf = Buffer.from(meta.runtime.signature, "base64");
  } catch (_) {
    throw new Error("Malformed update signature");
  }

  const ok = crypto.verify(null, payloadBuf, crypto.createPublicKey(keys.publicKey), signatureBuf);
  if (!ok) throw new Error("Runtime update signature verification failed");
}

function restartToApply() {
  log.info("[Updater] Restarting to apply runtime update...");
  const appImage = process.env.APPIMAGE;

  if (appImage && process.platform === "linux") {
    // AppImage state must not leak into the new instance; it starts only after this process released the lock and mount (before-quit stops server, ~2s).
    const env = { ...process.env };
    for (const k of ["APPIMAGE", "APPDIR", "ARGV0", "OWD", "TARGET_APPIMAGE", "LD_LIBRARY_PATH", "APPIMAGE_EXTRACT_AND_RUN"]) delete env[k];
    try {
      const child = spawn(
        "/bin/sh",
        [
          "-c",
          'i=0; while kill -0 "$0" 2>/dev/null && [ $i -lt 75 ]; do sleep 0.2; i=$((i+1)); done; sleep 1; exec "$@"',
          String(process.pid),
          appImage,
          ...process.argv.slice(1),
        ],
        { detached: true, stdio: "ignore", env, cwd: app.getPath("home") },
      );
      child.unref();
    } catch (err) {
      log.error(`[Updater] AppImage relaunch spawn failed: ${err.message}`);
      app.relaunch({ execPath: appImage, args: process.argv.slice(1) });
    }
  } else {
    app.relaunch();
  }
  app.quit();
}

// Per-method update instructions
function getUpdateInstructions(method, version, assets = []) {
  switch (method) {
    case "pacman": {
      const pkgArch = getArch("pacman");
      const asset = assets.find((a) => a.name.endsWith(`${pkgArch}.pkg.tar.zst`));

      const installArchCmd = getInstallArchCmd(version);
      const detailLines = [`Version ${version} is available.`, "", "Option 1 - Run the one-shot installer (recommended):", "", `  ${installArchCmd}`];

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
        secondaryFn: () => require("electron").clipboard.writeText(installArchCmd),
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

    case "darwin": {
      const pkgArch = getArch("darwin");
      // Universal builds have no arch suffix in the artifact name
      const asset = assets.find((a) => a.name.endsWith(`-${pkgArch}.dmg`)) || assets.find((a) => a.name.endsWith(".dmg"));

      return {
        title: "Update Available - macOS",
        detail: [
          `Version ${version} is available.`,
          "",
          "Auto-update is unavailable for this build on macOS",
          "",
          "Download and mount the new .dmg, then replace the app in /Applications.",
        ].join("\n"),
        primaryBtn: "Open Releases",
        primaryFn: () => shell.openExternal(GITHUB_RELEASES_URL),
        ...(asset && {
          secondaryBtn: "Download .dmg",
          secondaryFn: () => shell.openExternal(asset.url),
        }),
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
    darwin: `Update ${version} - Download DMG`,
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
    darwin: `${version} available - download new .dmg from GitHub Releases`,
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
  // Development mode (electron .) skips all automatic update checks.
  if (!app.isPackaged) {
    log.info("[Updater] Dev mode detected - skipping automatic update checks");
    return;
  }

  const method = detectInstallMethod();
  const autoCapable = canAutoUpdate(method);

  log.info(`[Updater] Install method: ${method} | Binary auto-update: ${autoCapable}`);

  _wireBinaryUpdater(method);

  if (ConfigManager.config.AUTO_UPDATE_CHECK) {
    _checkForUpdates(method, "startup").catch((err) => {
      log.error(`[Updater] Initial check failed: ${err.message?.split("\n")[0] ?? err}`);
    });

    setInterval(() => {
      _checkForUpdates(method, "interval").catch((err) => {
        const msg = typeof err?.message === "string" ? err.message.split("\n")[0].trim() : String(err);
        log.error(`[Updater] Background check failed: ${msg}`);
      });
    }, ConfigManager.config.UPDATE_CHECK_INTERVAL);
  }
}

// Combined check: runtime channel preferred when latest.json exists else binary channel.
async function _checkForUpdates(method, source) {
  // Guard against concurrent checks.
  if (updateCheckInProgress) {
    log.info(`[Updater] Update check already in progress - skipping ${source} check`);
    return;
  }
  updateCheckInProgress = true;
  try {
    const release = await fetchLatestVersion();
    if (!release.version) return;

    const current = runtimeInfo.getCodeVersion() ?? app.getVersion();

    if (!runtimeInfo.safeSemverGt(release.version, current)) {
      if (source === "startup") log.info(`[Updater] Already up to date (${current})`);
      return;
    }

    const meta = _validateMetaForRelease(await fetchUpdateMeta(release.assets), release, current);

    if (!runtimeInfo.safeSemverGt(release.version, current)) {
      if (source === "startup") log.info(`[Updater] Already up to date (${current})`);
      return;
    }

    log.info(`[Updater] New version: ${release.version} (current: ${current}, source: ${source})`);

    // Skip if already staged.
    const userData = app.getPath("userData");
    const stagedMetaPath = runtimeInfo.getStagingMetaPath(userData);
    let alreadyStaged = false;
    try {
      const stagedMeta = JSON.parse(rawFs.readFileSync(stagedMetaPath, "utf8"));
      if (meta && stagedMeta.version === meta.version && stagedMeta.runtime?.sha256 && rawFs.existsSync(runtimeInfo.getStagingAsarPath(userData))) {
        alreadyStaged = true;
      }
    } catch (_) {}
    if (alreadyStaged) {
      log.info(`[Updater] Version ${meta.version} already staged - not re-downloading`);
      return;
    }

    // Runtime channel only when policy allows (shouldUseReleaseChannel logs its reason).
    const useReleaseChannel = meta ? shouldUseReleaseChannel(current, release.version, meta) : false;
    if (meta && !useReleaseChannel) {
      const staged = await stageRuntimeUpdate(meta, release.assets);
      if (staged) return;
      log.warn("[Updater] Falling back to binary update channel");
    } else if (meta) {
      log.info(`[Updater] Release channel selected for ${release.version}`);
    }

    // Binary channel.
    _offerBinaryUpdate(method, release);
  } finally {
    updateCheckInProgress = false;
  }
}

// electron-updater (win32/AppImage) or per-platform instructions (macOS DMG, deb, rpm, pacman, nixos, appimage-anylinux).
function _offerBinaryUpdate(method, release) {
  const { version, assets } = release;

  if (canAutoUpdate(method)) {
    // electron-updater downloads automatically; listener notifies and arms tray item.
    autoUpdater.checkForUpdates().catch((err) => {
      log.error(`[Updater] Binary update download failed: ${err.message?.split("\n")[0] ?? err}`);
    });
    return;
  }

  const instructions = getUpdateInstructions(method, version, assets);
  showManualUpdateNotification(version, method, instructions);
  setUpdateMenuState({
    visible: true,
    label: trayLabel(method, version),
    releaseUrl: GITHUB_RELEASES_URL,
    isInstallable: false,
  });
}

// Listeners for electron-updater binary channel (win32/AppImage).
function _wireBinaryUpdater(method) {
  if (!canAutoUpdate(method)) return;

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
}

// Manual check (tray menu); same channel order as _checkForUpdates.
async function runManualUpdateCheck() {
  // Dev builds skip packaged installations' update state.
  if (!app.isPackaged) {
    log.info("[Updater] Dev mode detected - skipping manual update check");
    return;
  }

  // Guard against concurrent checks.
  if (updateCheckInProgress) {
    log.info("[Updater] Update check already in progress - skipping manual check");
    dialog.showMessageBox({
      type: "info",
      buttons: ["OK"],
      title: "Web Presence Bridge - Update Check",
      message: "An update check is already in progress.",
      detail: "Please try again in a moment.",
      icon: icons.message,
    });
    return;
  }
  updateCheckInProgress = true;

  const method = detectInstallMethod();
  log.info("[Updater] Manual update check triggered");

  try {
    const release = await fetchLatestVersion();
    if (!release.version) return _showUpToDate();

    const current = runtimeInfo.getCodeVersion() ?? app.getVersion();
    const meta = _validateMetaForRelease(await fetchUpdateMeta(release.assets), release, current);

    if (!runtimeInfo.safeSemverGt(release.version, current)) return _showUpToDate();

    // Skip if already staged.
    const userData = app.getPath("userData");
    let alreadyStaged = false;
    try {
      const stagedMeta = JSON.parse(rawFs.readFileSync(runtimeInfo.getStagingMetaPath(userData), "utf8"));
      if (meta && stagedMeta.version === meta.version && stagedMeta.runtime?.sha256 && rawFs.existsSync(runtimeInfo.getStagingAsarPath(userData))) {
        alreadyStaged = true;
      }
    } catch (_) {}
    // Runtime channel only when policy allows (shouldUseReleaseChannel logs its reason).
    const useReleaseChannel = meta ? shouldUseReleaseChannel(current, release.version, meta) : false;
    if (meta && !useReleaseChannel) {
      let ready = alreadyStaged;
      if (alreadyStaged) {
        log.info(`[Updater] Version ${meta.version} already staged - not re-downloading`);
      } else {
        ready = await stageRuntimeUpdate(meta, release.assets);
      }
      if (ready) {
        _showRuntimeStaged(meta.version);
        return;
      }
      log.warn("[Updater] Falling back to binary update channel");
    } else if (meta) {
      log.info(`[Updater] Release channel selected for ${release.version}`);
    }

    // Binary channel
    if (canAutoUpdate(method)) {
      const result = await autoUpdater.checkForUpdates();
      const remote = result?.updateInfo?.version;

      if (remote && runtimeInfo.safeSemverGt(remote, app.getVersion())) {
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
      showUpdateDialog(release.version, method, getUpdateInstructions(method, release.version, release.assets));
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
  } finally {
    updateCheckInProgress = false;
  }
}

function _showRuntimeStaged(version) {
  dialog
    .showMessageBox({
      type: "info",
      buttons: ["OK"],
      title: "Web Presence Bridge - Update Ready",
      message: `Version ${version} has been downloaded.`,
      detail: "It will be applied the next time the app starts.",
      icon: icons.message,
    })
    .catch(() => {});
}

function _showUpToDate() {
  const currentVersion = runtimeInfo.getCodeVersion() ?? app.getVersion();
  dialog.showMessageBox({
    type: "info",
    buttons: ["OK"],
    title: "Web Presence Bridge - Up to Date",
    message: "You're using the latest version.",
    detail: `Version: ${currentVersion}`,
    icon: icons.message,
  });
}

module.exports = {
  setupAutoUpdater,
  runManualUpdateCheck,
  _checkForUpdates,
  detectInstallMethod,
  shouldUseReleaseChannel,
  canonicalUpdatePayload,
  stageRuntimeUpdate,
  _verifyRuntimeSignature,
  restartToApply,
};
