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

  const LOG_PREFIX = "[WEB PRESENCE - i18n]:";

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

      const promise = this._doLoad(namespace, langHint).finally(() => {
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

      const fetchWithFallback = async (base, file) => {
        let data = await this._fetch(`${base}/${lang}/${file}`);
        if (data == null && shortLang !== lang) data = await this._fetch(`${base}/${shortLang}/${file}`);
        return data;
      };

      const [sharedMain, sharedFallback, fetchedMain] = await Promise.all([
        fetchWithFallback(sharedBase, "shared.json"),
        this._fetch(`${sharedBase}/${this.fallbackLang}/shared.json`),
        fetchWithFallback(base, `${ns}.json`),
      ]);

      this.lang = lang;
      let main = fetchedMain;

      if (main == null) {
        if (this.lang !== this.fallbackLang) {
          console.log(`${LOG_PREFIX} "${this.lang}" not found, falling back to "${this.fallbackLang}".`);
          main = (await this._fetch(`${base}/${this.fallbackLang}/${ns}.json`)) ?? {};
          this.lang = this.fallbackLang;
        } else {
          console.warn(`${LOG_PREFIX} Fallback language "${this.fallbackLang}" also missing for base "${base}".`);
          main = {};
        }
      }

      const fallback = this.lang !== this.fallbackLang ? ((await this._fetch(`${base}/${this.fallbackLang}/${ns}.json`)) ?? {}) : main;

      this._translations[ns] = { ...(sharedMain ?? {}), ...main };
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

      if (str == null) {
        const fallbackStr = resolve(fb, key);

        if (fallbackStr != null) {
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
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem("lang", lang);
        } catch {
          /* quota / private mode */
        }
      }
      return this.load(namespace ?? this.activeNamespace, lang);
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

  global.I18n = I18n;
  global.i18n = i18n;
  global.applyTranslations = applyTranslations;
})(typeof globalThis !== "undefined" ? globalThis : window);
