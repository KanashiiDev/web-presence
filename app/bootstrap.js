// Bootstrap entry point. Top-level order:
//   1. app.setName → userData path
//   2. applyPendingUpdate (staged runtime swap)
//   3. selectCodeEntry (runtime vs shipped; binary fingerprint is the sole Electron compatibility gate)
//   4. require(entry), fallback to ./main
// Node built-ins + Electron only before runtime selection; async crashes handled via health marker (runtime-info.js).
const { app } = require("electron");
const path = require("path");
const crypto = require("crypto");

const runtimeInfo = require("./runtime-info");
const fingerprint = require("./fingerprint");

// Unpatched fs: Electron's patched fs treats *.asar paths as archives.
const fs = runtimeInfo.rawFs;

const MAX_FAILED_ATTEMPTS = 2;
const ATTEMPTS_FILENAME = "attempts.json";

// --- Attempt bookkeeping -----------------------------------------------------

// userData root (not runtime dir): a broken bundle must not reset the counter.
const getAttemptsPath = (userData) => path.join(userData, ATTEMPTS_FILENAME);

function readAttempts(userData) {
  try {
    return JSON.parse(fs.readFileSync(getAttemptsPath(userData), "utf8"));
  } catch (_) {
    return null;
  }
}

function writeAttempts(userData, data) {
  try {
    fs.writeFileSync(getAttemptsPath(userData), JSON.stringify(data));
  } catch (_) {}
}

function clearAttempts(userData) {
  try {
    fs.rmSync(getAttemptsPath(userData), { force: true });
  } catch (_) {}
}

// Best-effort recursive rm that never throws (Windows EPERM on locked files).
function safeRmSync(target, opts = { recursive: true, force: true }) {
  try {
    fs.rmSync(target, opts);
  } catch (_) {}
}

// --- Signature verification ----------------------------------------------------

// Canonical signed payload (version+sha256+binaryFingerprint). Matches prepareRelease.js and updater.js.
function canonicalUpdatePayload(meta) {
  return JSON.stringify({
    version: meta.version,
    sha256: meta.runtime?.sha256 ?? null,
    binaryFingerprint: meta.runtime?.binaryFingerprint ?? null,
  });
}

// Verifies the Ed25519 signature of a staged runtime update.
// Packaged builds require a valid signature; returns true if verification passes or signatures aren't configured (dev); throws on invalid/missing signature in packaged builds.
function verifyRuntimeSignature(meta) {
  let keys;
  try {
    keys = require("./update-keys");
  } catch (_) {
    keys = null;
  }

  if (!keys) {
    if (app.isPackaged) {
      throw new Error("Release is unsigned but this packaged build requires signatures");
    }
    // Dev mode: checksum-only, signature not configured.
    return true;
  }

  if (!meta.runtime?.signature) {
    throw new Error("Release is not signed but this build requires signatures");
  }

  let signatureBuf;
  try {
    signatureBuf = Buffer.from(meta.runtime.signature, "base64");
  } catch (_) {
    throw new Error("Malformed update signature");
  }

  const payload = canonicalUpdatePayload(meta);
  const payloadBuf = Buffer.from(payload, "utf8");
  const ok = crypto.verify(null, payloadBuf, crypto.createPublicKey(keys.publicKey), signatureBuf);
  if (!ok) throw new Error("Runtime update signature verification failed");
  return true;
}

// Swap verified staging bundle into runtime slot synchronously before any runtime require (no file locks). Old runtime preserved until new one in place; backup removed after rename, restored if activation fails so a valid runtime is never destroyed.
// The healthy marker is NOT written here - markHealthy() (main.js, after successful init) marks a runtime proven. Writing it during staging lets an unproven runtime skip the attempt counter next launch.
function applyPendingUpdate() {
  const userData = app.getPath("userData");
  const stagedAsar = runtimeInfo.getStagingAsarPath(userData);

  // Remove stale .old backup from interrupted swap; never the active runtime.
  const runtimeDir = runtimeInfo.getRuntimeDir(userData);
  const runtimeAsar = runtimeInfo.getRuntimeAsarPath(userData);
  const staleBackup = runtimeAsar + ".old";
  try {
    if (fs.existsSync(staleBackup) && !fs.existsSync(runtimeAsar)) {
      fs.rmSync(staleBackup, { force: true });
    }
  } catch (_) {}

  // Remove orphaned .tmp from interrupted download (never consumed, would persist indefinitely).
  const orphanedTmp = stagedAsar + ".tmp";
  try {
    if (fs.existsSync(orphanedTmp)) fs.rmSync(orphanedTmp, { force: true });
  } catch (_) {}

  if (!fs.existsSync(stagedAsar)) return;

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(runtimeInfo.getStagingMetaPath(userData), "utf8"));
  } catch (_) {
    console.log("[bootstrap] staging meta unreadable - discarding staged update");
    safeRmSync(runtimeInfo.getStagingDir(userData));
    return;
  }

  // Binary compatibility: the runtime must have been built against the same shipped-only code, Electron version, build config, extraResources and native modules as the INSTALLED binary. Missing on either side → discard (the fingerprint is covered by the signature, so it can't be stripped or forged).
  const shippedFingerprint = fingerprint.getShippedFingerprint();
  if (!shippedFingerprint || meta.runtime?.binaryFingerprint !== shippedFingerprint) {
    console.log(
      `[bootstrap] staged runtime ${meta.version} does not match the installed binary (fingerprint ${meta.runtime?.binaryFingerprint ? "differs" : "missing"}${shippedFingerprint ? "" : ", installed fingerprint missing"}) - discarding`,
    );
    safeRmSync(runtimeInfo.getStagingDir(userData));
    return;
  }

  // Block older staged runtime overriding newer app version.
  const currentAppVersion = app.getVersion();
  if (meta.version && runtimeInfo.safeSemverLte(meta.version, currentAppVersion)) {
    console.log(`[bootstrap] staged runtime ${meta.version} is not newer than app ${currentAppVersion} - discarding`);
    safeRmSync(runtimeInfo.getStagingDir(userData));
    return;
  }

  try {
    const hash = runtimeInfo.hashPathSync(stagedAsar);
    // Metadata is nested ({ version, runtime: { sha256, ... } }) so canonical payload can be rebuilt; flat meta.sha256 would be undefined.
    if (hash !== meta.runtime?.sha256) throw new Error("checksum mismatch");
    // Missing or invalid signature rejects the update before it is applied.
    verifyRuntimeSignature(meta);
  } catch (err) {
    console.log(`[bootstrap] staged update rejected (${err.message}) - discarding`);
    safeRmSync(runtimeInfo.getStagingDir(userData));
    return;
  }

  let backupAsar = null;

  try {
    fs.mkdirSync(runtimeDir, { recursive: true });

    // Preserve old runtime until the new one is in place.
    if (fs.existsSync(runtimeAsar)) {
      const candidate = runtimeAsar + ".old";
      safeRmSync(candidate, { force: true }); // leftover from an earlier swap whose cleanup failed
      fs.renameSync(runtimeAsar, candidate);
      backupAsar = candidate; // set only after a successful rename, so the restore path can't clobber the active runtime
    }

    // Atomic promotion: staged bundle → runtime slot.
    fs.renameSync(stagedAsar, runtimeAsar);

    // Staging dir no longer needed; remove old-runtime backup.
    safeRmSync(runtimeInfo.getStagingDir(userData));
    if (backupAsar) {
      try {
        fs.rmSync(backupAsar, { force: true });
      } catch (_) {}
    }
    console.log(`[bootstrap] runtime update applied: ${meta.version}`);

    // Persist runtime metadata for main.js health marker.
    try {
      const runtimeMetaPath = path.join(runtimeDir, "runtime-meta.json");
      fs.writeFileSync(
        runtimeMetaPath,
        JSON.stringify({
          version: meta.version,
          binaryFingerprint: meta.runtime?.binaryFingerprint ?? null,
          appliedAt: Date.now(),
        }),
      );
    } catch (_) {}
  } catch (err) {
    // Restore previous runtime from backup if swap failed.
    if (backupAsar && fs.existsSync(backupAsar)) {
      try {
        if (fs.existsSync(runtimeAsar)) fs.rmSync(runtimeAsar, { force: true });
        fs.renameSync(backupAsar, runtimeAsar);
      } catch (_) {}
    }
    console.log(`[bootstrap] runtime swap failed: ${err.message}`);
  }
}

// Drops the runtime bundle + its state without ever throwing.
function discardRuntime(userData) {
  safeRmSync(runtimeInfo.getRuntimeDir(userData));
  clearAttempts(userData);
  safeRmSync(runtimeInfo.getHealthyMarkerPath(userData));
}

// --- Entry selection ----------------------------------------------------------

// Returns require target: runtime asar path, or "./main" (shipped).
// Compatibility checks run before health-state handling, for every runtime version (proven or not): minimum-electron, app-major, app-version guards.
// Proven = healthy marker matches package.json version; otherwise launch counts as an attempt and rolls back after MAX_FAILED_ATTEMPTS.
function selectCodeEntry() {
  const userData = app.getPath("userData");
  const runtimeAsar = runtimeInfo.getRuntimeAsarPath(userData);

  if (!fs.existsSync(runtimeAsar)) {
    // No runtime: shipped code is authoritative; clear stale marker and attempts.
    safeRmSync(runtimeInfo.getHealthyMarkerPath(userData));
    clearAttempts(userData);
    return "./main";
  }

  const version = runtimeInfo.getBundleVersion(runtimeAsar);
  if (!version) {
    console.log("[bootstrap] runtime bundle unreadable - discarding");
    discardRuntime(userData);
    return "./main";
  }

  // Already blacklisted (rollback happened but the runtime dir could not be deleted, e.g. Windows file lock): never load it again.
  if (runtimeInfo.isFailedVersion(userData, version)) {
    console.log(`[bootstrap] runtime ${version} is blacklisted - falling back to shipped code`);
    discardRuntime(userData);
    return "./main";
  }

  const healthy = runtimeInfo.readHealthyMarker(userData);

  // runtime-meta.json is source of truth only when it describes THIS runtime version (failed/partial swaps can leave a previous version's meta). Health marker is a fallback for the same version.
  let runtimeMeta = null;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(runtimeInfo.getRuntimeDir(userData), "runtime-meta.json"), "utf8"));
    if (m?.version === version) runtimeMeta = m;
  } catch (_) {}
  const runtimeFingerprint = runtimeMeta?.binaryFingerprint ?? null;

  // The installed binary changed since this runtime was applied (reinstall / different build): strict on mismatch. Lenient when runtime-meta.json is missing - apply time was authoritative.
  if (runtimeFingerprint && runtimeFingerprint !== fingerprint.getShippedFingerprint()) {
    console.log(`[bootstrap] runtime ${version} was built for a different binary (fingerprint mismatch) - falling back to shipped code`);
    discardRuntime(userData);
    return "./main";
  }

  // --- Compatibility checks (all versions, before health state) ---

  // Guard: discard runtime if app major changed since it was built.
  if (healthy?.appVersion) {
    const prevMajor = Number(healthy.appVersion.split(".")[0]);
    const currMajor = Number(app.getVersion().split(".")[0]);
    if (!Number.isNaN(prevMajor) && !Number.isNaN(currMajor) && prevMajor !== currMajor) {
      console.log(`[bootstrap] App major changed ${prevMajor} → ${currMajor}, clearing runtime bundle`);
      discardRuntime(userData);
      return "./main";
    }
  }

  // Block runtime strictly older than app version. Equal versions allowed: proven runtime at app version is known-working, must not be torn down; unproven falls to attempt counter (self-heal via crash rollback).
  const currentAppVersion = app.getVersion();
  if (runtimeInfo.safeSemverLt(version, currentAppVersion)) {
    console.log(`[bootstrap] runtime ${version} is older than app ${currentAppVersion} - falling back to shipped code`);
    discardRuntime(userData);
    return "./main";
  }

  // --- Health-state handling ---

  // Proven: healthy marker matches runtime's package.json version.
  if (healthy?.version === version && healthy.electron === process.versions.electron) {
    clearAttempts(userData);
    return runtimeAsar;
  }

  if (healthy?.version === version && healthy.electron && healthy.electron !== process.versions.electron) {
    console.log(`[bootstrap] runtime ${version} was proven on Electron ${healthy.electron}, now running ${process.versions.electron} - re-proving`);
  }

  // Unproven: count this launch as an attempt.
  const attempts = readAttempts(userData);
  const tries = attempts?.version === version ? attempts.tries : 0;
  writeAttempts(userData, { version, tries: tries + 1 });

  if (tries + 1 > MAX_FAILED_ATTEMPTS) {
    console.log(`[bootstrap] runtime ${version} failed ${MAX_FAILED_ATTEMPTS} times - rolling back to shipped code`);
    // Record first: must survive even if the cleanup below fails (locked files on Windows).
    runtimeInfo.recordFailedVersion(userData, version);
    discardRuntime(userData);
    return "./main";
  }

  console.log(`[bootstrap] using unproven runtime ${version} (attempt ${tries + 1}/${MAX_FAILED_ATTEMPTS})`);
  return runtimeAsar;
}

// --- Main ---

if (app.isPackaged) {
  app.setName("web-presence-bridge");
  // Point userData explicitly: Electron resolves default from packaged manifest before pre-ready setName.
  app.setPath("userData", path.join(app.getPath("appData"), "web-presence-bridge"));

  // Lock after userData finalized so it resolves to the directory actually used.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
  }
  // second-instance is handled in main.js (state.tray is not available here).

  // Bootstrap must never crash the app: any failure here falls through to shipped code.
  try {
    // Electron major changed since last run: discard pending staged update (built for old Electron) and clear stale marker. Do NOT delete applied runtime here - selectCodeEntry validates it against new Electron.
    const userData = app.getPath("userData");
    const healthy = runtimeInfo.readHealthyMarker(userData);

    if (healthy?.electron) {
      const prevMajor = Number(healthy.electron.split(".")[0]);
      const currMajor = Number(process.versions.electron.split(".")[0]);
      if (!Number.isNaN(prevMajor) && !Number.isNaN(currMajor) && prevMajor !== currMajor) {
        console.log(`[bootstrap] Electron major changed ${prevMajor} → ${currMajor}, clearing staged update`);
        safeRmSync(runtimeInfo.getStagingDir(userData));
        clearAttempts(userData);
        safeRmSync(runtimeInfo.getHealthyMarkerPath(userData));
      }
    }

    applyPendingUpdate();
  } catch (err) {
    console.log(`[bootstrap] pre-launch update handling failed (${err.message}) - continuing`);
  }
}

let entry = "./main";
if (app.isPackaged) {
  try {
    entry = selectCodeEntry();
  } catch (err) {
    console.log(`[bootstrap] entry selection failed (${err.message}) - using shipped code`);
    entry = "./main";
  }
}

try {
  require(entry);
} catch (err) {
  console.log(`[bootstrap] entry failed to load (${entry}): ${err.message}`);
  if (entry !== "./main") {
    // Record runtime version as failed so it is not re-downloaded.
    try {
      const failedVersion = runtimeInfo.getBundleVersion(entry);
      if (failedVersion) {
        runtimeInfo.recordFailedVersion(app.getPath("userData"), failedVersion);
      }
    } catch (_) {}
    try {
      fs.rmSync(runtimeInfo.getRuntimeDir(app.getPath("userData")), { recursive: true, force: true });
      clearAttempts(app.getPath("userData"));
    } catch (_) {}
    require("./main");
  } else {
    throw err;
  }
}
