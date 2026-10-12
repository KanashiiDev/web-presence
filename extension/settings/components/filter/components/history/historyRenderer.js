// RENDERER
const HistoryRenderer = {
  async render({ reset = true, query = "" } = {}) {
    const sb = simpleBarInstances.get(HistoryDOM.panel);
    const target = sb?.getContentElement() || HistoryDOM.panel;

    if (reset) {
      target.innerHTML = "";
      HistoryState.lastRenderedHeader = null;
      HistoryState.currentOffset = 0;

      const spinner = createSpinner();
      target.appendChild(spinner);

      HistoryState.fullHistory = (await sendAction("loadHistory")).data;
      spinner.remove();
    }

    const q = query.trim().toLowerCase();
    const filtering = q || HistoryState.selectedSources.size;

    if (filtering) {
      HistoryState.filteredHistory = HistoryState.fullHistory.filter((e) => {
        const text = (e.t + " " + e.a).toLowerCase();
        return (!q || text.includes(q)) && (!HistoryState.selectedSources.size || HistoryState.selectedSources.has(e.s));
      });
      HistoryState.isFiltering = true;
    } else {
      HistoryState.filteredHistory = [];
      HistoryState.isFiltering = false;
    }

    const data = HistoryState.isFiltering ? HistoryState.filteredHistory : HistoryState.fullHistory;
    const end = Math.min(HistoryState.currentOffset + HistoryState.maxLoad, data.length);
    const items = data.slice(HistoryState.currentOffset, end);
    HistoryState.currentOffset = end;

    if (reset && !items.length) {
      const empty = document.createElement("i");
      empty.textContent = filtering ? i18n.t("common.noResults") : i18n.t("common.empty");
      target.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    let lastHeader = HistoryState.lastRenderedHeader;

    for (const entry of items) {
      const time = new Date(entry.p);
      const header = isSameDay(time, dateToday) ? i18n.t("stats.today") : isSameDay(time, dateYesterday) ? i18n.t("stats.yesterday") : dateFull(time);

      if (header !== lastHeader) {
        const h3 = document.createElement("h3");
        h3.className = "history-header";
        h3.textContent = header;
        frag.appendChild(h3);
        lastHeader = header;
      }

      frag.appendChild(HistoryUtils.createHistoryEntry(entry, HistoryState.fullHistory.indexOf(entry)));
    }

    target.appendChild(frag);
    HistoryState.lastRenderedHeader = lastHeader;

    await activateSimpleBar("historyPanel");

    const scrollEl = sb?.getScrollElement?.() || target;
    if (HistoryState.currentOffset < data.length && scrollEl.scrollHeight <= scrollEl.clientHeight + 1) {
      await this.render({ reset: false, query });
    }
  },

  renderSourceFilter() {
    const content = HistoryDOM.filterMenuContent;
    content.innerHTML = "";

    const allSources = [...new Set(HistoryState.fullHistory.map((e) => e.s))];

    // Sort: selected first, then alphabetically
    const sources = allSources.sort((a, b) => {
      const aSelected = HistoryState.selectedSources.has(a) ? 0 : 1;
      const bSelected = HistoryState.selectedSources.has(b) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      return a.localeCompare(b);
    });

    if (!document.querySelector(".history-filter")) {
      HistoryDOM.filterBtn.className = "history-filter btn";
      HistoryDOM.filterBtn.appendChild(createSVG(svg_paths.filterIconPaths));
    }

    // Handle checkbox changes
    const handleChange = async (e) => {
      if (e.target.type === "checkbox") {
        if (e.target.checked) {
          HistoryState.selectedSources.add(e.target.value);
        } else {
          HistoryState.selectedSources.delete(e.target.value);
        }

        if (HistoryState.activeScrollCleanup) {
          HistoryState.activeScrollCleanup();
          HistoryState.activeScrollCleanup = null;
        }

        await this.render({
          reset: true,
          query: HistoryDOM.searchBox.value,
        });

        await destroySimplebar("historyFilterMenuContent");
        this.renderSourceFilter();
        await activateSimpleBar(["historyPanel", "historyFilterMenuContent"]);
        await HistoryScroll.activate();
      }
    };

    if (content._sourceChangeListener) {
      content.removeEventListener("change", content._sourceChangeListener);
    }
    content._sourceChangeListener = handleChange;
    content.addEventListener("change", handleChange);

    sources.forEach((src) => {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      const span = document.createElement("span");

      span.textContent = src;
      cb.type = "checkbox";
      cb.value = src;
      cb.checked = HistoryState.selectedSources.has(src);

      label.append(cb, " ", span);
      content.appendChild(label);
    });
  },
};
