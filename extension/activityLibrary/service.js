const STORE_STORAGE_KEY = "githubStoreRepos";
const STORE_ETAG_KEY = "githubStoreETags";
const STORE_ALARM_NAME = "githubStoreUpdateCheck";
const STORE_CHECK_INTERVAL_MINS = 60;

// IndexedDB for githubStoreRepos
const IDB_NAME = "githubStore";
const IDB_STORE_NAME = "repos";
const IDB_VERSION = 1;

let _idbInstance = null;
const _getStoreDB = () => {
  if (_idbInstance) return Promise.resolve(_idbInstance);
  return openIndexedDB(IDB_NAME, IDB_STORE_NAME, IDB_VERSION).then((db) => {
    _idbInstance = db;
    return db;
  });
};

class GitHubStoreService {
  constructor() {
    this._repoCache = null;
    this._etagCache = null;
    this._pendingSaveRepos = null;
    this._pendingSaveETags = null;
    this._saveReposTimer = null;
    this._saveETagsTimer = null;
    this._alarmsApi = null;
    this._actionApi = null;
    this._initApis();
    this.firstTimeSetup();
  }

  // API Initialization
  _initApis() {
    this._alarmsApi =
      (typeof chrome !== "undefined" && chrome?.alarms?.create ? chrome.alarms : null) ??
      (typeof browser !== "undefined" && browser?.alarms?.create ? browser.alarms : null);
  }

  // Internal Helpers

  /**
   * Normalizes the GitHub repo URL and generates the raw base URL.
   */
  _parseRepoUrl(url) {
    const trimmedUrl = url?.trim();
    if (!trimmedUrl) throw new Error("URL cannot be empty");

    try {
      const u = new URL(trimmedUrl);

      // If the raw URL is already given
      if (u.hostname === "raw.githubusercontent.com") {
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length < 3) throw new Error("Invalid raw URL format");
        const [user, repo, branch] = parts;
        return { user, repo, branch, rawBase: `https://raw.githubusercontent.com/${user}/${repo}/${branch}` };
      }

      // Normal github.com URL
      if (u.hostname !== "github.com") throw new Error("Only github.com URLs are supported");

      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length < 2) throw new Error("Invalid GitHub URL format");

      const [user, repo] = parts;
      const branch = parts[2] === "tree" && parts[3] ? parts[3] : "main";

      return { user, repo, branch, rawBase: `https://raw.githubusercontent.com/${user}/${repo}/${branch}` };
    } catch (err) {
      throw new Error(`URL parse error: ${err.message}`);
    }
  }

  /** Generates a unique repo ID */
  _repoId(user, repo, branch) {
    return `${user}__${repo}__${branch}`;
  }

  /** SemVer or free string comparison → is remote newer? */
  _isNewer(remoteVersion, localVersion) {
    if (!remoteVersion || !localVersion || remoteVersion === localVersion) return false;

    const toNum = (v) =>
      String(v)
        .replace(/[^0-9.]/g, "")
        .split(".")
        .map(Number);
    const r = toNum(remoteVersion);
    const l = toNum(localVersion);
    const len = Math.max(r.length, l.length);

    for (let i = 0; i < len; i++) {
      const rv = r[i] ?? 0;
      const lv = l[i] ?? 0;
      if (rv > lv) return true;
      if (rv < lv) return false;
    }
    return false;
  }

  // Debounced Storage
  async _loadRepos() {
    if (this._repoCache) return this._repoCache;
    try {
      const db = await _getStoreDB();
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const store = tx.objectStore(IDB_STORE_NAME);
      const [keys, vals] = await Promise.all([
        new Promise((res, rej) => {
          const r = store.getAllKeys();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        }),
        new Promise((res, rej) => {
          const r = store.getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        }),
      ]);
      const repos = {};
      keys.forEach((k, i) => (repos[k] = vals[i]));
      this._repoCache = repos;
    } catch {
      this._repoCache = {};
    }
    return this._repoCache;
  }

  async _saveRepos(repos) {
    this._repoCache = repos;

    // Debounce: perform multiple saves that come within 100ms at once
    clearTimeout(this._saveReposTimer);
    this._saveReposTimer = setTimeout(async () => {
      try {
        const db = await _getStoreDB();
        const tx = db.transaction(IDB_STORE_NAME, "readwrite");
        const store = tx.objectStore(IDB_STORE_NAME);
        store.clear();
        for (const [key, val] of Object.entries(this._repoCache)) {
          store.put(val, key);
        }
        await new Promise((res, rej) => {
          tx.oncomplete = res;
          tx.onerror = () => rej(tx.error);
        });
      } catch (err) {
        logError("[GitHubStore] saveRepos IDB error:", err);
      }
      this._saveReposTimer = null;
    }, 100);
  }

  async _loadETags() {
    if (this._etagCache) return this._etagCache;
    try {
      const result = await browser.storage.local.get(STORE_ETAG_KEY);
      this._etagCache = result[STORE_ETAG_KEY] ?? {};
    } catch {
      this._etagCache = {};
    }
    return this._etagCache;
  }

  async _saveETags(etags) {
    this._etagCache = etags;

    clearTimeout(this._saveETagsTimer);
    this._saveETagsTimer = setTimeout(async () => {
      try {
        await browser.storage.local.set({ [STORE_ETAG_KEY]: this._etagCache });
      } catch (err) {
        logError("[GitHubStore] saveETags error:", err);
      }
      this._saveETagsTimer = null;
    }, 100);
  }

  // Fetch
  /**
   * Fetches hash.json first to cheaply detect whether index.json.gz has changed.
   * @returns { data: Array|null, changed: boolean, etag: string|null }
   */
  async _fetchIndex(rawBase) {
    //  1. Try hash.json → skip full download when nothing changed
    const gzUrl = `${rawBase}/index.json.gz`;
    const hashUrl = `${rawBase}/hash.json`;

    const etags = await this._loadETags();

    let remoteHash = null;
    try {
      const hashRes = await fetch(hashUrl, { cache: "no-store" });
      if (hashRes.ok) {
        const hashObj = await hashRes.json();
        remoteHash = hashObj?.sha256 ?? null;
      }
    } catch (_) {}

    // If we already have this exact hash stored, nothing has changed
    const storedHash = etags[gzUrl + "#hash"];
    if (remoteHash && storedHash && remoteHash === storedHash) {
      return { data: null, changed: false, etag: null };
    }

    //  2. Fetch index.json.gz (ETag as secondary cache layer)
    const savedEtag = etags[gzUrl];
    const gzHeaders = { Accept: "application/octet-stream" };
    if (savedEtag && !remoteHash) gzHeaders["If-None-Match"] = savedEtag;

    let gzRes;
    try {
      gzRes = await fetch(gzUrl, { headers: gzHeaders, cache: "no-store" });
    } catch (err) {
      throw new Error(`index.json.gz fetch failed (${gzUrl}): ${err.message}`);
    }

    if (gzRes.status === 304) return { data: null, changed: false, etag: savedEtag };
    if (!gzRes.ok) throw new Error(`index.json.gz HTTP ${gzRes.status} (${gzUrl})`);

    let data;
    try {
      const buf = await gzRes.arrayBuffer();
      const decompressed = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
      data = JSON.parse(decompressed);
    } catch {
      throw new Error(`index.json.gz decompress/parse failed (${gzUrl})`);
    }

    if (!Array.isArray(data)) {
      throw new Error(`index.json.gz should be an array, ${typeof data} came`);
    }

    // Persist hash + ETag for next check
    const newEtag = gzRes.headers.get("ETag");
    if (newEtag) etags[gzUrl] = newEtag;
    if (remoteHash) etags[gzUrl + "#hash"] = remoteHash;
    if (newEtag || remoteHash) await this._saveETags(etags);

    return { data, changed: true, etag: newEtag };
  }

  /**
   * Fetches a single script file.
   * @returns { code: string }
   */
  async _fetchScriptFile(rawBase, filePath) {
    if (!filePath) throw new Error("Script file path is missing");

    const url = `${rawBase}/${filePath.replace(/^\//, "")}`;

    let res;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (err) {
      throw new Error(`Script fetch failed (${url}): ${err.message}`);
    }

    if (!res.ok) throw new Error(`Script HTTP ${res.status} (${url})`);

    const code = await res.text();
    if (!code?.trim()) throw new Error(`Script file empty: ${url}`);

    return { code };
  }

  // Repository Management

  /**
   * Adds a new GitHub repo and fetches the first index.json.
   * @param {string} repoUrl - GitHub repo URL
   * @returns {{ ok: boolean, repo?: object, error?: string }}
   */
  async addRepo(repoUrl) {
    try {
      const parsed = this._parseRepoUrl(repoUrl);
      const id = this._repoId(parsed.user, parsed.repo, parsed.branch);
      const repos = await this._loadRepos();

      if (repos[id]) {
        return { ok: false, error: "This repo has already been added", repoId: id };
      }

      // First index.json fetch - No ETag, always fetches
      const { data } = await this._fetchIndex(parsed.rawBase);

      const now = Date.now();
      const repo = {
        id,
        url: repoUrl,
        user: parsed.user,
        repo: parsed.repo,
        branch: parsed.branch,
        rawBase: parsed.rawBase,
        scripts: data ?? [],
        addedAt: now,
        lastChecked: now,
      };

      repos[id] = repo;
      await this._saveRepos(repos);

      return { ok: true, repo };
    } catch (err) {
      logError("[GitHubStore]: addRepo error:", err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Removes the repo. Does not delete installed scripts, only removes the repo record.
   */
  async removeRepo(repoId) {
    if (!repoId) return { ok: false, error: "Repo ID required" };

    try {
      const repos = await this._loadRepos();
      if (!repos[repoId]) return { ok: false, error: "Repo not found" };

      // Clear the ETags belonging to this repo
      const rawBase = repos[repoId]?.rawBase;
      if (rawBase) {
        const etags = await this._loadETags();
        const gzUrl = `${rawBase}/index.json.gz`;
        delete etags[gzUrl];
        delete etags[gzUrl + "#hash"];
        await this._saveETags(etags);
      }

      delete repos[repoId];
      await this._saveRepos(repos);
      return { ok: true };
    } catch (err) {
      logError("[GitHubStore]: removeRepo error:", err);
      return { ok: false, error: err.message };
    }
  }

  /** Lists all registered repositories */
  async listRepos() {
    const repos = await this._loadRepos();
    return Object.values(repos);
  }

  // Update Check
  async checkRepoUpdates() {
    const { storeAutoUpdate = true } = await browser.storage.local.get("storeAutoUpdate");
    if (storeAutoUpdate) {
      storeService
        .checkAllReposForUpdates()
        .then(async ({ totalUpdates, results }) => {
          if (totalUpdates > 0) {
            const updates = [];
            for (const result of results ?? []) {
              for (const script of result.updates ?? []) {
                updates.push({ repoId: result.repoId, scriptMeta: script });
              }
            }
            if (updates.length) await handleStoreBatchUpdate({ updates });
            logInfo(`[GitHubStore]: Updated ${totalUpdates} scripts`);
          } else {
            logInfo("[GitHubStore]: No updates found");
          }
        })
        .catch((err) => logError("[GitHubStore]: ", err));
    }
  }

  /**
   * Checks for updates of a single repo.
   * If there is an ETag and it hasn't changed, it doesn't load any JS.
   */
  async checkRepoForUpdates(repoId) {
    if (!repoId) return { ok: false, error: "Repo ID required" };

    const repos = await this._loadRepos();
    const repo = repos[repoId];
    if (!repo) return { ok: false, error: "Repo not found" };

    try {
      const { data, changed } = await this._fetchIndex(repo.rawBase);

      // If the hash hasn't changed, data comes as null - use the scripts in storage
      const scripts = changed ? data : (repo.scripts ?? []);

      // Snapshot of previous script IDs before overwriting — used for "new" detection
      const previousScriptIds = new Set((repo.scripts ?? []).map((s) => s.id ?? generateParserKey(s.domain, s.urlPatterns ?? ["/.*/"], s.authors)));
      const isFirstLoad = repo.scripts == null;

      if (changed) {
        repo.scripts = data;
        repo.lastChecked = Date.now();
        repos[repoId] = repo;
        await this._saveRepos(repos);
      } else {
        repo.lastChecked = Date.now();
        repos[repoId] = repo;
        await this._saveRepos(repos);
      }

      // Compare with installed in any case
      const installed = await this._getInstalledScripts();
      const installedMap = new Map(installed.map((s) => [s.id ?? s.storeScriptId, s]));

      const updates = [];
      const newScripts = [];
      const remoteIds = new Set();

      for (const remoteMeta of scripts) {
        if (!remoteMeta?.file) continue;

        const scriptId = remoteMeta.id ?? generateParserKey(remoteMeta.domain, remoteMeta.urlPatterns ?? ["/.*/"], remoteMeta.authors);
        remoteIds.add(scriptId);
        const localScript = installedMap.get(scriptId);

        if (!localScript) {
          newScripts.push({ ...remoteMeta, _repoId: repoId, _scriptId: scriptId });
        } else if (this._isNewer(remoteMeta.version, localScript.version)) {
          updates.push({ ...remoteMeta, _repoId: repoId, _scriptId: scriptId, _localVersion: localScript.version });
        }
      }

      // Auto-remove scripts that are no longer in the repo
      const removedScripts = [];
      for (const [installedId, localScript] of installedMap) {
        if (localScript.storeRepoId !== repoId) continue;
        if (remoteIds.has(installedId)) continue;
        removedScripts.push(localScript);
      }

      for (const script of removedScripts) {
        try {
          await scriptManager.unregisterUserScript(script);
          const list = await scriptManager.storage.getScripts();
          const idx = list.findIndex((s) => s.id === script.id);
          if (idx !== -1) {
            list.splice(idx, 1);
            await scriptManager.storage.saveScripts(list);
          }
          logInfo(`[GitHubStore]: Auto-removed: ${script.title} (${script.id}) - no longer in repo`);
        } catch (err) {
          logError(`[GitHubStore]: Auto-remove failed: ${script.id}`, err);
        }
      }

      // Detect new scripts: only when hash changed, not on first load, and absent from previous snapshot
      if (changed && !isFirstLoad) {
        const trulyNew = scripts.filter((s) => {
          const sid = s.id ?? generateParserKey(s.domain, s.urlPatterns ?? ["/.*/"], s.authors);
          return !previousScriptIds.has(sid);
        });

        if (trulyNew.length > 0) {
          try {
            const { storeNewScriptIds = [] } = await browser.storage.local.get("storeNewScriptIds");
            const existing = new Set(storeNewScriptIds);
            for (const s of trulyNew) {
              existing.add(s.id ?? generateParserKey(s.domain, s.urlPatterns ?? ["/.*/"], s.authors));
            }
            await browser.storage.local.set({ storeNewScriptIds: [...existing] });
          } catch (_) {}
        }
      }

      return { ok: true, repoId, checked: true, changed, updates, newScripts, removedScripts };
    } catch (err) {
      repo.lastChecked = Date.now();
      repos[repoId] = repo;
      await this._saveRepos(repos).catch(() => {});
      logError(`[GitHubStore]: checkRepoForUpdates [${repoId}]:`, err);
      return { ok: false, repoId, error: err.message };
    }
  }

  /**
   * Checks all repositories.
   * @returns { results: Array, totalUpdates: number, totalNew: number }
   */
  async checkAllReposForUpdates() {
    const repos = await this._loadRepos();
    const repoIds = Object.keys(repos);

    if (!repoIds.length) {
      return { ok: true, results: [], totalUpdates: 0, totalNew: 0 };
    }

    let totalUpdates = 0;
    let totalNew = 0;
    const results = [];

    for (const repoId of repoIds) {
      const result = await this.checkRepoForUpdates(repoId);
      results.push(result);
      if (result.ok) {
        totalUpdates += result.updates?.length ?? 0;
        totalNew += result.newScripts?.length ?? 0;
      }
    }

    return { ok: true, results, totalUpdates, totalNew };
  }

  // Installation / Update

  /**
   * If there are no repositories registered in the system, it adds the default repository.
   * @param {string} defaultUrl - The default GitHub repository URL to be added
   */
  async addDefaultRepoIfNeeded(defaultUrl) {
    if (!defaultUrl) return;

    try {
      const repos = await this._loadRepos();
      if (Object.keys(refopos).length === 0) {
        logInfo("[GitHubStore]: No repository found, adding default repository...");
        await this.addRepo(defaultUrl);
      }
    } catch (err) {
      logError("[GitHubStore]: addDefaultRepoIfNeeded error:", err);
    }
  }

  /**
   * Installs a script from the library.
   * Generates a script object compatible with the existing handleSaveUserScript flow.
   */
  async installScript(repoId, scriptMeta) {
    if (!repoId) return { ok: false, error: "Repo ID required" };
    if (!scriptMeta?.file) return { ok: false, error: "Script file path is missing (file field)" };

    try {
      const repos = await this._loadRepos();
      const repo = repos[repoId];
      if (!repo) return { ok: false, error: "Repo not found" };

      const { code } = await this._fetchScriptFile(repo.rawBase, scriptMeta.file);
      const scriptObj = this._buildScriptObj(scriptMeta, code, repoId, repo);

      return { ok: true, scriptObj };
    } catch (err) {
      logError("[GitHubStore]: installScript error:", err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Updates an installed script (pulls the code again, saves it).
   */
  async updateScript(repoId, scriptMeta) {
    if (!repoId) return { ok: false, error: "Repo ID required" };
    if (!scriptMeta?.file) return { ok: false, error: "Script file path is missing" };

    try {
      const repos = await this._loadRepos();
      const repo = repos[repoId];
      if (!repo) return { ok: false, error: "Repo not found" };

      const { code } = await this._fetchScriptFile(repo.rawBase, scriptMeta.file);

      const installed = await this._getInstalledScripts();
      const scriptId = scriptMeta.id ?? generateParserKey(scriptMeta.domain, scriptMeta.urlPatterns ?? ["/.*/"], scriptMeta.authors);
      const localScript = installed.find((s) => (s.id ?? s.storeScriptId) === scriptId);

      const scriptObj = this._buildScriptObj(scriptMeta, code, repoId, repo);

      return { ok: true, scriptObj, previousId: localScript?.id ?? null };
    } catch (err) {
      logError("[GitHubStore]: updateScript error:", err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Updates a script installed from the Store along with an update check.
   * First, it checks the version, and if there is actually a new version, it updates.
   */
  async updateScriptIfNewer(repoId, scriptMeta) {
    if (!repoId || !scriptMeta) return { ok: false, error: "Missing Parameters" };

    const installed = await this._getInstalledScripts();
    const scriptId = scriptMeta.id ?? generateParserKey(scriptMeta.domain, scriptMeta.urlPatterns ?? ["/.*/"], scriptMeta.authors);
    const local = installed.find((s) => (s.id ?? s.storeScriptId) === scriptId);

    if (local && !this._isNewer(scriptMeta.version, local.version)) {
      return { ok: true, skipped: true, reason: "Already up to date" };
    }

    return this.updateScript(repoId, scriptMeta);
  }

  // Alarm (Daily Automatic Check)

  /**
   * Starts the daily automatic update check alarm.
   * Call inside background.js init().
   */
  async setupUpdateAlarm() {
    try {
      if (!this._alarmsApi) {
        logError("[GitHubStore]: alarms API not found");
        return;
      }

      const INTERVAL_MINS = STORE_CHECK_INTERVAL_MINS;
      const INTERVAL_MS = INTERVAL_MINS * 60 * 1000;

      const repos = await this._loadRepos();
      const repoList = Object.values(repos);
      const now = Date.now();

      const oldestCheck = repoList.reduce((oldest, repo) => (repo.lastChecked && repo.lastChecked < oldest ? repo.lastChecked : oldest), now);

      const remaining = INTERVAL_MS - (now - oldestCheck);

      if (remaining <= 0) {
        logInfo("[GitHubStore]: Overdue check, running immediately");
        this.checkAllReposForUpdates().catch((err) => logError("[GitHubStore]: ", err));
      }

      const existing = await this._alarmsApi.get(STORE_ALARM_NAME);
      if (existing) {
        logInfo(`[GitHubStore]: Alarm already set, skipping create`);
        return;
      }

      const delayMins = remaining > 0 ? Math.ceil(remaining / 60000) : INTERVAL_MINS;
      logInfo(`[GitHubStore]: Creating alarm, first fire in ${delayMins} minutes`);
      await this._alarmsApi.create(STORE_ALARM_NAME, {
        delayInMinutes: delayMins,
        periodInMinutes: INTERVAL_MINS,
      });
    } catch (err) {
      logError("[GitHubStore]: alarm setup error:", err);
    }
  }

  async onAlarm(alarm) {
    if (alarm?.name !== STORE_ALARM_NAME) return;
    logInfo("[GitHubStore]: Automatic update check is starting...");

    try {
      const { storeAutoUpdate = true } = await browser.storage.local.get("storeAutoUpdate");

      const { totalUpdates, totalNew, results } = await this.checkAllReposForUpdates();
      logInfo("[GitHubStore]: totalUpdates:", totalUpdates, "totalNew:", totalNew);

      if (storeAutoUpdate && totalUpdates > 0) {
        const updates = [];
        for (const result of results ?? []) {
          for (const script of result.updates ?? []) {
            updates.push({ repoId: result.repoId, scriptMeta: script });
          }
        }
        logInfo("[GitHubStore]: updates to apply:", JSON.stringify(updates));
        if (updates.length) await handleStoreBatchUpdate({ updates });
      } else {
        logInfo("[GitHubStore]: alarm skipped -", !storeAutoUpdate ? "autoUpdate off" : "no updates found");
      }
    } catch (err) {
      logError("[GitHubStore]: onAlarm error:", err);
    }
  }

  /** brings the installed user scripts from storage */
  async _getInstalledScripts() {
    try {
      const result = await browser.storage.local.get("userScriptsList");
      return result.userScriptsList ?? [];
    } catch {
      return [];
    }
  }

  _normalizeRegisterParser(jsText) {
    try {
      // 1. JSON check
      const parsedJson = JSON.parse(jsText);
      const scriptData = Array.isArray(parsedJson) ? parsedJson[0] : parsedJson;

      if (scriptData && typeof scriptData.code === "string") {
        return {
          isParser: false,
          code: scriptData.code,
          title: scriptData.title,
          description: scriptData.description,
          domain: scriptData.domain,
          homepage: scriptData.homepage,
          authors: scriptData.authors,
          authorsLinks: scriptData.authorsLinks,
          mode: scriptData.mode,
          urlPatterns: scriptData.urlPatterns,
          category: scriptData.category ?? [],
          tags: scriptData.tags ?? [],
          iframeSelectors: scriptData.iframeSelectors ?? null,
        };
      }
    } catch (_) {}

    // 2. JS Regex Extraction
    const match = /registerParser\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(jsText);
    if (!match) return { code: jsText };

    const block = match[1];

    const extractStr = (key) => {
      return new RegExp(`${key}:\\s*["'\`](.*?)["'\`]`).exec(block)?.[1] || "";
    };

    // domain: string or ["a","b"] array
    let domain;
    const domainArrayMatch = /\bdomain:\s*\[([\s\S]*?)\]/.exec(block);
    const domainStringMatch = /\bdomain:\s*["'`](.*?)["'`]/.exec(block);
    if (domainArrayMatch) {
      const arr = domainArrayMatch[1]
        .split(",")
        .map((d) => d.trim().replace(/^["'`]|["'`]$/g, ""))
        .filter(Boolean);
      domain = arr.length === 1 ? arr[0] : arr;
    } else if (domainStringMatch) {
      domain = domainStringMatch[1];
    } else {
      domain = "";
    }

    // urlPatterns
    const urlPatternsRaw = /\burlPatterns:\s*\[([\s\S]*?)\]/.exec(block)?.[1] || "";
    const urlPatterns = urlPatternsRaw
      .split(",")
      .map((p) => p.trim().replace(/^["'`]|["'`]$/g, ""))
      .filter(Boolean);

    // authors / authorsLinks
    const authorsRaw = extractStr("authors");
    const authors = authorsRaw ? authorsRaw.split(",").map((a) => a.trim()) : [];
    const authorsLinksRaw = extractStr("authorsLinks");
    const authorsLinks = authorsLinksRaw ? authorsLinksRaw.split(",").map((a) => a.trim()) : [];

    // tags: ["a", "b"] array
    const tagsArrayMatch = /\btags:\s*\[([\s\S]*?)\]/.exec(block);
    const tags = tagsArrayMatch
      ? tagsArrayMatch[1]
          .split(",")
          .map((t) => t.trim().replace(/^["'`]|["'`]$/g, ""))
          .filter(Boolean)
      : [];

    // category
    const categoryArrayMatch = /\bcategory:\s*\[([\s\S]*?)\]/.exec(block);
    const category = categoryArrayMatch
      ? categoryArrayMatch[1]
          .split(",")
          .map((t) => t.trim().replace(/^["'`]|["'`]$/g, ""))
          .filter(Boolean)
      : [];

    // iframeSelectors: balanced brace match
    let iframeSelectors = null;
    const iframeIdx = block.indexOf("iframeSelectors:");
    if (iframeIdx !== -1) {
      let depth = 0,
        objStart = -1,
        k = iframeIdx;
      while (k < block.length) {
        if (block[k] === "{") {
          if (objStart === -1) objStart = k;
          depth++;
        } else if (block[k] === "}") {
          if (--depth === 0 && objStart !== -1) {
            try {
              iframeSelectors = JSON.parse(block.slice(objStart, k + 1));
            } catch (_) {}
            break;
          }
        }
        k++;
      }
    }

    function extractRegisterParserObject(text) {
      const start = text.indexOf("registerParser");
      if (start === -1) return null;

      const open = text.indexOf("{", start);
      if (open === -1) return null;

      let depth = 1,
        i = open + 1,
        inString = false,
        stringChar = null,
        escape = false;

      while (i < text.length) {
        const c = text[i];
        if (escape) {
          escape = false;
          i++;
          continue;
        }
        if (c === "\\") {
          escape = true;
          i++;
          continue;
        }
        if (inString) {
          if (c === stringChar) {
            inString = false;
            stringChar = null;
          }
          i++;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          inString = true;
          stringChar = c;
          i++;
          continue;
        }
        if (c === "{") depth++;
        if (c === "}") depth--;
        if (depth === 0) return text.slice(open, i + 1);
        i++;
      }
      return null;
    }

    function extractFnBody(objText) {
      const fnMatch = /fn\s*:\s*(?:async\s+)?function\s*\(/.exec(objText);
      if (!fnMatch) return null;

      const start = objText.indexOf("{", fnMatch.index);
      if (start === -1) return null;

      let depth = 1,
        i = start + 1,
        inString = false,
        quote = null,
        escape = false;

      while (i < objText.length) {
        const c = objText[i];
        if (escape) {
          escape = false;
          i++;
          continue;
        }
        if (c === "\\") {
          escape = true;
          i++;
          continue;
        }
        if (inString) {
          if (c === quote) {
            inString = false;
            quote = null;
          }
          i++;
          continue;
        }
        if (c === "'" || c === '"' || c === "`") {
          inString = true;
          quote = c;
          i++;
          continue;
        }
        if (c === "{") depth++;
        if (c === "}") depth--;
        if (depth === 0) {
          return objText
            .slice(start + 1, i)
            .split("\n")
            .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
            .join("\n")
            .trim();
        }
        i++;
      }
      return null;
    }

    const obj = extractRegisterParserObject(jsText);
    const code = obj ? extractFnBody(obj) : null;

    return {
      isParser: true,
      code,
      title: extractStr("title"),
      description: extractStr("description"),
      domain,
      homepage: extractStr("homepage"),
      authors,
      authorsLinks,
      mode: extractStr("mode") || "listen",
      urlPatterns,
      category,
      tags,
      iframeSelectors,
    };
  }

  _buildScriptObj(meta, rawCode, repoId, repo) {
    // 1. Normalize the code (extracts if it contains registerParser)
    const parsed = this._normalizeRegisterParser(rawCode);

    // 2. Determine the Domain (Priority: index.json meta -> registerParser -> empty)
    const rawDomain = meta.domain ?? parsed.domain ?? "";
    const domains = Array.isArray(rawDomain)
      ? rawDomain
      : typeof rawDomain === "string" && rawDomain
        ? rawDomain
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean)
        : [];

    // 3. iframeSelectors: index.json meta first, otherwise get from registerParser
    const iframeSelectors = meta.iframeSelectors ?? parsed.iframeSelectors ?? null;

    // 4. category: index.json meta first, otherwise get from registerParser
    const category = meta.category?.length ? [...meta.category] : (parsed.category ?? []);

    // 5. tags: index.json meta first, otherwise get from registerParser
    const tags = meta.tags?.length ? [...meta.tags] : (parsed.tags ?? []);

    // 6. Resolve authors
    const authors = meta.authors?.length ? [...meta.authors] : (parsed.authors ?? []);

    // 7. Resolve urlPatterns
    const urlPatterns = meta.urlPatterns ?? (parsed.urlPatterns?.length ? parsed.urlPatterns : ["/.*/"]);

    // 8. Generate id
    const primaryDomain = domains[0] ?? "";
    const id = meta.id ?? generateParserKey(primaryDomain, urlPatterns, authors);

    // 9. Create object
    return {
      id,
      title: meta.title ?? parsed.title ?? domains[0] ?? "Unknown",
      description: meta.description ?? parsed.description ?? "",
      authors,
      authorsLinks: meta.authorsLinks?.length ? [...meta.authorsLinks] : (parsed.authorsLinks ?? []),
      homepage: meta.homepage ?? parsed.homepage ?? "",
      domain: domains,
      urlPatterns,
      mode: meta.mode ?? parsed.mode ?? "listen",
      watchAutoDetect: meta.watchAutoDetect ?? "disable",
      debug: false,
      code: parsed.code,
      version: meta.version ?? "1.0.0",
      iframeSelectors,
      category,
      tags,

      // Store tracking fields
      source: "store",
      storeSource: "github",
      storeRepoId: repoId,
      storeRepoUrl: repo?.url ?? "",
      storeScriptId: meta.id ?? null,
      storeFilePath: meta.file,
    };
  }

  // Public API Helpers
  getAlarmsApi() {
    return this._alarmsApi;
  }
  getActionApi() {
    return this._actionApi;
  }

  async clearCache() {
    clearTimeout(this._saveReposTimer);
    clearTimeout(this._saveETagsTimer);
    this._repoCache = null;
    this._etagCache = null;
    this._pendingSaveRepos = null;
    this._pendingSaveETags = null;
    _idbInstance = null;
  }
  async firstTimeSetup() {
    const { storeServiceSetup } = await browser.storage.local.get("storeServiceSetup");
    if (!storeServiceSetup) {
      try {
        const url = browser.runtime.getURL(`activityLibrary/library.html?setup=1`);
        const [existing] = await browser.tabs.query({ url });
        if (existing) {
          await browser.tabs.update(existing.id, { active: true });
          await browser.windows.update(existing.windowId, { focused: true }).catch(() => {});
        } else {
          await browser.tabs.create({ url });
        }
      } catch (err) {
        logError("[GitHubStore]: Open store failed:", err);
      }
    }
  }
}

const storeService = new GitHubStoreService();
