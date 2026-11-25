// Raw URLs are always built from an immutable commit SHA, never a branch.
const TE_LOCALES_RAW_ROOT = `https://raw.githubusercontent.com/${TE_REPO.owner}/${TE_REPO.name}`;
const TE_SOURCE_OWNER = "KanashiiDev";
const TE_SOURCE_REPO = "web-presence";
const TE_SOURCE_BRANCH = "main";

// Last known good payloads. Network/rate-limit failures must never silently
// fall back to a mutable branch URL; they reuse these instead.
let teLastGoodManifest = null;
const teLastGoodSource = new Map();
const TE_API_MIN_INTERVAL_MS = 60000;

// Immutable (sha, path) content cache. A SHA-pinned raw URL never changes, so
// these entries are safe to keep across page reloads. Bounded by LRU count.
const TE_CONTENT_CACHE_KEY = "translationImmutableContentCache";
const TE_CONTENT_CACHE_VERSION = 1;
const TE_CONTENT_CACHE_LIMIT = 80;
let teContentCache = null;

// Called after a verified processor result: drop derived caches so the next
// read goes through the immutable-ref path. The last verified manifest is kept
// as the safe fallback if the API rate-limits or is offline.
async function teInvalidateLocaleSnapshot({ notifyBackground = true } = {}) {
  // Keep immutable content entries: they are keyed by SHA and remain valid.
  try {
    await browser.storage.local.remove(TE_LOCALE_CACHE_KEY);
  } catch (_err) {
    /* storage failures must not block editing */
  }
  if (notifyBackground && typeof browser !== "undefined" && browser.runtime?.sendMessage) {
    try {
      await browser.runtime.sendMessage({ type: "REFRESH_LOCALES" });
    } catch (_err) {
      /* background may not be listening; next alarm refreshes */
    }
  }
}

async function teEditorGithubToken() {
  try {
    if (typeof teGetGithubTokenCached === "function") return await teGetGithubTokenCached();
    if (typeof githubContributeService !== "undefined" && githubContributeService?.getToken) {
      return await githubContributeService.getToken();
    }
  } catch (_err) {
    /* unauthenticated mode is supported */
  }
  return null;
}

async function teResolveLocalesHead(force = false) {
  const token = await teEditorGithubToken();
  return fetchGitHubHead({
    owner: TE_REPO.owner,
    repo: TE_REPO.name,
    branch: TE_REPO.branch,
    token,
    // Authenticated requests still have a ~60s edge cache; keep polling gentle.
    minIntervalMs: token ? 30000 : TE_API_MIN_INTERVAL_MS,
    force,
  });
}

async function teResolveSourceHead(force = false) {
  const token = await teEditorGithubToken();
  return fetchGitHubHead({
    owner: TE_SOURCE_OWNER,
    repo: TE_SOURCE_REPO,
    branch: TE_SOURCE_BRANCH,
    token,
    minIntervalMs: token ? 30000 : TE_API_MIN_INTERVAL_MS,
    force,
  });
}

async function teReadContentCache() {
  if (teContentCache) return teContentCache;
  const empty = { schemaVersion: TE_CONTENT_CACHE_VERSION, entries: Object.create(null) };
  try {
    const stored = await browser.storage.local.get(TE_CONTENT_CACHE_KEY);
    const value = stored?.[TE_CONTENT_CACHE_KEY];
    teContentCache = value?.schemaVersion === TE_CONTENT_CACHE_VERSION && value.entries && typeof value.entries === "object" ? value : empty;
  } catch (_err) {
    teContentCache = empty;
  }
  return teContentCache;
}

async function tePersistContentCache() {
  const entries = Object.entries(teContentCache.entries)
    .sort((a, b) => (b[1]?.storedAt || 0) - (a[1]?.storedAt || 0))
    .slice(0, TE_CONTENT_CACHE_LIMIT);
  teContentCache.entries = Object.fromEntries(entries);
  try {
    await browser.storage.local.set({ [TE_CONTENT_CACHE_KEY]: teContentCache });
  } catch (_err) {
    /* cache is best effort */
  }
}

function teFindCachedContent(path) {
  const suffix = `:${path}`;
  const match = Object.entries(teContentCache.entries)
    .filter(([key, value]) => key.endsWith(suffix) && typeof value?.text === "string")
    .sort((a, b) => (b[1]?.storedAt || 0) - (a[1]?.storedAt || 0))[0];
  return match ? { text: match[1].text, blobSha: match[1].sha, fromCache: true } : null;
}

// Read content from an immutable SHA-pinned raw URL. The URL itself is the
// integrity guarantee; when the caller supplies an expected blob SHA (from the
// manifest) we additionally verify the bytes. API calls are used only to
// resolve the head SHA, never to read file contents.
async function teFetchRawAtRef({ owner, repo, sha, path, expectedSha = null, allowStale = false, root = null }) {
  const cache = await teReadContentCache();
  const key = `${repo}@${sha}:${path}`;
  const entry = cache.entries[key];
  if (entry && typeof entry.text === "string") {
    return { text: entry.text, blobSha: entry.sha, fromCache: true };
  }
  const base = root || `https://raw.githubusercontent.com/${owner}/${repo}`;
  const url = `${base}/${sha}/${path}`;
  let response;
  try {
    response = await fetchWithTimeout(url, { cache: "no-store" }, 12000);
  } catch (err) {
    if (allowStale) {
      const stale = teFindCachedContent(path);
      if (stale) return stale;
    }
    throw err;
  }
  if (!response.ok) {
    if (allowStale) {
      const stale = teFindCachedContent(path);
      if (stale) return stale;
    }
    const err = new Error(`Raw fetch ${path}: HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const text = await response.text();
  const actual = await teGitBlobShaForText(text);
  if (expectedSha && actual.toLowerCase() !== String(expectedSha).toLowerCase()) {
    throw new Error(`Blob SHA mismatch for ${path}`);
  }
  cache.entries[key] = { text, sha: actual, storedAt: Date.now() };
  await tePersistContentCache();
  return { text, blobSha: actual, fromCache: false };
}

async function teFetchGithubText(path) {
  const head = await teResolveLocalesHead();
  if (!head.ok || !head.sha) {
    throw new Error(`Cannot resolve ${TE_REPO.name} head for ${path}: ${head.error || "no SHA"}`);
  }
  try {
    const result = await teFetchRawAtRef({
      owner: TE_REPO.owner,
      repo: TE_REPO.name,
      sha: head.sha,
      path,
      allowStale: true,
    });
    return result.text;
  } catch (err) {
    const error = new Error(i18n.t("translationEditor.error.fetchFailed", { path, status: err.status || err.message }));
    error.status = err.status;
    throw error;
  }
}

async function teFetchGithubJson(path) {
  const text = await teFetchGithubText(path);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(i18n.t("translationEditor.error.invalidJson", { path, error: err.message }));
  }
}

async function teFetchGithubFile(lang, namespace) {
  const text = await teFetchGithubText(`locales/${teNormalizeLang(lang)}/${namespace}.json`);
  try {
    return { text, json: JSON.parse(text) };
  } catch (err) {
    throw new Error(i18n.t("translationEditor.error.invalidJson", { path: `locales/${lang}/${namespace}.json`, error: err.message }));
  }
}

// Authoritative English strings come from the main repository, never from the
// derived and possibly stale mirror inside web-presence-locales.
async function teFetchMainSource(namespace, manifest = null) {
  const path = `locales/en/${namespace}.json`;
  const head = await teResolveSourceHead();
  if (head.ok && head.sha) {
    try {
      const result = await teFetchRawAtRef({
        owner: TE_SOURCE_OWNER,
        repo: TE_SOURCE_REPO,
        sha: head.sha,
        path,
        // The upstream blob SHA is recorded in the runtime manifest/source meta.
        expectedSha: manifest?.source?.blobs?.[namespace] || null,
        allowStale: false,
      });
      const source = { text: result.text, json: JSON.parse(result.text), blobSha: result.blobSha };
      teLastGoodSource.set(namespace, source);
      return source;
    } catch (err) {
      // SHA verification or network failure: reuse the last verified source only.
      const previous = teLastGoodSource.get(namespace);
      if (previous) return previous;
      const error = new Error(i18n.t("translationEditor.error.fetchFailed", { path, status: err.status || err.message }));
      error.status = err.status;
      throw error;
    }
  }
  const previous = teLastGoodSource.get(namespace);
  if (previous) return previous;
  throw new Error(i18n.t("translationEditor.error.fetchFailed", { path, status: "head unavailable" }));
}

function teManifestIsValid(manifest) {
  return teManifestIsValidForBase(manifest, TE_LOCALES_RAW_ROOT);
}

async function teFetchManifest() {
  const head = await teResolveLocalesHead();
  if (head.ok && head.sha) {
    try {
      const result = await teFetchRawAtRef({
        owner: TE_REPO.owner,
        repo: TE_REPO.name,
        sha: head.sha,
        path: "runtime/manifest.json",
        allowStale: true,
      });
      const manifest = JSON.parse(result.text);
      if (!teManifestIsValid(manifest)) throw new Error(i18n.t("translationEditor.error.invalidManifest"));
      teLastGoodManifest = manifest;
      return manifest;
    } catch (err) {
      // Never downgrade to a mutable branch URL. Keep the last valid manifest.
      if (typeof logWarn === "function") logWarn("[TranslationEditor]: manifest refresh failed:", err.message);
    }
  }
  if (teLastGoodManifest) return teLastGoodManifest;
  throw new Error("Runtime manifest unavailable and no verified snapshot is known");
}

async function teFetchMetaAtSnapshot(manifest, lang) {
  const normalized = teNormalizeLang(lang);
  const path = `locales/${normalized}/.meta.json`;
  try {
    const result = await teFetchRawAtRef({
      owner: TE_REPO.owner,
      repo: TE_REPO.name,
      sha: manifest.snapshot,
      path,
      allowStale: true,
    });
    const meta = JSON.parse(result.text);
    if (meta && !teIsSupportedHashVersion(meta.hashVersion)) {
      throw new Error(i18n.t("translationEditor.error.unsupportedHashVersion", { version: String(meta.hashVersion) }));
    }
    return { ...meta, fromFallback: false };
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  // A newly processed language can exist on main before the manifest snapshot
  // advances. Fall back to the immutable head SHA, never to a branch URL.
  const head = await teResolveLocalesHead();
  if (!head.ok || !head.sha) return null;
  try {
    const verified = await teFetchRawAtRef({
      owner: TE_REPO.owner,
      repo: TE_REPO.name,
      sha: head.sha,
      path,
      allowStale: true,
    });
    const fallbackMeta = JSON.parse(verified.text);
    if (!teIsSupportedHashVersion(fallbackMeta?.hashVersion)) return null;
    return { ...fallbackMeta, fromFallback: true };
  } catch (_err) {
    return null;
  }
}

// Key renames are recorded in the English mirror metadata by sync-source.js.
async function teFetchSourceMetaAtSnapshot(manifest) {
  const path = "locales/en/.source.json";
  try {
    const result = await teFetchRawAtRef({
      owner: TE_REPO.owner,
      repo: TE_REPO.name,
      sha: manifest.snapshot,
      path,
      allowStale: true,
    });
    return JSON.parse(result.text);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const head = await teResolveLocalesHead();
  if (!head.ok || !head.sha) return null;
  try {
    const verified = await teFetchRawAtRef({
      owner: TE_REPO.owner,
      repo: TE_REPO.name,
      sha: head.sha,
      path,
      allowStale: true,
    });
    return JSON.parse(verified.text);
  } catch (_err) {
    return null;
  }
}

async function teFetchSnapshotTarget(manifest, lang, namespace, allowMissing) {
  const normalizedLang = teNormalizeLang(lang);
  const declared = manifest.languages?.[normalizedLang]?.files?.[namespace];
  const prefix = `${TE_LOCALES_RAW_ROOT}/${manifest.snapshot}/locales/`;
  if (declared) {
    const expectedUrl = `${prefix}${normalizedLang}/${namespace}.json`;
    // Never follow an arbitrary URL from the manifest.
    if (declared.url !== expectedUrl) throw new Error(i18n.t("translationEditor.error.invalidManifest"));
  }
  const path = `locales/${normalizedLang}/${namespace}.json`;
  let fromFallback = false;
  let text = null;
  let blobSha = null;
  try {
    const result = await teFetchRawAtRef({
      owner: TE_REPO.owner,
      repo: TE_REPO.name,
      sha: manifest.snapshot,
      path,
      expectedSha: declared?.sha || null,
      allowStale: false,
    });
    text = result.text;
    blobSha = result.blobSha;
  } catch (err) {
    if (err.status !== 404) throw err;
    if (allowMissing) return { text: null, json: {}, fromFallback: false };
    // The locale file may already be on main while the manifest snapshot still
    // points at an older commit. Read it from the immutable head SHA.
    const head = await teResolveLocalesHead();
    if (!head.ok || !head.sha) throw new Error(`Translation ${lang}/${namespace}: head unavailable`);
    try {
      const verified = await teFetchRawAtRef({
        owner: TE_REPO.owner,
        repo: TE_REPO.name,
        sha: head.sha,
        path,
        expectedSha: declared?.sha || null,
        allowStale: false,
      });
      text = verified.text;
      blobSha = verified.blobSha;
      fromFallback = true;
    } catch (fallbackErr) {
      throw new Error(`Translation ${lang}/${namespace}: ${fallbackErr.message}`);
    }
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(i18n.t("translationEditor.error.invalidJson", { path: `locales/${lang}/${namespace}.json`, error: err.message }));
  }
  return { text, json, blobSha, fromFallback };
}

const TE_LOCALE_CACHE_KEY = "translationLocaleCache";

async function teReadLocaleCache() {
  try {
    const stored = await browser.storage.local.get(TE_LOCALE_CACHE_KEY);
    const cache = stored[TE_LOCALE_CACHE_KEY] || null;
    return cache?.schemaVersion === 2 ? cache : null;
  } catch (_err) {
    return null;
  }
}

function teRegisteredLanguages(metadata) {
  const langs = [
    ...Object.keys(metadata).filter((lang) => lang !== "en"),
    ...PARSER_LOCALE_LANGS.filter((lang) => !Object.prototype.hasOwnProperty.call(metadata, lang)),
  ];
  return [...new Set(langs.map(teNormalizeLang))];
}

function teLanguageNamespaces(lang, metadata) {
  return metadata[lang] ? TE_NAMESPACES.filter((ns) => ns === "shared" || metadata[lang][ns]) : [...TE_NAMESPACES];
}

// Count the words in English source strings that still need a translation.
// Uses the same accepted-key metadata as progress, so both figures agree.
function teWordsToTranslate(sourceFlat, metaKeys) {
  const keys = metaKeys || {};
  return Object.entries(sourceFlat || {}).reduce((total, [key, value]) => {
    if (typeof value !== "string" || Object.prototype.hasOwnProperty.call(keys, key)) return total;
    return total + value.trim().split(/\s+/).filter(Boolean).length;
  }, 0);
}

// Progress must use the authoritative English source, not the derived mirror
// stored in the runtime cache. Otherwise newly added keys are invisible to the
// dropdown while the editor already counts them.
async function teFetchAllSources(manifest = null) {
  const entries = await Promise.all(
    TE_NAMESPACES.map(async (namespace) => {
      try {
        return [namespace, teFlattenTranslations((await teFetchMainSource(namespace, manifest)).json)];
      } catch (_err) {
        // A namespace that cannot be fetched keeps zero stats; others still load.
        return [namespace, null];
      }
    }),
  );
  return Object.fromEntries(entries);
}

function teProgressStats(source, keys) {
  return { progress: teProgressFromMeta(source, keys), wordsRemaining: teWordsToTranslate(source, keys) };
}

// Only a non-empty draft whose source hash still matches counts as translated.
// A stale draft would be rejected on submission, so it must not claim progress.
async function teDraftAcceptedKeys(source, entries) {
  const accepted = new Set();
  if (!source || !entries) return accepted;
  await Promise.all(
    Object.entries(entries).map(async ([key, entry]) => {
      if (!(key in source) || typeof entry?.target !== "string" || !entry.target.trim()) return;
      try {
        if (entry.sourceHash === (await teHashSource(source[key], key))) accepted.add(key);
      } catch (_err) {
        // An unreadable hash cannot be trusted; leave the key untranslated.
      }
    }),
  );
  return accepted;
}

async function teLanguageStats(entry, sources, publishedKeys, drafts) {
  const files = {};
  for (const namespace of TE_NAMESPACES) {
    const source = sources?.[namespace];
    const published = publishedKeys?.[namespace] || {};
    const draftKeys = await teDraftAcceptedKeys(source, drafts?.[`${entry.lang}/${namespace}.json`]?.entries);
    const localKeys = { ...published };
    draftKeys.forEach((key) => {
      localKeys[key] = true;
    });
    const local = teProgressStats(source, localKeys);
    const publishedStats = teProgressStats(source, published);
    files[namespace] = {
      ...local,
      publishedProgress: publishedStats.progress,
      publishedWordsRemaining: publishedStats.wordsRemaining,
    };
  }
  const extension = files.extension || { progress: 0, wordsRemaining: 0, publishedProgress: 0, publishedWordsRemaining: 0 };
  return {
    progress: extension.progress,
    wordsRemaining: extension.wordsRemaining,
    publishedProgress: extension.publishedProgress,
    publishedWordsRemaining: extension.publishedWordsRemaining,
    files,
    sources,
    publishedKeys,
  };
}

async function teLanguageProgressValues(langs, metadata, sources, manifest, drafts) {
  const entries = await Promise.all(
    langs.map(async (lang) => {
      const publishedKeys = {};
      let meta = null;
      if (metadata[lang]?.published !== false) {
        try {
          meta = await teFetchMetaAtSnapshot(manifest, lang);
        } catch (_err) {
          // Missing/unreadable metadata means 0%; other languages still load.
        }
      }
      TE_NAMESPACES.forEach((namespace) => {
        publishedKeys[namespace] = metadata[lang]?.published === false ? {} : meta?.namespaces?.[namespace]?.keys || {};
      });
      return [lang, await teLanguageStats({ lang }, sources, publishedKeys, drafts)];
    }),
  );
  return Object.fromEntries(entries);
}

// Re-read local drafts without another network round trip when Home is shown.
async function teRefreshLanguageDraftStats(languages) {
  const drafts = await teLoadAllDrafts();
  await Promise.all(
    languages.map(async (entry) => {
      Object.assign(entry, await teLanguageStats(entry, entry.sources, entry.publishedKeys, drafts));
    }),
  );
}

function teLanguageStatsFields(stats) {
  return {
    progress: stats?.progress ?? 0,
    wordsRemaining: stats?.wordsRemaining ?? 0,
    publishedProgress: stats?.publishedProgress ?? 0,
    publishedWordsRemaining: stats?.publishedWordsRemaining ?? 0,
    files: stats?.files || {},
    sources: stats?.sources || {},
    publishedKeys: stats?.publishedKeys || {},
  };
}

async function teLoadGithubLanguages() {
  const cache = await teReadLocaleCache();
  if (cache?.metadata?.content && cache.langs && Object.keys(cache.langs).length) {
    const metadata = cache.metadata.content;
    const langs = teRegisteredLanguages(metadata);
    const sources = await teFetchAllSources(cache.manifest?.content || null);
    if (sources.extension && cache.manifest?.content) {
      const drafts = await teLoadAllDrafts();
      const statsByLang = await teLanguageProgressValues(langs, metadata, sources, cache.manifest.content, drafts);
      return langs.map((lang) => {
        const registered = Object.prototype.hasOwnProperty.call(metadata, lang);
        // Only an explicit `published:false` in languages.json is a blocker.
        // "Not registered yet" must NOT block: it is the only way a new language
        // can ever reach the 90% publication threshold.
        const override = metadata[lang]?.published === false;
        return {
          lang,
          label: parserLangLabel(lang, parserDisplayLocales()),
          namespaces: teLanguageNamespaces(lang, metadata),
          pending: !registered,
          published: !override,
          ...teLanguageStatsFields(statsByLang[lang]),
        };
      });
    }
  }
  return teLoadGithubLanguagesLive();
}

async function teLoadGithubLanguagesLive() {
  const [metadata, manifest, drafts] = await Promise.all([teFetchGithubJson("locales/languages.json"), teFetchManifest(), teLoadAllDrafts()]);
  const sources = await teFetchAllSources(manifest);
  const langs = teRegisteredLanguages(metadata);
  const statsByLang = await teLanguageProgressValues(langs, metadata, sources, manifest, drafts);

  return langs.map((lang) => {
    const registered = Object.prototype.hasOwnProperty.call(metadata, lang);
    const override = metadata[lang]?.published === false;
    return {
      lang,
      label: parserLangLabel(lang, parserDisplayLocales()),
      namespaces: teLanguageNamespaces(lang, metadata),
      pending: !registered,
      published: !override,
      ...teLanguageStatsFields(statsByLang[lang]),
    };
  });
}

// The locales repo records only value-identical (safe) renames, scoped by
// namespace. Older snapshots may still carry a flat legacy map.
function teNamespaceRenames(container, namespace) {
  if (!container || typeof container !== "object") return null;
  const safe = container.safeRenames;
  if (safe && typeof safe === "object") {
    const scoped = safe[namespace];
    return scoped && typeof scoped === "object" ? scoped : null;
  }
  const legacy = container.renames;
  if (!legacy || typeof legacy !== "object") return null;
  const scoped = legacy[namespace];
  if (scoped && typeof scoped === "object") return scoped;
  return TE_NAMESPACES.some((ns) => ns in legacy) ? null : legacy;
}

async function teLoadGithubRows(lang, namespace, allowMissingTarget = false) {
  const manifest = await teFetchManifest();
  const normalizedLang = teNormalizeLang(lang);
  const [source, target, meta, sourceMeta] = await Promise.all([
    teFetchMainSource(namespace, manifest),
    teFetchSnapshotTarget(manifest, normalizedLang, namespace, allowMissingTarget),
    teFetchMetaAtSnapshot(manifest, normalizedLang),
    teFetchSourceMetaAtSnapshot(manifest),
  ]);
  const rows = await teBuildRows(source.json, target.json);
  return {
    rows,
    source: source.json,
    target: target.json,
    targetText: target.text,
    meta,
    renames: teNamespaceRenames(sourceMeta, namespace) || teNamespaceRenames(meta, namespace) || {},
    manifest,
    enBlobSha: source.blobSha || null,
    targetBlobSha: target.blobSha || null,
    targetFromFallback: target.fromFallback === true || meta?.fromFallback === true,
  };
}
