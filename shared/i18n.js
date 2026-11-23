(function (global) {
  "use strict";

  // Helpers

  /** Unambiguous cache key: uses a separator that cannot appear in namespace/key */
  function cacheKey(ns, key, params) {
    return ns + "\x00" + key + (params == null ? "" : "\x00" + JSON.stringify(params));
  }

  /** Safely resolve a nested dot-notation key ("errors.notFound") from an object */
  function resolve(obj, key) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    const parts = key.split(".");
    let cur = obj;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : undefined;
    }
    return cur;
  }

  /** Interpolate {0},{1},… or {name} placeholders */
  function interpolate(str, params) {
    if (params == null) return str;
    if (Array.isArray(params)) {
      return str.replace(/\{(\d+)\}/g, (_, i) => {
        const idx = Number(i);
        return idx < params.length ? String(params[idx]) : `{${i}}`;
      });
    }
    if (typeof params === "object") {
      return str.replace(/\{(\w+)\}/g, (match, k) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : match));
    }
    return str;
  }

  /**
   * Ordered language/folder candidates for a requested tag, most specific first:
   * exact tag, script variant ("zh-Hans-CN" -> "zh-CN"), base language, then the
   * other Chinese variant as a last resort (Traditional-leaning tags prefer
   * zh-TW first). Shared by the UI loader below and the parser `locales`
   * selection (parser-locales.js), so both always resolve the same language.
   * @param {string} lang
   * @returns {string[]}
   */
  function getLangCandidates(lang) {
    if (typeof lang !== "string" || !lang) return [];
    const shortLang = lang.split("-")[0];

    // Known script-to-region variants so tags like "zh-Hans-CN" resolve to the
    // Simplified Chinese folder instead of falling back to English.
    const lowerLang = lang.toLowerCase();
    const scriptVariant = lowerLang.startsWith("zh-hans") ? "zh-CN" : lowerLang.startsWith("zh-hant") ? "zh-TW" : null;

    // Candidate folder names, most specific first: exact tag, script variant,
    // then the base language. Deduped so repeated candidates fetch only once.
    const candidates = [...new Set([lang, scriptVariant, shortLang].filter(Boolean))];

    // Last-resort Chinese cross-variant matching: when the exact tag, script
    // variant and base language folder all miss, try the other Chinese variant
    // before falling back to English. Traditional-leaning requests prefer the
    // Traditional folder first.
    if (lowerLang.startsWith("zh")) {
      const traditional = scriptVariant === "zh-TW" || /^(zh-hant|zh-tw|zh-hk|zh-mo)/.test(lowerLang);
      const cross = traditional ? ["zh-TW", "zh-CN"] : ["zh-CN", "zh-TW"];
      candidates.push(...cross.filter((code) => !candidates.includes(code)));
    }
    return candidates;
  }

  const LOG_PREFIX = "[WEB PRESENCE - i18n]:";
  const LOCALE_CACHE_KEY = "translationLocaleCache";
  let localeCacheWaitDone = false;

  // First run: the snapshot cache is populated asynchronously. Gate the first
  // load so pages never render with English before the real locales arrive.
  const LOCALE_GATE_TIMEOUT_MS = 10000;
  const LOCALE_GATE_POLL_MS = 250;
  const LOCALE_GATE_TEXT = "Loading languages. Please wait...";
  let localeGateOverlay = null;

  function showLocaleGate() {
    if (typeof document === "undefined") return;
    if (localeGateOverlay?.isConnected) return;
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.55);color:#fff;font:14px/1.4 sans-serif;text-align:center;";
    const box = document.createElement("div");
    box.style.cssText = "max-width:280px;padding:16px 20px;border-radius:10px;background:#1e1e22;box-shadow:0 8px 30px rgba(0,0,0,.4);";
    box.textContent = LOCALE_GATE_TEXT;
    overlay.appendChild(box);
    (document.body || document.documentElement).appendChild(overlay);
    localeGateOverlay = overlay;
  }

  function hideLocaleGate() {
    localeGateOverlay?.remove();
    localeGateOverlay = null;
  }

  async function localeSourceState(namespace) {
    if (namespace === "extension") {
      if (typeof browser === "undefined" || !browser?.storage?.local) return { ready: true, fresh: true };
      try {
        const stored = await browser.storage.local.get(LOCALE_CACHE_KEY);
        const cache = stored?.[LOCALE_CACHE_KEY];
        const ready = !!cache && cache.schemaVersion === 2 && Object.keys(cache.langs || {}).length > 0;
        const fresh = ready && Date.now() - (cache.fetchedAt || 0) < 60 * 60 * 1000;
        return { ready, fresh };
      } catch {
        return { ready: true, fresh: true };
      }
    }
    if (namespace === "server") {
      try {
        const response = await fetch("/locales/status", { cache: "no-store" });
        if (!response.ok) return { ready: true, fresh: true };
        const status = await response.json();
        return { ready: !!status.ready, fresh: !!status.ready };
      } catch {
        return { ready: true, fresh: true };
      }
    }
    return { ready: true, fresh: true };
  }

  let localeRefreshSent = false;
  function requestLocaleRefresh() {
    if (localeRefreshSent || typeof browser === "undefined" || !browser?.runtime?.sendMessage) return;
    localeRefreshSent = true;
    browser.runtime.sendMessage({ type: "REFRESH_LOCALES" }).catch(() => {});
  }

  async function ensureLocaleSourceReady(namespace) {
    if (namespace !== "extension" && namespace !== "server") return;
    const initial = await localeSourceState(namespace);
    if (initial.ready) {
      // A stale cache is usable, but ask the background to refresh it for next time.
      if (!initial.fresh) requestLocaleRefresh();
      return;
    }
    requestLocaleRefresh();
    showLocaleGate();
    const deadline = Date.now() + LOCALE_GATE_TIMEOUT_MS;
    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, LOCALE_GATE_POLL_MS));
        if ((await localeSourceState(namespace)).ready) return;
      }
      console.warn(`${LOG_PREFIX} Locale source not ready after ${LOCALE_GATE_TIMEOUT_MS} ms; continuing with packaged translations.`);
    } finally {
      hideLocaleGate();
    }
  }

  /**
   * Read the hourly-refreshed locale cache. Extension contexts only.
   * On a fresh install the background is still populating the cache, so wait
   * briefly once instead of rendering the first page with English only.
   */
  async function readLocaleCache() {
    if (typeof browser === "undefined" || browser == null || !browser.storage?.local) return null;
    try {
      let stored = await browser.storage.local.get(LOCALE_CACHE_KEY);
      let cache = stored?.[LOCALE_CACHE_KEY] || null;
      if (!cache && !localeCacheWaitDone) {
        localeCacheWaitDone = true;
        const deadline = Date.now() + 4000;
        while (!cache && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          stored = await browser.storage.local.get(LOCALE_CACHE_KEY);
          cache = stored?.[LOCALE_CACHE_KEY] || null;
        }
      }
      return cache?.schemaVersion === 2 ? cache : null;
    } catch {
      return null;
    }
  }

  // Class

  class I18n {
    /**
     * @param {object} [opts]
     * @param {string} [opts.defaultLang="en"]
     * @param {string} [opts.fallbackLang="en"]
     */
    constructor({ defaultLang = "en", fallbackLang = "en" } = {}) {
      this.lang = defaultLang;
      this.fallbackLang = fallbackLang;
      this.activeNamespace = "__default__";

      /** @type {Record<string, Record<string, string>>} */
      this._translations = {};
      /** @type {Record<string, Record<string, string>>} */
      this._fallback = {};

      /** @type {Map<string, string>} */
      this._cache = new Map();

      /**
       * Per-namespace load promises so concurrent calls for the same namespace
       * share a single in-flight fetch instead of racing.
       * @type {Map<string, Promise<void>>}
       */
      this._pending = new Map();

      /** Resolved once the first successful load() completes */
      this._readyPromise = null;
      this._resolveReady = null;
      this._ready = false;

      // Pre-build the ready promise so callers can await it before load() fires
      this._readyPromise = new Promise((res) => {
        this._resolveReady = res;
      });
    }

    // Private

    /** Detect whether we are running inside a browser extension */
    _isExtension() {
      return typeof browser !== "undefined" && browser != null && typeof browser.runtime !== "undefined" && typeof browser.storage !== "undefined";
    }

    /**
     * Resolve the base URL for locale files.
     * - Extension context  → browser.runtime.getURL("extension")
     * - All other contexts → "/locales"
     * File structure: locales/{lang}/{namespace}.json
     */
    _resolveBase(namespace) {
      if (namespace === "extension") {
        if (!this._isExtension()) {
          throw new Error(`${LOG_PREFIX} namespace="extension" requires a browser extension context.`);
        }
        return browser.runtime.getURL("locales");
      }
      return "/locales";
    }

    /**
     * Determine the language to use:
     *   1. Persisted preference (localStorage / extension storage)
     *   2. Browser UI language
     *   3. Caller hint
     *   4. "en"
     */
    async _detectLang(namespace, hint) {
      let stored = null;
      try {
        if (namespace === "extension" && this._isExtension()) {
          const result = await browser.storage.local.get("lang");
          stored = result?.lang ?? null;
        } else if (typeof localStorage !== "undefined") {
          stored = localStorage.getItem("lang");
        }
      } catch (e) {
        console.warn(`${LOG_PREFIX} Could not read persisted language:`, e);
      }

      const browserLang = navigator.languages?.[0] || navigator.language;

      return stored || browserLang || hint || "en";
    }

    /**
     * Fetch a single locale JSON file.
     * Returns an empty object on any error (network, parse, 404).
     */
    async _fetch(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    // Public API

    /**
     * Load translations for the given namespace and (optional) language hint.
     * Concurrent calls for the same namespace share a single fetch.
     *
     * @param {string} [namespace]
     * @param {string} [langHint]
     * @returns {Promise<void>}
     */
    load(namespace, langHint) {
      // Normalise before building the pending-key so concurrent callers dedupe
      const nsKey = namespace ?? "__default__";

      if (this._pending.has(nsKey)) {
        return this._pending.get(nsKey);
      }

      const promise = (async () => {
        await ensureLocaleSourceReady(namespace);
        await this._doLoad(namespace, langHint);
      })().finally(() => {
        this._pending.delete(nsKey);
      });

      this._pending.set(nsKey, promise);
      return promise;
    }

    /** @private */
    async _doLoad(namespace, langHint) {
      const lang = await this._detectLang(namespace, langHint);
      const base = this._resolveBase(namespace);
      const ns = namespace ?? "__default__";
      const shortLang = lang.split("-")[0];
      const sharedBase = this._isExtension() ? browser.runtime.getURL("locales") : "/locales";

      // Extension pages can use translations refreshed by the background alarm.
      // Dashboard/other contexts keep the original package-file behavior.
      const useCache = this._isExtension() && namespace === "extension";
      const cache = useCache ? await readLocaleCache() : null;
      const cached = (candidate, cacheNs) => cache?.langs?.[candidate]?.[cacheNs]?.content ?? null;

      const langCandidates = getLangCandidates(lang);

      // Repo cache wins per key, but keys that only exist in the build are kept.
      // This covers translations added locally before they reach GitHub main.
      const mergeWithBuild = (packageData, cachedData) => (cachedData ? { ...(packageData || {}), ...cachedData } : packageData);

      const fetchWithFallback = async (base, file, cacheNs) => {
        for (const [index, candidate] of langCandidates.entries()) {
          const cachedData = cached(candidate, cacheNs);
          // A cached translation is authoritative: never request the packaged
          // copy of that language (it is usually absent and logs a 404).
          if (cachedData && candidate !== this.fallbackLang) return { data: cachedData, lang: candidate };
          // Same when a shorter candidate (tr-TR -> tr) is already cached.
          if (langCandidates.slice(index + 1).some((next) => cached(next, cacheNs))) continue;
          const packageData = await this._fetch(`${base}/${candidate}/${file}`);
          const data = mergeWithBuild(packageData, cachedData);
          if (data != null) return { data, lang: candidate };
        }
        return { data: null, lang: null };
      };

      const fetchFallback = async (base, file, cacheNs) => {
        const cachedData = cached(this.fallbackLang, cacheNs);
        const packageData = await this._fetch(`${base}/${this.fallbackLang}/${file}`);
        return mergeWithBuild(packageData, cachedData);
      };

      const [sharedMain, sharedFallback, fetchedMain] = await Promise.all([
        fetchWithFallback(sharedBase, "shared.json", "shared"),
        fetchFallback(sharedBase, "shared.json", "shared"),
        fetchWithFallback(base, `${ns}.json`, ns),
      ]);

      // Track the folder that actually served the namespace file; only when
      // nothing resolved keep the legacy short code for the fallback check below.
      this.lang = fetchedMain.lang ?? shortLang;
      let main = fetchedMain.data;

      if (main == null) {
        if (this.lang !== this.fallbackLang) {
          console.log(`${LOG_PREFIX} "${this.lang}" not found, falling back to "${this.fallbackLang}".`);
          main = (await fetchFallback(base, `${ns}.json`, ns)) ?? {};
          this.lang = this.fallbackLang;
        } else {
          console.warn(`${LOG_PREFIX} Fallback language "${this.fallbackLang}" also missing for base "${base}".`);
          main = {};
        }
      }

      const fallback = this.lang !== this.fallbackLang ? ((await fetchFallback(base, `${ns}.json`, ns)) ?? {}) : main;

      this._translations[ns] = { ...(sharedMain?.data ?? {}), ...main };
      this._fallback[ns] = { ...(sharedFallback ?? {}), ...fallback };
      this.activeNamespace = ns;

      this._evictNamespace(ns);

      if (!this._ready) {
        this._ready = true;
        this._resolveReady();
      }
    }

    /** Remove all cache entries belonging to a namespace */
    _evictNamespace(ns) {
      const prefix = ns + "\x00";
      for (const key of this._cache.keys()) {
        if (key.startsWith(prefix)) this._cache.delete(key);
      }
    }

    /**
     * Returns a promise that resolves once the first load() has completed.
     * Safe to call before or after load().
     *
     * @returns {Promise<void>}
     */
    ready() {
      return this._readyPromise;
    }

    /**
     * Translate a key.
     *
     * @param {string} key           Translation key (supports dot notation)
     * @param {Array|object} [params] Interpolation parameters
     * @param {string} [namespace]   Override the active namespace
     * @returns {string}
     */
    t(key, params, namespace) {
      if (!this._ready) {
        console.warn(`${LOG_PREFIX} t("${key}") called before load() completed.`);
      }

      const ns = namespace ?? this.activeNamespace;
      const ck = cacheKey(ns, key, params);

      if (this._cache.has(ck)) return this._cache.get(ck);

      const tr = this._translations[ns] ?? {};
      const fb = this._fallback[ns] ?? {};

      let str = resolve(tr, key);

      if (str == null || str === "") {
        const fallbackStr = resolve(fb, key);

        if (fallbackStr != null && fallbackStr !== "") {
          console.log(`${LOG_PREFIX} Key "${key}" missing in "${this.lang}" (ns: "${ns}"). Using fallback value.`);
          str = fallbackStr;
        } else {
          console.log(`${LOG_PREFIX} Key "${key}" not found in "${this.lang}" or fallback (ns: "${ns}").`);
          str = key;
        }
      } else if (typeof str !== "string") {
        console.log(`${LOG_PREFIX} Key "${key}" resolved to a non-string value.`);
        str = String(str);
      }

      const result = interpolate(str, params);
      this._cache.set(ck, result);
      return result;
    }

    /**
     * Check whether a translation key exists (without triggering missing-key warning).
     *
     * @param {string} key
     * @param {string} [namespace]
     * @returns {boolean}
     */
    has(key, namespace) {
      const ns = namespace ?? this.activeNamespace;
      const tr = this._translations[ns] ?? {};
      const fb = this._fallback[ns] ?? {};
      return resolve(tr, key) != null || resolve(fb, key) != null;
    }

    /**
     * Change the active language at runtime and reload the current namespace.
     *
     * @param {string} lang
     * @param {string} [namespace]
     * @returns {Promise<void>}
     */
    async setLang(lang, namespace) {
      const ns = namespace ?? this.activeNamespace;
      if (this._isExtension() && ns === "extension") {
        try {
          await browser.storage.local.set({ lang });
        } catch (e) {
          console.warn(`${LOG_PREFIX} Could not persist language to extension storage:`, e);
        }
      }
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem("lang", lang);
        } catch {
          /* quota / private mode */
        }
      }
      return this.load(ns, lang);
    }
  }

  // DOM helpers

  /**
   * Parse data-i18n-params. Returns null on failure (already logged).
   * @param {Element} el
   * @returns {Array|object|null}
   */
  function parseParams(el) {
    const raw = el.dataset.i18nParams;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      console.warn(`${LOG_PREFIX} Invalid data-i18n-params JSON on`, el, ":", raw);
      return null;
    }
  }

  /**
   * Translate a single DOM element using its data-i18n* attributes.
   * @param {Element} el
   * @param {string} [namespace]
   */
  function translateElement(el, namespace) {
    const key = el.dataset.i18n;
    if (!key) return;

    const separator = el.dataset.i18nSep ?? " ";
    const keys = key.split("|");
    const text = keys.map((k) => i18n.t(k.trim(), parseParams(el), namespace)).join(separator);
    const attr = el.dataset.i18nAttr;

    if (attr) {
      el.setAttribute(attr, text);
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.placeholder = text;
    } else {
      el.textContent = text;
    }
  }

  /**
   * Translate all [data-i18n] elements within a root node.
   *
   * @param {string}   [namespace]   Override namespace (defaults to i18n.activeNamespace)
   * @param {Document|Element} [root=document]
   */
  function applyTranslations(namespace, root) {
    if (root == null) root = typeof document !== "undefined" ? document : null;
    if (root == null) return;

    const ns = namespace ?? i18n.activeNamespace;
    root.querySelectorAll("[data-i18n]").forEach((el) => translateElement(el, ns));
  }

  // Exports

  const i18n = new I18n();

  // Pure helpers shared with other modules
  I18n.interpolate = interpolate;
  I18n.getLangCandidates = getLangCandidates;

  global.I18n = I18n;
  global.i18n = i18n;
  global.applyTranslations = applyTranslations;
})(typeof globalThis !== "undefined" ? globalThis : window);
