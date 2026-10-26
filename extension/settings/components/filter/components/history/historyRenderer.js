// RENDERER
const HistoryRenderer = {
  async render({ reset = true, query = "" } = {}) {
    await renderHistoryList({
      panel: HistoryDOM.panel,
      state: HistoryState,
      query,
      reset,
      pageSize: HistoryState.maxLoad,
      buildEntry: (entry, historyIndex) => HistoryUtils.createHistoryEntry(entry, historyIndex),
      additionalFilter: () => ({
        active: HistoryState.activeMode !== "all",
        test: (entry) => HistoryState.activeMode === "all" || entry.m === HistoryState.activeMode || (!entry.m && HistoryState.activeMode === "listen"),
      }),
      afterRender: async ({ target, dataSourceLength }) => {
        await activateSimpleBar("historyPanel");

        // Keep rendering until the panel overflows so continuous scroll can take over.
        const sb = simpleBarInstances.get(HistoryDOM.panel);
        const scrollEl = sb?.getScrollElement?.() || target;
        if (HistoryState.currentOffset < dataSourceLength && scrollEl.scrollHeight <= scrollEl.clientHeight + 1) {
          await HistoryRenderer.render({ reset: false, query });
        }
      },
    });
  },

  renderSourceFilter() {
    renderSourceFilterMenuContent({
      content: HistoryDOM.filterMenuContent,
      state: HistoryState,
      onSelectionChange: async () => {
        updateHistoryFilterResetVisibility(HistoryDOM.resetBtn, HistoryState, HistoryDOM.searchBox);

        if (HistoryState.activeScrollCleanup) {
          HistoryState.activeScrollCleanup();
          HistoryState.activeScrollCleanup = null;
        }

        await HistoryRenderer.render({ reset: true, query: HistoryDOM.searchBox.value });

        await destroySimplebar("historyFilterMenuContent");
        HistoryRenderer.renderSourceFilter();
        await activateSimpleBar(["historyPanel", "historyFilterMenuContent"]);
        await HistoryScroll.activate();
      },
    });
  },
};
