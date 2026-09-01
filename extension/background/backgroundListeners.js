// UserScript Actions
const handleListUserScripts = async (req) => {
  const { showStoreParsers, showOnlyStore } = req;
  logInfo("[background:handleListUserScripts]: Fetching scripts...");
  const scripts = await scriptManager.storage.getScripts();
  const filteredScripts = showOnlyStore
    ? scripts.filter((script) => script.storeFilePath)
    : showStoreParsers
      ? scripts
      : scripts.filter((script) => !script.storeFilePath);

  const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
  const scriptsWithStatus = filteredScripts.map((script) => ({
    ...script,
    enabled: parserEnabledState[`enable_${script.id}`] !== false,
  }));
  logInfo("[background:handleListUserScripts]: Script list fetched successfully. Count:", scriptsWithStatus.length);
  return { ok: true, list: scriptsWithStatus };
};

const handleSaveUserScript = async (req) => {
  const scriptData = req.script;
  const previousId = req.previousId;
  logInfo("[background:handleSaveUserScript]: Saving script id:", scriptData?.id, "previousId:", previousId ?? "none");
  const fromImport = req.fromImport;
  const scriptsList = await scriptManager.storage.getScripts();

  const cleanDomain = (d) => {
    if (!d) return "";
    return d
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .trim();
  };

  if (Array.isArray(scriptData.domain)) {
    scriptData.domain = scriptData.domain.map(cleanDomain).filter(Boolean);
  } else if (typeof scriptData.domain === "string") {
    const rawDomains = scriptData.domain.split(",");
    scriptData.domain = rawDomains.length > 1 ? rawDomains.map(cleanDomain).filter(Boolean) : cleanDomain(scriptData.domain);
  }
  scriptData.urlPatterns = scriptData.urlPatterns ? PatternValidator.normalizePatterns(scriptData.urlPatterns) : ["/.*/"];
  if (previousId) {
    const prevIndex = scriptsList.findIndex((s) => s.id === previousId);
    if (prevIndex >= 0) {
      await scriptManager.unregisterUserScript(scriptsList[prevIndex]);

      // Transfer old settings
      const { parserSettings = {}, parserEnabledState = {} } = await browser.storage.local.get(["parserSettings", "parserEnabledState"]);

      const enableSettings = parserEnabledState[`enable_${previousId}`] !== false;
      const oldSettings = {
        [`enable_${previousId}`]: enableSettings,
        [`settings_${previousId}`]: parserSettings[`settings_${previousId}`],
      };

      scriptsList.splice(prevIndex, 1);
      await scriptManager.storage.saveScripts(scriptsList);
      scriptData._oldSettings = oldSettings;
    }
  }

  // Normalize URL patterns
  scriptData.urlPatterns = scriptData.urlPatterns ? PatternValidator.normalizePatterns(scriptData.urlPatterns) : ["/.*/"];

  // Saving Script
  const newIndex = scriptsList.findIndex((s) => s.id === scriptData.id);

  // Duplicate content check
  const contentDuplicate = scriptsList.find(
    (s) =>
      s.id !== (previousId || scriptData.id) &&
      s.title === scriptData.title &&
      s.domain?.toString() === scriptData.domain?.toString() &&
      JSON.stringify(s.urlPatterns) === JSON.stringify(scriptData.urlPatterns),
  );

  if (!fromImport && !scriptData.storeFilePath && (contentDuplicate || (newIndex >= 0 && !previousId))) {
    logInfo("[background:handleSaveUserScript]: Duplicate detected, aborting save for:", scriptData.id);
    return { ok: false, error: "userscript.editor.warn.saveFailed.duplicate" };
  }

  const newScript = {
    ...scriptData,
    lastUpdated: Date.now(),
  };

  delete newScript._oldSettings;

  if (newIndex >= 0) {
    await scriptManager.unregisterUserScript(scriptsList[newIndex]);
    scriptsList[newIndex] = newScript;
  } else {
    newScript.created = Date.now();
    scriptsList.push(newScript);
  }

  await scriptManager.storage.saveScripts(scriptsList);

  // Enable Settings
  const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
  const isEnabled = parserEnabledState[`enable_${scriptData.id}`] !== false;

  // Transfer old settings
  if (scriptData._oldSettings) {
    const { _oldSettings } = scriptData;

    // Enable flag
    if (_oldSettings[`enable_${previousId}`] !== undefined) {
      const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
      parserEnabledState[`enable_${scriptData.id}`] = _oldSettings[`enable_${previousId}`];
      await browser.storage.local.set({ parserEnabledState });
    }

    // Parser settings
    if (_oldSettings[`settings_${previousId}`]) {
      const { parserSettings = {} } = await browser.storage.local.get("parserSettings");
      parserSettings[`settings_${scriptData.id}`] = _oldSettings[`settings_${previousId}`];
      await browser.storage.local.set({ parserSettings });
    }

    delete scriptData._oldSettings;
  }

  // Register / Unregister
  try {
    let isRegistered = false;
    if (isEnabled) {
      const registerResult = await scriptManager.registerUserScript(scriptData);
      isRegistered = registerResult?.ok && !registerResult.skipped;
      logInfo("[background:handleSaveUserScript]: Register result for", scriptData.id, "- ok:", registerResult?.ok, "skipped:", registerResult?.skipped ?? false);
    } else {
      await scriptManager.unregisterUserScript(scriptData);
      logInfo("[background:handleSaveUserScript]: Script disabled, unregistered:", scriptData.id);
    }

    //  Save current status
    const updatedList = await scriptManager.storage.getScripts();
    const updatedScript = updatedList.find((s) => s.id === scriptData.id);
    if (updatedScript) {
      updatedScript.registered = isRegistered;
      await scriptManager.storage.saveScripts(updatedList);
    }

    scriptData.registered = isRegistered;
    return { ok: true, script: scriptData };
  } catch (err) {
    logError("[background:userScript]: Error during register/unregister after save:", err);
    return { ok: false, error: err.message };
  }
};

const handleDeleteUserScript = async (req) => {
  logInfo("[background:handleDeleteUserScript]: Deleting script id:", req.id);
  const scriptsList = await scriptManager.storage.getScripts();
  const deleteIndex = scriptsList.findIndex((s) => s.id === req.id);

  if (deleteIndex === -1) {
    logInfo("[background:handleDeleteUserScript]: Script not found:", req.id);
    return { ok: false, error: "[background:userScript]: Script not found" };
  }

  // Unregister
  await scriptManager.unregisterUserScript(scriptsList[deleteIndex]);

  // Clear browser storage
  const parserList = (await browser.storage.local.get("parserList")).parserList || [];
  const filteredParserList = parserList.filter((p) => p.id !== scriptsList[deleteIndex].id);
  await browser.storage.local.set({ parserList: filteredParserList });

  // Remove enable flag
  const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
  const enableKey = `enable_${scriptsList[deleteIndex].id}`;
  delete parserEnabledState[enableKey];
  await browser.storage.local.set({ parserEnabledState });

  // Remove settings from parserSettings
  const { parserSettings = {} } = await browser.storage.local.get("parserSettings");
  const settingsKey = `settings_${scriptsList[deleteIndex].id}`;

  if (settingsKey in parserSettings) {
    delete parserSettings[settingsKey];
    await browser.storage.local.set({ parserSettings });
  }

  // Delete from the list
  scriptsList.splice(deleteIndex, 1);
  await scriptManager.storage.saveScripts(scriptsList);

  return { ok: true };
};

const handleRegisterUserScript = async (req) => {
  logInfo("[background:handleRegisterUserScript]: Registering script id:", req.id);
  const scriptsList = await scriptManager.storage.getScripts();
  const scriptToRegister = scriptsList.find((s) => s.id === req.id);

  if (!scriptToRegister) {
    logInfo("[background:handleRegisterUserScript]: Script not found:", req.id);
    return { ok: false, error: "Script not found" };
  }

  const registerResult = await scriptManager.registerUserScript(scriptToRegister);
  logInfo("[background:handleRegisterUserScript]: Result for", req.id, "- ok:", registerResult.ok, "skipped:", registerResult.skipped);

  if (!registerResult.ok) {
    return { ok: false, error: registerResult.error };
  }

  // Update registration status
  scriptToRegister.registered = !registerResult.skipped;
  await scriptManager.storage.saveScripts(scriptsList);

  return {
    ok: true,
    registered: !registerResult.skipped,
    registrationId: scriptToRegister.id,
  };
};

const handleUnregisterUserScript = async (req) => {
  logInfo("[background:handleUnregisterUserScript]: Unregistering script id:", req.id);
  const scriptsList = await scriptManager.storage.getScripts();
  const scriptToUnregister = scriptsList.find((s) => s.id === req.id);

  if (!scriptToUnregister) {
    logInfo("[background:handleUnregisterUserScript]: Script not found:", req.id);
    return { ok: false, error: "Script not found" };
  }

  const unregisterResult = await scriptManager.unregisterUserScript(scriptToUnregister);

  if (!unregisterResult.ok) {
    return { ok: false, error: unregisterResult.error };
  }

  scriptToUnregister.registered = false;
  await scriptManager.storage.saveScripts(scriptsList);

  return { ok: true };
};

const handleToggleUserScript = async (req) => {
  logInfo("[background:handleToggleUserScript]: Toggle script id:", req.id, "enabled:", req.enabled);
  const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
  const enableKey = `enable_${req.id}`;
  const isEnabled = parserEnabledState[enableKey] !== false;
  const newEnabledState = req.enabled !== undefined ? req.enabled : !isEnabled;

  if (newEnabledState) {
    delete parserEnabledState[enableKey];
  } else {
    parserEnabledState[enableKey] = false;
  }
  await browser.storage.local.set({ parserEnabledState });

  const scriptsList = await scriptManager.storage.getScripts();
  const script = scriptsList.find((s) => s.id === req.id);

  if (script) {
    if (newEnabledState) {
      const result = await scriptManager.registerUserScript(script);
      script.registered = result.ok && !result.skipped;
    } else {
      await scriptManager.unregisterUserScript(script, true);
      script.registered = false;
    }

    await scriptManager.storage.saveScripts(scriptsList);
  }

  return { ok: true, enabled: newEnabledState };
};

// GitHub Store Handlers
/** Lists all registered repositories */
const handleStoreListRepos = async () => {
  try {
    const list = await storeService.listRepos();
    return { ok: true, list };
  } catch (err) {
    logError("[background:githubStore]: handleStoreListRepos:", err);
    return { ok: false, error: err.message };
  }
};

/** Adds a new GitHub repo. */
const handleStoreAddRepo = async (req) => {
  if (!req.url?.trim()) return { ok: false, error: "URL required" };
  try {
    return await storeService.addRepo(req.url.trim());
  } catch (err) {
    logError("[background:githubStore]: handleStoreAddRepo:", err);
    return { ok: false, error: err.message };
  }
};

/** Removes the repo */
const handleStoreRemoveRepo = async (req) => {
  if (!req.repoId) return { ok: false, error: "repoId required" };

  if (req.repoId === "KanashiiDev__web-presence-activities__main") {
    return { ok: false, error: "[background:githubStore]: The default main repository cannot be deleted from the system!" };
  }

  try {
    const scriptsList = await scriptManager.storage.getScripts();
    const scriptsToDelete = scriptsList.filter((s) => s.storeRepoId === req.repoId);
    logInfo("[background:handleStoreRemoveRepo]: Removing repo:", req.repoId, "- scripts to delete:", scriptsToDelete.length);

    for (const script of scriptsToDelete) {
      await handleDeleteUserScript({ id: script.id });
    }

    const result = await storeService.removeRepo(req.repoId);

    if (scriptsToDelete.length > 0) {
      await parserReady(true).catch(() => {});
    }

    return result;
  } catch (err) {
    logError("[background:githubStore]: handleStoreRemoveRepo:", err);
    return { ok: false, error: err.message };
  }
};

/** Checks for updates for all repositories */
const handleStoreCheckUpdates = async () => {
  try {
    logInfo("[background:handleStoreCheckUpdates]: Checking all repos for updates");
    const result = await storeService.checkAllReposForUpdates();

    return result;
  } catch (err) {
    logError("[background:githubStore]: handleStoreCheckUpdates:", err);
    return { ok: false, error: err.message };
  }
};

/** Single repo update check. */
const handleStoreCheckRepoUpdates = async (req) => {
  if (!req.repoId) return { ok: false, error: "repoId required" };
  try {
    return await storeService.checkRepoForUpdates(req.repoId);
  } catch (err) {
    logError("[background:githubStore]: handleStoreCheckRepoUpdates:", err);
    return { ok: false, error: err.message };
  }
};

/**
 * Installs a script from the Store.
 * req.repoId    → repo
 * req.scriptMeta → the script object in index.json
 */
const handleStoreInstallScript = async (req) => {
  if (!req.repoId) return { ok: false, error: "repoId required" };
  if (!req.scriptMeta?.file) return { ok: false, error: "scriptMeta.file required" };
  try {
    logInfo("[background:handleStoreInstallScript]: Installing", req.scriptMeta?.file, "from repo:", req.repoId);
    const result = await storeService.installScript(req.repoId, req.scriptMeta);

    if (result.ok && result.scriptObj) {
      const saveResult = await handleSaveUserScript({
        script: result.scriptObj,
        previousId: null,
      });
      if (saveResult.ok) {
        await parserReady(true).catch(() => {});
      }
      return saveResult;
    }
    return result;
  } catch (err) {
    logError("[background:githubStore]: handleStoreInstallScript:", err);
    return { ok: false, error: err.message };
  }
};

const handleStoreUpdateScript = async (req) => {
  if (!req.repoId) return { ok: false, error: "repoId required" };
  if (!req.scriptMeta?.file) return { ok: false, error: "scriptMeta.file required" };
  try {
    logInfo("[background:handleStoreUpdateScript]: Updating", req.scriptMeta?.file, "from repo:", req.repoId);
    const result = await storeService.updateScript(req.repoId, req.scriptMeta);

    if (result.ok && result.scriptObj) {
      const saveResult = await handleSaveUserScript({
        script: result.scriptObj,
        previousId: result.previousId,
      });
      if (saveResult.ok) {
        await parserReady(true).catch(() => {});
      }
      return saveResult;
    }
    return result;
  } catch (err) {
    logError("[background:githubStore]: handleStoreUpdateScript:", err);
    return { ok: false, error: err.message };
  }
};

const handleStoreBatchUpdate = async (req) => {
  if (!Array.isArray(req.updates) || !req.updates.length) {
    return { ok: false, error: "updates array required" };
  }
  logInfo("[background:handleStoreBatchUpdate]: Batch updating", req.updates.length, "scripts");

  const results = { successful: [], failed: [] };

  for (const { repoId, scriptMeta } of req.updates) {
    const r = await handleStoreUpdateScript({ repoId, scriptMeta }).catch((err) => ({
      ok: false,
      error: err.message,
    }));

    if (r.ok) {
      results.successful.push(scriptMeta.id || scriptMeta.title);
    } else {
      results.failed.push({ id: scriptMeta.id || scriptMeta.title, error: r.error });
    }
  }

  if (results.successful.length) {
    logInfo("[background:handleStoreBatchUpdate]: Completed - successful:", results.successful.length, "failed:", results.failed.length);
    await parserReady(true).catch(() => {});
  }

  return { ok: true, ...results };
};

/**
 * Returns information about the script in the Store (whether it is installed, whether it is up to date).
 * req.repoId    → repo
 * req.scriptId  → the id in index.json
 */
const handleStoreGetScriptStatus = async (req) => {
  if (!req.repoId || !req.scriptId) return { ok: false, error: "repoId and scriptId required" };

  try {
    const installedList = (await browser.storage.local.get("userScriptsList")).userScriptsList || [];
    const local = installedList.find((s) => s.id === req.scriptId || s.storeScriptId === req.scriptId);

    const repos = await storeService._loadRepos();
    const repo = repos[req.repoId];
    const remoteMeta = repo?.scripts?.find((s) => s.id === req.scriptId);

    return {
      ok: true,
      installed: !!local,
      hasUpdate: local && remoteMeta ? storeService._isNewer(remoteMeta.version, local.version) : false,
      localVersion: local?.version || null,
      remoteVersion: remoteMeta?.version || null,
    };
  } catch (err) {
    logError("[background:githubStore]: handleStoreGetScriptStatus:", err);
    return { ok: false, error: err.message };
  }
};

const handleStoreRemoveScript = async (req) => {
  if (!req.scriptId) return { ok: false, error: "scriptId required" };

  try {
    const scriptsList = await scriptManager.storage.getScripts();
    const scriptToDelete = scriptsList.find((s) => (s.id ?? s.storeScriptId) === req.scriptId);

    if (!scriptToDelete) {
      return { ok: false, error: "Script not found" };
    }

    const result = await handleDeleteUserScript({ id: scriptToDelete.id });

    if (result.ok) {
      await parserReady(true).catch(() => {});
    }

    return result;
  } catch (err) {
    logError("[background:githubStore]: handleStoreRemoveScript:", err);
    return { ok: false, error: err.message };
  }
};

// History Actions
const handleAddToHistory = async (req) => {
  await addToHistory(req.data);
  return { ok: true };
};

const handleLoadHistory = async () => {
  const history = await historyData();
  return { ok: true, data: history };
};

const handleSaveHistory = async (req) => {
  await saveHistory(req.data);
  return { ok: true };
};

const handleFilterHistoryReplace = async (request) => {
  const action = request.mode || "update";
  const entries = Array.isArray(request.entries) ? request.entries : [];
  const parsers = Array.isArray(request.parsers) ? request.parsers : [];
  const parserList = Array.isArray(request.parserList) ? request.parserList : [];

  //  Check for empty entries
  if (!entries.length) {
    return { ok: true, count: 0, message: "No entries provided" };
  }

  // At least one entry must have either the artist or the title filled in
  const hasValidEntry = entries.some(
    (e) => (typeof e.artist === "string" && e.artist.trim() && e.artist.trim() !== "*") || (typeof e.title === "string" && e.title.trim() && e.title.trim() !== "*"),
  );
  if (!hasValidEntry) {
    return { ok: false, count: 0, error: "At least one entry must have artist or title" };
  }

  // Load current history entries
  let history;
  try {
    history = await loadHistory();
  } catch (err) {
    return { ok: false, count: 0, error: "Failed to load history: " + err.message };
  }

  if (!Array.isArray(history) || history.length === 0) {
    return { ok: true, count: 0, message: "History is empty" };
  }

  // Convert parser IDs to source names
  const sourceNames = new Set();
  const applyToAll = parsers.includes("*");

  if (!applyToAll) {
    // Error if the parser list is empty
    if (!parsers.length) return { ok: false, count: 0, error: "No parsers specified" };

    parsers.forEach((id) => {
      const parser = parserList.find((p) => p.id === id);
      if (parser) {
        const domainStr = Array.isArray(parser.domain) ? parser.domain[0] : parser.domain;
        const name = (parser.title || domainStr || "").toLowerCase().trim();
        if (name) sourceNames.add(name);
      }
    });

    // Error if no source is found
    if (sourceNames.size === 0) return { ok: false, count: 0, error: "No valid sources found" };
  }

  let changeCount = 0;
  const indicesToRemove = new Set();

  // Find the matches in history for each replace entry
  entries.forEach((entry) => {
    const origA = typeof entry.artist === "string" ? entry.artist.trim().toLowerCase() : "";
    const origT = typeof entry.title === "string" ? entry.title.trim().toLowerCase() : "";
    const newA = typeof entry.replaceArtist === "string" ? entry.replaceArtist.trim() : "";
    const newT = typeof entry.replaceTitle === "string" ? entry.replaceTitle.trim() : "";

    if (action === "update" && !newA && !newT) {
      return;
    }
    if (action === "revert" && !origA && !origT) {
      return;
    }
    if (!origA && !origT) {
      return;
    }

    history.forEach((record, idx) => {
      const histA = typeof record.a === "string" ? record.a.trim().toLowerCase() : "";
      const histT = typeof record.t === "string" ? record.t.trim().toLowerCase() : "";
      const histS = typeof record.s === "string" ? record.s.trim().toLowerCase() : "";

      let hasConcreteMatch = false;

      if (action === "revert") {
        const replaceA = newA.toLowerCase();
        const replaceT = newT.toLowerCase();

        const hasA = replaceA && replaceA !== "*";
        const hasT = replaceT && replaceT !== "*";

        if (hasA && hasT) {
          hasConcreteMatch = histA === replaceA && histT === replaceT;
        } else if (hasA) {
          hasConcreteMatch = histA === replaceA;
        } else if (hasT) {
          hasConcreteMatch = histT === replaceT;
        } else {
          hasConcreteMatch = false;
        }
      } else {
        const hasOrigA = origA && origA !== "*";
        const hasOrigT = origT && origT !== "*";

        if (hasOrigA && hasOrigT) {
          hasConcreteMatch = histA === origA && histT === origT;
        } else if (hasOrigA) {
          hasConcreteMatch = histA === origA;
        } else if (hasOrigT) {
          hasConcreteMatch = histT === origT;
        }
      }

      if (!hasConcreteMatch) return;

      // Source matching check
      let sourceOk = applyToAll;
      if (!applyToAll) {
        for (const s of sourceNames) {
          if (s.length >= 3 && histS.length >= 3 && (histS.includes(s) || s.includes(histS))) {
            sourceOk = true;
            break;
          }
        }
      }
      if (!sourceOk) return;

      if (action === "update") {
        let changed = false;
        if (newA && newA !== record.a) {
          record.a = newA;
          changed = true;
        }
        if (newT && newT !== record.t) {
          record.t = newT;
          changed = true;
        }
        if (changed) changeCount++;
      } else if (action === "revert") {
        let changed = false;
        // Revert to original values
        if (origA && origA !== record.a.toLowerCase()) {
          record.a = entry.artist.trim();
          changed = true;
        }
        if (origT && origT !== record.t.toLowerCase()) {
          record.t = entry.title.trim();
          changed = true;
        }
        if (changed) changeCount++;
      } else if (action === "clean") {
        indicesToRemove.add(idx);
        changeCount++;
      }
    });
  });

  if (changeCount > 0) {
    if (action === "clean") {
      Array.from(indicesToRemove)
        .sort((a, b) => b - a)
        .forEach((i) => history.splice(i, 1));
    }

    try {
      await saveHistory(history);
    } catch (err) {
      return { ok: false, count: 0, error: "Failed to save history: " + err.message };
    }
  }

  return {
    ok: true,
    count: changeCount,
    message:
      changeCount > 0
        ? action === "update"
          ? `${changeCount} record(s) updated`
          : action === "revert"
            ? `${changeCount} record(s) reverted`
            : `${changeCount} record(s) removed`
        : `No matching records found to ${action}`,
  };
};

const handleAddHistoryToServer = async ({ image, title, artist, source, link, date, mode }) => {
  try {
    const response = await fetchWithTimeout(
      `http://localhost:${state.serverPort}/add-history`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          artist,
          image: image || "",
          source: source || "",
          link: link || "",
          date,
          mode,
        }),
      },
      CONFIG.requestTimeout,
    );

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const result = await response.json();
    return { ok: result.success, action: result.action };
  } catch (err) {
    logError("[background:handleAddHistoryToServer]: Add history error:", err);
    return { ok: false, error: err.message };
  }
};

const handleSyncHistory = async () => {
  logInfo("[background:handleSyncHistory]: Starting history sync with server");
  try {
    const history = await loadHistory();
    const fullHistory = history.map((entry) => ({
      title: entry.t || "",
      artist: entry.a || "",
      image: entry.i || "",
      source: entry.s || "",
      link: entry.u || "",
      date: entry.p,
      mode: entry.m,
      total_listened_ms: entry.ms || 0,
    }));

    const response = await fetchWithTimeout(
      `http://localhost:${state.serverPort}/sync-history`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: fullHistory }),
      },
      CONFIG.requestTimeout,
    );

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const result = await response.json();

    if (result.success && Array.isArray(result.serverHistory)) {
      const shortHistory = result.serverHistory
        .reduce((acc, entry) => {
          const title = entry.title?.trim();
          const artist = entry.artist?.trim();
          const source = entry.source?.trim();

          if (title && artist && source) {
            acc.push({
              t: title,
              a: artist,
              i: entry.image || "",
              s: source,
              u: entry.link || "",
              p: entry.date,
              ms: entry.total_listened_ms || 0,
            });
          }

          return acc;
        }, [])
        .reverse();

      await saveHistory(shortHistory);
    }

    return {
      ok: true,
      synced: true,
      count: result.count || 0,
    };
  } catch (err) {
    logError("[background:handleSyncHistory]: History sync error:", err);
    return { ok: false, error: err.message };
  }
};

const handleSyncDeleteToServer = async (req) => {
  const deletedEntries = req.data;
  try {
    const serverEntries = deletedEntries.map((entry) => ({
      title: entry.t || "",
      artist: entry.a || "",
      date: entry.p,
    }));

    await fetchWithTimeout(
      `http://localhost:${state.serverPort}/delete-history-entries`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: serverEntries }),
      },
      CONFIG.requestTimeout,
    );
    return { ok: true };
  } catch (err) {
    logError("[background:handleSyncDeleteToServer]: Server history delete error:", err);
    return { ok: false };
  }
};

// Song Info
const handleGetSongInfo = async () => {
  const map = state.activeTabMap;
  if (map.size === 0) {
    return { ok: false, error: "No active tab map or it's empty" };
  }

  // Iterate over the Map to find the current song
  for (const [key, value] of map.entries()) {
    const current = value;
    if (current && current.title && current.artist) {
      return { ok: true, data: current };
    }
  }

  return { ok: false, error: "No current song" };
};

// Update RPC
const handleUpdateRpc = async (req, sender) => {
  const tab = await getSenderTab(sender);
  if (!tab) {
    logWarn("[background]: No tab info from sender, skipping:", req);
    return { ok: false, error: "No tab info" };
  }

  const tabId = tab.id;
  // Get the tab info
  let tabInfo;
  try {
    tabInfo = await browser.tabs.get(tabId);
  } catch {
    return { ok: false, error: "Tab not found" };
  }

  const now = Date.now();
  const { title, artist, progress, duration } = req.data;
  const current = state.activeTabMap.get(tabId) || {};
  let parserId = current.parserId;

  // Match the parser via the tab URL
  if (tabInfo.url) {
    try {
      const url = new URL(tabInfo.url);
      const hostname = normalizeHost(url.hostname);

      const exactMatch = state.parserList.find((p) => {
        try {
          const domains = Array.isArray(p.domain) ? p.domain : [p.domain];
          return domains.some((d) => isDomainMatch(d, hostname));
        } catch {
          return false;
        }
      });

      if (exactMatch) parserId = exactMatch.id;
    } catch {}
  }

  // 1️) Audible check
  const isAudible = tabInfo.audible ?? false;
  const isPlaying = !!(isAudible || req.data?.isPlaying);

  if (isAudible && state.audibleTimers.has(tabId)) {
    clearTimeout(state.audibleTimers.get(tabId));
    state.audibleTimers.delete(tabId);
    logInfo(`[background]: Tab ${tabId} resumed audio in UPDATE_RPC, timer cancelled`);
  }

  // If it is not on the map and there is no play, reject it
  if (!isPlaying && !state.activeTabMap.has(tabId)) {
    logInfo(`[background]: Tab ${tabId} UPDATE_RPC: not audible, not playing, not in map, rejecting`);

    state.activeTabMap.set(tabId, {
      ...req.data,
      isAudioPlaying: false,
      lastKey: `${title}|${artist}`,
      lastUpdated: now,
      progress,
      parserId,
    });
    return { ok: false, waiting: true };
  }

  // 2️) Update state
  state.activeTabMap.set(tabId, {
    ...req.data,
    isAudioPlaying: isPlaying,
    lastKey: `${title}|${artist}`,
    lastUpdated: now,
    progress,
    parserId,
  });

  if (!isPlaying) {
    if (state.activeTabMap.has(tabId)) {
      logInfo(`[background]: Tab ${tabId} UPDATE_RPC: not playing but already tracked, keeping RPC`);
      return { ok: true };
    }
    logInfo(`[background]: Tab ${tabId} UPDATE_RPC: not audible, not playing, waiting`);
    return { ok: true, waiting: true };
  }

  // 3) RPC update
  scheduleRpcUpdate(req.data, tabId)?.catch((err) => logError("[background:scheduleRpcUpdate]: RPC schedule failed", err));

  // 4️) Add History
  if (req.data.title !== "_Unknown Title_" && req.data.artist !== "_Unknown Artist_" && req.data.artist !== "-1") {
    scheduleHistoryAdd(tabId, {
      title: req.data.title,
      artist: req.data.artist,
      image: req.data.image,
      source: req.data.source || "",
      link: req.data.link || req.data.songUrl || "",
      mode: req.data.mode || "listen",
    });
  }

  return { ok: true };
};

const handleGetRpcPort = async () => {
  return { ok: true, port: state.serverPort || 3000 };
};

const handleUpdateRpcPort = async (req) => {
  try {
    const response = await fetchWithTimeout(
      `http://localhost:${state.serverPort}/update-port`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.data),
      },
      CONFIG.requestTimeout,
    );

    return { ok: true, port: req.data.port };
  } catch (err) {
    logError("[background:handleUpdateRpcPort]: Update port error:", err);
    return { ok: false, error: err.message };
  }
};

const handleUpdatediscordWebPort = async (req) => {
  try {
    const response = await fetchWithTimeout(
      `http://localhost:${state.serverPort}/update-web-bridge-port`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.data),
      },
      CONFIG.requestTimeout,
    );

    return { ok: true, port: req.data.port };
  } catch (err) {
    logError("[background:handleUpdateDiscordWebPort]: Update web bridge port error:", err);
    return { ok: false, error: err.message };
  }
};

const handleIsTabAudible = async (sender) => {
  try {
    const tab = await getSenderTab(sender);
    return { audible: tab?.audible ?? false };
  } catch {
    return { audible: false };
  }
};

const handleClearRpc = async (sender) => {
  const tab = await getSenderTab(sender);
  if (!tab) {
    logWarn("[background]: No tab info from sender, skipping");
    return { ok: false, error: "No tab info" };
  }

  await clearRpcForTab(tab.id, "CLEAR_RPC triggered");
  return { ok: true };
};

const handleIsRpcConnected = async () => {
  try {
    const res = await fetchWithTimeout(`http://localhost:${state.serverPort}/health`, {}, CONFIG.requestTimeout);

    if (!res) {
      return { ok: false, reason: "No response from RPC server" };
    }

    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { ok: !!data.rpcConnected };
  } catch (err) {
    return { ok: false, reason: err.message || "Unknown error" };
  }
};

const handleIsHostnameMatch = async (sender) => {
  const noTabError = { ok: false, error: { code: 0, message: "No tab info" } };

  const tab = await getSenderTab(sender);
  if (!tab?.id) return noTabError;

  let tabInfo;
  try {
    tabInfo = await browser.tabs.get(tab.id);
  } catch {
    return noTabError;
  }

  if (!tabInfo?.url) return noTabError;

  let url;
  try {
    url = new URL(tabInfo.url);
  } catch {
    return noTabError;
  }

  // Allowed Domain Control
  const allowed = await isAllowedDomain(url.hostname, url.pathname);
  if (!allowed.ok) {
    return { ok: false, match: allowed.match, error: allowed.error };
  }

  // Audible Control
  const { activeTabMap } = state;
  if (activeTabMap.size > 0 && !activeTabMap.has(tab.id)) {
    for (const [activeTabId, tabData] of activeTabMap) {
      if (!tabData.isAudioPlaying) continue;

      try {
        const activeTab = await browser.tabs.get(activeTabId);
        const pingRes = await safePingTab(activeTabId).catch(() => null);
        const isActuallyPlaying = activeTab.audible || pingRes?.isPlaying === true;

        if (isActuallyPlaying) {
          const source = tabData.source ? ` | ${tabData.source}` : "";
          return {
            ok: false,
            error: {
              code: 1,
              message: `⏸️ Another tab (${activeTabId}${source}) is currently playing audio.`,
            },
          };
        }

        logInfo(`[background]: Tab ${activeTabId} in map but not audible, updating state`);
        tabData.isAudioPlaying = false;
        activeTabMap.set(activeTabId, tabData);
      } catch {
        logInfo(`[background]: Tab ${activeTabId} not found, removing from map`);
        activeTabMap.delete(activeTabId);
      }
    }
  }

  return { ok: true, match: allowed.match };
};

// Main Setup Function
const setupListeners = () => {
  const alarmsApi = (typeof chrome !== "undefined" && chrome.alarms) || browser?.alarms;
  if (alarmsApi?.onAlarm) {
    alarmsApi.onAlarm.addListener((alarm) => storeService.onAlarm(alarm));
  }

  browser.runtime.onMessage.addListener(async (req, sender) => {
    try {
      if (req.type === "REQUEST_FRESH_PARSER_LIST") {
        await loadParserListOnce(req.force);
        return { ok: true, data: state.parserList || [] };
      }
      if (req.type === "FETCH_IFRAME_DATA") {
        if (sender.tab?.id != null) {
          const tabId = sender.tab.id;
          browser.webNavigation
            .getAllFrames({ tabId })
            .then((frames) => {
              for (const frame of frames) {
                if (frame.frameId === 0) continue;
                browser.tabs.sendMessage(tabId, req, { frameId: frame.frameId }).catch(() => {});
              }
            })
            .catch(() => {});
        }
        return { ok: true };
      }

      if (req.type === "IFRAME_DATA") {
        if (sender.tab?.id != null) {
          browser.tabs.sendMessage(sender.tab.id, req, { frameId: 0 }).catch(() => {});
        }
        return { ok: true };
      }
      if (req.type === "ACCESS_WINDOW") {
        try {
          const { path, callFunction, args } = req.payload;

          const results = await browser.scripting.executeScript({
            target: { tabId: sender.tab.id },
            world: "MAIN",
            func: (targetPath, shouldCallStr, fnArgs) => {
              function safeSerialize(obj, maxDepth = 3, currentDepth = 0, seen = new WeakSet()) {
                if (currentDepth >= maxDepth) return "[Max Depth]";
                if (obj === null) return null;
                if (obj === undefined) return undefined;

                const type = typeof obj;
                if (type === "string" || type === "number" || type === "boolean") return obj;
                if (type === "function") return `[Function: ${obj.name || "anonymous"}]`;

                if (seen.has(obj)) return "[Circular]";
                seen.add(obj);

                if (Array.isArray(obj)) {
                  return obj.slice(0, 100).map((item) => safeSerialize(item, maxDepth, currentDepth + 1, seen));
                }

                if (typeof obj === "object") {
                  const result = {};
                  const keys = Object.keys(obj).slice(0, 100);
                  for (const key of keys) {
                    try {
                      result[key] = safeSerialize(obj[key], maxDepth, currentDepth + 1, seen);
                    } catch (e) {
                      result[key] = `[Error: ${e.message}]`;
                    }
                  }
                  return result;
                }
                return obj;
              }

              try {
                const parts = targetPath.split(".");
                let current = window;
                let parent = window;

                for (let i = 0; i < parts.length; i++) {
                  parent = current;
                  current = current[parts[i]];

                  if (current === undefined || current === null) {
                    return { ok: false, __error: `'${parts.slice(0, i + 1).join(".")}' is ${current}` };
                  }
                }

                const isFunction = typeof current === "function";
                let shouldCall = false;
                if (shouldCallStr === "auto") {
                  shouldCall = isFunction;
                } else if (shouldCallStr === "true") {
                  shouldCall = true;
                }

                if (shouldCall) {
                  if (!isFunction) {
                    return { ok: false, __error: `'${targetPath}' is not a function` };
                  }
                  const returnValue = current.apply(parent, fnArgs);
                  return safeSerialize(returnValue);
                }

                return safeSerialize(current);
              } catch (e) {
                return { ok: false, __error: e.message };
              }
            },
            args: [path, callFunction === undefined ? "auto" : callFunction ? "true" : "false", args || []],
          });

          return results?.[0]?.result ?? { ok: false, error: "No script result" };
        } catch (err) {
          return { ok: false, __error: err.message };
        }
      }

      if (req.type === "INJECT_BRIDGE") {
        browser.scripting.executeScript({
          target: { tabId: sender.tab.id },
          func: (webPort) => {
            if (window._RPC_BRIDGE_LOADED_) return;
            window._RPC_BRIDGE_LOADED_ = true;

            const BRIDGE_URL = `ws://127.0.0.1:${webPort || 1337}`;
            const RETRY_DELAYS = [1000, 2000, 5000, 10000];
            const MAX_RETRY_DELAY = 10000;

            let Dispatcher, lookupAsset, lookupApp;
            const apps = {};
            let ws = null;
            let retryCount = 0;
            let retryTimer = null;

            // Webpack Helpers
            const eachCandidate = (mod, fn) => {
              if (!mod) return;
              try {
                fn(mod);
              } catch {}
              try {
                if (mod.default) fn(mod.default);
              } catch {}
              try {
                for (const key of Reflect.ownKeys(mod)) {
                  try {
                    fn(mod[key]);
                  } catch {}
                }
              } catch {}
            };

            const getWebpackRequire = () => {
              const reqs = [];
              const seen = new Set();

              window.webpackChunkdiscord_app.push([
                [Symbol()],
                {},
                (req) => {
                  if (req && !seen.has(req)) {
                    seen.add(req);
                    reqs.push(req);
                  }
                },
              ]);
              window.webpackChunkdiscord_app.pop();

              return reqs[0] || null;
            };

            const findModule = (wpRequire, ...needles) => {
              for (const id in wpRequire.m) {
                let source;
                try {
                  source = wpRequire.m[id]?.toString?.();
                } catch {
                  continue;
                }
                if (!source || !needles.every((n) => source.includes(n))) continue;
                try {
                  return wpRequire(id);
                } catch {}
              }
            };

            // Finding Dispatcher
            function findDispatcher(wpRequire) {
              // Method 1: Known module ID (228366)
              try {
                const mod = wpRequire(228366);
                if (mod && typeof mod === "object") {
                  for (const key in mod) {
                    const val = mod[key];
                    if (val && typeof val === "object" && typeof val.dispatch === "function" && val._subscriptions && val._actionHandlers) {
                      console.log(`[Web Presence - RPC Bridge] Found Dispatcher at module 228366.${key}`);
                      return val;
                    }
                  }
                }
              } catch {}

              // Method 2: Search for Flux dispatcher pattern in Cache
              for (const id in wpRequire.c) {
                const mod = wpRequire.c[id]?.exports;
                if (!mod || typeof mod !== "object") continue;

                if (mod._subscriptions && mod._actionHandlers && typeof mod.dispatch === "function" && typeof mod.subscribe === "function") {
                  console.log(`[Web Presence - RPC Bridge] Found Dispatcher at cache[${id}]`);
                  return mod;
                }
              }

              // Method 3: Find the module using LOCAL_ACTIVITY_UPDATE and analyze its source code
              let activityModuleId = null;
              let activitySource = null;

              for (const id in wpRequire.m) {
                try {
                  const source = wpRequire.m[id]?.toString?.();
                  if (source && source.includes("LOCAL_ACTIVITY_UPDATE")) {
                    activityModuleId = id;
                    activitySource = source;
                    console.log(`[Web Presence - RPC Bridge] Found LOCAL_ACTIVITY_UPDATE in module[${id}]`);
                    break;
                  }
                } catch {}
              }

              if (activityModuleId && activitySource) {
                // Search for the "dispatch(" pattern and find the variable before it
                const dispatchMatches = [...activitySource.matchAll(/([a-zA-Z_$][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)\.dispatch\(/g)];

                for (const match of dispatchMatches) {
                  const varName = match[1];
                  const propName = match[2];

                  console.log(`[Web Presence - RPC Bridge] Analyzing: ${varName}.${propName}.dispatch()`);

                  // Find which module this variable was imported from
                  // Pattern: varName=n(moduleId) or {varName}=n(moduleId)
                  const importPatterns = [
                    new RegExp(`${varName}=n\\((\\d+)\\)`, "g"),
                    new RegExp(`\\{[^}]*${varName}[^}]*\\}=n\\((\\d+)\\)`, "g"),
                    new RegExp(`,[^,]*${varName}=n\\((\\d+)\\)`, "g"),
                  ];

                  for (const pattern of importPatterns) {
                    let importMatch;
                    while ((importMatch = pattern.exec(activitySource)) !== null) {
                      const moduleId = parseInt(importMatch[1]);
                      console.log(`[Web Presence - RPC Bridge] Testing module[${moduleId}] for property '${propName}'`);

                      try {
                        const mod = wpRequire(moduleId);
                        if (mod && mod[propName]) {
                          const candidate = mod[propName];

                          if (
                            candidate &&
                            typeof candidate === "object" &&
                            typeof candidate.dispatch === "function" &&
                            (candidate._subscriptions || candidate._actionHandlers)
                          ) {
                            console.log(`[Web Presence - RPC Bridge] Found Dispatcher via code analysis at module[${moduleId}].${propName}`);
                            return candidate;
                          }
                        }
                      } catch {}
                    }
                  }
                }
              }

              // Method 4: Find by executing within Modules
              for (const id in wpRequire.m) {
                try {
                  const exports = wpRequire(id);
                  if (!exports || typeof exports !== "object") continue;

                  if (exports._subscriptions && exports._actionHandlers && typeof exports.dispatch === "function") {
                    console.log(`[Web Presence - RPC Bridge] Found Dispatcher at module[${id}]`);
                    return exports;
                  }

                  for (const key in exports) {
                    const val = exports[key];
                    if (val && typeof val === "object" && val._subscriptions && val._actionHandlers && typeof val.dispatch === "function") {
                      console.log(`[Web Presence - RPC Bridge] Found Dispatcher at module[${id}].${key}`);
                      return val;
                    }
                  }
                } catch {}
              }

              return null;
            }

            // Discord Internals
            function initDiscordInternals() {
              if (Dispatcher && lookupAsset && lookupApp) return true;

              const wpRequire = getWebpackRequire();
              if (!wpRequire) {
                console.warn("[Web Presence - RPC Bridge] Could not get webpack require");
                return false;
              }

              // Find the dispatcher
              if (!Dispatcher) {
                Dispatcher = findDispatcher(wpRequire);
              }

              // Find the asset lookup
              if (!lookupAsset) {
                const assetMod = findModule(wpRequire, "getAssetImage: size must === [");
                if (assetMod) {
                  eachCandidate(assetMod, (candidate) => {
                    if (!lookupAsset && typeof candidate === "function") {
                      const str = candidate.toString();
                      if (str.includes("APPLICATION_ASSETS_FETCH_SUCCESS")) {
                        lookupAsset = async (appId, name) => {
                          try {
                            const result = await candidate(appId, [name]);
                            return Array.isArray(result) ? result[0] : result;
                          } catch {
                            return null;
                          }
                        };
                      }
                    }
                  });
                }
              }

              // Find the app lookup
              if (!lookupApp) {
                const appMod = findModule(wpRequire, "Invalid Origin", "coverImage", ".application");
                if (appMod) {
                  eachCandidate(appMod, (candidate) => {
                    if (!lookupApp && typeof candidate === "function") {
                      const str = candidate.toString();
                      if (str.includes("Invalid Origin") && str.includes("coverImage")) {
                        lookupApp = async (appId) => {
                          try {
                            const socket = {};
                            await candidate(socket, appId);
                            return socket.application || socket;
                          } catch {
                            return null;
                          }
                        };
                      }
                    }
                  });
                }
              }

              if (!Dispatcher || !lookupAsset || !lookupApp) {
                console.warn(
                  `[Web Presence - RPC Bridge] Internals not ready yet: ${[!Dispatcher && "Dispatcher", !lookupAsset && "lookupAsset", !lookupApp && "lookupApp"]
                    .filter(Boolean)
                    .join(", ")}`,
                );
                return false;
              }

              console.log("[Web Presence - RPC Bridge] All internals initialized successfully");
              return true;
            }

            // Activity Dispatch
            async function handleMessage(msg) {
              try {
                // Start the internals
                if (!Dispatcher || !lookupAsset || !lookupApp) {
                  const initialized = initDiscordInternals();
                  if (!initialized) {
                    throw new Error("Discord internals not ready");
                  }
                }

                if (!msg.activity || msg.activity === null) {
                  Dispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null });
                  return;
                }

                // Process if there are assets
                if (msg.activity.assets) {
                  if (msg.activity.assets.large_image) {
                    msg.activity.assets.large_image = await lookupAsset(msg.activity.application_id, msg.activity.assets.large_image);
                  }
                  if (msg.activity.assets.small_image) {
                    msg.activity.assets.small_image = await lookupAsset(msg.activity.application_id, msg.activity.assets.small_image);
                  }
                }

                // Get app information
                const appId = msg.activity.application_id;
                if (appId) {
                  if (!apps[appId]) {
                    apps[appId] = await lookupApp(appId);
                  }
                  const app = apps[appId];

                  if (!msg.activity.name && app?.name) {
                    msg.activity.name = app.name;
                  }
                }

                Dispatcher.dispatch({
                  type: "LOCAL_ACTIVITY_UPDATE",
                  activity: msg.activity,
                });
              } catch (err) {
                console.error("[Web Presence - RPC Bridge] Failed to handle message:", err);
                Dispatcher = null;
              }
            }

            function clearActivity() {
              try {
                if (Dispatcher) {
                  Dispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null });
                }
              } catch (err) {
                console.error("[Web Presence - RPC Bridge] Failed to clear activity:", err);
              }
            }

            // WebSocket
            function getRetryDelay() {
              const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
              return Math.min(delay, MAX_RETRY_DELAY);
            }

            function scheduleRetry() {
              const delay = getRetryDelay();

              retryTimer = setTimeout(() => {
                retryTimer = null;
                connect();
              }, delay);
            }

            function connect() {
              if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

              ws = new WebSocket(BRIDGE_URL);

              ws.onopen = () => {
                ws.send(JSON.stringify({ type: "INIT_BRIDGE", origin: location.origin }));
                retryCount = 0;
              };

              ws.onmessage = async (x) => {
                try {
                  const msg = JSON.parse(x.data);
                  await handleMessage(msg);
                } catch (err) {
                  console.error("[Web Presence - RPC Bridge] Failed to handle message:", err);
                }
              };

              ws.onerror = () => {};

              ws.onclose = () => {
                clearActivity();
                retryCount++;
                scheduleRetry();
              };
            }

            connect();
            document.addEventListener("beforeunload", clearActivity);
          },
          args: [state.discordWebPort],
          world: "MAIN",
        });
      }

      if (req.type === "GET_TAB_ID") {
        return { ok: true, tabId: sender.tab?.id };
      }

      // Handle action-based requests
      if (req.action) {
        let result;
        switch (req.action) {
          case "listUserScripts":
            result = await handleListUserScripts(req);
            break;
          case "saveUserScript":
            result = await handleSaveUserScript(req);
            break;
          case "deleteUserScript":
            result = await handleDeleteUserScript(req);
            break;
          case "registerUserScript":
            result = await handleRegisterUserScript(req);
            break;
          case "unregisterUserScript":
            result = await handleUnregisterUserScript(req);
            break;
          case "toggleUserScript":
            result = await handleToggleUserScript(req);
            break;
          case "addToHistory":
            result = await handleAddToHistory(req);
            break;
          case "loadHistory":
            result = await handleLoadHistory();
            break;
          case "saveHistory":
            result = await handleSaveHistory(req);
            break;
          case "filterHistoryReplace":
            result = await handleFilterHistoryReplace(req);
            break;
          case "addHistoryToServer":
            result = await handleAddHistoryToServer();
            break;
          case "syncHistory":
            result = await handleSyncHistory();
            break;
          case "syncDeleteToServer":
            result = await handleSyncDeleteToServer(req);
            break;
          case "getSongInfo":
            result = await handleGetSongInfo();
            break;
          case "store_listRepos":
            result = await handleStoreListRepos();
            break;
          case "store_addRepo":
            result = await handleStoreAddRepo(req);
            break;
          case "store_removeRepo":
            result = await handleStoreRemoveRepo(req);
            break;
          case "store_checkUpdates":
            result = await handleStoreCheckUpdates();
            break;
          case "store_checkRepoUpdates":
            result = await handleStoreCheckRepoUpdates(req);
            break;
          case "store_installScript":
            result = await handleStoreInstallScript(req);
            break;
          case "store_updateScript":
            result = await handleStoreUpdateScript(req);
            break;
          case "store_batchUpdate":
            result = await handleStoreBatchUpdate(req);
            break;
          case "store_getScriptStatus":
            result = await handleStoreGetScriptStatus(req);
            break;
          case "store_removeScript":
            result = await handleStoreRemoveScript(req);
            break;
          case "store_setAutoUpdate": {
            await browser.storage.local.set({ storeAutoUpdate: req.enabled });
            return { ok: true };
          }
          case "store_getAutoUpdate": {
            const { storeAutoUpdate = true } = await browser.storage.local.get("storeAutoUpdate");
            return { ok: true, enabled: storeAutoUpdate };
          }
          case "debug_log": {
            if (typeof debugLog === "function") {
              const { level = "info", source = "unknown", args = [] } = req;
              debugLog(level, source, args);
            }
            result = { ok: true };
            break;
          }

          case "debug_read_logs": {
            result = { ok: true, entries: await debugLogReadAll() };
            break;
          }

          case "debug_clear_logs": {
            await debugLogClear();
            result = { ok: true };
            break;
          }
          case "APPEND_MEMORY_LOGS": {
            if (req.payload && Array.isArray(req.payload)) {
              if (!state._memoryLogs) {
                state._memoryLogs = [];
              }
              state._memoryLogs.push(...req.payload);

              if (state._memoryLogs.length > 1000) {
                state._memoryLogs = state._memoryLogs.slice(-1000);
              }
              try {
                browser.runtime
                  .sendMessage({
                    action: "MEMORY_LOGS_UPDATED",
                    newEntries: req.payload,
                  })
                  .catch(() => {});
              } catch (e) {}

              result = { ok: true };
            } else {
              result = { ok: false, error: "Invalid payload" };
            }
            break;
          }

          case "debug_read_memory_logs": {
            result = { ok: true, entries: state._memoryLogs || [] };
            break;
          }

          case "debug_clear_memory_logs": {
            if (state._memoryLogs) state._memoryLogs.length = 0;
            result = { ok: true };
            break;
          }
          default:
            result = { ok: false, error: "Unknown action" };
        }
        return result;
      }

      // Handle type-based requests
      if (req.type) {
        let result;
        switch (req.type) {
          case "UPDATE_RPC":
            result = await handleUpdateRpc(req, sender);
            break;
          case "CLEAR_RPC":
            result = await handleClearRpc(sender);
            break;
          case "IS_RPC_CONNECTED":
            result = await handleIsRpcConnected();
            break;
          case "IS_HOSTNAME_MATCH":
            result = await handleIsHostnameMatch(sender);
            break;
          case "GET_RPC_PORT":
            result = await handleGetRpcPort();
            break;
          case "UPDATE_RPC_PORT":
            result = await handleUpdateRpcPort(req);
            break;
          case "UPDATE_WEB_BRIDGE_PORT":
            result = await handleUpdatediscordWebPort(req);
            break;
          case "IS_TAB_AUDIBLE":
            result = await handleIsTabAudible(sender);
            break;
          default:
            result = { ok: false, error: "Unknown message type" };
        }
        return result;
      }
      // If neither action nor type is present
      if (!req.type && !req.action) {
        return { ok: false, error: "No action or type specified" };
      }
    } catch (err) {
      logError("[background]: Unified message handler error:", err);
      return { ok: false, error: err.message };
    }
    return true;
  });

  // update the local storage when the data changes
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    for (const [key, change] of Object.entries(changes)) {
      // Update parser enabled cache
      if (key === "parserEnabledState") {
        const enabledState = change.newValue || {};

        for (const [enableKey, isEnabled] of Object.entries(enabledState)) {
          const parserId = enableKey.startsWith("enable_");
          state.parserEnabledCache.set(parserId, isEnabled !== false);
        }
      }
      // If the parser list or settings have changed, reload
      if (key === "parserList" || key === "userParserSelectors" || key === "userScriptsList" || key === "parserSettings" || key === "parserEnabledState") {
        if (state.parserReloadDebounce) {
          clearTimeout(state.parserReloadDebounce);
        }

        state.parserReloadDebounce = setTimeout(() => {
          parserListMutex(async () => {
            logInfo("[background:storageChanged]: Parser list change detected, reloaded parser list.");
            state.parserListLoaded = false;
            await loadParserList();
          }).catch((err) => logError("[background:parserListMutex]:", err));
        }, 200);
      }
    }
  });

  // onRemoved
  browser.tabs.onRemoved.addListener(async (tabId) => {
    if (typeof tabId !== "number" || tabId <= 0) return;

    // Cancel pending network operations
    const controller = state.pendingFetches.get(tabId);
    if (controller) controller.abort();
    state.pendingFetches.delete(tabId);

    // Clear RPC
    await clearRpcForTab(tabId, "tab removed").catch((err) => logError("[background:clearRpcForTab]: ", err));

    // Clean URL cache
    state.tabUrlMap.delete(tabId);
  });

  // onUpdated
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const tabState = state.activeTabMap.get(tabId);
    if (!tabState) return;

    const oldUrl = state.tabUrlMap.get(tabId);
    const newUrl = changeInfo.url || oldUrl;

    try {
      // 1) Tab muted check
      if (changeInfo.mutedInfo?.muted === true) {
        const pingRes = await safePingTab(tabId).catch(() => null);
        if (!pingRes?.isPlaying) {
          logInfo(`[background]: Tab ${tabId} muted and not playing, clearing RPC`);
          if (state.audibleTimers.has(tabId)) {
            clearTimeout(state.audibleTimers.get(tabId));
            state.audibleTimers.delete(tabId);
          }
          await clearRpcForTab(tabId, "tab muted").catch((err) => logError("[background:clearRpcForTab]:", err));
          state.tabUrlMap.delete(tabId);
          return;
        }
        logInfo(`[background]: Tab ${tabId} muted but isPlaying is true, keeping RPC`);
      }

      // 2) Domain change control
      let shouldClearImmediately = false;

      if (changeInfo.url && oldUrl) {
        try {
          const oldHost = new URL(oldUrl).host;
          const newHost = new URL(changeInfo.url).host;

          if (oldHost !== newHost) {
            shouldClearImmediately = true;
            logInfo(`[background]: Tab ${tabId} domain changed: ${oldHost} → ${newHost}, clearing RPC immediately`);
          }
        } catch (err) {
          logError("[background]: Domain comparison error:", err);
        }
      }

      // 3) Page reload control
      if (!shouldClearImmediately && changeInfo.status === "loading" && oldUrl) {
        try {
          const currentHost = new URL(oldUrl).host;
          const tabHost = new URL(tab.url || oldUrl).host;

          if (currentHost !== tabHost) {
            shouldClearImmediately = true;
            logInfo(`[background]: Tab ${tabId} page reloaded on different domain, clearing RPC immediately`);
          }
        } catch (err) {
          logError("[background]: Page reload check error:", err);
        }
      }

      // If the domain has changed, clear it immediately
      if (shouldClearImmediately) {
        if (state.audibleTimers.has(tabId)) {
          clearTimeout(state.audibleTimers.get(tabId));
          state.audibleTimers.delete(tabId);
        }

        await clearRpcForTab(tabId, "domain/navigation changed").catch((err) => logError("[background:clearRpcForTab]: ", err));
        state.tabUrlMap.set(tabId, newUrl);
        return;
      }

      // 4) Audible check
      const isCurrentlyAudible = tab.audible ?? false;

      if (isCurrentlyAudible) {
        if (!tabState.isAudioPlaying) {
          tabState.isAudioPlaying = true;
          state.activeTabMap.set(tabId, tabState);
          logInfo(`[background]: Tab ${tabId} became audible, state updated`);
        }

        // If there is an audible timer, cancel it
        if (state.audibleTimers.has(tabId)) {
          clearTimeout(state.audibleTimers.get(tabId));
          state.audibleTimers.delete(tabId);
          logInfo(`[background]: Tab ${tabId} audible resumed, cleanup timer cancelled`);
        }
      } else {
        // The tab no longer active → just update the state
        if (tabState.isAudioPlaying) {
          const pingRes = await safePingTab(tabId).catch(() => null);
          const isStillPlaying = !!pingRes?.isPlaying;

          if (isStillPlaying) {
            logInfo(`[background]: Tab ${tabId} not audible but isPlaying is true, keeping RPC`);
            return;
          }

          tabState.isAudioPlaying = false;
          state.activeTabMap.set(tabId, tabState);
          logInfo(`[background]: Tab ${tabId} lost audio, will clear RPC in 5s if not recovered`);

          // Only start a new timer if there isn't one already
          if (!state.audibleTimers.has(tabId)) {
            const timer = setTimeout(async () => {
              try {
                const t = await browser.tabs.get(tabId);
                const currentState = state.activeTabMap.get(tabId);
                const pingRes2 = await safePingTab(tabId).catch(() => null);
                const stillPlaying = pingRes2?.isPlaying;

                if (!t.audible && !stillPlaying) {
                  logInfo(`[background]: Tab ${tabId} still not audible after 5s, clearing RPC`);
                  await clearRpcForTab(tabId, "audio stopped for 5+ seconds");
                } else {
                  logInfo(`[background]: Tab ${tabId} recovered audio within 5s, keeping RPC active`);
                  if (currentState) {
                    currentState.isAudioPlaying = true;
                    state.activeTabMap.set(tabId, currentState);
                  }
                }
              } catch (err) {
                logInfo(`[background]: Tab ${tabId} not found during cleanup timer, removing from map`);
                state.activeTabMap.delete(tabId);
              } finally {
                state.audibleTimers.delete(tabId);
              }
            }, 5000);

            state.audibleTimers.set(tabId, timer);
            logInfo(`[background]: Tab ${tabId} cleanup timer started (5s)`);
          }
        }
      }
    } catch (err) {
      logError(`[background]: Tab ${tabId} onUpdated error:`, err);
    } finally {
      if (newUrl) state.tabUrlMap.set(tabId, newUrl);
    }
  });

  // onSuspend
  browser.runtime.onSuspend.addListener(async () => {
    logInfo("[background:onSuspend]: Service worker suspending, cleaning up", state.activeTabMap.size, "tabs");
    const allTabs = Array.from(state.activeTabMap.keys());
    for (const tabId of allTabs) {
      const controller = state.pendingFetches.get(tabId);
      if (controller) controller.abort();
      await cleanupRpcForTab(tabId);
    }
    state.activeTabMap.clear();
    state.pendingFetches.clear();
  });

  // Context Menu
  const manifestVersion = browser.runtime.getManifest().manifest_version;
  const contextType = manifestVersion === 3 ? "action" : "browser_action";

  // Create Menu
  try {
    browser.contextMenus.removeAll().finally(() => {
      // Restart Extension
      browser.contextMenus.create({
        id: "reloadExtension",
        title: "Restart the extension (Page Reload Required)",
        contexts: [contextType],
      });

      // Toggle Debug Mode
      browser.contextMenus.create({
        id: "toggleDebugMode",
        title: "Toggle Debug Mode (Check Developer Console)",
        contexts: [contextType],
      });

      // Reset to Defaults
      browser.contextMenus.create({
        id: "factoryReset",
        title: "Reset to Defaults (Click > Open Menu Again > Confirm)",
        contexts: [contextType],
      });
    });
  } catch (err) {}

  // Handle click on menu
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    // Restart Extension Action
    if (info.menuItemId === "reloadExtension") {
      restartExtension(tab);
    }

    // Toggle Debug Mode Action
    if (info.menuItemId === "toggleDebugMode") {
      toggleDebugMode(tab);
    }

    // Reset to Defaults Action
    if (info.menuItemId === "factoryReset") {
      factoryReset(tab);
    }
  });
};
