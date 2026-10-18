const FilterState = {
  // Data
  parserList: [],
  parserFilters: [],

  // Form state
  form: {
    isOpen: false,
    editingFilterId: null,
    mode: "filter", // 'filter' | 'replace'
    entries: [{ artist: "", title: "", replaceArtist: "", replaceTitle: "" }],
    replaceAction: "update", // 'update' | 'revert'
  },

  // Parser selection state - mutated by ParserController, read by _renderForm
  parsers: {
    allSelected: false,
    selectedIds: [], // Order matters for display
  },

  // UI state
  ui: {
    activeTab: "all", // 'all' | 'block' | 'replace'
    searchQuery: "",
  },
};

// STORAGE - Browser storage operations
const FilterStorage = {
  async loadParsers() {
    try {
      const { parserList } = await browser.storage.local.get("parserList");
      FilterState.parserList = parserList || [];
    } catch (error) {
      logError("[FilterStorage:loadParsers]: Failed to load parsers:", error);
      FilterState.parserList = [];
    }
  },

  async loadFilters() {
    try {
      const { parserFilters } = await browser.storage.local.get("parserFilters");
      FilterState.parserFilters = parserFilters || [];
    } catch (error) {
      logError("[FilterStorage:loadFilters]: Failed to load filters:", error);
      FilterState.parserFilters = [];
    }
  },

  async saveFilters() {
    try {
      await browser.storage.local.set({ parserFilters: FilterState.parserFilters });
    } catch (error) {
      logError("[FilterStorage:saveFilters]: Failed to save filters:", error);
      showAlert(i18n.t("filter.saveFailed"), "", "warn");
      throw error;
    }
  },
};
