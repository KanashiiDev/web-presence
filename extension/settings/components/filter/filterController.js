// FILTER TABS CONTROLLER
const FilterTabsController = {
  setTab(tab) {
    FilterState.ui.activeTab = tab;
    FormController.close();
    this.render();
    FilterListController.render();
  },

  render() {
    const container = document.getElementById("filterTabsContainer");
    if (!container) return;

    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "filter-tabs";

    const tabs = [
      { value: "all", label: i18n.t("common.all") },
      { value: "block", label: i18n.t("common.block") },
      { value: "replace", label: i18n.t("common.replace") },
    ];

    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.className = `filter-tab${FilterState.ui.activeTab === tab.value ? " active" : ""} btn`;
      btn.textContent = tab.label;
      btn.dataset.tab = tab.value;

      FilterEvents.add(btn, "click", () => this.setTab(tab.value));

      wrapper.appendChild(btn);
    });

    container.appendChild(wrapper);
  },
};

// FILTER LIST CONTROLLER
const FilterListController = {
  getFiltered() {
    const { activeTab } = FilterState.ui;

    if (activeTab === "block") {
      return FilterState.parserFilters.filter((f) => !FilterUtils.isReplaceFilter(f));
    }

    if (activeTab === "replace") {
      return FilterState.parserFilters.filter((f) => FilterUtils.isReplaceFilter(f));
    }

    return FilterState.parserFilters;
  },

  async delete(filterId) {
    const filter = FilterState.parserFilters.find((f) => f.id === filterId);
    if (!filter) return;

    const isReplace = FilterUtils.isReplaceFilter(filter);

    if (
      !(await showConfirm("", {
        heading: i18n.t("filter.confirm.delete"),
        body: "",
      }))
    )
      return;

    // Ask about reverting for replace filters
    if (isReplace) {
      const shouldRevert = await showConfirm("", {
        type: "info",
        heading: i18n.t("filter.confirm.restore"),
        labelCancel: i18n.t("common.close"),
      });

      if (shouldRevert) {
        await sendAction("filterHistoryReplace", {
          mode: "revert",
          entries: filter.entries,
          parsers: filter.parsers,
          parserList: FilterState.parserList,
        });
      }
    }

    FilterState.parserFilters = FilterState.parserFilters.filter((f) => f.id !== filterId);
    await FilterStorage.saveFilters();

    FilterTabsController.render();
    this.render();
  },

  render() {
    const container = document.getElementById("filtersList");
    if (!container) return;

    // Clear old
    container.querySelectorAll(".filter-item").forEach((el) => {
      FilterEvents.removeFrom(el);
    });
    container.innerHTML = "";

    const filtered = this.getFiltered();

    // Empty state
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";

      const p = document.createElement("p");
      p.textContent = FilterState.ui.activeTab === "all" ? i18n.t("filter.noAdded") : i18n.t("filter.notFoundTab", { tab: FilterState.ui.activeTab });

      empty.appendChild(p);
      container.appendChild(empty);
      return;
    }

    filtered.sort((a, b) => {
      const getKey = (filter) => (filter.parsers[0] === "*" ? "All Websites" : filter.parsers.join(","));

      return getKey(a).localeCompare(getKey(b));
    });

    // Render filters
    filtered.forEach((filter) => {
      container.appendChild(this.createFilterItem(filter));
    });
  },

  createFilterItem(filter) {
    const item = document.createElement("div");
    item.className = "filter-item card card-sm";
    item.dataset.filterId = filter.id;

    const isReplace = FilterUtils.isReplaceFilter(filter);
    if (isReplace) item.classList.add("replace-filter");

    // Card Header
    const header = document.createElement("div");
    header.className = "filter-card-header card-header";

    const modePill = createBadge(
      isReplace ? i18n.t("common.replace") : i18n.t("common.block"),
      `filter-mode-pill badge-sm ${isReplace ? "badge-text-warning" : "badge-text-danger"}`,
    );

    const sourceTag = document.createElement("span");
    sourceTag.className = "filter-source-tag badge badge-sm";
    const sourceDot = document.createElement("span");
    sourceDot.className = "filter-source-dot";
    const sourceNames =
      filter.parsers[0] === "*"
        ? ["All Websites"]
        : filter.parsers.map((id) => {
            const parser = FilterState.parserList.find((p) => p.id === id);
            return parser ? parser.title || parser.domain : id;
          });
    sourceTag.append(sourceDot, document.createTextNode(sourceNames.join(", ")));

    const entryCount = document.createElement("span");
    entryCount.className = "filter-entry-count";
    entryCount.textContent = i18n.t("filter.header.entries", { count: filter.entries.length });

    const actions = document.createElement("div");
    actions.className = "filter-actions";

    const editBtn = createIconButton(svg_paths.penIconPaths, {
      className: "icon-btn",
      title: i18n.t("common.edit"),
    });
    FilterEvents.add(editBtn, "click", (e) => {
      e.stopPropagation();
      FormController.startEdit(filter);
    });

    const deleteBtn = createIconButton(svg_paths.trashIconPaths, {
      className: "icon-btn icon-btn-danger",
      title: i18n.t("common.delete"),
    });
    FilterEvents.add(deleteBtn, "click", (e) => {
      e.stopPropagation();
      this.delete(filter.id);
    });

    actions.append(editBtn, deleteBtn);
    header.append(modePill, sourceTag, entryCount, actions);

    FilterEvents.add(header, "click", () => FormController.startEdit(filter));

    const collapsedBody = document.createElement("div");
    collapsedBody.className = "filter-card-body card-body filter-collapsed-body";

    // Entries
    const entriesWrapper = document.createElement("div");
    entriesWrapper.className = "filter-entries-wrapper";

    filter.entries.forEach((entry) => {
      const entryDiv = document.createElement("div");
      entryDiv.className = isReplace ? "filter-entry filter-entry-replace" : "filter-entry filter-entry-block";

      if (isReplace) {
        const original = document.createElement("span");
        original.className = "original";
        original.textContent = `${entry.artist || "*"} - ${entry.title || "*"}`;
        const arrow = document.createElement("span");
        arrow.className = "filter-entry-arrow";
        arrow.appendChild(createSVG(svg_paths.forwardIconPaths, { width: "12px", height: "12px" }));
        const replace = document.createElement("span");
        replace.className = "replace";
        replace.textContent = `${entry.replaceArtist || "*"} - ${entry.replaceTitle || "*"}`;
        entryDiv.append(original, arrow, replace);
      } else {
        entryDiv.textContent = `${entry.artist || "*"} - ${entry.title || "*"}`;
      }

      entriesWrapper.appendChild(entryDiv);
    });

    // More button
    const moreBtn = document.createElement("button");
    moreBtn.className = "btn btn-secondary btn-sm";
    moreBtn.textContent = i18n.t("common.more");
    moreBtn.style.display = "none";
    FilterEvents.add(moreBtn, "click", (e) => {
      e.stopPropagation();
      const isExpanded = entriesWrapper.classList.toggle("expanded");
      entriesWrapper.style.maxHeight = isExpanded ? `${entriesWrapper.dataset.maxHeight}px` : "";
      moreBtn.textContent = isExpanded ? i18n.t("common.less") : i18n.t("common.more");
    });

    collapsedBody.append(entriesWrapper, moreBtn);

    // Inline Editor
    const editor = document.createElement("div");
    editor.className = "filter-inline-editor";

    item.append(header, collapsedBody, editor);

    // Check if more button needed
    requestAnimationFrame(() => {
      if (entriesWrapper.scrollHeight > entriesWrapper.clientHeight) {
        entriesWrapper.dataset.maxHeight = entriesWrapper.scrollHeight;
        moreBtn.style.display = "inline-block";
      }
    });

    return item;
  },
};
