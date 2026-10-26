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
  loadFailed: false,
};

async function renderHistory({ reset = true, query = "" } = {}) {
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

  buildHistorySourceCache();

  await renderHistoryList({
    panel: historyPanel,
    state: historyState,
    query,
    reset,
    pageSize: historyState.maxHistoryItemLoad,
    spinnerClass: "history-spinner",
    buildEntry: (entry, historyIndex) => createHistoryEntry(entry, historyIndex, "history"),
    buildHeader: (header) => {
      const h3 = Object.assign(document.createElement("h3"), { textContent: header });
      h3.style.marginTop = "10px";
      return h3;
    },
    additionalFilter: () => ({
      active: historyState.activeMode !== "all",
      test: (entry) => historyState.activeMode === "all" || entry.m === historyState.activeMode || (!entry.m && historyState.activeMode === "listen"),
    }),
    emptyText: (hasFilter) => (hasFilter ? i18n.t("common.noResults") : historyState.loadFailed ? i18n.t("history.loadFailed") : i18n.t("common.empty")),
    onReset: (panel) => {
      panel.style.paddingRight = "";
    },
    afterRender: () => {
      applyTranslations();
      if (historyState.cleaningMode) attachCheckboxListeners();
    },
  });
}
