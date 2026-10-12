const historyState = {
  cleaningMode: false,
  isFiltering: false,
  fullHistory: [],
  filteredHistory: [],
  currentOffset: 0,
  maxHistoryItemLoad: 20,
  lastRenderedHeader: null,
  scrollElement: null,
  scrollListenerRef: null,
  activeScrollCleanup: null,
  selectedSources: new Set(),
  sourceMenuBuilt: false,
  activeMode: "all",
};

async function renderHistory({ reset = true, query = "" } = {}) {
  const { selectedSources } = historyState;
  const historyPanel = document.getElementById("historyPanel");
  const filterBtn = document.getElementById("historyFilterBtn");

  filterBtn.dataset.listenerAdded ??= (() => {
    filterBtn.addEventListener("click", handleFilterButtonClick);
    return "true";
  })();

  if (historyState.cleaningMode) {
    historyPanel._cleanupCheckboxListener?.();
    historyPanel._cleanupTrashListener?.();
  }

  const sbInstance = simpleBarInstances.get(historyPanel);
  const target = sbInstance?.getContentElement() ?? historyPanel;

  if (reset) {
    target.innerHTML = "";
    historyPanel.style.paddingRight = "";
    historyState.lastRenderedHeader = null;
    historyState.currentOffset = 0;

    const spinner = createSpinner("history-spinner");
    target.appendChild(spinner);

    const res = await sendAction("loadHistory");
    historyState.fullHistory = res.data;
  }

  buildHistorySourceCache();
  target.querySelector(".history-spinner.spinner")?.remove();

  const searchQuery = query.trim();
  const modeFiltered = historyState.activeMode !== "all";
  const hasFilter = searchQuery || selectedSources.size > 0 || modeFiltered;

  if (hasFilter) {
    const lq = searchQuery.toLowerCase();
    historyState.filteredHistory = historyState.fullHistory.filter((entry) => {
      const matchesText = !searchQuery || `${entry.t} ${entry.a}`.toLowerCase().includes(lq);
      const matchesSource = selectedSources.size === 0 || selectedSources.has(entry.s);
      const matchesMode = historyState.activeMode === "all" || entry.m === historyState.activeMode || (!entry.m && historyState.activeMode === "listen");
      return matchesText && matchesSource && matchesMode;
    });
    historyState.isFiltering = true;
  } else {
    historyState.filteredHistory = [];
    historyState.isFiltering = false;
  }

  const dataSource = historyState.isFiltering ? historyState.filteredHistory : historyState.fullHistory;
  const end = Math.min(historyState.currentOffset + historyState.maxHistoryItemLoad, dataSource.length);
  const pagedHistory = dataSource.slice(historyState.currentOffset, end);
  historyState.currentOffset = end;

  if (reset && !pagedHistory.length) {
    const emptyMsg = Object.assign(document.createElement("i"), {
      textContent: hasFilter ? i18n.t("common.noResults") : i18n.t("common.empty"),
    });
    target.appendChild(emptyMsg);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const entry of pagedHistory) {
    const time = new Date(entry.p);
    const header = isSameDay(time, dateToday) ? i18n.t("stats.today") : isSameDay(time, dateYesterday) ? i18n.t("stats.yesterday") : dateFull(time);

    if (header !== historyState.lastRenderedHeader) {
      const h3 = Object.assign(document.createElement("h3"), { textContent: header });
      h3.style.marginTop = "10px";
      fragment.appendChild(h3);
      historyState.lastRenderedHeader = header;
    }

    const historyIndex = historyState.fullHistory.indexOf(entry);
    fragment.appendChild(createHistoryEntry(entry, historyIndex, "history"));
  }

  target.appendChild(fragment);
  new Promise(requestAnimationFrame);
  applyTranslations();

  if (historyState.cleaningMode) attachCheckboxListeners();
}
