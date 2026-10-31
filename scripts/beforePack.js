// electron-builder "beforePack" hook: regenerates app/binary-fingerprint.json right before the app files are packed into app.asar, so every build path (build:*, pack, --dir) ships a fresh fingerprint. Throws (aborting the build) if the fingerprint can't be computed, e.g. electron is not pinned.
const { writeFingerprintFile } = require("./writeBinaryFingerprint");

module.exports = async function beforePack() {
  const { fingerprint, electron } = writeFingerprintFile();
  console.log(`  • binary fingerprint ${fingerprint.slice(0, 12)}… (Electron ${electron})`);
};
