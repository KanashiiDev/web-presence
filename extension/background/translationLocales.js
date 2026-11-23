// Hourly refresh of snapshot-pinned GitHub locale files into browser.storage.local.
// i18n reads this cache first and falls back to the packaged locale files.

const TE_LOCALE_CACHE_KEY = "translationLocaleCache";
const TE_LOCALE_CACHE_VERSION = 2;
const TE_LOCALE_ALARM_NAME = "translationLocaleUpdateCheck";
const TE_LOCALE_CHECK_MINS = 60;
const TE_LOCALES_REPO = { owner: "KanashiiDev", name: "web-presence-locales", branch: "main" };
const TE_LOCALES_RAW_BASE = `https://raw.githubusercontent.com/${TE_LOCALES_REPO.owner}/${TE_LOCALES_REPO.name}`;
const TE_MANIFEST_URL = `${TE_LOCALES_RAW_BASE}/${TE_LOCALES_REPO.branch}/runtime/manifest.json`;
const TE_LOCALE_NAMESPACES = ["extension", "server", "shared"];

function teLocalePayloadIsValid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const values = Object.values(data);
  return values.length > 0 && values.every((value) => typeof value === "string");
}

function teLocaleMetadataIsValid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return Object.values(data).every((value) => value && typeof value === "object" && !Array.isArray(value) && typeof value.label === "string");
}

function teLocaleManifestIsValid(data) {
  return teManifestIsValidForBase(data, TE_LOCALES_RAW_BASE);
}

function teLocaleMetaIsValid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (!teIsSupportedHashVersion(data.hashVersion)) return false;
  return !!data.namespaces && typeof data.namespaces === "object" && !Array.isArray(data.namespaces);
}

function teLocaleCandidates(lang) {
  if (!lang) return [];
  const lower = String(lang).toLowerCase();
  const scriptVariant = lower.startsWith("zh-hans") ? "zh-CN" : lower.startsWith("zh-hant") ? "zh-TW" : null;
  return [...new Set([lang, scriptVariant, lang.split("-")[0]].filter(Boolean))];
}

function teLocaleProgress(source, target, metaKeys) {
  if (!source || !target) return 0;
  // Only keys with an accepted metadata entry count as translated; an English
  // seed is a baseline, not a finished translation.
  return teProgressFromMeta(source, metaKeys);
}

function teLocaleAlarmsApi() {
  if (typeof chrome !== "undefined" && chrome?.alarms?.create) return chrome.alarms;
  if (typeof browser !== "undefined" && browser?.alarms?.create) return browser.alarms;
  return null;
}

async function teLocaleFetchJson(url, etag, validate) {
  const headers = etag ? { "If-None-Match": etag } : {};
  const response = await fetchWithTimeout(url, { headers }, 12000);
  if (response.status === 304) return { unchanged: true };
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  const data = JSON.parse(text);
  if (!validate(data)) throw new Error("Invalid payload");
  return { data, text, etag: response.headers.get("ETag") || null };
}

async function teMapWithLimit(items, limit, mapper) {
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

async function teRefreshTranslationLocales() {
  const stored = await browser.storage.local.get([TE_LOCALE_CACHE_KEY, "lang"]);
  const previous = stored[TE_LOCALE_CACHE_KEY];
  const hasCurrentCache = !!previous && previous.schemaVersion === TE_LOCALE_CACHE_VERSION && previous.repo === TE_LOCALES_RAW_BASE;
  const cache = hasCurrentCache ? previous : null;

  let manifestResult;
  try {
    manifestResult = await teLocaleFetchJson(TE_MANIFEST_URL, cache?.manifest?.etag, teLocaleManifestIsValid);
  } catch (err) {
    logError("[TranslationLocales]: manifest fetch failed:", err.message);
    return;
  }

  if (manifestResult.unchanged && cache) {
    await browser.storage.local.set({ [TE_LOCALE_CACHE_KEY]: { ...cache, fetchedAt: Date.now() } });
    return;
  }

  const manifest = manifestResult.data;
  if (cache?.snapshot === manifest.snapshot) {
    const refreshed = { ...cache, fetchedAt: Date.now(), manifest: { ...cache.manifest, etag: manifestResult.etag || cache.manifest.etag } };
    await browser.storage.local.set({ [TE_LOCALE_CACHE_KEY]: refreshed });
    return;
  }

  const snapshotBase = `${TE_LOCALES_RAW_BASE}/${manifest.snapshot}/locales`;
  const langs = new Set(["en", ...Object.keys(manifest.languages), ...teLocaleCandidates(stored.lang)]);
  const tasks = [];
  langs.forEach((lang) => {
    const declaredFiles = manifest.languages[lang]?.files || {};
    TE_LOCALE_NAMESPACES.forEach((namespace) => {
      const file = declaredFiles[namespace];
      tasks.push({ lang, namespace, file, url: file?.url || `${snapshotBase}/${lang}/${namespace}.json` });
    });
  });

  const loaded = await teMapWithLimit(tasks, 6, async (task) => {
    try {
      const result = await teLocaleFetchJson(task.url, null, teLocalePayloadIsValid);
      // The manifest `sha` is the git blob SHA of the exact served bytes.
      if (task.file?.sha) {
        const actual = await teGitBlobShaForText(result.text);
        if (actual.toLowerCase() !== String(task.file.sha).toLowerCase()) {
          throw new Error(`sha mismatch (expected ${task.file.sha}, got ${actual})`);
        }
      }
      return { ...task, content: result.data, sha: task.file?.sha || null };
    } catch (err) {
      if (err.status !== 404 || task.file) logWarn(`[TranslationLocales]: ${task.lang}/${task.namespace} failed: ${err.message}`);
      return null;
    }
  });

  const failed = loaded.filter((entry) => entry === null).length;
  if (cache && failed === tasks.length) {
    logWarn("[TranslationLocales]: every file failed, keeping previous snapshot");
    return;
  }

  const nextLangs = {};
  langs.forEach((lang) => {
    nextLangs[lang] = { progress: 0 };
  });
  loaded.forEach((entry) => {
    if (entry) nextLangs[entry.lang][entry.namespace] = { content: entry.content, sha: entry.file?.sha || null, fetchedAt: Date.now() };
  });

  let metadata = cache?.metadata || null;
  try {
    const result = await teLocaleFetchJson(`${snapshotBase}/languages.json`, null, teLocaleMetadataIsValid);
    metadata = { content: result.data, etag: result.etag, fetchedAt: Date.now() };
  } catch (err) {
    logWarn(`[TranslationLocales]: languages.json fetch failed: ${err.message}`);
  }

  // Per-language metadata decides which keys were actually accepted. Fetch it
  // from the same immutable snapshot as the translation files.
  const metaTasks = [...langs].filter((lang) => lang !== "en").map((lang) => ({ lang, url: `${snapshotBase}/${lang}/.meta.json` }));
  const metas = await teMapWithLimit(metaTasks, 6, async (task) => {
    try {
      const result = await teLocaleFetchJson(task.url, null, teLocaleMetaIsValid);
      return { lang: task.lang, keys: result.data?.namespaces?.extension?.keys || null };
    } catch (err) {
      if (err.status !== 404) logWarn(`[TranslationLocales]: ${task.lang} metadata failed: ${err.message}`);
      return { lang: task.lang, keys: null };
    }
  });
  const metaByLang = Object.fromEntries(metas.map((entry) => [entry.lang, entry.keys]));

  const enSource = nextLangs.en?.extension?.content;
  langs.forEach((lang) => {
    nextLangs[lang].progress = teLocaleProgress(enSource, nextLangs[lang]?.extension?.content, metaByLang[lang]);
  });

  const nextCache = {
    schemaVersion: TE_LOCALE_CACHE_VERSION,
    repo: TE_LOCALES_RAW_BASE,
    manifest: { content: manifest, etag: manifestResult.etag, fetchedAt: Date.now() },
    snapshot: manifest.snapshot,
    sourceCommit: manifest.source.commit,
    fetchedAt: Date.now(),
    metadata,
    langs: nextLangs,
  };
  await browser.storage.local.set({ [TE_LOCALE_CACHE_KEY]: nextCache });
  logInfo(`[TranslationLocales]: refreshed snapshot ${manifest.snapshot.slice(0, 8)} across ${langs.size} language(s), ${failed} file(s) failed`);
}

async function teSetupTranslationLocalesAlarm() {
  const alarms = teLocaleAlarmsApi();
  if (alarms) {
    try {
      const existing = await alarms.get(TE_LOCALE_ALARM_NAME);
      if (!existing) {
        await alarms.create(TE_LOCALE_ALARM_NAME, { delayInMinutes: 1, periodInMinutes: TE_LOCALE_CHECK_MINS });
      }
    } catch (err) {
      logError("[TranslationLocales]: alarm setup failed:", err);
    }
  }

  // First run (or a stale cache) must be fully populated before the rest of the
  // background work starts, so the very first page already sees translations.
  const stored = await browser.storage.local.get(TE_LOCALE_CACHE_KEY);
  const cache = stored[TE_LOCALE_CACHE_KEY];
  const isFresh = cache?.schemaVersion === TE_LOCALE_CACHE_VERSION && Date.now() - (cache.fetchedAt || 0) < TE_LOCALE_CHECK_MINS * 60 * 1000;
  if (!isFresh) {
    const refresh = teRefreshTranslationLocales().catch((err) => logError("[TranslationLocales]: initial refresh failed:", err));
    await Promise.race([refresh, new Promise((resolve) => setTimeout(resolve, 15000))]);
  }
}

async function teOnTranslationLocalesAlarm(alarm) {
  if (alarm?.name !== TE_LOCALE_ALARM_NAME) return;
  await teRefreshTranslationLocales();
}
