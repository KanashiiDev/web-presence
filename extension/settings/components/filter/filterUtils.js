// UTILS
const FilterUtils = {
  generateId() {
    return Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 8);
  },

  // Normalize string for comparison
  normalize(str) {
    return (str || "").toLowerCase().trim();
  },

  // Check if filter is replace mode
  isReplaceFilter(filter) {
    return filter.entries.some((e) => e.replaceArtist || e.replaceTitle);
  },

  // Create entry key for duplicate checking
  createEntryKey(entry, includeReplace = false) {
    const artist = this.normalize(entry.artist);
    const title = this.normalize(entry.title);

    if (!includeReplace) {
      return `${artist}|||${title}`;
    }

    const replaceArtist = this.normalize(entry.replaceArtist);
    const replaceTitle = this.normalize(entry.replaceTitle);
    return `${artist}|||${title}|||${replaceArtist}|||${replaceTitle}`;
  },

  // Check for duplicate entry across all filters
  findDuplicate(entry, includeReplace = false) {
    const key = this.createEntryKey(entry, includeReplace);

    for (const filter of FilterState.parserFilters) {
      const filterIsReplace = this.isReplaceFilter(filter);

      for (const existing of filter.entries) {
        const existingKey = this.createEntryKey(existing, filterIsReplace);
        if (existingKey === key) {
          return { isDuplicate: true, filterId: filter.id };
        }
      }
    }

    return { isDuplicate: false };
  },

  // Filter duplicates from array
  removeDuplicates(entries, includeReplace = false) {
    const seen = new Set();
    return entries.filter((entry) => {
      const key = this.createEntryKey(entry, includeReplace);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
};

// EVENT MANAGER - Event listener tracking
const FilterEvents = {
  listeners: new Map(),

  add(element, event, handler) {
    element.addEventListener(event, handler);
    if (!this.listeners.has(element)) {
      this.listeners.set(element, []);
    }
    this.listeners.get(element).push({ event, handler });
  },

  removeFrom(element) {
    const handlers = this.listeners.get(element);
    if (handlers) {
      handlers.forEach(({ event, handler }) => {
        element.removeEventListener(event, handler);
      });
      this.listeners.delete(element);
    }
  },

  clearAll() {
    this.listeners.forEach((handlers, element) => {
      handlers.forEach(({ event, handler }) => {
        element.removeEventListener(event, handler);
      });
    });
    this.listeners.clear();
  },
};

// Activity FETCHER - Fetch current playing activity
const ActivityFetcher = {
  async fetch(buttonElement, buttonText) {
    const originalText = buttonText || buttonElement.textContent;
    buttonElement.disabled = true;
    buttonElement.textContent = i18n.t("filter.fetching");
    await new Promise((r) => requestAnimationFrame(r));

    const maxAttempts = 4;
    let activityData = null;

    for (let i = 0; i < maxAttempts; i++) {
      const response = await sendAction("getActivityInfo");

      if (!response.ok || !response.data?.title || !response.data?.artist) {
        if (i === maxAttempts - 1) break;
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      if (!activityData) activityData = response.data;
      if (response.data.parserId) {
        activityData = response.data;
        break;
      }

      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }

    return {
      activityData,
      resetButton: () => {
        buttonElement.textContent = originalText;
        buttonElement.style.color = "";
        buttonElement.disabled = false;
      },
    };
  },
};

// QUICK ACTIONS - Fill current activity, block current activity
const QuickActions = {
  fillTimeout: null,
  blockTimeout: null,

  async fillCurrent(renderEntries, btn) {
    if (!btn) btn = document.querySelector("#fillFormBtn");
    if (!btn) return;

    const originalText = btn.textContent;
    const isReplace = FilterState.form.mode === "replace";
    clearTimeout(this.fillTimeout);

    // Force repaint
    const { activityData, resetButton } = await ActivityFetcher.fetch(btn, originalText);

    if (!activityData) {
      btn.textContent = i18n.t("filter.fetching.empty");
      btn.style.color = "var(--red-color)";
      this.fillTimeout = setTimeout(resetButton, 2000);
      return;
    }

    const { title, artist, parserId } = activityData;

    // Check duplicate
    const entry = { artist, title, replaceArtist: "", replaceTitle: "" };
    const duplicate = FilterUtils.findDuplicate(entry, isReplace);

    if (duplicate.isDuplicate) {
      btn.textContent = i18n.t("filter.exists");
      btn.style.color = "var(--yellow-color)";
      this.fillTimeout = setTimeout(resetButton, 2000);
      return;
    }

    // Check if last entry is empty - reuse it, otherwise add new
    const lastIndex = FilterState.form.entries.length - 1;
    const lastEntry = FilterState.form.entries[lastIndex];
    const isLastEmpty = !lastEntry.artist.trim() && !lastEntry.title.trim();

    if (isLastEmpty) {
      // Fill the existing empty slot
      FilterState.form.entries[lastIndex].artist = artist;
      FilterState.form.entries[lastIndex].title = title;
    } else {
      // All slots are filled - add a new one
      FilterState.form.entries.push({ artist, title, replaceArtist: "", replaceTitle: "" });
    }

    // Re-render entries so inputs are visible immediately
    if (typeof renderEntries === "function") {
      renderEntries();
    }

    // Select parser
    if (parserId) {
      ParserController.toggle(parserId.toString(), true);
    }

    // Success
    btn.textContent = i18n.t("filter.fetching.complete");
    btn.style.color = "var(--green-color)";
    this.fillTimeout = setTimeout(resetButton, 1500);
  },

  async blockCurrent() {
    const activityInfoBtn = document.querySelector("#getActivityInfoBtn span");
    const parentBtn = document.querySelector("#getActivityInfoBtn");

    if (!activityInfoBtn || !parentBtn) return;

    const buttonText = i18n.t("filter.blockCurrent");
    clearTimeout(this.blockTimeout);

    const { activityData, resetButton } = await ActivityFetcher.fetch(activityInfoBtn, buttonText);

    const resetWithParent = () => {
      resetButton();
      parentBtn.disabled = false;
    };

    if (!activityData) {
      activityInfoBtn.textContent = i18n.t("filter.blockCurrent.empty");
      parentBtn.style.backgroundColor = "var(--red-color-dark)";
      parentBtn.style.color = "var(--text-color-btn)";
      this.blockTimeout = setTimeout(() => {
        parentBtn.style.backgroundColor = "";
        parentBtn.style.color = "";
        resetWithParent();
      }, 2000);
      return;
    }

    const { title, artist, parserId } = activityData;

    // Check duplicate
    const entry = { artist, title, replaceArtist: "", replaceTitle: "" };
    const duplicate = FilterUtils.findDuplicate(entry, false);

    if (duplicate.isDuplicate) {
      activityInfoBtn.textContent = i18n.t("filter.exists");
      this.blockTimeout = setTimeout(resetWithParent, 2000);
      return;
    }

    if (!parserId) {
      activityInfoBtn.textContent = i18n.t("filter.pending");
      this.blockTimeout = setTimeout(resetWithParent, 2000);
      return;
    }

    // Find or create filter
    const existingIndex = FilterState.parserFilters.findIndex((f) => {
      const isBlock = !FilterUtils.isReplaceFilter(f);
      return isBlock && f.parsers.includes(parserId);
    });

    if (existingIndex !== -1) {
      FilterState.parserFilters[existingIndex].entries.push({ artist, title });
      FilterState.parserFilters[existingIndex].updatedAt = new Date().toISOString();
    } else {
      FilterState.parserFilters.push({
        id: FilterUtils.generateId(),
        createdAt: new Date().toISOString(),
        entries: [{ artist, title }],
        parsers: [parserId],
      });
    }

    await FilterStorage.saveFilters();

    FilterTabsController.render();
    FilterListController.render();

    // Success
    activityInfoBtn.textContent = i18n.t("filter.blockCurrent.complete");
    activityInfoBtn.style.color = "var(--green-color)";
    this.blockTimeout = setTimeout(resetWithParent, 1500);
  },
};
