// Create DOM elements
function createHistoryDOM() {
  const dom = {};

  // Modal
  dom.modal = document.createElement("div");
  dom.modal.id = "historyModal";
  dom.modal.className = "history-modal";

  // Content
  dom.content = document.createElement("div");
  dom.content.className = "history-modal-content";

  // Header
  dom.header = document.createElement("div");
  dom.header.className = "history-modal-header";

  // Search controls (popup-style: input with reset + filter icons inside)
  dom.searchControls = document.createElement("div");
  dom.searchControls.className = "history-search-controls";

  dom.searchBox = document.createElement("input");
  dom.searchBox.type = "text";
  dom.searchBox.id = "historySearchBox";
  dom.searchBox.setAttribute("data-i18n", "history.search_history");
  dom.searchBox.setAttribute("data-i18n-attr", "placeholder");
  dom.searchBox.placeholder = "Search history...";

  // Reset button - visible while a source filter or a search query is active
  dom.resetBtn = document.createElement("button");
  dom.resetBtn.type = "button";
  dom.resetBtn.id = "historyFilterResetBtn";
  dom.resetBtn.className = "icon-btn";
  dom.resetBtn.setAttribute("data-i18n", "common.reset");
  dom.resetBtn.setAttribute("data-i18n-attr", "title");
  dom.resetBtn.title = "Reset Filter";
  dom.resetBtn.setAttribute("aria-label", "Reset Filter");
  dom.resetBtn.style.display = "none";
  dom.resetBtn.appendChild(createSVG(svg_paths.crossIconPaths));

  dom.filterBtn = document.createElement("button");
  dom.filterBtn.type = "button";
  dom.filterBtn.id = "historyFilterBtn";
  dom.filterBtn.className = "history-filter";
  dom.filterBtn.setAttribute("data-i18n", "history.filter_source");
  dom.filterBtn.setAttribute("data-i18n-attr", "title");
  dom.filterBtn.title = "Filter by Source";
  dom.filterBtn.setAttribute("aria-label", "Filter by Source");
  dom.filterBtn.appendChild(createSVG(svg_paths.filterIconPaths));

  dom.searchControls.append(dom.searchBox, dom.resetBtn, dom.filterBtn);
  dom.header.appendChild(dom.searchControls);

  // Filter menu (anchored to the header like the popup filter menu)
  dom.filterMenu = document.createElement("div");
  dom.filterMenu.id = "historyFilterMenu";
  dom.filterMenu.className = "history-filter-menu";

  dom.filterMenuContent = document.createElement("div");
  dom.filterMenuContent.id = "historyFilterMenuContent";
  dom.filterMenuContent.className = "history-filter-menu-content";

  dom.filterMenu.appendChild(dom.filterMenuContent);
  dom.header.appendChild(dom.filterMenu);

  // Mode switch (Music / Video / All), shared with the popup history panel.
  // Defaults to "all" here and is synced with HistoryState in initHistoryModal
  // (HistoryState is not evaluated yet when this DOM is built at bundle start).
  dom.modeSwitch = createHistoryModeSwitch({
    onModeChange: async (value, modeSwitch) => {
      if (HistoryState.activeMode === value) return;
      HistoryState.activeMode = value;

      modeSwitch.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === value));

      if (HistoryState.activeScrollCleanup) {
        HistoryState.activeScrollCleanup();
        HistoryState.activeScrollCleanup = null;
      }

      await HistoryRenderer.render({ reset: true, query: HistoryDOM.searchBox.value });
      await HistoryScroll.activate();
    },
  });
  dom.header.appendChild(dom.modeSwitch);

  dom.content.appendChild(dom.header);

  // History panel
  dom.panel = document.createElement("div");
  dom.panel.id = "historyPanel";
  dom.panel.className = "history-panel";
  dom.content.appendChild(dom.panel);

  // Footer
  dom.footer = document.createElement("div");
  dom.footer.id = "historyFooter";

  dom.closeBtn = document.createElement("button");
  dom.closeBtn.textContent = "Close";
  dom.closeBtn.className = "history-modal-close btn";
  dom.closeBtn.setAttribute("data-i18n", "common.close");

  dom.footer.appendChild(dom.closeBtn);
  dom.content.appendChild(dom.footer);

  dom.modal.appendChild(dom.content);
  document.body.appendChild(dom.modal);

  return dom;
}

const HistoryDOM = createHistoryDOM();

// INIT
function initHistoryModal() {
  // Sync the mode switch with the evaluated state and set up event listeners
  HistoryDOM.modeSwitch.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === HistoryState.activeMode));

  // Event listeners
  HistoryDOM.closeBtn.addEventListener("click", () => HistoryModal.close());
  HistoryDOM.filterBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    HistoryDOM.filterMenu.classList.toggle("open");

    if (HistoryDOM.filterMenu.classList.contains("open")) {
      const contentHeight = HistoryDOM.filterMenuContent.scrollHeight;
      const finalHeight = Math.min(contentHeight, 170);
      HistoryDOM.filterMenu.style.height = finalHeight + "px";
    } else {
      HistoryDOM.filterMenu.style.height = "0";
    }

    updateHistoryFilterResetVisibility(HistoryDOM.resetBtn, HistoryState, HistoryDOM.searchBox);

    await destroySimplebar("historyFilterMenuContent");
    await activateSimpleBar("historyFilterMenuContent");
  });

  // Reset clears the active source filter and the search query, then re-renders
  HistoryDOM.resetBtn.addEventListener("click", async () => {
    HistoryState.selectedSources.clear();
    HistoryDOM.searchBox.value = "";
    updateHistoryFilterResetVisibility(HistoryDOM.resetBtn, HistoryState, HistoryDOM.searchBox);

    if (HistoryState.activeScrollCleanup) {
      HistoryState.activeScrollCleanup();
      HistoryState.activeScrollCleanup = null;
    }

    await HistoryRenderer.render({ reset: true, query: "" });
    await destroySimplebar("historyFilterMenuContent");
    HistoryRenderer.renderSourceFilter();
    await activateSimpleBar(["historyPanel", "historyFilterMenuContent"]);
    await HistoryScroll.activate();
  });

  const debouncedSearch = debounce(async () => {
    await HistoryRenderer.render({ reset: true, query: HistoryDOM.searchBox.value });
    await HistoryScroll.activate();
  }, 200);

  HistoryDOM.searchBox.addEventListener("input", debouncedSearch);
  HistoryDOM.searchBox.addEventListener("input", () => updateHistoryFilterResetVisibility(HistoryDOM.resetBtn, HistoryState, HistoryDOM.searchBox));
  document.getElementById("openHistoryBtn").addEventListener("click", () => HistoryModal.open());
}
