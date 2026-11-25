const TE_GITHUB_RAW_BASE = TE_REPO_RAW_BASE;
// TE_REPO_RAW_BASE already ends with the branch. Snapshot-pinned URLs need the
// repository root without a branch segment.
const TE_LOCALES_RAW_ROOT = `https://raw.githubusercontent.com/${TE_REPO.owner}/${TE_REPO.name}`;
const TE_SOURCE_OWNER = "KanashiiDev";
const TE_SOURCE_REPO = "web-presence";
const TE_SOURCE_BRANCH = "main";
const TE_SOURCE_RAW_BASE = `https://raw.githubusercontent.com/${TE_SOURCE_OWNER}/${TE_SOURCE_REPO}`;

async function teFetchGithubText(path) {
  const response = await fetchWithTimeout(`${TE_GITHUB_RAW_BASE}/${path}`, {}, 10000);
  if (!response.ok) {
    const error = new Error(i18n.t("translationEditor.error.fetchFailed", { path, status: response.status }));
    error.status = response.status;
    throw error;
  }
  return response.text();
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
async function teFetchMainSource(namespace) {
  const path = `locales/en/${namespace}.json`;
  const url = `${TE_SOURCE_RAW_BASE}/${TE_SOURCE_BRANCH}/${path}?t=${Date.now()}`;
  const response = await fetchWithTimeout(url, {}, 12000);
  if (!response.ok) {
    const error = new Error(i18n.t("translationEditor.error.fetchFailed", { path, status: response.status }));
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  try {
    return { text, json: JSON.parse(text), blobSha: await teGitBlobShaForText(text) };
  } catch (err) {
    throw new Error(i18n.t("translationEditor.error.invalidJson", { path, error: err.message }));
  }
}

function teManifestIsValid(manifest) {
  return teManifestIsValidForBase(manifest, TE_LOCALES_RAW_ROOT);
}

async function teFetchManifest() {
  const url = `${TE_LOCALES_RAW_ROOT}/${TE_REPO.branch}/runtime/manifest.json?t=${Date.now()}`;
  const response = await fetchWithTimeout(url, {}, 12000);
  if (!response.ok) throw new Error(`Runtime manifest: HTTP ${response.status}`);
  const manifest = await response.json();
  if (!teManifestIsValid(manifest)) throw new Error(i18n.t("translationEditor.error.invalidManifest"));
  return manifest;
}

async function teFetchMetaAtSnapshot(manifest, lang) {
  const normalized = teNormalizeLang(lang);
  const url = `${TE_LOCALES_RAW_ROOT}/${manifest.snapshot}/locales/${normalized}/.meta.json`;
  let response = await fetchWithTimeout(url, {}, 12000);
  let fromFallback = false;
  // A newly processed language can exist on main before the manifest snapshot
  // advances. Fall back to the mutable branch instead of showing a failed load.
  if (response.status === 404) {
    response = await fetchWithTimeout(`${TE_GITHUB_RAW_BASE}/locales/${normalized}/.meta.json?t=${Date.now()}`, {}, 12000);
    fromFallback = true;
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Metadata for ${lang}: HTTP ${response.status}`);
  const meta = await response.json();
  if (meta && !teIsSupportedHashVersion(meta.hashVersion)) {
    throw new Error(i18n.t("translationEditor.error.unsupportedHashVersion", { version: String(meta.hashVersion) }));
  }
  return { ...meta, fromFallback };
}

// Key renames are recorded in the English mirror metadata by sync-source.js.
async function teFetchSourceMetaAtSnapshot(manifest) {
  const url = `${TE_LOCALES_RAW_ROOT}/${manifest.snapshot}/locales/en/.source.json`;
  const response = await fetchWithTimeout(url, {}, 12000);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Source metadata: HTTP ${response.status}`);
  return response.json();
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
  const url = declared?.url || `${prefix}${normalizedLang}/${namespace}.json`;
  let response = await fetchWithTimeout(url, {}, 12000);
  let fromFallback = false;
  if (response.status === 404) {
    if (allowMissing) return { text: null, json: {}, fromFallback: false };
    // The locale file may already be on main while the manifest snapshot still
    // points at an older commit. Use current main for display, but mark the
    // result so submission can wait until the snapshot catches up.
    response = await fetchWithTimeout(`${TE_GITHUB_RAW_BASE}/locales/${normalizedLang}/${namespace}.json?t=${Date.now()}`, {}, 12000);
    fromFallback = true;
  }
  if (!response.ok) throw new Error(`Translation ${lang}/${namespace}: HTTP ${response.status}`);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(i18n.t("translationEditor.error.invalidJson", { path: `locales/${lang}/${namespace}.json`, error: err.message }));
  }
  const blobSha = await teGitBlobShaForText(text);
  if (!fromFallback && declared?.sha && blobSha.toLowerCase() !== String(declared.sha).toLowerCase()) {
    throw new Error(i18n.t("translationEditor.error.shaMismatch", { path: `${lang}/${namespace}`, expected: declared.sha, actual: blobSha }));
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
async function teFetchAllSources() {
  const entries = await Promise.all(
    TE_NAMESPACES.map(async (namespace) => {
      try {
        return [namespace, teFlattenTranslations((await teFetchMainSource(namespace)).json)];
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
    const sources = await teFetchAllSources();
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
  const [metadata, manifest, sources, drafts] = await Promise.all([
    teFetchGithubJson("locales/languages.json"),
    teFetchManifest(),
    teFetchAllSources(),
    teLoadAllDrafts(),
  ]);
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
    teFetchMainSource(namespace),
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
