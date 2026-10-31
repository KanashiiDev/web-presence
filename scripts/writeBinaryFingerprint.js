// Binary fingerprint: hash of everything the runtime bundle (userData app.asar) cannot carry - only a newly installed binary changes:
//   1. shipped-only code: app/bootstrap.js, app/runtime-info.js, app/update-keys.js, app/fingerprint.js (loaded from installed asar, never the runtime bundle)
//   2. Electron version bundled into the binary (pinned exactly in package.json)
//   3. package.json "main" + "build"
//   4. extraResources source files (<install>/resources, outside the asar)
//   5. declared production dependency surface (dependencies / optionalDependencies / overrides / resolutions) - ranges, not resolved versions
// Everything else (server/, shared/, locales/, most of app/, pure-JS deps, installed transitive versions) is intentionally NOT part of it: changing those is exactly what a runtime update delivers.
//
// node_modules is deliberately NOT inspected. Releases are produced from a clean tree (package-lock.json and node_modules deleted, `npm install` from scratch), so resolved transitive versions are not reproducible across platforms, runners or release dates and must never feed the fingerprint. The declared ranges are stable byte-for-byte on every runner.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const OUTPUT_PATH = path.join(projectRoot, "app", "binary-fingerprint.json");

const SHIPPED_ONLY_FILES = ["app/bootstrap.js", "app/runtime-info.js", "app/update-keys.js", "app/fingerprint.js"];

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Deterministic JSON (sorted keys).
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(byCodeUnit)
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedBytes(buf) {
  if (buf.includes(0)) return buf; // binary file: hash raw
  return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"), "utf8");
}

const hashFile = (full) => sha256(normalizedBytes(fs.readFileSync(full)));

// Hash of a file, or of a directory (relative paths + contents, sorted).
function hashPath(rel) {
  const full = path.join(projectRoot, rel);
  if (!fs.existsSync(full)) throw new Error(`Fingerprint input missing: ${rel}`);
  if (!fs.statSync(full).isDirectory()) return hashFile(full);

  const hash = crypto.createHash("sha256");
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => byCodeUnit(a.name, b.name))) {
      const relName = prefix ? `${prefix}/${e.name}` : e.name;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, relName);
      else hash.update(relName).update(hashFile(p));
    }
  };
  walk(full, "");
  return hash.digest("hex");
}

// --- Declared production dependencies ---

// Hash surface for the declared production dependency graph. Only fields that can change what
// electron-builder actually ships into the binary are included:
//   - dependencies / optionalDependencies: direct prod deps (native or pure-JS) - electron-builder ships these
//   - overrides / resolutions: rewrite transitive versions; with no lockfile, these are the only
//     way a transitive native dep can change without touching `dependencies`
// Deliberately excluded: devDependencies (not shipped), engines (the Electron binary bundles its
// own Node, so engines.node does not affect which native modules end up in the binary), and metadata
// (scripts / description / keywords / author / homepage - no runtime effect).
function declaredDependencySurface(rootPkg) {
  return {
    dependencies: rootPkg.dependencies ?? {},
    optionalDependencies: rootPkg.optionalDependencies ?? {},
    overrides: rootPkg.overrides ?? {},
    resolutions: rootPkg.resolutions ?? {},
  };
}

// --- Electron ---

function getPinnedElectronVersion(rootPkg) {
  let installed;
  try {
    installed = readJson(path.join(projectRoot, "node_modules", "electron", "package.json")).version;
  } catch (_) {
    throw new Error("electron is not installed - run npm install");
  }
  const declared = rootPkg.devDependencies?.electron ?? rootPkg.dependencies?.electron;
  if (declared !== installed) {
    throw new Error(
      `electron must be pinned exactly: package.json declares "${declared}" but ${installed} is installed. Run: npm install -D --save-exact electron@${installed}`,
    );
  }
  return installed;
}

// --- Fingerprint ---

function computeFingerprint() {
  const rootPkg = readJson(path.join(projectRoot, "package.json"));
  const build = rootPkg.build ?? {};

  const shippedFiles = {};
  for (const rel of SHIPPED_ONLY_FILES) shippedFiles[rel] = hashPath(rel);

  const extraResources = {};
  for (const entry of build.extraResources ?? []) {
    const from = typeof entry === "string" ? entry : entry?.from;
    if (from) extraResources[from] = hashPath(from);
  }

  const parts = {
    electron: getPinnedElectronVersion(rootPkg),
    shippedFiles,
    packageConfig: sha256(stable({ main: rootPkg.main ?? null, build })),
    extraResources,
    dependencySurface: declaredDependencySurface(rootPkg),
  };

  return { fingerprint: sha256(stable(parts)), electron: parts.electron, parts };
}

function writeFingerprintFile() {
  const result = computeFingerprint();
  const content = JSON.stringify(result, null, 2) + "\n";
  let existing = null;
  try {
    existing = fs.readFileSync(OUTPUT_PATH, "utf8");
  } catch (_) {}
  if (existing !== content) fs.writeFileSync(OUTPUT_PATH, content);
  return result;
}

if (require.main === module) {
  try {
    const { fingerprint, electron, parts } = writeFingerprintFile();
    const depCount = Object.keys(parts.dependencySurface.dependencies).length + Object.keys(parts.dependencySurface.optionalDependencies).length;
    console.log(`🔑 Binary fingerprint ${fingerprint.slice(0, 12)}… (Electron ${electron}, ${depCount} declared prod dep(s)) → app/binary-fingerprint.json`);
  } catch (err) {
    console.error(`❌ Binary fingerprint failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { computeFingerprint, writeFingerprintFile, OUTPUT_PATH, SHIPPED_ONLY_FILES };
