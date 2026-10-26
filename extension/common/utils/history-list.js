// Shared render pipeline for the popup history panel and settings filter
// history modal, replacing duplicated implementations that had drifted.
//
// Callers provide mutable state, entry/header builders and optional hooks.
// Page-specific orchestration remains in each caller.
//
// Renders or appends history entries and updates:
//   fullHistory, filteredHistory, isFiltering, currentOffset,
//   lastRenderedHeader.
//
// Options:
//   panel            history panel element.
//   state            Page state; includes selectedSources and loadFailed.
//   query, reset     Caller-provided render delegates.
//   pageSize         Rows per page.
//   buildEntry       (entry, historyIndex) => Node.
//   buildHeader      Optional header builder; defaults to h3.history-header.
//   additionalFilter Optional { active, test } page-specific filter.
//   emptyText        Optional empty-state text builder.
//   onReset          Optional reset hook.
//   afterRender      Optional async hook after append; skipped when empty.
async function renderHistoryList({
  panel,
  state,
  query = "",
  reset = true,
  pageSize = 20,
  spinnerClass = "",
  buildEntry,
  buildHeader = null,
  additionalFilter = null,
  emptyText = null,
  onReset = null,
  afterRender = null,
}) {
  const sbInstance = simpleBarInstances.get(panel);
  const target = sbInstance?.getContentElement() ?? panel;

  if (reset) {
    target.innerHTML = "";
    onReset?.(panel);
    state.lastRenderedHeader = null;
    state.currentOffset = 0;

    const spinner = createSpinner(spinnerClass);
    target.appendChild(spinner);

    const res = await sendAction("loadHistory");
    state.fullHistory = res?.data ?? [];
    state.loadFailed = res?.ok === false;

    spinner.remove();
  }

  const searchQuery = query.trim();
  const extra = additionalFilter ? additionalFilter() : null;
  const hasFilter = !!searchQuery || state.selectedSources.size > 0 || !!extra?.active;

  if (hasFilter) {
    const lq = searchQuery.toLowerCase();
    state.filteredHistory = state.fullHistory.filter((entry) => {
      const matchesText = !searchQuery || `${entry.t} ${entry.a}`.toLowerCase().includes(lq);
      const matchesSource = state.selectedSources.size === 0 || state.selectedSources.has(entry.s);
      const matchesExtra = !extra?.active || extra.test(entry);
      return matchesText && matchesSource && matchesExtra;
    });
    state.isFiltering = true;
  } else {
    state.filteredHistory = [];
    state.isFiltering = false;
  }

  const dataSource = state.isFiltering ? state.filteredHistory : state.fullHistory;
  const end = Math.min(state.currentOffset + pageSize, dataSource.length);
  const rows = dataSource.slice(state.currentOffset, end);
  state.currentOffset = end;

  if (reset && !rows.length) {
    const emptyEl = Object.assign(document.createElement("i"), {
      textContent: emptyText ? emptyText(hasFilter) : hasFilter ? i18n.t("common.noResults") : i18n.t("common.empty"),
    });
    target.appendChild(emptyEl);
    return;
  }

  const fragment = document.createDocumentFragment();
  let lastHeader = state.lastRenderedHeader;

  for (const entry of rows) {
    const time = new Date(entry.p);
    const header = isSameDay(time, dateToday) ? i18n.t("stats.today") : isSameDay(time, dateYesterday) ? i18n.t("stats.yesterday") : dateFull(time);

    if (header !== lastHeader) {
      const h3 = buildHeader ? buildHeader(header) : Object.assign(document.createElement("h3"), { className: "history-header", textContent: header });
      fragment.appendChild(h3);
      lastHeader = header;
    }

    fragment.appendChild(buildEntry(entry, state.fullHistory.indexOf(entry)));
  }

  state.lastRenderedHeader = lastHeader;
  target.appendChild(fragment);

  await afterRender?.({ target, dataSourceLength: dataSource.length, hasFilter });
}

// Shared source list for both history filter menus.
// Sorts selected sources first, then alphabetically, and manages change
// listeners. Selection changes are forwarded to the caller for re-rendering.
//
// Options:
//   content              Menu content element.
//   state                State containing fullHistory and selectedSources.
//   emptyMessageKey      Optional i18n key for the empty state.
//   onSelectionChange    Optional async () => void after a toggle.
function renderSourceFilterMenuContent({ content, state, emptyMessageKey = null, onSelectionChange = null }) {
  content.innerHTML = "";

  const sources = [...new Set(state.fullHistory.map((e) => e.s))].sort((a, b) => {
    const diff = (state.selectedSources.has(a) ? 0 : 1) - (state.selectedSources.has(b) ? 0 : 1);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  if (content._sourceChangeListener) {
    content.removeEventListener("change", content._sourceChangeListener);
  }

  const handleSourceCheckboxChange = async (e) => {
    if (e.target.type !== "checkbox") return;
    e.target.checked ? state.selectedSources.add(e.target.value) : state.selectedSources.delete(e.target.value);
    await onSelectionChange?.(e);
  };

  content._sourceChangeListener = handleSourceCheckboxChange;
  content.addEventListener("change", handleSourceCheckboxChange);

  const fragment = document.createDocumentFragment();
  sources.forEach((src) => {
    const label = document.createElement("label");
    const cb = Object.assign(document.createElement("input"), {
      type: "checkbox",
      value: src,
      checked: state.selectedSources.has(src),
    });
    const span = Object.assign(document.createElement("span"), { textContent: src });
    label.append(cb, " ", span);
    fragment.appendChild(label);
  });

  if (!fragment.childNodes.length && emptyMessageKey) {
    fragment.appendChild(Object.assign(document.createElement("i"), { textContent: i18n.t(emptyMessageKey) }));
  }
  content.appendChild(fragment);
}

// Shared Music / Video / All mode switch for both history views.
// Callers handle mode state, active classes and re-rendering via
// `onModeChange(value, wrapper)`. Buttons use `data-i18n` for labels,
// allowing translation after i18n.load() completes.
function createHistoryModeSwitch({ activeMode = "all", onModeChange = null } = {}) {
  const modes = [
    { value: "listen", i18nKey: "history.mode.music" },
    { value: "watch", i18nKey: "history.mode.video" },
    { value: "all", i18nKey: "common.all" },
  ];

  const wrapper = document.createElement("div");
  wrapper.id = "historyModeSwitch";
  wrapper.className = "history-mode-switch segmented-toggle";

  modes.forEach(({ value, i18nKey }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segmented-option";
    btn.dataset.mode = value;
    btn.dataset.i18n = i18nKey;
    if (value === activeMode) btn.classList.add("active");

    btn.addEventListener("click", async () => {
      const current = wrapper.querySelector(".segmented-option.active")?.dataset.mode;
      if (current === value) return;
      await onModeChange?.(value, wrapper);
    });

    wrapper.appendChild(btn);
  });

  return wrapper;
}

// Reset (x) button visibility for the history search controls
function updateHistoryFilterResetVisibility(resetBtn, state, queryEl = null) {
  const hasQuery = !!(queryEl?.value ?? "").trim();
  const hasSourceFilter = (state?.selectedSources.size ?? 0) > 0;
  resetBtn?.classList.toggle("filter-active", hasQuery || hasSourceFilter);
}
