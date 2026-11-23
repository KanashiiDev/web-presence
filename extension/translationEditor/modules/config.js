// Single source of truth for the translation repository. Loaded first by the
// inliner (modules are concatenated alphabetically), so no other module may
// use these values in a top-level initializer that runs earlier.
const TE_REPO = { owner: "KanashiiDev", name: "web-presence-locales", branch: "main" };
const TE_REPO_RAW_BASE = `https://raw.githubusercontent.com/${TE_REPO.owner}/${TE_REPO.name}/${TE_REPO.branch}`;

// Hash algorithm versioning. Keep in sync with web-presence-locales/tools/lib/{constants,hash}.js.
// A DOMAIN change requires a new entry here AND a hashVersion migration on the
// locales side; bumping the freshness cache version alone is not enough.
const TE_HASH_VERSION = 1;
const TE_DOMAIN_BY_VERSION = Object.freeze({ 1: "web-presence-locales/v1" });

// Submission / locale code validation mirrors tools/lib/submission.js.
const TE_LANG_RE = /^[a-z]{2,3}(?:-[a-z0-9]+)*$/;
const TE_NS_RE = /^(extension|server|shared)$/;
const TE_RESERVED_SUBMISSION_DIRS = new Set(["archive", "results", "review", "en"]);
// Match the locales processor's LANG_RE (multiple -<region> segments), not a
// single optional segment, so a valid language is not rejected by the editor.
const TE_SUBMISSION_PATH_RE = /^submissions\/[a-z]{2,3}(?:-[a-z0-9]+)*\/[A-Za-z0-9][A-Za-z0-9_-]{7,63}\.json$/;

// Hard blockers shared with the canonical qa.js: executable URLs and invisible
// bidi/zero-width characters. Generic HTML markup is only a QA warning.
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

// SHA-1 of the Git blob representation of a string. Used to verify downloaded
// files against the `sha` recorded in runtime/manifest.json. Also inlined into
// the background worker, which cannot import the editor's hash.js module.
async function teGitBlobShaForText(text) {
  const bytes = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const combined = new Uint8Array(header.length + bytes.length);
  combined.set(header);
  combined.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", combined);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// A key only counts as translated when metadata records an accepted source
// hash for it. A seeded English copy is a baseline, not a translation.
function teAcceptedKeyCount(source, metaKeys) {
  const keys = metaKeys || {};
  return Object.keys(source || {}).filter((key) => Object.prototype.hasOwnProperty.call(keys, key)).length;
}

function teProgressFromMeta(source, metaKeys) {
  const total = Object.keys(source || {}).length;
  return total ? Math.round((teAcceptedKeyCount(source, metaKeys) / total) * 100) : 0;
}

// Manifest validation shared by the editor and the background loader. The
// server copy lives in server/services/localeSnapshot.js (CommonJS).
function teManifestIsValidForBase(manifest, rawBase) {
  const shaRe = /^[a-f0-9]{40}$/i;
  const langRe = /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  if (typeof manifest.schemaVersion !== "number" || typeof manifest.validatorVersion !== "number") return false;
  if (!shaRe.test(manifest.snapshot || "")) return false;
  if (!manifest.source || !shaRe.test(manifest.source.commit || "")) return false;
  if (!manifest.languages || typeof manifest.languages !== "object" || Array.isArray(manifest.languages)) return false;
  if (!teIsSupportedHashVersion(manifest.hashVersion)) return false;
  for (const [lang, entry] of Object.entries(manifest.languages)) {
    if (!langRe.test(lang) || !entry?.files) return false;
    for (const [ns, file] of Object.entries(entry.files)) {
      if (!["extension", "server", "shared"].includes(ns)) return false;
      if (!file || !shaRe.test(file.sha || "")) return false;
      const prefix = `${rawBase}/${manifest.snapshot}/locales/`;
      if (typeof file.url !== "string" || !file.url.startsWith(prefix)) return false;
      if (!new RegExp(`^[^/]+/${ns}\\.json$`).test(file.url.slice(prefix.length))) return false;
    }
  }
  return true;
}
