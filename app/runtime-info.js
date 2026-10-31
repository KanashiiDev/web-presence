// Runtime bundle discovery, integrity hashing, and health tracking.
// Bootstrap may load a newer runtime bundle (full app.asar copy) under userData:
//   runtime/app.asar          - active runtime
//   runtime/runtime-meta.json - metadata of the applied runtime
//   runtime/healthy.json      - last known healthy version
//   staging/app.asar          - pending update (sibling of runtime/)
// This module is Electron-free for use in Node.js tests and build scripts.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const semver = require("semver");

// Electron patches require("fs") to support ASAR paths, which breaks archive-file operations. Use original-fs when available; fall back to fs under plain Node.
const rawFs = (() => {
  try {
    return require("original-fs");
  } catch (_) {
    return fs;
  }
})();

const RUNTIME_DIRNAME = "runtime";
const STAGING_DIRNAME = "staging";
const RUNTIME_ASAR = "app.asar";
const HEALTHY_FILENAME = "healthy.json";
const STAGING_META_FILENAME = "update-meta.json";

// Runtime layout (relative to userData):
//   runtime/app.asar      - active runtime bundle (disposable)
//   runtime/healthy.json  - last known healthy version
//   staging/              - downloaded updates awaiting application
// Staging is a sibling of runtime so replacing the runtime cannot destroy a pending update.
// --- Paths ------------------------------------------------------------------
const getRuntimeDir = (userDataPath) => path.join(userDataPath, RUNTIME_DIRNAME);
const getRuntimeAsarPath = (userDataPath) => path.join(getRuntimeDir(userDataPath), RUNTIME_ASAR);
const getStagingDir = (userDataPath) => path.join(userDataPath, STAGING_DIRNAME);
const getStagingAsarPath = (userDataPath) => path.join(getStagingDir(userDataPath), RUNTIME_ASAR);
const getStagingMetaPath = (userDataPath) => path.join(getStagingDir(userDataPath), STAGING_META_FILENAME);
const getHealthyMarkerPath = (userDataPath) => path.join(getRuntimeDir(userDataPath), HEALTHY_FILENAME);

// --- Bundle identity ---------------------------------------------------------

// Root of the bundle this file was loaded from:
//   dev      → project root
//   shipped  → <install>/resources/app.asar
//   runtime  → <userData>/runtime/app.asar
const getBundleRoot = () => path.join(__dirname, "..");

// True when running code is the userData runtime bundle (not shipped/dev).
const isRuntimeBundle = () => path.basename(path.dirname(getBundleRoot())) === RUNTIME_DIRNAME;

// Authoritative code version: the bundle we are actually running. Returns null when package.json cannot be read.
function getCodeVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(getBundleRoot(), "package.json"), "utf8")).version ?? null;
  } catch (_) {
    return null;
  }
}

// Read the version declared inside a runtime bundle's package.json.
function getBundleVersion(bundleAsarPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(bundleAsarPath, "package.json"), "utf8")).version ?? null;
  } catch (_) {
    return null;
  }
}

// --- Health marker -----------------------------------------------------------

// Called by the app after a fully successful initialization. The marker is
// versioned: bootstrap treats a runtime as proven only while its recorded
// version matches the runtime's package.json (a swap invalidates it).
//
// Only the running code itself can mark itself healthy, and only when it is
// actually executing from the userData runtime bundle (not the shipped bundle
// or a dev tree). This prevents a newer shipped binary from back-marking an
// older staged runtime as proven.
function markHealthy(userDataPath, electronVersion, appVersion) {
  if (!isRuntimeBundle()) return false;
  try {
    const version = getCodeVersion();
    if (!version) return false;
    fs.mkdirSync(getRuntimeDir(userDataPath), { recursive: true });
    const existing = readHealthyMarker(userDataPath) || {};
    const sameVersion = existing.version === version;
    fs.writeFileSync(
      getHealthyMarkerPath(userDataPath),
      JSON.stringify({
        version,
        at: Date.now(),
        electron: electronVersion ?? (sameVersion ? existing.electron : null) ?? null,
        appVersion: appVersion ?? (sameVersion ? existing.appVersion : null) ?? null,
      }),
    );
    return true;
  } catch (_) {
    return false;
  }
}

function readHealthyMarker(userDataPath) {
  try {
    return JSON.parse(fs.readFileSync(getHealthyMarkerPath(userDataPath), "utf8"));
  } catch (_) {
    return null;
  }
}

// --- Integrity ---------------------------------------------------------------

function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = rawFs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// Sync hash of a file, or of a directory bundle (stable manifest: relative paths + contents, order-independent). Used by bootstrap to re-verify staged bundles; rawFs used because the target is a bundle FILE (.asar) that must be hashed raw.
function hashPathSync(target) {
  const stat = rawFs.statSync(target);
  if (stat.isFile()) return crypto.createHash("sha256").update(rawFs.readFileSync(target)).digest("hex");

  const hash = crypto.createHash("sha256");
  const walk = (dir, prefix) => {
    for (const entry of rawFs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else hash.update(rel).update(rawFs.readFileSync(path.join(dir, entry.name)));
    }
  };
  walk(target, "");
  return hash.digest("hex");
}

// --- Failed-version tracking --------------------------------------------------

// Lives in the userData ROOT (not inside the runtime dir) so that dropping a
// broken runtime bundle never resets the failure counter.
const FAILED_VERSIONS_FILENAME = "failed-runtime-versions.json";

const getFailedVersionsPath = (userDataPath) => path.join(userDataPath, FAILED_VERSIONS_FILENAME);

function readFailedVersions(userDataPath) {
  try {
    return JSON.parse(fs.readFileSync(getFailedVersionsPath(userDataPath), "utf8"));
  } catch (_) {
    return [];
  }
}

function writeFailedVersions(userDataPath, versions) {
  try {
    fs.writeFileSync(getFailedVersionsPath(userDataPath), JSON.stringify(versions));
  } catch (_) {}
}

function recordFailedVersion(userDataPath, version) {
  try {
    const versions = readFailedVersions(userDataPath);
    if (!versions.includes(version)) {
      versions.push(version);
      writeFailedVersions(userDataPath, versions);
    }
  } catch (_) {}
}

function isFailedVersion(userDataPath, version) {
  return readFailedVersions(userDataPath).includes(version);
}

// Validate that a version string is safe to pass to semver functions.
// Returns false for invalid, missing, or non-string versions.
function isValidVersion(version) {
  if (!version || typeof version !== "string") return false;
  try {
    return semver.valid(version) !== null;
  } catch (_) {
    return false;
  }
}

// Safe semver.lt that returns false if either version is invalid.
function safeSemverLt(a, b) {
  if (!isValidVersion(a) || !isValidVersion(b)) return false;
  return semver.lt(a, b);
}

// Safe semver.lte that returns false if either version is invalid.
function safeSemverLte(a, b) {
  if (!isValidVersion(a) || !isValidVersion(b)) return false;
  return semver.lte(a, b);
}

// Safe semver.gt that returns false if either version is invalid.
function safeSemverGt(a, b) {
  if (!isValidVersion(a) || !isValidVersion(b)) return false;
  return semver.gt(a, b);
}

module.exports = {
  RUNTIME_DIRNAME,
  rawFs,
  getRuntimeDir,
  getRuntimeAsarPath,
  getStagingDir,
  getStagingAsarPath,
  getStagingMetaPath,
  getHealthyMarkerPath,
  getBundleRoot,
  isRuntimeBundle,
  getCodeVersion,
  getBundleVersion,
  markHealthy,
  readHealthyMarker,
  fileSha256,
  hashPathSync,
  getFailedVersionsPath,
  readFailedVersions,
  writeFailedVersions,
  recordFailedVersion,
  isFailedVersion,
  isValidVersion,
  safeSemverLt,
  safeSemverLte,
  safeSemverGt,
};
