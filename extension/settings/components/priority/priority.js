// ACTIVITY PRIORITY - Transfer list: drag activity sites into the priority zone.
// The storage format stays an ordered array of parser ids; only chosen sites are stored,
// unlisted sites keep the default behavior in the background.
const PriorityState = {
  parserList: [],
  order: [], // Parser ids chosen for priority, in order
  searchQuery: "",
  saveTimer: null,
  dragRow: null, // Element currently being dragged (shared across rows)
};

// STORAGE
const PriorityStorage = {
  async load() {
    try {
      const { parserList = [], activityPriority = [] } = await browser.storage.local.get(["parserList", "activityPriority"]);
      PriorityState.parserList = parserList || [];
      PriorityState.order = Array.isArray(activityPriority) ? activityPriority.filter((id) => typeof id === "string") : [];

      // Drop ids of parsers that no longer exist (parserList is written by content scripts)
      if (PriorityState.parserList.length) {
        const knownIds = new Set(PriorityState.parserList.map((p) => p.id));
        const cleaned = PriorityState.order.filter((id) => knownIds.has(id));
        if (cleaned.length !== PriorityState.order.length) {
          PriorityState.order = cleaned;
          this.save();
        }
      }
    } catch (error) {
      logError("[PriorityStorage:load]: Failed to load priority data:", error);
      PriorityState.parserList = [];
      PriorityState.order = [];
    }
  },

  // Save is debounced - dragging produces many reorders
  save() {
    if (PriorityState.saveTimer) clearTimeout(PriorityState.saveTimer);
    PriorityState.saveTimer = setTimeout(async () => {
      PriorityState.saveTimer = null;
      try {
        await browser.storage.local.set({ activityPriority: PriorityState.order });
      } catch (error) {
        logError("[PriorityStorage:save]: Failed to save activity priority:", error);
        showAlert(i18n.t("common.error"), "", "warn");
      }
    }, 250);
  },
};

function getParserLabel(parser) {
  return parser?.title || (Array.isArray(parser?.domain) ? parser?.domain[0] : parser?.domain) || "";
}

function getParserDomains(parser) {
  const domains = Array.isArray(parser?.domain) ? parser.domain : [parser?.domain];
  return domains.filter((d) => typeof d === "string" && d);
}

function getPrimaryParserDomain(parser) {
  const first = Array.isArray(parser?.domain) ? parser.domain[0] : parser?.domain;
  return (first || "").replace(/^\*\./, "");
}

// LIST CONTROLLER
const PriorityListController = {
  getZones() {
    return {
      source: document.getElementById("prioritySourceList"),
      priority: document.getElementById("priorityList"),
    };
  },

  renderSearchBar() {
    const searchContainer = document.getElementById("prioritySearchContainer");
    if (!searchContainer) return;

    let searchBar = searchContainer.querySelector(".filter-search-bar");
    if (!searchBar) {
      searchBar = document.createElement("div");
      searchBar.className = "filter-search-bar";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "input filter-search-input";
      input.placeholder = i18n.t("settings.priority.search");

      const resetBtn = document.createElement("button");
      resetBtn.className = "filter-search-reset";
      resetBtn.title = i18n.t("common.reset");
      resetBtn.style.display = "none";
      resetBtn.appendChild(createSVG(svg_paths.crossIconPaths));

      // Hiding rows is cheap - no rebuild, no debounce
      FilterEvents.add(input, "input", (e) => {
        PriorityState.searchQuery = e.target.value;
        resetBtn.style.display = e.target.value ? "" : "none";
        this.applySearch();
      });

      FilterEvents.add(resetBtn, "click", (e) => {
        e.stopPropagation();
        input.value = "";
        PriorityState.searchQuery = "";
        resetBtn.style.display = "none";
        this.applySearch();
      });

      searchBar.append(input, resetBtn);
      searchContainer.appendChild(searchBar);
    }
  },

  // Filter without rebuilding - only the source zone is searchable;
  // priority members always stay visible so dragging out is still possible.
  applySearch() {
    const zone = document.getElementById("prioritySourceList");
    if (!zone) return;

    zone.querySelector(".empty-state")?.remove();

    const query = (PriorityState.searchQuery || "").toLowerCase().trim();
    const rows = zone.querySelectorAll(".priority-item");
    let visibleCount = 0;

    for (const row of rows) {
      const show = !query || row.dataset.searchText.includes(query);
      row.style.display = show ? "" : "none";
      if (show) visibleCount++;
    }

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = i18n.t("settings.priority.empty");
      zone.appendChild(empty);
    } else if (visibleCount === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = i18n.t("settings.priority.noResults");
      zone.appendChild(empty);
    }
  },

  render() {
    const zones = this.getZones();
    if (!zones.source || !zones.priority) return;

    const parsersById = new Map(PriorityState.parserList.map((p) => [p.id, p]));

    // Priority zone: current members in saved order (stale ids without a parser are skipped)
    const members = PriorityState.order.map((id) => parsersById.get(id)).filter(Boolean);
    const memberIds = new Set(members.map((p) => p.id));

    zones.priority.replaceChildren();
    members.forEach((parser, index) => {
      zones.priority.appendChild(this.createPriorityItem(parser, { member: true, rank: index + 1 }));
    });
    this.updateEmptyState();

    // Source zone: everything not prioritized
    zones.source.replaceChildren();
    for (const parser of PriorityState.parserList) {
      if (memberIds.has(parser.id)) continue;
      zones.source.appendChild(this.createPriorityItem(parser, { member: false }));
    }

    if (PriorityState.parserList.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = i18n.t("settings.priority.empty");
      zones.source.appendChild(empty);
    }

    loadFavIcons([...zones.source.querySelectorAll(".parser-icon"), ...zones.priority.querySelectorAll(".parser-icon")]);
    this.applySearch();
  },

  // Order = current contents of the priority zone, in DOM order.
  // All interactions (drag in, reorder, drag out, buttons) resolve through this.
  commit() {
    const zones = this.getZones();
    if (!zones.source || !zones.priority) return;

    const memberRows = [...zones.priority.querySelectorAll(".priority-item")];
    PriorityState.order = memberRows.map((row) => row.dataset.parserId);

    // Rows may have crossed zones since they were built - resync rank + action button
    memberRows.forEach((row, index) => this.setRowRole(row, true, index + 1));
    for (const row of zones.source.querySelectorAll(".priority-item")) {
      this.setRowRole(row, false);
    }

    this.updateEmptyState();
    this.applySearch();
    PriorityStorage.save();
  },

  updateEmptyState() {
    const zones = this.getZones();
    if (!zones.priority) return;

    zones.priority.querySelector(".empty-state")?.remove();
    if (zones.priority.querySelectorAll(".priority-item").length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = i18n.t("settings.priority.dropzone");
      zones.priority.appendChild(empty);
    }
  },

  // Rearrange row chrome to its role: members get a rank chip and a remove button,
  // source rows get an add button. Dragging moves rows between zones without
  // rebuilding them, so the role sync happens here (and in commit()).
  setRowRole(row, member, rank) {
    const currentChip = row.querySelector(".priority-rank");
    if (member) {
      const chip = currentChip || document.createElement("span");
      if (!currentChip) {
        chip.className = "priority-rank";
        row.insertBefore(chip, row.querySelector(".parser-icon-container"));
      }
      chip.textContent = String(rank ?? "");
    } else {
      currentChip?.remove();
    }

    const currentAction = row.querySelector(".priority-action");
    const wantedRole = member ? "remove" : "add";
    if (currentAction && currentAction.dataset.role === wantedRole) return;
    currentAction?.remove();

    const action = createIconButton(member ? svg_paths.crossIconPaths : svg_paths.plusIconPaths, {
      className: member ? "icon-btn icon-btn-danger priority-action" : "icon-btn priority-action",
      title: i18n.t(member ? "settings.priority.remove" : "settings.priority.add"),
    });
    action.dataset.role = wantedRole;
    action.addEventListener("click", () => {
      const zones = this.getZones();
      if (PriorityState.dragRow === row) PriorityState.dragRow = null;
      const zone = member ? zones.source : zones.priority;
      if (zone === zones.source) row.style.display = ""; // show it again under an active search filter
      zone.appendChild(row);
      this.commit();
    });
    row.appendChild(action);
  },

  createPriorityItem(parser, { member, rank }) {
    const row = document.createElement("div");
    row.className = "priority-item";
    row.dataset.parserId = parser.id;
    row.dataset.searchText = `${getParserLabel(parser)} ${getParserDomains(parser).join(" ")}`.toLowerCase();
    row.draggable = true;

    const grip = document.createElement("span");
    grip.className = "priority-grip";
    grip.appendChild(createSVG(svg_paths.dragIconPaths, { width: 14, height: 14 }));
    row.appendChild(grip);

    const iconWrap = document.createElement("div");
    iconWrap.className = "parser-icon-container spinner";

    const icon = document.createElement("img");
    icon.className = "parser-icon hidden-visibility";
    icon.loading = "lazy";
    icon.decoding = "async";
    const primaryDomain = getPrimaryParserDomain(parser);
    icon.dataset.src = primaryDomain;
    icon.addEventListener("click", () => window.open(parser.homepage || `https://${primaryDomain}`, "_blank", "noopener,noreferrer"));
    iconWrap.appendChild(icon);
    row.appendChild(iconWrap);

    const title = document.createElement("span");
    title.className = "parser-title priority-title";
    title.textContent = getParserLabel(parser);
    title.title = getParserDomains(parser).join(", ");
    row.appendChild(title);

    const domain = document.createElement("span");
    domain.className = "priority-domain";
    const domainText = getParserDomains(parser).join(", ");
    domain.textContent = domainText;
    domain.title = domainText;
    row.appendChild(domain);

    this.setRowRole(row, member, rank);
    this.wireDragEvents(row);

    return row;
  },

  // HTML5 drag & drop across the two zones. Live preview moves the row in the
  // DOM; commit() derives the saved order from the priority zone contents.
  wireDragEvents(row) {
    const zones = this.getZones();

    const finishDrag = () => {
      const dragRow = PriorityState.dragRow;
      if (!dragRow) return;
      PriorityState.dragRow = null;
      dragRow.classList.remove("dragging");
      this.commit();
    };

    row.addEventListener("dragstart", (e) => {
      PriorityState.dragRow = row;
      row.classList.add("dragging");
      // A row leaving the priority zone frees the dropzone hint during the preview
      zones.priority.querySelector(".empty-state")?.remove();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.dataset.parserId);
    });

    row.addEventListener("dragover", (e) => {
      const dragRow = PriorityState.dragRow;
      if (!dragRow || dragRow === row) return;
      e.preventDefault();
      e.stopPropagation();

      const zone = row.parentElement;
      // Reordering inside the source zone is meaningless - priority members only
      if (zone === zones.source && dragRow.parentElement === zones.source) return;

      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      zone.insertBefore(dragRow, after ? row.nextSibling : row);
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      finishDrag();
    });

    row.addEventListener("dragend", () => finishDrag());
  },

  // Zone level drop targets - make gap and empty areas of both columns droppable
  initZoneDropTargets() {
    const zones = this.getZones();
    if (!zones.source || !zones.priority) return;

    for (const zone of [zones.source, zones.priority]) {
      zone.addEventListener("dragover", (e) => {
        const dragRow = PriorityState.dragRow;
        if (!dragRow) return;
        e.preventDefault();

        // Hovering the empty area of the priority zone appends the row last
        if (zone === zones.priority && dragRow.parentElement !== zones.priority) {
          zones.priority.appendChild(dragRow);
        }
      });

      zone.addEventListener("drop", (e) => {
        if (!PriorityState.dragRow) return;
        e.preventDefault();
        const dragRow = PriorityState.dragRow;
        PriorityState.dragRow = null;
        dragRow.classList.remove("dragging");
        this.commit();
      });
    }
  },
};

// INIT
async function initActivityPriority() {
  await PriorityStorage.load();

  PriorityListController.renderSearchBar();
  PriorityListController.initZoneDropTargets();
  PriorityListController.render();
}
