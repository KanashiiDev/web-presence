// Binary fingerprint helpers (Electron-free, plain Node). Shipped-only file: loaded by bootstrap.js from the installed asar.
// app/binary-fingerprint.json is generated at build time by scripts/writeBinaryFingerprint.js. Hash of everything a runtime update can't carry (shipped-only code, Electron version, build config, extraResources, native modules). A runtime bundle may only be used while its fingerprint equals the INSTALLED binary's fingerprint.
const fs = require("fs");
const path = require("path");

const FINGERPRINT_FILENAME = "binary-fingerprint.json";

// Returns the 64-char hex fingerprint stored in `file`, or null (missing/unreadable/malformed).
function readFingerprintFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof data?.fingerprint === "string" && /^[0-9a-f]{64}$/.test(data.fingerprint) ? data.fingerprint : null;
  } catch (_) {
    return null;
  }
}

// True when loaded from the userData runtime bundle (<userData>/runtime/app.asar/app/).
const isInRuntimeBundle = () => path.basename(path.dirname(path.join(__dirname, ".."))) === "runtime";

// Fingerprint of the INSTALLED binary (shipped asar), never the running runtime bundle's own copy (a runtime would always match itself otherwise).
// null when unavailable; callers treat as "not compatible" (safe default).
function getShippedFingerprint() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "app.asar", "app", FINGERPRINT_FILENAME));
  // Dev / plain Node (tests): this directory IS the shipped tree. Never inside a runtime bundle.
  if (!isInRuntimeBundle()) candidates.push(path.join(__dirname, FINGERPRINT_FILENAME));

  for (const file of candidates) {
    const value = readFingerprintFile(file);
    if (value) return value;
  }
  return null;
}

module.exports = { FINGERPRINT_FILENAME, readFingerprintFile, getShippedFingerprint };
