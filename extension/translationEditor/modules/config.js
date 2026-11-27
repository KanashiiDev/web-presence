// Shared translation repository configuration. Loaded first by the inliner;
// other modules must not reference these values in earlier initializers.
const TE_REPO = { owner: "KanashiiDev", name: "web-presence-locales", branch: "main" };
const TE_REPO_RAW_BASE = `https://raw.githubusercontent.com/${TE_REPO.owner}/${TE_REPO.name}/${TE_REPO.branch}`;
// Must match PROCESSOR_BOT_LOGIN in web-presence-locales/tools/lib/constants.js.
// Only this bot's result comments are trusted.
const TE_RESULT_BOT_LOGIN = "github-actions[bot]";

// Keep in sync with web-presence-locales/tools/lib/{constants,hash}.js.
// Domain changes require a hashVersion migration on the locales side.
const TE_HASH_VERSION = 1;
const TE_DOMAIN_BY_VERSION = Object.freeze({ 1: "web-presence-locales/v1" });

// Mirrors tools/lib/submission.js validation.
const TE_LANG_RE = /^[a-z]{2,3}(?:-[a-z0-9]+)*$/;
const TE_LANG_RE_CI = new RegExp(TE_LANG_RE.source, "i");
const TE_NAMESPACES = ["extension", "server", "shared"];
const TE_NS_RE = new RegExp(`^(${TE_NAMESPACES.join("|")})$`);
const TE_RESERVED_SUBMISSION_DIRS = new Set(["archive", "results", "review", "en"]);
const TE_SHA1_RE = /^[a-f0-9]{40}$/i;
const TE_MAX_ENTRIES = 5000;
const TE_MAX_VALUE = 20000;
const TE_MAX_BYTES = 512 * 1024;
// Match the processor's LANG_RE, including multiple region segments.
const TE_SUBMISSION_PATH_RE = /^submissions\/[a-z]{2,3}(?:-[a-z0-9]+)*\/[A-Za-z0-9][A-Za-z0-9_-]{7,63}\.json$/;

// Hard blockers shared with qa.js: executable URLs and invisible bidi/zero-width characters.
// Generic HTML markup remains a QA warning.
const TE_JAVASCRIPT_URL_RE = /javascript\s*:/i;
const TE_BIDI_ZERO_WIDTH_RE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/u;

function teDomainForVersion(version) {
  const domain = TE_DOMAIN_BY_VERSION[version];
  if (!domain) throw new Error(`Unsupported hash version: ${version}`);
  return domain;
}

function teIsSupportedHashVersion(version) {
  return version === undefined || version === null || version === TE_HASH_VERSION;
}

function teNormalizeLang(lang) {
  return typeof lang === "string" ? lang.toLowerCase() : "";
}

function teValueIsUnsafe(value) {
  // Generic HTML markup is only a QA warning; these three are hard blockers.
  return typeof value === "string" && (TE_JAVASCRIPT_URL_RE.test(value) || TE_BIDI_ZERO_WIDTH_RE.test(value));
}

function teBytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Verify the Git blob SHA-1 used by manifest.json.
// Also inlined into the background worker, which cannot import hash.js.
async function teGitBlobShaForText(text) {
  const bytes = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const combined = new Uint8Array(header.length + bytes.length);
  combined.set(header);
  combined.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", combined);
  return teBytesToHex(new Uint8Array(digest));
}

// A key is translated only when metadata contains an accepted source hash.
// Seeded English values are not translations.
function teAcceptedKeyCount(source, metaKeys) {
  const keys = metaKeys || {};
  return Object.keys(source || {}).filter((key) => Object.prototype.hasOwnProperty.call(keys, key)).length;
}

function teCappedPercent(done, total) {
  if (!total) return 0;
  // Rounding 99.8% up must not hide the remaining work.
  return Math.min(done === total ? 100 : 99, Math.round((done / total) * 100));
}

function teProgressFromMeta(source, metaKeys) {
  const total = Object.keys(source || {}).length;
  if (!total) return 0;
  return teCappedPercent(teAcceptedKeyCount(source, metaKeys), total);
}

// Manifest validation shared with the background loader.
// Server implementation: server/services/localeSnapshot.js (CommonJS).
function teManifestIsValidForBase(manifest, rawBase) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  if (typeof manifest.schemaVersion !== "number" || typeof manifest.validatorVersion !== "number") return false;
  if (!TE_SHA1_RE.test(manifest.snapshot || "")) return false;
  if (!manifest.source || !TE_SHA1_RE.test(manifest.source.commit || "")) return false;
  if (!manifest.languages || typeof manifest.languages !== "object" || Array.isArray(manifest.languages)) return false;
  if (!teIsSupportedHashVersion(manifest.hashVersion)) return false;
  for (const [lang, entry] of Object.entries(manifest.languages)) {
    if (!TE_LANG_RE_CI.test(lang) || !entry?.files) return false;
    for (const [ns, file] of Object.entries(entry.files)) {
      if (!TE_NS_RE.test(ns)) return false;
      if (!file || !TE_SHA1_RE.test(file.sha || "")) return false;
      const prefix = `${rawBase}/${manifest.snapshot}/locales/`;
      if (typeof file.url !== "string" || !file.url.startsWith(prefix)) return false;
      if (!new RegExp(`^[^/]+/${ns}\\.json$`).test(file.url.slice(prefix.length))) return false;
    }
  }
  return true;
}
