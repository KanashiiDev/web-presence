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
  const url = `${TE_LOCALES_RAW_ROOT}/${manifest.snapshot}/locales/${teNormalizeLang(lang)}/.meta.json`;
  const response = await fetchWithTimeout(url, {}, 12000);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Metadata for ${lang}: HTTP ${response.status}`);
  const meta = await response.json();
  if (meta && !teIsSupportedHashVersion(meta.hashVersion)) {
    throw new Error(i18n.t("translationEditor.error.unsupportedHashVersion", { version: String(meta.hashVersion) }));
  }
  return meta;
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
  const response = await fetchWithTimeout(url, {}, 12000);
  if (response.status === 404 && allowMissing) return { text: null, json: {} };
  if (!response.ok) throw new Error(`Translation ${lang}/${namespace}: HTTP ${response.status}`);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(i18n.t("translationEditor.error.invalidJson", { path: `locales/${lang}/${namespace}.json`, error: err.message }));
  }
  const blobSha = await teGitBlobShaForText(text);
  if (declared?.sha && blobSha.toLowerCase() !== String(declared.sha).toLowerCase()) {
    throw new Error(i18n.t("translationEditor.error.shaMismatch", { path: `${lang}/${namespace}`, expected: declared.sha, actual: blobSha }));
  }
  return { text, json, blobSha };
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
  const langs = [...Object.keys(metadata).filter((lang) => lang !== "en"), ...TE_SUPPORTED_LANGS.filter((lang) => !Object.prototype.hasOwnProperty.call(metadata, lang))];
  return [...new Set(langs.map(teNormalizeLang))];
}

function teLanguageNamespaces(lang, metadata) {
  return metadata[lang] ? TE_NAMESPACES.filter((ns) => ns === "shared" || metadata[lang][ns]) : [...TE_NAMESPACES];
}

// Progress must use the authoritative English source, not the derived mirror
// stored in the runtime cache. Otherwise newly added keys are invisible to the
// dropdown while the editor already counts them.
async function teLanguageProgressValues(langs, metadata, sourceFlat, manifest) {
  const entries = await Promise.all(
    langs.map(async (lang) => {
      if (metadata[lang]?.published === false) return [lang, 0];
      let meta = null;
      try {
        meta = await teFetchMetaAtSnapshot(manifest, lang);
      } catch (_err) {
        // Missing/unreadable metadata means 0%; other languages still load.
      }
      return [lang, teProgressFromMeta(sourceFlat, meta?.namespaces?.extension?.keys)];
    }),
  );
  return Object.fromEntries(entries);
}

async function teLoadGithubLanguages() {
  const cache = await teReadLocaleCache();
  if (cache?.metadata?.content && cache.langs && Object.keys(cache.langs).length) {
    const metadata = cache.metadata.content;
    const langs = teRegisteredLanguages(metadata);
    let sourceFlat = null;
    try {
      sourceFlat = teFlattenTranslations((await teFetchMainSource("extension")).json);
    } catch (_err) {
      // Offline: keep the cached values until the source is reachable again.
    }
    if (sourceFlat && cache.manifest?.content) {
      const progressByLang = await teLanguageProgressValues(langs, metadata, sourceFlat, cache.manifest.content);
      return langs.map((lang) => {
        const registered = Object.prototype.hasOwnProperty.call(metadata, lang);
        // Only an explicit `published:false` in languages.json is a blocker.
        // "Not registered yet" must NOT block: it is the only way a new language
        // can ever reach the 90% publication threshold.
        const override = metadata[lang]?.published === false;
        return {
          lang,
          label: metadata[lang]?.label || teLangLabel(lang),
          namespaces: teLanguageNamespaces(lang, metadata),
          pending: !registered,
          published: !override,
          progress: progressByLang[lang] ?? 0,
        };
      });
    }
  }
  return teLoadGithubLanguagesLive();
}

async function teLoadGithubLanguagesLive() {
  const [metadata, sourceRaw, manifest] = await Promise.all([teFetchGithubJson("locales/languages.json"), teFetchMainSource("extension"), teFetchManifest()]);
  const sourceFlat = teFlattenTranslations(sourceRaw.json);
  const langs = teRegisteredLanguages(metadata);
  const progressByLang = await teLanguageProgressValues(langs, metadata, sourceFlat, manifest);

  return langs.map((lang) => {
    const registered = Object.prototype.hasOwnProperty.call(metadata, lang);
    const override = metadata[lang]?.published === false;
    return {
      lang,
      label: metadata[lang]?.label || teLangLabel(lang),
      namespaces: teLanguageNamespaces(lang, metadata),
      pending: !registered,
      published: !override,
      progress: progressByLang[lang] ?? 0,
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
  };
}
