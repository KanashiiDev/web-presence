const fs = require("fs");
const path = require("path");
const { ZipArchive } = require("archiver");
const { version } = require("../package.json");
const { checkMissingTranslations, generateLanguages } = require("./checkMissingTranslations");
const { computeFingerprint } = require("./writeBinaryFingerprint");
const inputVersion = process.argv[2];
const releaseVersion = inputVersion || version;
const projectRoot = path.join(__dirname, "..");
const LOCALES_DIR = path.join(projectRoot, "locales");
const distDir = path.join(projectRoot, "dist");
const extensionBuildsDir = path.join(projectRoot, "extensionBuilds");
const releaseDir = path.join(projectRoot, "release");
const winUnpackedDir = path.join(distDir, "win32", "win-unpacked");

// Clean or create release folder (fall back to clearing contents if locked).
if (fs.existsSync(releaseDir)) {
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  } catch (_) {
    for (const entry of fs.readdirSync(releaseDir)) {
      try {
        fs.rmSync(path.join(releaseDir, entry), { recursive: true, force: true });
      } catch (err) {
        console.warn(`⚠️  could not remove ${entry}: ${err.code ?? err.message} (file locked?)`);
      }
    }
  }
}
fs.mkdirSync(releaseDir, { recursive: true });

// Update readme.md version
function updateReadmeVersion() {
  const readmePath = path.join(projectRoot, "readme.md");
  if (!fs.existsSync(readmePath)) {
    console.log("⚠️  readme.md not found, skipping");
    return;
  }
  const content = fs.readFileSync(readmePath, "utf8");
  const pattern = /(\/releases\/latest\/download\/[a-zA-Z-]+-)(\d+\.\d+\.\d+)(-[a-zA-Z0-9._-]+)/g;
  let count = 0,
    oldVer = null,
    same = true;
  const updated = content.replace(pattern, (_, pre, ver, suf) => {
    oldVer ??= ver;
    if (ver !== releaseVersion) same = false;
    count++;
    return `${pre}${releaseVersion}${suf}`;
  });
  if (!count) return console.log("⚠️  No version patterns found in readme.md");
  if (same) return console.log(`ℹ️  readme.md already at ${releaseVersion}`);
  fs.writeFileSync(readmePath, updated, "utf8");
  console.log(`📝 readme.md: ${oldVer} → ${releaseVersion} (${count} occurrences)`);
}
updateReadmeVersion();

// Helper: recursively collect files from dist
function getAllFiles(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    out = e.isDirectory() ? out.concat(getAllFiles(full)) : [...out, full];
  }
  return out;
}

// Helper: rename "web-presence-bridge-" prefix to "web-presence-" in filename
function resolvedName(f) {
  return f.startsWith("web-presence-bridge-") ? f.replace("web-presence-bridge-", "web-presence-") : f;
}

// Collect & copy dist files
for (const full of getAllFiles(distDir)) {
  const f = path.basename(full);
  const renamed = resolvedName(f);
  const dest = path.join(releaseDir, renamed);

  if (f.startsWith("latest") && f.endsWith(".yml")) {
    fs.copyFileSync(full, dest);
    console.log(`📄 Copied ${f}`);
  }
  if ((f.startsWith("web-presence-bridge-") || f.startsWith("web-presence-")) && f.endsWith(".exe")) {
    fs.copyFileSync(full, dest);
    console.log(`📦 Windows installer: ${f}`);
  }
  if ((f.startsWith("web-presence-bridge-") || f.startsWith("web-presence-")) && f.endsWith(".AppImage")) {
    fs.copyFileSync(full, dest);
    const arch = f.includes("aarch64") ? "aarch64" : "x86_64";
    console.log(`📦 AppImage (${arch}): ${f}`);
  }
  if ((f.startsWith("web-presence-bridge-") || f.startsWith("web-presence-")) && f.endsWith(".deb")) {
    fs.copyFileSync(full, dest);
    console.log(`📦 DEB: ${f}`);
  }
  if ((f.startsWith("web-presence-bridge-") || f.startsWith("web-presence-")) && f.endsWith(".rpm")) {
    fs.copyFileSync(full, dest);
    console.log(`📦 RPM: ${f}`);
  }
  if ((f.startsWith("web-presence-bridge-") || f.startsWith("web-presence-")) && f.endsWith(".dmg")) {
    fs.copyFileSync(full, dest);
    console.log(`📦 Mac DMG: ${f}`);
  }
  if ((f.startsWith("web-presence-bridge-") || f.startsWith("web-presence-")) && f.endsWith(".pacman")) {
    fs.copyFileSync(full, dest);
    console.log(`📦 Pacman: ${f}`);
  }
}

// ZIP Windows unpacked
function zipDir(src, zipName) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(path.join(releaseDir, zipName));
    const arc = new ZipArchive({ zlib: { level: 9 } });
    out.on("close", () => {
      console.log(`✅ Zipped → ${zipName}`);
      resolve();
    });
    arc.on("error", reject);
    arc.pipe(out);
    arc.directory(src, false);
    arc.finalize();
  });
}

// Main
checkMissingTranslations(LOCALES_DIR);
generateLanguages(LOCALES_DIR);

// --- Runtime update bundle (custom updater) ---
// Generates web-presence-<version>-runtime.asar + latest.json (version+sha256+Ed25519 signature). Repackages a completed electron-builder output; needs @electron/asar and a platform build in dist/.
const crypto = require("crypto");
let asar = null;
try {
  asar = require("@electron/asar");
} catch (_) {}

function findBuiltAsar() {
  if (!fs.existsSync(distDir)) return null;
  return getAllFiles(distDir).find((f) => /-unpacked[\\/]resources[\\/]app\.asar$/i.test(f)) ?? null;
}

// Canonical signed payload (version+sha256+binaryFingerprint). Matches updater.js and bootstrap.js. UTF-8 JSON (not raw hex).
function canonicalUpdatePayload(version, sha256, binaryFingerprint) {
  return JSON.stringify({ version, sha256, binaryFingerprint: binaryFingerprint ?? null });
}

// Loads the private signing key and verifies it matches the public key embedded in app/update-keys.js (mismatch → clients reject the release).
function loadSigningKeyPair() {
  const keyPath = path.join(projectRoot, "keys", "update-signing-private.pem");
  if (!fs.existsSync(keyPath)) {
    throw new Error("Update signing private key not found - run scripts/generateUpdateKeys.js first. Releases cannot be produced unsigned.");
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8"));
  } catch (err) {
    throw new Error(`could not read update signing key: ${err.message}`);
  }

  let embeddedPem;
  try {
    embeddedPem = require("../app/update-keys").publicKey;
  } catch (err) {
    throw new Error(`app/update-keys.js is missing or invalid (${err.message}) - run scripts/generateUpdateKeys.js`);
  }

  const derivedPem = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  if (derivedPem.trim() !== String(embeddedPem).trim()) {
    throw new Error("keys/update-signing-private.pem does not match the public key in app/update-keys.js - clients would reject this release");
  }
  return { privateKey, publicKey: crypto.createPublicKey(embeddedPem) };
}

// Ed25519 sign the runtime update. Private key required for releases; missing/mismatched key or signing failure aborts so an unsigned release is never produced silently. Signature self-checked against embedded public key.
function signChecksum(sha256, binaryFingerprint) {
  const { privateKey, publicKey } = loadSigningKeyPair();
  const payload = Buffer.from(canonicalUpdatePayload(releaseVersion, sha256, binaryFingerprint), "utf8");
  const signature = crypto.sign(null, payload, privateKey);
  if (!crypto.verify(null, payload, publicKey, signature)) {
    throw new Error("signature self-check failed");
  }
  return signature.toString("base64");
}

async function buildRuntimeBundle() {
  if (!asar) {
    throw new Error("@electron/asar not installed - cannot build runtime bundle (npm i -D @electron/asar)");
  }

  const builtAsar = findBuiltAsar();
  if (!builtAsar) {
    throw new Error("No built app.asar found in dist/ - run a platform build first");
  }

  const workDir = path.join(releaseDir, ".runtime-build");
  fs.rmSync(workDir, { recursive: true, force: true });
  await asar.extractAll(builtAsar, workDir);

  // Runtime bundle enters through the real app, not bootstrap (bootstrap performs the swap itself).
  const pkgPath = path.join(workDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  // Version must match the built app (stale build or wrong version arg) - never relabel silently.
  if (pkg.version !== releaseVersion) {
    fs.rmSync(workDir, { recursive: true, force: true });
    throw new Error(`Built app.asar is version ${pkg.version} but the release version is ${releaseVersion} - rebuild with a matching package.json version`);
  }

  pkg.main = "app/main.js";
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  const outFile = path.join(releaseDir, `web-presence-${releaseVersion}-runtime.asar`);
  await asar.createPackage(workDir, outFile);
  fs.rmSync(workDir, { recursive: true, force: true });

  // Verify packaged output (not working copy): embedded version, entry point, entry file exists in archive.
  try {
    const embedded = JSON.parse(asar.extractFile(outFile, "package.json").toString("utf8"));
    if (embedded.version !== releaseVersion) throw new Error(`embedded version ${embedded.version} != ${releaseVersion}`);
    if (embedded.main !== "app/main.js") throw new Error(`embedded main is ${embedded.main}`);
    asar.statFile(outFile, "app/main.js");
  } catch (err) {
    fs.rmSync(outFile, { force: true });
    throw new Error(`Runtime bundle verification failed: ${err.message}`);
  }

  // Binary fingerprint of the build this runtime was packed from (written into the asar by scripts/beforePack.js). It must also match the CURRENT source tree, otherwise the dist/ build is stale (e.g. bootstrap.js edited after building) and this runtime could be incompatible with the binaries.
  let binaryFingerprint;
  try {
    binaryFingerprint = JSON.parse(asar.extractFile(outFile, "app/binary-fingerprint.json").toString("utf8")).fingerprint;
    if (!/^[0-9a-f]{64}$/.test(String(binaryFingerprint))) throw new Error("malformed fingerprint");
  } catch (err) {
    fs.rmSync(outFile, { force: true });
    throw new Error(`app/binary-fingerprint.json missing or invalid in the built asar (${err.message}) - rebuild with electron-builder (beforePack writes it)`);
  }
  const currentFingerprint = computeFingerprint().fingerprint;
  if (binaryFingerprint !== currentFingerprint) {
    fs.rmSync(outFile, { force: true });
    throw new Error(
      `dist/ build is stale: its binary fingerprint (${binaryFingerprint.slice(0, 12)}…) differs from the current source tree (${currentFingerprint.slice(0, 12)}…) - rebuild before preparing the release`,
    );
  }

  const buf = fs.readFileSync(outFile);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  const meta = {
    version: releaseVersion,
    runtime: {
      file: path.basename(outFile),
      sha256,
      size: buf.length,
      binaryFingerprint,
    },
  };

  // Signing mandatory for releases; signChecksum throws if key missing or signing fails, so no unsigned release is produced.
  const signature = signChecksum(sha256, binaryFingerprint);
  meta.runtime.signature = signature;
  console.log("🔐 Update signed (ed25519, canonical payload: version+sha256+binaryFingerprint)");
  console.log(`🔑 Binary fingerprint ${binaryFingerprint.slice(0, 12)}…`);

  fs.writeFileSync(path.join(releaseDir, "latest.json"), JSON.stringify(meta, null, 2));
  console.log(`📦 Runtime bundle: ${path.basename(outFile)} (${(buf.length / 1024 / 1024).toFixed(2)} MB, sha256 ${sha256.slice(0, 12)}...)`);
  console.log(`📄 latest.json written`);
}

(async () => {
  if (fs.existsSync(winUnpackedDir)) {
    await zipDir(winUnpackedDir, `web-presence-${releaseVersion}-x64.zip`);
  }

  if (fs.existsSync(extensionBuildsDir)) {
    for (const f of fs.readdirSync(extensionBuildsDir).filter((f) => f.endsWith(".zip"))) {
      const dest = path.join(releaseDir, f);
      fs.copyFileSync(path.join(extensionBuildsDir, f), dest);
      console.log(`🧩 Extension: ${f}`);
    }
  }

  await buildRuntimeBundle();

  console.log(`\n✅ Release files ready in: release/\n`);
})().catch((err) => {
  console.error(`\n❌ Release preparation failed: ${err.message}`);
  process.exit(1);
});
