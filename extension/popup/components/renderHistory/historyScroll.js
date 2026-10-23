async function activateHistoryScroll() {
  historyState.activeScrollCleanup?.();
  historyState.activeScrollCleanup = null;

  const cleanup = await createHistoryScroll({
    panel: document.getElementById("historyPanel"),
    isAllLoaded: () => {
      const src = historyState.isFiltering ? historyState.filteredHistory : historyState.fullHistory;
      return historyState.currentOffset >= src.length;
    },
    renderMore: async () => {
      await renderHistory({
        reset: false,
        query: document.getElementById("historySearchBox")?.value ?? "",
      });
    },
    loaderDelayMs: 500,
    loadCooldownMs: 200,
  });

  historyState.activeScrollCleanup = cleanup;
}
