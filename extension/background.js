import "./libs/browser-polyfill.js";
import "./libs/pako.js";

const state = {
  serverPort: CONFIG.serverPort,
  discordWebPort: CONFIG.discordWebPort,
  webOnlyMode: false,
  isLoopRunning: false,
  activeTabMap: new Map(),
  tabUrlMap: new Map(),
  audibleTimers: new Map(),
  cleanupQueue: new Set(),
  pendingUpdates: new Map(),
  historyCounters: new Map(),
  lastLoopTime: 0,
  parserList: [],
  parserListLoaded: false,
  parserListLoading: null,
  parserEnabledCache: new Map(),
  parserMap: {},
  pendingClear: new Set(),
  pendingFetches: new Map(),
  mainLoopTimer: null,
  parserReloadDebounce: null,
};

const getEnabledParsers = () => state.parserList.filter((p) => p.isEnabled);
const historyData = () => loadHistory();

// Retrieves the 'enable_' data from the local storage.
async function loadParserEnabledCache(parserEnabledCache, parserList) {
  parserEnabledCache.clear();
  const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
  parserList.forEach((p) => {
    const enableKey = `enable_${p.id}`;
    parserEnabledCache.set(p.id, parserEnabledState[enableKey] !== false);
  });
}

const historyMutex = createMutex();
async function scheduleHistoryAdd(tabId, songData) {
  if (!tabId || !Number.isInteger(tabId)) return;
  if (!songData?.title || !songData?.artist) return;

  if (!state.historyCounters) state.historyCounters = new Map();
  const key = `${songData.title}::${songData.artist}::${songData.source}`;
  const tracker = state.historyCounters.get(tabId);
  const now = Date.now();

  if (!tracker || tracker.lastKey !== key) {
    logInfo("[background:scheduleHistoryAdd]: New song detected for tab:", tabId, "title:", songData.title, "artist:", songData.artist);
    state.historyCounters.set(tabId, { lastKey: key, startTime: now });
    return;
  }

  if (now - tracker.startTime >= 27000) {
    await historyMutex(async () => {
      try {
        const history = await historyData();

        const last = history[0];
        const sameAsLast = last && last.t === songData.title && last.a === songData.artist && last.s === songData.source;
        const activeTab = state.activeTabMap.get(tabId);
        let saveHistory = true;

        if (activeTab?.parserId) {
          const parserSettings = await getParserSettings(activeTab.parserId);
          saveHistory = parserSettings?.saveHistory ?? true;
        }

        if (!sameAsLast && saveHistory) {
          // Add to History
          logInfo("[background:scheduleHistoryAdd]: Adding to history - title:", songData.title, "artist:", songData.artist, "source:", songData.source);
          await addToHistory({
            image: songData.image,
            title: songData.title,
            artist: songData.artist,
            source: songData.source,
            link: songData.link || songData.songUrl,
            mode: songData.mode,
            date: tracker.startTime || now,
          });
        } else {
          logInfo("[background:scheduleHistoryAdd]: Skipped - sameAsLast:", sameAsLast, "saveHistory:", saveHistory);
        }
      } catch (error) {
        logError("[background:scheduleHistoryAdd]: History add error:", error);
      }
    });
    // Clear tracker
    state.historyCounters.delete(tabId);
  }
}

// Load Parser Lists - Processes the saved list
async function loadParserList() {
  try {
    // If it is loading, do not process it again
    if (state.parserListLoading) {
      await state.parserListLoading;
    }

    const { parserList = [], userParserSelectors = [], userScriptsList = [] } = await browser.storage.local.get(["parserList", "userParserSelectors", "userScriptsList"]);
    const builtInList = parserList.filter((p) => !p.userAdd && !p.userScript);
    logInfo(`Loaded ${builtInList.length} built-in, ${userParserSelectors.length} selector, ${userScriptsList.length} userscript parsers`);

    // Selector Parsers
    const userList = userParserSelectors.map((u) => {
      const fallbackId = generateParserKey(u.domain, u.urlPatterns || [".*"]);
      return {
        ...u,
        id: u.id || fallbackId,
        urlPatterns: u.urlPatterns || u.selectors?.regex || [".*"],
        userAdd: true,
      };
    });

    // UserScript Parsers
    const userScriptList = userScriptsList.map((u) => {
      const fallbackId = generateParserKey(u.domain, u.urlPatterns || [".*"], u.authors);
      return {
        ...u,
        id: u.id || fallbackId,
        urlPatterns: u.urlPatterns || [".*"],
        userScript: true,
      };
    });

    // Merge the lists
    const allParsers = [...builtInList, ...userList, ...userScriptList];

    // Get Enable settings from storage and apply them to the parsers
    const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");

    state.parserList = allParsers.map((p) => ({
      ...p,
      isEnabled: parserEnabledState[`enable_${p.id}`] !== false,
      settings: {},
    }));

    // If there is an 'enable_' setting in the cache, use it.
    state.parserMap = Object.fromEntries(state.parserList.map((p) => [`${p.id}`, p]));
    await loadParserEnabledCache(state.parserEnabledCache, state.parserList);
    state.parserListLoaded = true;
  } catch (error) {
    logError("[background:loadParserList]: ParserList loading failed:", error);
    state.parserList = [];
    state.parserMap = {};
    state.parserListLoaded = true;
    throw error;
  }
}

// Retrieves the parser settings from storage.
async function getParserSettings(parserId) {
  if (!parserId) return {};

  try {
    const cached = state.parserMap?.[parserId]?.settings;
    if (cached && Object.keys(cached).length > 0) {
      return cached;
    }

    const storageResult = await browser.storage.local.get("parserSettings");
    const parserSettings = storageResult?.parserSettings ?? {};

    const parserKey = `settings_${parserId}`;
    const rawSettings = parserSettings?.[parserKey] ?? {};

    const parsedSettings =
      typeof rawSettings === "object" && rawSettings !== null ? Object.fromEntries(Object.entries(rawSettings).map(([key, obj]) => [key, obj?.value])) : {};

    if (state.parserMap?.[parserId]) {
      state.parserMap[parserId].settings = parsedSettings;
    }

    return parsedSettings;
  } catch (err) {
    logError("[background:getParserSettings]: getParserSettings failed:", err);
    return {};
  }
}

// Load the parsers once, return true if they exist.
const parserListMutex = createMutex();
const loadParserListOnce = async (force = false) => {
  return parserListMutex(async () => {
    if (!force && state.parserListLoaded) {
      return true;
    }

    if (force) {
      state.parserListLoaded = false;
      state.parserListLoading = null;
    }

    if (state.parserListLoading) {
      return state.parserListLoading;
    }

    state.parserListLoading = (async () => {
      try {
        await loadParserList();
        state.parserListLoaded = true;
        return true;
      } catch (e) {
        logError("[background:loadParserListOnce]: ParserList load failed", e);
        return false;
      } finally {
        state.parserListLoading = null;
      }
    })();

    return state.parserListLoading;
  });
};

const parserReady = async () => {
  await loadParserListOnce();
};

const activeTabMutex = createMutex();
// RPC and Tab Cleaning operations
const clearRpcForTab = async (tabId, reason = "Tab closed") => {
  return activeTabMutex(async () => {
    // If a clear is already in-progress, skip
    if (!state.activeTabMap.has(tabId) && !state.pendingClear.has(tabId)) {
      return;
    }

    if (state.pendingClear.has(tabId)) {
      logInfo(`[background:clearRpcForTab]: Clear already pending for tab ${tabId}, skipping`);
      return;
    }

    const wasActive = state.activeTabMap.has(tabId);
    state.pendingClear.add(tabId);

    try {
      // Clear pending update timeouts
      const pending = state.pendingUpdates.get(tabId);
      if (pending?.timeout) {
        clearTimeout(pending.timeout);
        logInfo(`[background:clearRpcForTab]: cleared pending update for tab ${tabId}`);
      }
      state.pendingUpdates.delete(tabId);

      // if there is an audible timer, cancel it
      if (state.audibleTimers?.has(tabId)) {
        clearTimeout(state.audibleTimers.get(tabId));
        state.audibleTimers.delete(tabId);
      }

      // Abort the pending fetch
      const controller = state.pendingFetches.get(tabId);
      if (controller) {
        controller.abort();
        logInfo(`[background:clearRpcForTab]: aborted fetch for tab ${tabId}`);
      }
      state.pendingFetches.delete(tabId);

      if (wasActive) {
        let tab;
        try {
          tab = await browser.tabs.get(tabId);
        } catch (err) {
          if (err.message.includes("No tab with id")) {
            logInfo(`[background:clearRpcForTab]: Tab ${tabId} is already closed, RPC cleanup skipped.`);
          }
        }

        const title = tab?.title || "";
        const url = tab?.url || "";
        const domain = url ? new URL(url).host : "";
        const stored = await browser.storage.local.get("debugMode");
        const debugMode = stored.debugMode === 1 ? true : CONFIG.debugMode;
        if (debugMode && state.lastUpdateStatus !== "skipped") {
          console.groupCollapsed(
            `%c[WEB-PRESENCE - INFO] Clearing RPC for tab ${tabId}%c ${url ? "| " + url : ""}`,
            "color: ddd; background-color: #2a4645ff; padding: 2px 4px; border-radius: 3px;",
            "color: #5bc0de; font-weight: bold;",
          );
          if (tab) {
            console.log(`Title: %c${title}`, "color: #f0ad4e; font-weight: bold;");
            console.log(`Domain: %c${domain}`, "color: #5cb85c; text-decoration: underline;");
          }
          console.log(`Reason: %c${reason}`, "color: #0275d8; font-weight: bold;");
          console.groupEnd();
        }
        logInfo(`[background:clearRpcForTab]: Clearing RPC for tab ${tabId} - reason: ${reason}`);
        if (state.webOnlyMode) {
          await sendToWebOnlyBridge({ activity: null });
          logInfo(`[background:clearRpcForTab]: Cleared RPC for tab ${tabId} via web-only`);
        } else {
          try {
            await fetchWithTimeout(
              `http://localhost:${state.serverPort}/clear-rpc`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId: `tab_${tabId}` }),
              },
              CONFIG.requestTimeout,
            );
            logInfo(`[background:clearRpcForTab]: Cleared RPC for tab ${tabId}`);
          } catch (err) {
            logError(`[background:clearRpcForTab]: RPC clear failed for tab ${tabId}:`, err.message);
          }
        }
      }
    } catch (e) {
      logError(`[background:clearRpcForTab]: Clear RPC failed tab ${tabId}`, e);
    } finally {
      state.activeTabMap.delete(tabId);
      state.pendingClear.delete(tabId);
      state.cleanupQueue.delete(tabId);
      state.historyCounters.delete(tabId);
      if (state.activeTabMap.size === 0) {
        if (state.mainLoopTimer) clearTimeout(state.mainLoopTimer);
        setTimeout(mainLoop, 0);
      }
    }
  });
};

// Tab Cleaning Helper Functions
const deferredCleanup = async () => {
  if (!state.cleanupQueue.size) return;

  const tabsToClean = [...state.cleanupQueue];
  state.cleanupQueue.clear();
  logInfo("[background:deferredCleanup]: Cleaning up", tabsToClean.length, "tabs:", tabsToClean.join(", "));
  for (const tabId of tabsToClean) {
    await clearRpcForTab(tabId, "deferred Cleanup");
  }
};

const markOtherTabsForCleanup = (activeId) => {
  state.activeTabMap.forEach((_, id) => {
    if (id !== activeId) state.cleanupQueue.add(id);
  });
};

// Finds the Active Tab that matches with the Parser.
const updateActiveTabMap = async (state, tabs) => {
  return activeTabMutex(async () => {
    const enabled = getEnabledParsers();
    const matchedTabsMap = new Map();

    // 1️) Match the tabs with the parser
    tabs.forEach((tab) => {
      try {
        if (!tab.url) return;

        const matched = findMatchingParsersForUrl(tab.url, enabled);
        if (matched.length === 0) return;

        const urlObj = new URL(tab.url);
        const validMatches = matched.filter((parser) => {
          try {
            const patterns = parser.urlPatterns || [];
            return patterns.some((pattern) => {
              const regex = parseUrlPattern(pattern);
              return regex.test(urlObj.pathname);
            });
          } catch (e) {
            logError(`[background:updateActiveTabMap]: Pattern error for parser ${parser.id}:`, e);
            return false;
          }
        });

        if (validMatches.length > 0) {
          matchedTabsMap.set(tab.id, { tab, matched: validMatches });
        }
      } catch (e) {
        logError("[background:updateActiveTabMap]: Tab URL parsing error:", e);
      }
    });

    if (matchedTabsMap.size === 0) return;

    const matchedTabs = Array.from(matchedTabsMap.values()).map((v) => v.tab);

    // 2) If there is an active tab in activeTabMap
    if (state.activeTabMap.size > 0) {
      const firstWinnerId = state.activeTabMap.keys().next().value;
      const winnerTab = tabs.find((t) => t.id === firstWinnerId);

      if (winnerTab) {
        // If the active tab is still open, send the others to cleanup
        markOtherTabsForCleanup(firstWinnerId);
        return winnerTab;
      } else {
        // The active tab has been closed or released with clear-rpc
        state.activeTabMap.clear();
      }
    }

    // 3️) Choose a new active tab
    const mainTab = matchedTabs.find((t) => t.active) || matchedTabs[0];
    const matchedData = matchedTabsMap.get(mainTab.id);

    logInfo("[background:updateActiveTabMap]: New active tab selected:", mainTab.id, "parser:", matchedData?.matched[0]?.id ?? "none");

    state.activeTabMap.set(mainTab.id, {
      lastUpdated: Date.now(),
      lastKey: "",
      isAudioPlaying: !!mainTab.audible,
      parserId: matchedData?.matched[0]?.id ?? null,
    });

    // Send the other tabs to cleanup
    markOtherTabsForCleanup(mainTab.id);

    return mainTab;
  });
};

// RPC Update
const updateRpc = async (data, tabId) => {
  try {
    await browser.tabs.get(tabId);
  } catch (err) {
    logInfo(`[background:updateRpc]: tab ${tabId} not found in browser, aborting`);
    return;
  }

  const existing = state.pendingFetches.get(tabId);
  if (existing) existing.abort();

  const controller = new AbortController();
  state.pendingFetches.set(tabId, controller);

  try {
    const base = state.activeTabMap.get(tabId);
    let parserId = base?.parserId;

    if (!parserId) {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab.url) {
          const url = new URL(tab.url);
          const hostname = url.hostname.replace(/^www\./, "");
          const exactMatch = state.parserList.find((parser) => {
            try {
              const domains = Array.isArray(parser.domain) ? parser.domain : [parser.domain];
              return domains.some((d) => isDomainMatch(d, hostname));
            } catch (e) {
              logError("[background:updateRpc]: Domain match error:", e);
              return false;
            }
          });

          if (exactMatch) {
            parserId = exactMatch.id;
            logInfo(`[background:updateRpc]: Found exact parser match: ${hostname} -> ${parserId}`);
          }
        }
      } catch (e) {
        logError("[background:updateRpc]: Error finding correct parser:", e);
      }
    }

    const parserSettings = await getParserSettings(parserId);
    const defaultParserSettings = Object.fromEntries(Object.entries(DEFAULT_PARSER_OPTIONS).map(([key, option]) => [key, option.value]));

    const payload = {
      data: {
        ...data,
        status: !!(base?.isAudioPlaying || data.isPlaying),
        settings: parserSettings,
        settingsDefault: defaultParserSettings,
      },
      clientId: `tab_${tabId}`,
      timestamp: Date.now(),
    };

    if (state.webOnlyMode) {
      const rawActivity = buildActivityLocally(payload.data);
      const webOnlyActivity = formatForWebConnection(rawActivity);
      await sendToWebOnlyBridge({ activity: webOnlyActivity });
    } else {
      await fetchWithTimeout(
        `http://localhost:${state.serverPort}/update-rpc`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
        CONFIG.requestTimeout,
      );
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      logError(`[background:updateRpc]: Update RPC failed for tab ${tabId}:`, err);
    }
    throw err;
  } finally {
    if (state.pendingFetches.get(tabId) === controller) {
      state.pendingFetches.delete(tabId);
    }
  }
};

// Schedule RPC Update - It is used on the backgroundListeners.js SetupListeners side.
const scheduleRpcUpdate = (data, tabId) => {
  if (state.pendingClear.has(tabId)) {
    logInfo(`[background:scheduleRpcUpdate]: tab ${tabId} is being cleared, skipping`);
    return;
  }

  if (!state.activeTabMap.has(tabId)) {
    logInfo(`[background:scheduleRpcUpdate]: tab ${tabId} not in activeTabMap, skipping`);
    return;
  }

  const current = state.pendingUpdates.get(tabId);
  if (current?.timeout) clearTimeout(current.timeout);

  const timeout = setTimeout(() => {
    if (state.pendingClear.has(tabId)) {
      logInfo(`[background:scheduleRpcUpdate]: tab ${tabId} cleared during wait, aborting update`);
      state.pendingUpdates.delete(tabId);
      return;
    }

    if (!state.activeTabMap.has(tabId)) {
      logInfo(`[background:scheduleRpcUpdate]: tab ${tabId} removed during wait, aborting update`);
      state.pendingUpdates.delete(tabId);
      return;
    }

    state.pendingUpdates.delete(tabId);
    updateRpc(data, tabId).catch((err) => logError("[background:updateRpc]", err));
  }, 500);

  state.pendingUpdates.set(tabId, { timeout, data });
};

// Checks the Active Tab
async function safePingTab(tabId) {
  try {
    const res = await browser.tabs.sendMessage(tabId, { type: "PING_FOR_DATA" });
    return res?.title && res?.artist ? res : null;
  } catch {
    return null;
  }
}

// Processes tab data
const processTab = async (tabId, tabData) => {
  if (!state.activeTabMap.has(tabId)) return;

  const now = Date.now();
  // If being processed for the first time, wait a bit for the content script to load
  if (!tabData.lastUpdated) {
    state.activeTabMap.set(tabId, {
      ...tabData,
      lastUpdated: 0,
    });
    return;
  }
  if (now - tabData.lastUpdated < CONFIG.activeInterval) return;

  const res = await safePingTab(tabId);

  if (!res || typeof res !== "object") {
    if (!tabData.lastUpdated || now - tabData.lastUpdated > CONFIG.stuckThreshold) {
      logInfo(`[background:processTab]: Tab ${tabId} did not respond, clearing RPC`);
      await clearRpcForTab(tabId, "tab did not respond").catch((err) => logError("[background:clearRpcForTab]", err));
    }
    return;
  }

  if (!res.title || !res.artist) return;

  // Radio / stream check (duration = 0)
  if (res.duration <= 0) {
    if (now - tabData.lastUpdated >= CONFIG.activeInterval) {
      logInfo(`[background:processTab]: Tab ${tabId} is a stream/radio, duration=0, updating state`);
      state.activeTabMap.set(tabId, {
        ...res,
        lastUpdated: now,
        isAudioPlaying: true,
      });
    }
    return;
  }

  // Normal update
  state.activeTabMap.set(tabId, {
    ...res,
    lastUpdated: now,
    isAudioPlaying: true,
    progress: res.progress,
  });
};

// Main Loop
const mainLoop = async () => {
  if (state.isLoopRunning) {
    logInfo("[background:mainLoop]: Main loop already running, skipping");
    return;
  }

  state.isLoopRunning = true;
  const now = Date.now();

  // Minimum interval check
  if (now - state.lastLoopTime < CONFIG.activeInterval) {
    state.isLoopRunning = false;
    return;
  }

  try {
    const audibleTabs = await browser.tabs.query({ audible: true });

    let tabs = audibleTabs;
    const trackedIds = [...state.activeTabMap.keys()];
    const extraTabs = (await Promise.all(trackedIds.filter((id) => !audibleTabs.some((t) => t.id === id)).map((id) => browser.tabs.get(id).catch(() => null)))).filter(
      (t) => t !== null,
    );
    tabs = [...audibleTabs, ...extraTabs];

    if (!tabs.length) {
      await deferredCleanup();
      return;
    }

    const matched = await updateActiveTabMap(state, tabs);

    if (matched) {
      const tabData = state.activeTabMap.get(matched.id);
      if (tabData) {
        await processTab(matched.id, tabData);
      }
    }

    const currentIds = tabs.map((t) => t.id);
    for (const id of state.activeTabMap.keys()) {
      if (!currentIds.includes(id)) {
        state.cleanupQueue.add(id);
      }
    }

    await deferredCleanup();
  } catch (e) {
    logError("[background:mainLoop]: Main Loop Error", e);
  } finally {
    state.lastLoopTime = Date.now();
    state.isLoopRunning = false;

    if (state.mainLoopTimer) {
      clearTimeout(state.mainLoopTimer);
    }

    state.mainLoopTimer = setTimeout(mainLoop, CONFIG.activeInterval);
  }
};

const keepAlive = () => {
  setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
};

function buildActivityLocally(data) {
  const dataTitle = String(data.title ?? "").trim();
  const rawArtist = String(data.artist ?? "").trim();
  const artistIsIntentionallyEmpty = !rawArtist || rawArtist === "-1";
  let dataArtist = artistIsIntentionallyEmpty ? "" : rawArtist;
  const dataImage = String(data.image ?? "").trim();
  const dataSource = String(data.source ?? "").trim();
  const dataLink = String(data.link ?? "").trim();

  if (!dataArtist && dataSource) dataArtist = dataSource;

  const mergeSettings = (defaults, overrides) => {
    const result = {};
    for (const key in defaults) {
      const defVal = defaults[key];
      const overVal = overrides?.[key];
      const finalVal =
        overVal && typeof overVal === "object" && "value" in overVal
          ? overVal.value
          : overVal !== undefined
            ? overVal
            : defVal && typeof defVal === "object" && "value" in defVal
              ? defVal.value
              : defVal;
      result[key] = finalVal;
    }
    return result;
  };

  const activitySettings = mergeSettings(DEFAULT_PARSER_OPTIONS, {
    ...data.settingsDefault,
    ...data.settings,
  });

  // FavIcon
  let favIcon = null;
  if (activitySettings.showFavIcon && dataLink) {
    try {
      const { hostname } = new URL(dataLink);
      favIcon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
    } catch {
      // invalid URL - favIcon stays null
    }
  }

  const shouldShowArtist = activitySettings.showArtist;
  const isWatch = data.mode === "watch";

  const activity = {
    application_id: "1366752683628957767",
    details: dataTitle,
    state: shouldShowArtist ? dataArtist : dataSource,
    type: isWatch ? 3 : 2,
    instance: false,
  };

  // Large image
  if (activitySettings.customCover && activitySettings.customCoverUrl) {
    activity.largeImageKey = String(activitySettings.customCoverUrl);
  } else if (activitySettings.showCover && dataImage) {
    activity.largeImageKey = dataImage;
  } else if (activitySettings.customPlaceholder && activitySettings.customPlaceholderUrl) {
    activity.largeImageKey = String(activitySettings.customPlaceholderUrl);
  } else {
    activity.largeImageKey = "key-default";
  }

  // Ensure largeImageKey does not exceed Discord's 300-character limit.
  if (activity.largeImageKey.length > 300) {
    activity.largeImageKey = "key-default";
  }

  // Large image text
  if (!artistIsIntentionallyEmpty && activitySettings.showSource && activitySettings.showArtist) {
    activity.largeImageText = dataSource;
  }

  // Small image
  const showSmallIcon = Boolean(activitySettings.showFavIcon);
  if (!artistIsIntentionallyEmpty && showSmallIcon) {
    activity.smallImageKey = favIcon ?? (isWatch ? "watch" : "listen");
    activity.smallImageText = dataSource;
  } else if (!artistIsIntentionallyEmpty) {
    activity.smallImageText = isWatch ? "Watching" : "Listening";
  } else {
    activity.smallImageText = "";
  }

  // Buttons
  const existingButtons = Array.isArray(data.buttons) ? data.buttons.filter((btn) => btn?.text && String(btn.text).trim() && isValidUrl(btn.link)) : [];

  const customButtons = [
    activitySettings.customButton1 && activitySettings.customButton1Text?.trim() && isValidUrl(activitySettings.customButton1Link)
      ? { text: activitySettings.customButton1Text, link: activitySettings.customButton1Link }
      : null,
    activitySettings.customButton2 && activitySettings.customButton2Text?.trim() && isValidUrl(activitySettings.customButton2Link)
      ? { text: activitySettings.customButton2Text, link: activitySettings.customButton2Link }
      : null,
  ];

  let mergedButtons;
  if (existingButtons.length === 0) {
    mergedButtons = customButtons.filter(Boolean);
  } else if (existingButtons.length === 1) {
    const firstCustom = customButtons.find(Boolean);
    mergedButtons = firstCustom ? [existingButtons[0], firstCustom] : existingButtons;
  } else {
    mergedButtons = [customButtons[0] ?? existingButtons[0], customButtons[1] ?? existingButtons[1]];
  }

  if (activitySettings.showButtons) {
    const validButtons = mergedButtons
      .filter((btn) => btn?.text && String(btn.text).trim() && isValidUrl(btn.link))
      .slice(0, 2)
      .map((btn) => ({ label: truncate(btn.text, 32), url: String(btn.link) }));

    const sourceButton = isValidUrl(dataLink) ? { label: truncate(`Open on ${dataSource || "Source"}`, 32), url: dataLink } : null;

    if (validButtons.length === 2) {
      activity.buttons = validButtons;
    } else if (validButtons.length === 1 && sourceButton) {
      activity.buttons = [validButtons[0], sourceButton];
    } else if (validButtons.length === 1) {
      activity.buttons = validButtons;
    } else if (sourceButton) {
      activity.buttons = [sourceButton];
    }

    if (isValidUrl(dataLink)) {
      activity.detailsUrl = dataLink;
      activity.largeImageUrl = dataLink;
    }
  }

  // Timestamps
  const position = Number(data.position) || 0;
  const duration = Number(data.duration) || 0;
  if (duration > 0) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    activity.startTimestamp = nowSeconds - position;
    if (activitySettings.showTimeLeft) {
      activity.endTimestamp = nowSeconds + (duration - position);
    }
  }

  return activity;
}

function formatForWebConnection(activity) {
  const assets = {};

  if (activity.largeImageKey) {
    assets.large_image = activity.largeImageKey;
    assets.large_url = activity.largeImageUrl;
  }
  if (activity.largeImageText) {
    assets.large_text = activity.largeImageText;
  }
  if (activity.smallImageKey) {
    assets.small_image = activity.smallImageKey;
  }
  if (activity.smallImageText) {
    assets.small_text = activity.smallImageText;
  }

  const webActivity = {
    application_id: activity.application_id,
    name: activity.state,
    details: activity.details,
    details_url: activity.detailsUrl,
    state: activity.state,
    type: activity.type,
    status_display_type: 1,
    instance: activity.instance ?? false,
  };

  if (Object.keys(assets).length) {
    webActivity.assets = assets;
  }

  if (activity.startTimestamp) {
    webActivity.timestamps = { start: activity.startTimestamp * 1000 };
    if (activity.endTimestamp) {
      webActivity.timestamps.end = activity.endTimestamp * 1000;
    }
  }

  if (activity.buttons?.length) {
    webActivity.buttons = activity.buttons.map((b) => b.label ?? b);
    const urls = activity.buttons.map((b) => b.url ?? "");
    if (urls.some((u) => u)) {
      webActivity.metadata = { button_urls: urls };
    }
  }

  return webActivity;
}

async function sendToWebOnlyBridge(payload) {
  const discordTabs = await browser.tabs.query({
    url: ["https://discord.com/*"],
  });

  if (!discordTabs.length) {
    logInfo("[background:sendToWebOnlyBridge] No Discord tabs found");
    return;
  }

  for (const tab of discordTabs) {
    browser.tabs
      .sendMessage(tab.id, {
        type: "FORWARD_TO_MAIN",
        payload,
      })
      .catch((err) => logError(`[background:sendToWebOnlyBridge] Tab ${tab.id}:`, err.message));
  }
}

// Start
const init = async () => {
  logInfo("[background:init]: Extension initializing");

  await browser.storage.local.get("serverPort").then((result) => {
    if (result.serverPort !== undefined) {
      state.serverPort = result.serverPort;
      logInfo("[background:init]: Server port loaded:", state.serverPort);
    }
  });

  await browser.storage.local.get("webOnlyMode").then((result) => {
    if (result.webOnlyMode !== undefined) {
      state.webOnlyMode = result.webOnlyMode;
      logInfo("[background:init]: Extension Only Bridge Mode:", state.webOnlyMode);
    }
  });

  await browser.storage.local.get("discordWebPort").then((result) => {
    if (result.discordWebPort !== undefined) {
      state.discordWebPort = result.discordWebPort;
      logInfo("[background:init]: Discord web port loaded:", state.discordWebPort);
    }
  });

  debugLogCleanup();
  setupListeners();
  await parserReady();
  await scriptManager.registerAllScripts();
  logInfo("[background:init]: Scripts registered, setting up store");
  await storeService.setupUpdateAlarm();
  await storeService.checkRepoUpdates();
  logInfo("[background:init]: Init complete, starting main loop");
  await mainLoop();
  keepAlive();
};

init();
