// mainParser.js - Controls all parser operations.

window.parsers = {};
window.parserMeta = [];
window.latestUserScriptData = window.latestUserScriptData || {};
window.iframeDataCache = {};
const rpcState = new window.RPCStateManager();
const processedScripts = new Set();
const settingsCache = {};
const loadingPromises = {};
const saveTimers = {};

// Save settings
function scheduleSave(parserId) {
  if (saveTimers[parserId]) clearTimeout(saveTimers[parserId]);

  saveTimers[parserId] = setTimeout(async () => {
    try {
      const snapshot = { ...settingsCache[parserId] };

      if (!snapshot || Object.keys(snapshot).length === 0) {
        return;
      }

      // Read all parserSettings
      const { parserSettings = {} } = await browser.storage.local.get("parserSettings");

      const current = parserSettings[parserId] || {};

      // Merge parser-specific settings
      const merged = {
        ...current,
        ...snapshot,
      };

      // Write back
      await browser.storage.local.set({
        parserSettings: {
          ...parserSettings,
          [parserId]: merged,
        },
      });
    } catch (err) {
      logError(`[mainParser:settings] save error for ${parserId}:`, err);
    }
  }, 120);
}

// Load settings
async function loadSettingsForId(id) {
  const settingKey = `settings_${id}`;

  // Cache hit
  if (settingsCache[settingKey]) {
    return settingsCache[settingKey];
  }

  // In-flight request
  if (loadingPromises[settingKey]) {
    return loadingPromises[settingKey];
  }

  loadingPromises[settingKey] = (async () => {
    try {
      const { parserSettings = {} } = await browser.storage.local.get("parserSettings");

      const value = parserSettings[settingKey];

      if (value && typeof value === "object" && !Array.isArray(value)) {
        settingsCache[settingKey] = value;
      } else {
        settingsCache[settingKey] = {};
      }

      return settingsCache[settingKey];
    } catch (err) {
      settingsCache[settingKey] = {};
      return settingsCache[settingKey];
    } finally {
      delete loadingPromises[settingKey];
    }
  })();

  return loadingPromises[settingKey];
}

async function accessWindow(path, options = {}) {
  try {
    const result = await browser.runtime.sendMessage({
      type: "ACCESS_WINDOW",
      payload: {
        path,
        callFunction: options.call,
        args: options.args || [],
      },
    });

    if (result && typeof result === "object" && result.ok === false) {
      logError("[mainParser:settings] Error:", result.error);
      return null;
    }

    return result?.data ?? result;
  } catch (error) {
    logError("[mainParser:settings] Error:", error);
    return null;
  }
}

async function resolveLabel(label) {
  if (!label || typeof label === "string") return label;
  const browserLang = navigator.languages?.[0] || navigator.language;
  const { lang } = await browser.storage.local.get("lang");
  const currentLang = lang || browserLang || "en";
  return label[currentLang] ?? label["en"] ?? Object.values(label)[0] ?? "";
}

async function resolveSelectOptions(options) {
  return Promise.all(
    options.map(async (opt) => ({
      ...opt,
      label: await resolveLabel(opt.label),
    })),
  );
}

// useSettings
/**
 * Manages custom settings for a custom user parser.
 * @async
 * @param {string} id - The identifier for the settings group
 * @param {string} key - The specific setting key within the group
 * @param {string} label - Display label for the setting
 * @param {string} [type="text"] - Type of the setting ("text" or "select")
 * @param {string|Array} [defaultValue=""] - Default value for the setting. For "select" type, should be an array of options
 * @param {*} [newValue] - New value to set (optional)
 * @throws {Error} Will throw an error if id or key is not provided
 * @returns {Promise<*>} The current value of the setting
 */
async function useSetting(id, key, label, type = "text", defaultValue = "", newValue) {
  if (!key) throw new Error("useSetting requires (id, key, ...)");
  const settingKey = `settings_${id}`;

  // Ensure cache loaded
  const opts = await loadSettingsForId(id);
  const DEFAULT_OPTION_KEYS = new Set(Object.keys(DEFAULT_PARSER_OPTIONS));
  const isDefaultOption = DEFAULT_OPTION_KEYS.has(key);

  let current = opts[key];

  let shouldSave = false;

  if (isDefaultOption && current && typeof current === "object" && "label" in current) {
    delete current.label;
    shouldSave = true;
  }

  const resolvedLabel = await resolveLabel(label);
  const resolvedDefaultValue = type === "select" && Array.isArray(defaultValue) ? await resolveSelectOptions(defaultValue) : defaultValue;

  // Initialize if not existing
  if (current === undefined) {
    if (type === "select" && Array.isArray(resolvedDefaultValue)) {
      current = isDefaultOption
        ? {
            type: "select",
            value: resolvedDefaultValue.map((opt, i) => ({
              ...opt,
              selected: opt.hasOwnProperty("selected") ? opt.selected : i === 0,
            })),
          }
        : {
            label: resolvedLabel,
            type: "select",
            value: resolvedDefaultValue.map((opt, i) => ({
              ...opt,
              selected: opt.hasOwnProperty("selected") ? opt.selected : i === 0,
            })),
          };
    } else {
      current = isDefaultOption ? { type, value: resolvedDefaultValue } : { label: resolvedLabel, type, value: resolvedDefaultValue };
    }
    shouldSave = true;
  } else {
    if (!isDefaultOption && current.label !== resolvedLabel) {
      current.label = resolvedLabel;
      shouldSave = true;
    }
    if (current.type !== type) {
      current.type = type;
      shouldSave = true;
    }

    // Default value check (update only if the value has not changed)
    if (type === "select" && Array.isArray(resolvedDefaultValue)) {
      const oldOptions = Array.isArray(current.value) ? current.value : [];
      const newOptions = resolvedDefaultValue;

      const isDifferent =
        oldOptions.length !== newOptions.length || oldOptions.some((opt, i) => opt.value !== newOptions[i]?.value || opt.label !== newOptions[i]?.label);

      if (isDifferent) {
        const selectedValue = oldOptions.find((o) => o.selected)?.value;
        const hasMatch = newOptions.some((opt) => opt.value === selectedValue);

        current.value = newOptions.map((opt, i) => ({
          ...opt,
          selected: hasMatch ? opt.value === selectedValue : (opt.selected ?? i === 0),
        }));

        shouldSave = true;
      }
    }

    if (type !== "select") {
      if (current.value === undefined && resolvedDefaultValue !== undefined) {
        current.value = resolvedDefaultValue;
        shouldSave = true;
      }
    }
  }

  // Apply new value if provided and different
  if (newValue !== undefined) {
    if (type === "select" && Array.isArray(current.value)) {
      const currentSelected = current.value.find((o) => o.selected)?.value;
      if (currentSelected !== newValue) {
        current.value = current.value.map((opt) => ({
          ...opt,
          selected: opt.value === newValue,
        }));
        shouldSave = true;
      }
    } else if (current.value !== newValue) {
      current.value = newValue;
      shouldSave = true;
    }
  }

  // Persist changes
  if (shouldSave) {
    opts[key] = current;
    settingsCache[settingKey] = opts;
    scheduleSave(settingKey);
  }

  return current.value;
}

// Initialize all parser settings
async function initializeAllParserSettings() {
  const { userScriptsList: storedUserScriptsList = [] } = await browser.storage.local.get("userScriptsList");
  const userScriptsList = Array.isArray(storedUserScriptsList) ? storedUserScriptsList : [];

  const allStored = await browser.storage.local.get(null);

  // Extract settings_*
  const merged = {};
  for (const [key, value] of Object.entries(allStored)) {
    if (key.startsWith("settings_")) {
      merged[key] = value;
    }
  }

  if (Object.keys(merged).length) {
    const { parserSettings: existing = {} } = await browser.storage.local.get("parserSettings");
    await browser.storage.local.set({ parserSettings: { ...existing, ...merged } });
    await browser.storage.local.remove(Object.keys(merged));
  }

  // Load all existing settings into cache
  const { parserSettings = {} } = await browser.storage.local.get("parserSettings");

  // initialSettings is located in global
  const initial = window.initialSettings || {};

  // Synchronize settingsCache with the current storage
  for (const key of Object.keys(parserSettings)) {
    if (key.startsWith("settings_")) {
      settingsCache[key] = parserSettings[key];
    }
  }

  // Create defaults for initialSettings
  for (const [primaryDomain, data] of Object.entries(initial)) {
    if (!data?.urlPatterns) continue;

    // If there is a domain array, use it; if not, use the key
    const domainArg = data.domain ?? primaryDomain;

    // id always based on primaryDomain
    const resolvedPrimary = Array.isArray(domainArg) ? domainArg[0] : domainArg;
    const id = generateParserKey(resolvedPrimary, data.urlPatterns);

    const settingKey = `settings_${id}`;
    if (!settingsCache[settingKey]) {
      settingsCache[settingKey] = parserSettings[settingKey] || {};
    }
    await syncParserSettings(id, data.settings || []);
  }

  // initialize the user script settings in userScriptsList
  for (const script of userScriptsList) {
    if (!script?.id) continue;
    const settingKey = `settings_${script.id}`;
    if (!settingsCache[settingKey]) {
      settingsCache[settingKey] = parserSettings[settingKey] || {};
    }
    await syncParserSettings(script.id, script.settings || []);
  }
}

function domReady() {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
}

window.initParsers = async function () {
  if (window.__parsersInitialized) return;
  window.__parsersInitialized = true;

  await loadAllSavedUserParsers();
  await initializeAllParserSettings();
  await scheduleParserListSave();
  await cleanupOrphanSettingsAndEnables();
};

// registerParser - Used to process all built-in parsers.
window.registerParser = async function ({
  title,
  domain,
  urlPatterns = [],
  authors = [""],
  authorsLinks = [""],
  homepage = "",
  description = "",
  category = "",
  tags = [],
  mode = "listen",
  fn,
  iframeFn,
  iframeSelectors,
  iframeOrigins,
  isLibraryActivity,
  userAdd = false,
  userScript = false,
  initOnly = false,
  ...rest
}) {
  const domains = (Array.isArray(domain) ? domain : [domain]).filter(Boolean);
  if (!domains.length || typeof fn !== "function") return;

  async function domReady() {
    if (document.readyState !== "loading") return Promise.resolve();
    return new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  }

  await domReady();

  const patternStrings = (urlPatterns || [])
    .map((p) => {
      if (typeof p === "string") return p;
      if (p instanceof RegExp) return p.source;
      return p.toString();
    })
    .sort();

  // bind the id
  const primaryDomain = domains[0];
  const id = generateParserKey(primaryDomain, urlPatterns, authors);
  const boundUseSetting = (key, label, type = "text", defaultValue = "", newValue) => useSetting(id, key, label, type, defaultValue, newValue);
  const patternRegexes = (urlPatterns || []).map(parseUrlPattern);

  for (const d of domains) {
    const existingUserScript = window.parsers[d]?.find((p) => p.id === id && p.userScript === userScript);
    if (existingUserScript) {
      existingUserScript.parse = fn;
      Object.assign(existingUserScript, rest);
      continue;
    }

    if (!window.parsers[d]) window.parsers[d] = [];
    if (window.parsers[d].some((p) => p.id === id)) continue;

    window.parsers[d].push({
      id,
      patterns: patternRegexes,
      authors,
      authorsLinks,
      homepage,
      description,
      category,
      tags,
      mode,
      iframeFn,
      iframeSelectors,
      iframeOrigins,
      isLibraryActivity,
      parse: async () => {
        const needsIframe = iframeFn || iframeSelectors;
        if (needsIframe) {
          fetchIframeData(primaryDomain, iframeSelectors).catch(() => {});
        }

        if (initOnly) return null;

        const CLEAR_SENTINEL = Object.freeze({ __clear: true });

        const rawData = await fn({
          useSetting: boundUseSetting,
          accessWindow,
          iframeData: window.iframeDataCache[primaryDomain] ?? null,
          clearActivity: () => CLEAR_SENTINEL,
        });

        if (!rawData) return null;
        if (rawData?.__clear) return -1;

        // RAW EXTRACTION
        let { timePassed = "", duration: durationElem = "" } = rawData;
        const { position: rawPosition, ...rest } = rawData;

        if (!timePassed && typeof rawPosition === "number") timePassed = rawPosition;
        if (!durationElem && typeof rest.duration === "number") durationElem = rest.duration;

        const [tp, dur] = extractTimeParts(timePassed);
        if (tp && dur) {
          timePassed = tp;
          durationElem = dur;
        } else {
          const [tp2, dur2] = extractTimeParts(durationElem);
          if (tp2 && dur2) {
            timePassed = tp2;
            durationElem = dur2;
          }
        }

        const rawTime = parseTime(timePassed);
        const rawDuration = parseTime(durationElem);

        const rawTimeValid = rawTime !== null && isFinite(rawTime);
        const rawDurValid = rawDuration !== null && isFinite(rawDuration) && rawDuration > 0;

        // NORMALIZATION
        const normalized = await normalizeTitleAndArtist(rest.title ?? "", rest.artist ?? "");

        const cleanTitle = truncate(normalized.title, 128, { fallback: "Unknown Song" });
        const cleanArtist = truncate(normalized.artist, 128, { fallback: "Unknown Artist" });

        // TRACK CHANGE
        const lastAct = rpcState.lastActivity;
        const sameTrack = lastAct && lastAct.title === cleanTitle && lastAct.artist === cleanArtist;
        if (!sameTrack) rpcState.reset();

        // NORMAL PATH (valid time and duration)
        if (rawTimeValid && rawDurValid) {
          rpcState.lastValidPosition = rawTime;
          rpcState.lastValidDuration = rawDuration;

          if (!rpcState.calculatedTotalDuration || rawDuration > rpcState.calculatedTotalDuration) {
            rpcState.calculatedTotalDuration = rawDuration;
          }

          if (rpcState.hasOnlyDuration) {
            rpcState.hasOnlyDuration = false;
            rpcState.hasOnlyDurationCount = 0;
            rpcState.resetDurationTimer();
          }

          const pos = Math.max(0, Math.min(rawTime, rawDuration));
          const progress = Math.min(100, (pos / rawDuration) * 100);

          return {
            ...rest,
            mode,
            title: cleanTitle,
            artist: cleanArtist,
            source: rest.artist === rest.source ? cleanTitle : rest.source,
            timePassed: pos,
            position: pos,
            duration: rawDuration,
            progress,
            isPlaying: rest.isPlaying,
            isRemainingMode: false,
            hasOnlyDuration: false,
          };
        }

        // FALLBACK PATH (valid time or duration)
        if (rawTimeValid) rpcState.lastValidPosition = rawTime;
        if (rawDurValid) rpcState.lastValidDuration = rawDuration;

        rpcState.updateModes(rawTime, rawDuration);

        // Position Resolution
        let finalPos;
        if (!rawTimeValid) {
          finalPos = rpcState.hasOnlyDuration ? rpcState.getDurationTimer() : (rpcState.lastValidPosition ?? 0);
        } else {
          finalPos = rawTime;
        }

        // Duration Resolution
        let finalDur = rawDurValid ? rawDuration : (rpcState.lastValidDuration ?? rpcState.calculatedTotalDuration ?? 0);

        // Remaining Mode - rawDuration negative (remaining time)
        if (rpcState.isRemainingMode && typeof rawDuration === "number" && rawDuration < 0) {
          const remaining = Math.abs(rawDuration);

          if (rawTimeValid) {
            finalPos = rawTime;
            finalDur = rawTime + remaining;
            rpcState.calculatedTotalDuration = finalDur;
          } else {
            rpcState.calculatedTotalDuration ??= (rpcState.lastValidPosition ?? rpcState.getDurationTimer()) + remaining;
            finalDur = rpcState.calculatedTotalDuration;
            finalPos = Math.max(0, finalDur - remaining);
          }
        }

        // Duration Lock - prevent the total time from decreasing
        if (rawDurValid && (!rpcState.calculatedTotalDuration || rawDuration > rpcState.calculatedTotalDuration)) {
          rpcState.calculatedTotalDuration = rawDuration;
        }

        if (rpcState.calculatedTotalDuration && finalDur < rpcState.calculatedTotalDuration) {
          finalDur = rpcState.calculatedTotalDuration;
        }

        // Timer Override - only when there is no real position
        if (rpcState.hasOnlyDuration && !rawTimeValid) {
          finalPos = Math.min(Math.max(0, rpcState.getDurationTimer()), finalDur || Infinity);
        }

        // Lock the duration for Remaining mode
        if (rpcState.isRemainingMode && rpcState.calculatedTotalDuration) {
          finalDur = rpcState.calculatedTotalDuration;
        }

        // Final Clamp
        if (finalPos != null && finalDur > 0) {
          finalPos = Math.max(0, Math.min(finalPos, finalDur));
        }

        const progress = finalDur > 0 && finalPos != null ? Math.min(100, (finalPos / finalDur) * 100) : 0;

        return {
          ...rest,
          mode,
          title: cleanTitle,
          artist: cleanArtist,
          source: rest.artist === rest.source ? cleanTitle : rest.source,
          timePassed: finalPos ?? 0,
          position: finalPos ?? 0,
          duration: finalDur ?? 0,
          progress,
          isPlaying: rest.isPlaying,
          isRemainingMode: rpcState.isRemainingMode,
          hasOnlyDuration: rpcState.hasOnlyDuration,
        };
      },
      userAdd,
    });
  }

  if (!userScript) {
    if (!window.parserMeta.some((m) => m.id === id)) {
      window.parserMeta.push({
        id,
        title,
        domain: domains,
        urlPatterns: patternStrings,
        authors,
        authorsLinks,
        description,
        category,
        tags,
        mode,
        homepage,
        userAdd,
        userScript,
      });
    }

    window.parserMeta.sort((a, b) => {
      const aTitle = a.title || (Array.isArray(a.domain) ? a.domain[0] : a.domain) || "";
      const bTitle = b.title || (Array.isArray(b.domain) ? b.domain[0] : b.domain) || "";
      return aTitle.toLowerCase().localeCompare(bTitle.toLowerCase());
    });
  }

  scheduleParserListSaveOnce();
};

// Save parser metadata to storage
let scheduleSaveTimeout = null;

// It is used after RegisterParser operations to save to local storage once.
function scheduleParserListSaveOnce(delay = 1000) {
  if (scheduleSaveTimeout) clearTimeout(scheduleSaveTimeout);

  scheduleSaveTimeout = setTimeout(() => {
    scheduleParserListSave();
  }, delay);
}

async function scheduleParserListSave() {
  try {
    const meta = (window.parserMeta || []).filter((p) => p.id && p.domain && p.title && p.urlPatterns);
    const parserList = [];
    let { userScriptsList = [] } = await browser.storage.local.get(["userScriptsList"]);

    if (userScriptsList.length) {
      userScriptsList = userScriptsList.map((u) => ({
        ...u,
        id: u.id,
        urlPatterns: u.urlPatterns || [".*"],
        userScript: true,
      }));
    }

    const getTitle = (item) => item.title || (Array.isArray(item.domain) ? item.domain[0] : item.domain) || "";

    const mergedList = [...new Map([...parserList, ...meta, ...userScriptsList].map((item) => [item.id, item])).values()].sort((a, b) =>
      getTitle(a).toLowerCase().localeCompare(getTitle(b).toLowerCase()),
    );

    await browser.storage.local.set({ parserList: mergedList });

    // Apply UserScript Settings
    if (userScriptsList.length) {
      const allScripts = userScriptsList;
      for (const script of allScripts) {
        if (!script?.id || processedScripts.has(script.id)) continue;
        processedScripts.add(script.id);

        const settings = script.settings || [];
        await syncParserSettings(script.id, settings);
      }
    }
  } catch (error) {
    logError("[mainParser:scheduleParserListSave] Error saving parser list:", error);
  }
}

// Get current song info based on website and parser list
window.getSongInfoLastSong = null;
window.getSongInfo = async function () {
  try {
    const hostname = location.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = location.pathname;

    const exactParsers = window.parsers?.[hostname] || [];
    const wildcardParsers = Object.entries(window.parsers || {})
      .filter(([key]) => key.startsWith("*.") && isDomainMatch(key, hostname))
      .flatMap(([, parsers]) => parsers);

    const domainParsers = [...exactParsers, ...wildcardParsers];
    if (!domainParsers.length) return null;

    for (const parser of domainParsers) {
      try {
        const matches = parser.patterns?.some((re) => re.test(pathname));
        if (matches) {
          const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
          const isEnabled = parserEnabledState[`enable_${parser.id}`] !== false;

          if (isEnabled) {
            const song = await parser.parse();

            if (song) {
              // String Extraction
              let dataTitle = String(song.title || "").trim();
              let dataArtist = String(song.artist || "").trim();
              let dataSource = String(song.source || "").trim();

              // return null if there is no title, no artist and it is a library activity
              if (!song.title && !song.artist && parser.isLibraryActivity) return null;

              // Normalization
              const normalized = await normalizeTitleAndArtist(dataTitle, dataArtist);
              dataTitle = normalized?.title || dataTitle;
              dataArtist = normalized?.artist || dataArtist;

              dataTitle = truncate(dataTitle, 128, { fallback: "Unknown Song" });
              dataArtist = truncate(dataArtist, 128, { fallback: "Unknown Artist" });
              dataSource = truncate(dataSource, 32, { fallback: "Unknown Source" });

              const currentData = { title: dataTitle, artist: dataArtist, source: dataSource };
              const isChanged =
                !window.getSongInfoLastSong ||
                window.getSongInfoLastSong.title !== currentData.title ||
                window.getSongInfoLastSong.artist !== currentData.artist ||
                window.getSongInfoLastSong.source !== currentData.source;

              // Apply parser filters and replacements
              const filterResult = await applyParserFilters(parser.id, dataArtist, dataTitle);
              if (filterResult.shouldBlock) {
                if (isChanged) logInfo(`[mainParser]: Song blocked: ${dataArtist} - ${dataTitle} (Parser: ${parser.id} | Filter: ${filterResult.filterId})`);
                window.getSongInfoLastSong = currentData;
                return "blocked";
              }

              // Apply replacements if any
              if (filterResult.replaced) {
                dataArtist = filterResult.artist;
                dataTitle = filterResult.title;
                if (isChanged) logInfo(`[mainParser]: Song replaced: ${dataArtist} - ${dataTitle} (Parser: ${parser.id} | Filter: ${filterResult.filterId})`);
                window.getSongInfoLastSong = currentData;
              }

              song.title = dataTitle;
              song.artist = dataArtist;
              song.source = dataSource;
              return song;
            }
          }
        }
      } catch (err) {
        logError(`[mainParser]: Parser ${parser.id} failed:`, err);
        continue;
      }
    }

    return null;
  } catch (err) {
    logError("[mainParser]: getSongInfo error:", err);
    return null;
  }
};

// Apply parser filters and replacements
async function applyParserFilters(parserId, artist, title) {
  try {
    const { parserFilters = [] } = await browser.storage.local.get("parserFilters");

    if (!parserFilters || parserFilters.length === 0) {
      return { shouldBlock: false, replaced: false, artist, title };
    }

    // Normalize strings for comparison (case-insensitive)
    const normalizedArtist = artist.toLowerCase().trim();
    const normalizedTitle = title.toLowerCase().trim();

    for (const filter of parserFilters) {
      // Check if this filter applies to current parser
      const appliesToParser = filter.parsers.includes("*") || filter.parsers.includes(parserId);

      if (!appliesToParser) {
        continue;
      }

      // Determine if this is a replace filter or block filter
      const isReplaceFilter = filter.entries.some((e) => e.replaceArtist || e.replaceTitle);

      // Check each entry in the filter
      for (const entry of filter.entries) {
        const filterArtist = (entry.artist || "").toLowerCase().trim();
        const filterTitle = (entry.title || "").toLowerCase().trim();

        // If both are empty, skip this entry
        if (!filterArtist && !filterTitle) {
          continue;
        }

        // Check if current song matches the filter entry
        const artistMatch = !filterArtist || normalizedArtist === filterArtist;
        const titleMatch = !filterTitle || normalizedTitle === filterTitle;

        // If both conditions match for this entry
        if (artistMatch && titleMatch) {
          if (isReplaceFilter) {
            // Apply replacement
            const newArtist = entry.replaceArtist?.trim() || artist;
            const newTitle = entry.replaceTitle?.trim() || title;

            return {
              shouldBlock: false,
              replaced: true,
              artist: newArtist,
              title: newTitle,
              filterId: filter.id,
            };
          } else {
            // Block the song
            return {
              shouldBlock: true,
              replaced: false,
              artist,
              title,
              filterId: filter.id,
            };
          }
        }
      }
    }

    return { shouldBlock: false, replaced: false, artist, title };
  } catch (err) {
    logError("[mainParser:applyParserFilters]: error:", err);
    return { shouldBlock: false, replaced: false, artist, title };
  }
}

function getBestVideo(videoEls) {
  const getRectArea = (el) => {
    const r = el?.getBoundingClientRect?.();
    return r ? r.width * r.height : 0;
  };

  const isHiddenEl = (el) => {
    if (!el) return true;

    const style = window.getComputedStyle(el);

    if (style.display === "none" || style.visibility === "hidden") return true;
    if (parseFloat(style.opacity) === 0) return true;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return true;

    if (rect.bottom < -100 || rect.right < -100) return true;

    return false;
  };

  const isAdLike = (el) => {
    const parent = el.closest("[class]");
    if (!parent) return false;
    return [...parent.classList].some((c) => /ad|ads|advertisement|preroll/i.test(c));
  };

  const isFloating = (el) => {
    const parent = el.closest("[class]");
    if (!parent) return false;
    return [...parent.classList].some((c) => /float|pip|mini/i.test(c));
  };

  const scoreVideo = (v) => {
    if (isHiddenEl(v)) return -Infinity;

    let score = 0;
    if (!v.paused) score += 50;
    if (v.duration > 60) score += 20;
    score += 30;
    if (isAdLike(v)) score -= 40;
    if (isFloating(v)) score -= 20;
    score += getRectArea(v) / 1000;

    return score;
  };

  let videoEl = null;
  let bestScore = -Infinity;

  for (const v of videoEls) {
    if (!(v instanceof HTMLVideoElement)) continue;

    const score = scoreVideo(v);

    if (score > bestScore) {
      bestScore = score;
      videoEl = v;
    }
  }

  return videoEl
    ? { el: videoEl, duration: videoEl.duration ?? null, currentTime: videoEl.currentTime ?? null, playing: !videoEl.paused, area: getRectArea(videoEl) }
    : {};
}

function getBestData(iframeData, videoData) {
  const isValidNumber = (n) => typeof n === "number" && !Number.isNaN(n);

  const normalize = (data) => {
    if (!data) return null;

    return {
      duration: isValidNumber(data.duration) ? data.duration : null,
      currentTime: isValidNumber(data.currentTime) ? data.currentTime : 0,
      paused: typeof data.paused === "boolean" ? data.paused : null,
      playing: typeof data.playing === "boolean" ? data.playing : data.paused === false,
    };
  };

  const candidates = [normalize(iframeData), normalize(videoData)].filter(Boolean);

  if (candidates.length === 0) return {};

  if (candidates.length === 1) return candidates[0];

  const score = (d) => {
    let s = 0;

    // duration strong signal
    if (d.duration !== null && d.duration > 0) s += 3;

    // is currentTime meaningful
    if (d.currentTime > 0) s += 1;

    // additional signal if there is pause information

    if (typeof d.paused === "boolean") s += 1;

    // if playing true, strong signal
    if (d.playing === true) s += 2;

    // if area is meaningful, add it to the score
    if (d.area > 0) s += Math.log(d.area) * 0.5;

    return s;
  };

  const [a, b] = candidates;
  const scoreA = score(a);
  const scoreB = score(b);

  if (scoreA > scoreB) return a;
  if (scoreB > scoreA) return b;

  // if equal, the one with the greater duration
  if (a.duration && b.duration) {
    return a.duration >= b.duration ? a : b;
  }

  // last fallback: prefer the video element
  return videoData || iframeData || {};
}

// userScript Manager Listener
const lastUseScriptRequest = Object.create(null);
const firstTrackSentDomains = new Set();
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  const msg = event.data;

  if (msg?.type === "USER_SCRIPT_USE_SETTING_REQUEST") {
    const { id, key, label, inputType, defaultValue, requestId } = msg;

    try {
      const result = await useSetting(id, key, label, inputType, defaultValue === "" ? undefined : defaultValue);
      // Send back the result
      window.postMessage(
        {
          type: "USER_SCRIPT_USE_SETTING_RESPONSE",
          requestId,
          value: result,
        },
        "*",
      );
    } catch (err) {
      window.postMessage(
        {
          type: "USER_SCRIPT_USE_SETTING_RESPONSE",
          requestId,
          error: err.message,
        },
        "*",
      );
    }
  }
  if (msg?.type === "USER_SCRIPT_CLEAR_ACTIVITY") {
    const domain = msg.domain || location.host;
    window.latestUserScriptData[domain] = { __clear: true };
    try {
      browser.runtime.sendMessage({ type: "RESTART_LOOP" });
    } catch (e) {}
  }
  if (msg?.type === "USER_SCRIPT_IFRAME_DATA_REQUEST") {
    const { requestId, id, iframeSelectors } = msg;
    const key = id;
    fetchIframeData(key, iframeSelectors).then((data) => {
      window.postMessage(
        {
          type: "USER_SCRIPT_IFRAME_DATA_RESPONSE",
          requestId,
          data: data ?? null,
        },
        "*",
      );
    });
  }
  if (msg?.type === "USER_SCRIPT_TRACK_DATA") {
    // Handle User Script Track Data
    const now = Date.now();
    const domain = msg.data.domain || location.host;
    const prevSong = window.latestUserScriptData[domain];
    const newSong = msg.data.song;

    const isSignificantChange =
      !prevSong ||
      prevSong.isPlaying !== newSong.isPlaying ||
      (typeof prevSong.timePassed === "number" && typeof newSong.timePassed === "number" && Math.abs(newSong.timePassed - prevSong.timePassed) > 2);

    window.latestUserScriptData[domain] = newSong;

    if (!firstTrackSentDomains.has(domain)) {
      firstTrackSentDomains.add(domain);
      try {
        browser.runtime.sendMessage({ type: "RESTART_LOOP" });
      } catch (e) {}
    } else if (isSignificantChange) {
      try {
        browser.runtime.sendMessage({ type: "RESTART_LOOP" });
      } catch (e) {}
    }

    window.latestUserScriptData[domain] = msg.data.song;
    window.latestUserScriptMeta = window.latestUserScriptMeta || {};
    window.latestUserScriptMeta[domain] = msg.data;

    if (typeof window.registerParser === "function") {
      const autoDetectEnabled = msg.data.mode === "watch" && msg.data.watchAutoDetect && msg.data.watchAutoDetect !== "disable";
      window.registerParser?.({
        title: msg.data.title,
        domain: msg.data.domains || msg.data.domain,
        authors: msg.data.authors,
        authorsLinks: msg.data.authorsLinks,
        homepage: msg.data.homepage,
        description: msg.data.description,
        category: msg.data.category,
        tags: msg.data.tags,
        urlPatterns: msg.data.urlPatterns,
        mode: msg.data.mode,
        watchAutoDetect: msg.data.watchAutoDetect,
        userAdd: false,
        userScript: true,
        ...(msg.data.isLibraryActivity && {
          isLibraryActivity: msg.data.isLibraryActivity,
        }),
        fn: async function ({ iframeData }) {
          try {
            const song = window.latestUserScriptData[msg.data.domain];
            if (!song) return null;
            if (song.__clear) return -1;

            const latestMeta = window.latestUserScriptMeta?.[msg.data.domain];
            const currentAutoDetect = latestMeta
              ? latestMeta.mode === "watch" && latestMeta.watchAutoDetect && latestMeta.watchAutoDetect !== "disable"
              : autoDetectEnabled;

            const videoData = currentAutoDetect ? getBestVideo(document.querySelectorAll("video")) : null;
            const { duration, currentTime, playing } = iframeData || videoData ? getBestData(iframeData, videoData) : {};

            return {
              title: song.title,
              artist: song.artist,
              image: song.image,
              source: song.source,
              link: song.link || song.songUrl,
              timePassed: currentTime || song.timePassed,
              duration: duration || song.duration,
              buttons: song.buttons,
              mode: msg.data.mode,
              isPlaying: Boolean(song.isPlaying || playing),
            };
          } catch (err) {
            logError("[mainParser:userScript]: User script parser error:", err);
            return null;
          }
        },
        ...(autoDetectEnabled && {
          iframeFn: true,
        }),
        ...(msg.data.iframeSelectors && {
          iframeSelectors: msg.data.iframeSelectors,
        }),
      });
    }
  }
});

// Load Selector Parsers
async function loadAllSavedUserParsers() {
  const settings = await browser.storage.local.get("userParserSelectors");
  const parserArray = settings.userParserSelectors;

  if (!Array.isArray(parserArray)) return;

  for (const data of parserArray) {
    if (!data.selectors || !data.domain) continue;

    const get = (key) => {
      try {
        const sel = data.selectors[key];
        if (!sel) return null;
        const { cleanSelector } = parseIgnoreSelector(sel);
        return querySelectorDeep(cleanSelector);
      } catch (e) {
        logError(`[mainParser:loadAllSavedUserParsers]: Selector error for key "${key}" in domain "${data.domain}":`, e);
        return null;
      }
    };

    const rawDomain = Array.isArray(data.domain) ? data.domain[0] : data.domain;
    const hostname = (typeof rawDomain === "string" ? rawDomain : String(rawDomain)).toLowerCase();
    const locHostname = location.hostname.replace(/^www\./, "").toLowerCase();
    const autoDetectEnabled = data.selectors.mode === "watch" && data.selectors.watchAutoDetect && data.selectors.watchAutoDetect !== "disable";
    const parserId = data.id || generateParserKey(hostname, data.urlPatterns || [".*"]);

    window.registerParser?.({
      domain: hostname,
      title: data.title || hostname,
      urlPatterns: data.urlPatterns,
      userAdd: true,
      mode: data.selectors.mode || "listen",
      fn: async function ({ iframeData }) {
        if (!isDomainMatch(hostname, locHostname)) return null;

        try {
          const videoData = autoDetectEnabled ? getBestVideo(document.querySelectorAll("video")) : null;
          const { duration, currentTime, playing } = iframeData || videoData ? getBestData(iframeData, videoData) : {};

          const title = getText(data.selectors["title"]) || getPlainText(data.selectors["title"]) || "";
          const artistRaw = getText(data.selectors["artist"]) || getPlainText(data.selectors["artist"]);
          const artist = artistRaw ? artistRaw : "-1";
          const source = getText(data.selectors["source"]) || getPlainText(data.selectors["source"]) || "";
          const image = getImage(data.selectors["image"]);
          const link = getSafeHref(get, "link", data.link || data.songUrl || location.href);
          const buttonLink = getSafeHref(get, "buttonLink", data.selectors.buttonLink);
          const buttonText = getSafeText(get, "buttonText", data.selectors.buttonText);
          const buttonLink2 = getSafeHref(get, "buttonLink2", data.selectors.buttonLink2);
          const buttonText2 = getSafeText(get, "buttonText2", data.selectors.buttonText2);

          return {
            title,
            artist,
            image,
            source: artist === source ? data.title : source || location.hostname.replace(/^www\./i, ""),
            link,
            timePassed: currentTime || getText(data.selectors["timePassed"]) || "",
            duration: duration || getText(data.selectors["duration"]) || "",
            isPlaying: Boolean(get("isPlaying") || playing),
            mode: data.selectors.mode || "listen",
            buttons: [
              buttonLink && buttonText
                ? {
                    link: buttonLink,
                    text: buttonText,
                  }
                : null,
              buttonLink2 && buttonText2
                ? {
                    link: buttonLink2,
                    text: buttonText2,
                  }
                : null,
            ].filter(Boolean),
          };
        } catch (e) {
          logError(`[mainParser:selectorParser]: Selector parser error (${hostname}):`, e);
          return null;
        }
      },

      ...(autoDetectEnabled && {
        iframeFn: true,
      }),
    });
  }
}

// Sync Parser Settings
async function syncParserSettings(id, declaredSettings = []) {
  const settingKey = `settings_${id}`;

  if (!settingsCache[settingKey]) {
    const { parserSettings = {} } = await browser.storage.local.get("parserSettings");
    settingsCache[settingKey] = parserSettings[settingKey] || {};
  }

  const declaredKeys = new Set([...Object.keys(DEFAULT_PARSER_OPTIONS), ...declaredSettings.map((s) => s.key)]);

  const cached = settingsCache[settingKey];
  let changed = false;

  for (const key of Object.keys(cached)) {
    if (!declaredKeys.has(key)) {
      logInfo(`[mainParser:settings]: Deleting orphan key "${key}" from parser "${id}"`);
      delete cached[key];
      changed = true;
    }
  }

  if (changed) {
    if (saveTimers[settingKey]) {
      clearTimeout(saveTimers[settingKey]);
      delete saveTimers[settingKey];
    }

    settingsCache[settingKey] = cached;

    const { parserSettings = {} } = await browser.storage.local.get("parserSettings");
    await browser.storage.local.set({
      parserSettings: { ...parserSettings, [settingKey]: cached },
    });
  }

  for (const [key, opt] of Object.entries(DEFAULT_PARSER_OPTIONS)) {
    await useSetting(id, key, opt.label, opt.type, opt.value);
  }

  for (const s of declaredSettings) {
    await useSetting(id, s.key, s.label, s.type, s.defaultValue);
  }
}

// Cleanup Orphan Settings And Enables
async function cleanupOrphanSettingsAndEnables() {
  try {
    const {
      userScriptsList = [],
      userParserSelectors = [],
      parserSettings = {},
      parserEnabledState = {},
    } = await browser.storage.local.get(["userScriptsList", "userParserSelectors", "parserSettings", "parserEnabledState"]);

    // At least one of them must be filled
    if (!userScriptsList.length && !userParserSelectors.length) return;

    const validIds = new Set([...userScriptsList.map((s) => s.id), ...userParserSelectors.map((s) => s.id)]);

    // parserSettings cleanup
    let settingsDirty = false;
    for (const key of Object.keys(parserSettings)) {
      if (!key.startsWith("settings_")) continue;
      const id = key.slice("settings_".length);
      if (!validIds.has(id)) {
        logInfo(`[mainParser:settings]: Deleted Orphan Setting: ${key}`);
        delete parserSettings[key];
        delete settingsCache[key];
        settingsDirty = true;
      }
    }
    if (settingsDirty) await browser.storage.local.set({ parserSettings });

    // parserEnabledState cleanup
    let enableDirty = false;
    for (const key of Object.keys(parserEnabledState)) {
      if (!key.startsWith("enable_")) continue;
      const id = key.slice("enable_".length);
      if (!validIds.has(id)) {
        logInfo(`[mainParser:settings]: Deleted Orphan Enable: ${key}`);
        delete parserEnabledState[key];
        enableDirty = true;
      }
    }
    if (enableDirty) await browser.storage.local.set({ parserEnabledState });
  } catch (e) {
    logError("[mainParser:cleanupOrphanSettingsAndEnables]: error:", e);
  }
}

const activeFetchIframeListeners = Object.create(null);

function fetchIframeData(key, iframeSelectors = null, maxDelayMs = 10000) {
  if (activeFetchIframeListeners[key]) {
    browser.runtime.onMessage.removeListener(activeFetchIframeListeners[key]);
    delete activeFetchIframeListeners[key];
  }

  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = (value) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      browser.runtime.onMessage.removeListener(listener);
      delete activeFetchIframeListeners[key];
      resolve(value);
    };

    const timeoutId = setTimeout(() => {
      delete window.iframeDataCache?.[key];
      cleanup(undefined);
    }, maxDelayMs);

    const listener = (msg) => {
      if (msg?.type !== "IFRAME_DATA" || msg.key !== key) return;
      if (msg.data == null) return;

      const cache = (window.iframeDataCache ??= {});
      const prev = cache[key];

      let lastValidValues = { ...prev?.lastValidValues };
      if (prev?.href !== msg.href) {
        lastValidValues = {};
      }

      for (const [k, v] of Object.entries(msg.data)) {
        if (v != null && v !== "" && (typeof v !== "number" || isFinite(v))) {
          lastValidValues[k] = v;
        }
      }

      const entry = {
        ...msg.data,
        lastValidValues,
        lastValidUpdate: Date.now(),
        origin: msg.origin,
        href: msg.href,
        ...(msg.data.duration != null && isFinite(msg.data.duration)
          ? { duration: msg.data.duration }
          : lastValidValues.duration != null
            ? { duration: lastValidValues.duration }
            : {}),
        ...(msg.data.paused != null ? { playing: msg.data.paused === false } : {}),
      };
      cache[key] = entry;
      cleanup(entry);
    };

    activeFetchIframeListeners[key] = listener;
    browser.runtime.onMessage.addListener(listener);
    browser.runtime
      .sendMessage({
        type: "FETCH_IFRAME_DATA",
        key,
        ...(iframeSelectors ? { iframeSelectors } : {}),
      })
      .catch(() => {});
  });
}

// Global unhandled promise rejection handler
window.addEventListener("unhandledrejection", (event) => {
  if (errorFilter.shouldIgnore(event.reason)) {
    event.preventDefault();
  }
});

// Global error handler
window.addEventListener("error", (event) => {
  if (errorFilter.shouldIgnore(event.error || event.message)) {
    event.preventDefault();
  }
});

(async function init() {
  await domReady();
  await window.initParsers();

  window.__parserSystemReady = true;
  window.dispatchEvent(new Event("parser-ready"));
})();
