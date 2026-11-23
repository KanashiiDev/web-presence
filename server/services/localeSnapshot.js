// Hourly snapshot-pinned locale cache for the dashboard.
// Mirrors the extension background loader: manifest first, then every file from
// one immutable commit SHA. A failed file keeps the previous snapshot intact.

const crypto = require("node:crypto");

const RAW_BASE = "https://raw.githubusercontent.com/KanashiiDev/web-presence-locales";
const MANIFEST_URL = `${RAW_BASE}/main/runtime/manifest.json`;
const NAMESPACES = ["extension", "server", "shared"];
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;
const SHA_RE = /^[a-f0-9]{40}$/i;
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/i;
const HASH_VERSION = 1;

function gitBlobSha(text) {
  const bytes = Buffer.from(text, "utf8");
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

let state = { manifest: null, metadata: null, snapshot: null, langs: Object.create(null), manifestEtag: null, fetchedAt: 0 };
let refreshTimer = null;
let inFlight = null;

function payloadIsValid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const values = Object.values(data);
  return values.length > 0 && values.every((value) => typeof value === "string");
}

function metadataIsValid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return Object.values(data).every((value) => value && typeof value === "object" && !Array.isArray(value) && typeof value.label === "string");
}

function fileUrlIsValid(url, snapshot) {
  if (typeof url !== "string") return false;
  const prefix = `${RAW_BASE}/${snapshot}/locales/`;
  if (!url.startsWith(prefix)) return false;
  const match = /^([^/]+)\/([^/]+)\.json$/.exec(url.slice(prefix.length));
  return !!match && LANG_RE.test(match[1]) && NAMESPACES.includes(match[2]);
}

function manifestIsValid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (typeof data.schemaVersion !== "number" || typeof data.validatorVersion !== "number") return false;
  if (data.hashVersion !== undefined && data.hashVersion !== HASH_VERSION) return false;
  if (!SHA_RE.test(data.snapshot || "")) return false;
  if (!data.source || !SHA_RE.test(data.source.commit || "")) return false;
  if (!data.languages || typeof data.languages !== "object" || Array.isArray(data.languages)) return false;
  for (const [lang, entry] of Object.entries(data.languages)) {
    if (!LANG_RE.test(lang) || !entry?.files) return false;
    // The producer omits namespaces disabled for a language. Validate every
    // declared entry instead of requiring all three (same rule as the editor).
    for (const [ns, file] of Object.entries(entry.files)) {
      if (!NAMESPACES.includes(ns) || !file || !SHA_RE.test(file.sha || "") || !fileUrlIsValid(file.url, data.snapshot)) return false;
    }
  }
  return true;
}

async function fetchJson(url, etag) {
  const response = await fetch(url, {
    headers: etag ? { "If-None-Match": etag } : {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 304) return { unchanged: true };
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  const data = JSON.parse(text);
  return { data, text, etag: response.headers.get("ETag") || null };
}

async function mapWithLimit(items, limit, mapper) {
  const result = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let manifestResult;
    try {
      manifestResult = await fetchJson(MANIFEST_URL, state.manifestEtag);
    } catch (err) {
      console.warn(`[LocaleSnapshot]: manifest fetch failed: ${err.message}`);
      return false;
    }
    if (manifestResult.unchanged && state.manifest) {
      state.fetchedAt = Date.now();
      return true;
    }
    if (!manifestIsValid(manifestResult.data)) {
      console.warn("[LocaleSnapshot]: invalid runtime manifest");
      return false;
    }

    const manifest = manifestResult.data;
    if (state.snapshot === manifest.snapshot) {
      state.manifest = manifest;
      state.manifestEtag = manifestResult.etag || state.manifestEtag;
      state.fetchedAt = Date.now();
      return true;
    }

    const base = `${RAW_BASE}/${manifest.snapshot}/locales`;
    const langs = new Set(["en", ...Object.keys(manifest.languages)]);
    const tasks = [];
    langs.forEach((lang) => {
      const files = manifest.languages[lang]?.files || {};
      NAMESPACES.forEach((ns) => {
        tasks.push({ lang, ns, file: files[ns], url: files[ns]?.url || `${base}/${lang}/${ns}.json` });
      });
    });

    const loaded = await mapWithLimit(tasks, 6, async (task) => {
      try {
        const result = await fetchJson(task.url, null);
        if (!payloadIsValid(result.data)) throw new Error("Invalid locale payload");
        // The manifest `sha` is the git blob SHA of the exact bytes served.
        if (task.file?.sha && gitBlobSha(result.text).toLowerCase() !== String(task.file.sha).toLowerCase()) {
          throw new Error(`sha mismatch for ${task.lang}/${task.ns}`);
        }
        return { ...task, content: result.data, sha: task.file?.sha || null };
      } catch (err) {
        if (err.status !== 404 || task.file) console.warn(`[LocaleSnapshot]: ${task.lang}/${task.ns} failed: ${err.message}`);
        return null;
      }
    });

    const failed = loaded.filter((entry) => entry === null).length;
    if (state.snapshot && failed === tasks.length) {
      console.warn("[LocaleSnapshot]: every file failed, keeping previous snapshot");
      return false;
    }

    const nextLangs = Object.create(null);
    langs.forEach((lang) => {
      nextLangs[lang] = Object.create(null);
    });
    loaded.forEach((entry) => {
      if (entry) nextLangs[entry.lang][entry.ns] = { content: entry.content, sha: entry.sha };
    });

    let metadata = state.metadata;
    try {
      const result = await fetchJson(`${base}/languages.json`, null);
      if (metadataIsValid(result.data)) metadata = result.data;
    } catch (err) {
      console.warn(`[LocaleSnapshot]: languages.json fetch failed: ${err.message}`);
    }

    state = {
      manifest,
      manifestEtag: manifestResult.etag,
      metadata,
      snapshot: manifest.snapshot,
      langs: nextLangs,
      fetchedAt: Date.now(),
    };
    console.log(`[LocaleSnapshot]: loaded snapshot ${manifest.snapshot.slice(0, 8)} with ${failed} file(s) failed`);
    return true;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function getLocale(lang, namespace) {
  if (!LANG_RE.test(lang || "") || !NAMESPACES.includes(namespace)) return null;
  return state.langs[lang]?.[namespace]?.content || null;
}

function getMetadata() {
  return state.metadata;
}

function getStatus() {
  return { snapshot: state.snapshot, fetchedAt: state.fetchedAt, languages: Object.keys(state.langs) };
}

function start() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    refresh();
  }, CHECK_INTERVAL_MS);
  refreshTimer.unref?.();
  refresh();
}

function stop() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

module.exports = { start, stop, refresh, getLocale, getMetadata, getStatus };
