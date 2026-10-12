import { simpleBars } from "../../core/dom.js";
import { DataStore } from "../../core/dataStore.js";
import { ScrollManager } from "../../manager/scrollManager.js";
import { HistoryState } from "../history/history.js";
import { createHistoryItem } from "../history/historyItem.js";
import { updateSimpleBarPadding } from "../../utils.js";

function createHistoryRenderer(mode) {
  const ids = {
    container: mode === "listen" ? "historyContainer" : `${mode}Container`,
    wrapper: mode === "listen" ? "historyWrapper" : `${mode}Wrapper`,
    filterSelect: mode === "listen" ? "historyFilter" : `${mode}Filter`,
    simplebar: mode === "listen" ? "history" : mode,
  };

  return {
    mode,
    isFetching: false,
    _isRendering: false,
    _sourceFilterInitialized: false,
    _tsInstance: null,

    get state() {
      return HistoryState[mode];
    },

    async render({ reset = true, query = "" } = {}) {
      const scrollEl = simpleBars[ids.simplebar]?.getScrollElement();
      if (this._isRendering || !scrollEl || scrollEl.offsetParent === null) return;

      this._isRendering = true;

      try {
        const targetContainer = document.getElementById(ids.container);
        if (!targetContainer) return;

        if (reset) {
          targetContainer.replaceChildren();
          this.state.currentOffset = 0;

          if (this.state.fullData.length === 0 && !this.isFetching) {
            this.isFetching = true;
            const spinner = document.createElement("div");
            spinner.className = "spinner";
            targetContainer.appendChild(spinner);

            try {
              const historyData = DataStore.get("history");
              if (historyData && Array.isArray(historyData)) {
                const all = [...historyData].reverse();
                this.state.fullData = all.filter((e) => {
                  if (mode === "listen") return !e.mode || e.mode === "listen";
                  return e.mode === mode;
                });
              } else {
                this.state.fullData = [];
              }

              await ScrollManager.activate(ids.simplebar, simpleBars[ids.simplebar], this, this.state, ids.wrapper, "songs");
              this.renderSourceFilter();
            } catch (err) {
              console.error(`[historyRenderer:${mode}]: Failed to load:`, err);
              this.state.fullData = [];
            } finally {
              spinner.remove();
              this.isFetching = false;
            }
          }
        }

        const q = query.trim().toLowerCase();
        const hasActiveFilters = q || this.state.selectedSources.size > 0;

        if (hasActiveFilters) {
          this.state.filteredData = this.state.fullData.filter((e) => {
            const text = (e.title + " " + (e.artist || "")).toLowerCase();
            const matchesQuery = !q || text.includes(q);
            const matchesSource = !this.state.selectedSources.size || this.state.selectedSources.has(e.source);
            return matchesQuery && matchesSource;
          });
          this.state.isFiltering = true;
        } else {
          this.state.isFiltering = false;
        }

        const data = this.state.isFiltering ? this.state.filteredData : this.state.fullData;

        if (!this.isFetching && reset && data.length === 0) {
          const empty = document.createElement("i");
          empty.textContent = i18n.t("common.noResults");
          empty.className = "empty-msg";
          targetContainer.appendChild(empty);
          return;
        }

        const end = Math.min(this.state.currentOffset + this.state.maxLoad, data.length);
        const items = data.slice(this.state.currentOffset, end);
        this.state.currentOffset = end;

        for (let i = 0; i < items.length; i += 4) {
          const frag = document.createDocumentFragment();
          items.slice(i, i + 4).forEach((entry) => frag.appendChild(createHistoryItem(entry)));
          targetContainer.appendChild(frag);
          await new Promise((r) => requestAnimationFrame(r));
        }

        if (this.state.currentOffset < data.length) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          simpleBars[ids.simplebar]?.recalculate();
          const needsMore = scrollEl.scrollHeight <= scrollEl.clientHeight + 5;
          if (needsMore && scrollEl.offsetParent !== null) {
            this._isRendering = false;
            await this.render({ reset: false, query });
            return;
          }
        }

        await new Promise((resolve) => requestAnimationFrame(resolve));
        simpleBars[ids.simplebar]?.recalculate();
        updateSimpleBarPadding(ids.wrapper);
      } finally {
        this._isRendering = false;
      }
    },

    async prependNewHistory(newHistoryRaw) {
      const targetContainer = document.getElementById(ids.container);
      if (!targetContainer || !newHistoryRaw.length) return;

      const incomingData = [...newHistoryRaw].reverse().filter((e) => {
        if (mode === "listen") return !e.mode || e.mode === "listen";
        return e.mode === mode;
      });

      const lastKnownDate = this.state.fullData.length > 0 ? this.state.fullData[0].date : 0;
      const trulyNewItems = incomingData.filter((item) => item.date > lastKnownDate);
      if (trulyNewItems.length === 0) return;

      this.state.fullData = [...trulyNewItems, ...this.state.fullData];

      const itemsToDisplay = this.state.selectedSources.size === 0 ? trulyNewItems : trulyNewItems.filter((item) => this.state.selectedSources.has(item.source));

      if (itemsToDisplay.length > 0) {
        const frag = document.createDocumentFragment();
        itemsToDisplay.forEach((entry) => frag.appendChild(createHistoryItem(entry)));
        targetContainer.prepend(frag);
        simpleBars[ids.simplebar]?.recalculate();
        this.state.currentOffset += itemsToDisplay.length;
      }
    },

    renderSourceFilter() {
      const filterSelect = document.getElementById(ids.filterSelect);
      if (!filterSelect) return;

      if (this._tsInstance) {
        this._tsInstance.destroy();
        this._tsInstance = null;
        this._sourceFilterInitialized = false;
      }

      while (filterSelect.options.length > 1) filterSelect.remove(1);

      const sources = [...new Set(this.state.fullData.map((e) => e.source))].filter(Boolean).sort();
      sources.forEach((source) => {
        const option = document.createElement("option");
        option.value = source;
        option.textContent = source;
        filterSelect.appendChild(option);
      });

      if (this._sourceFilterInitialized) return;

      this._tsInstance = new TomSelect(filterSelect, {
        controlInput: null,
        sortField: false,
        plugins: {
          auto_width: {},
          simplebar: { simpleBars, key: ids.simplebar + "Filter" },
        },
        onChange: async (value) => {
          if (value !== "all") {
            this.state.selectedSources = new Set([value]);
          } else {
            this.state.selectedSources.clear();
          }
          await this.render({ reset: true });
          const scrollEl = simpleBars[ids.simplebar]?.getScrollElement();
          if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });
        },
      });

      this._sourceFilterInitialized = true;
    },

    destroy() {
      if (this._tsInstance) {
        this._tsInstance.destroy();
        this._tsInstance = null;
      }
      this._sourceFilterInitialized = false;
      this.isFetching = false;
      this._isRendering = false;
    },
  };
}

export const HistoryRenderer = {
  listen: createHistoryRenderer("listen"),
  watch: createHistoryRenderer("watch"),
};
