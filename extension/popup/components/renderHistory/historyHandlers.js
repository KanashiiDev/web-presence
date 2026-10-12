let historyPanel, clearBtn, cancelCleanBtn, filterBtn, historyFilterResetBtn, filterMenu, filterMenuContent;

function initHistoryHandlers() {
  historyPanel = document.getElementById("historyPanel");
  clearBtn = document.getElementById("clearHistoryBtn");
  cancelCleanBtn = document.getElementById("cancelCleanBtn");
  filterBtn = document.getElementById("historyFilterBtn");
  filterMenu = document.getElementById("historyFilterMenu");
  filterMenuContent = document.getElementById("historyFilterMenuContent");

  clearBtn.addEventListener("click", handleClearButtonClick);
  cancelCleanBtn.addEventListener("click", exitCleaningMode);

  historyFilterResetBtn = document.getElementById("historyFilterResetBtn");
  if (historyFilterResetBtn) {
    historyFilterResetBtn.appendChild(createSVG(svg_paths.closeIconPaths ?? svg_paths.crossIconPaths));
    historyFilterResetBtn.addEventListener("click", async () => {
      historyState.selectedSources.clear();
      document.getElementById("historySearchBox").value = "";
      historyFilterResetBtn?.classList.remove("filter-active");
      historyState.activeScrollCleanup?.();
      historyState.activeScrollCleanup = null;
      await renderHistory({ reset: true, query: "" });
      await destroyOtherSimpleBars();
      await activateSimpleBar(["historyPanel", "historyFilterMenuContent"]);
      await activateHistoryScroll();
    });
  }

  initHistoryModeSwitch();
}

function initHistoryModeSwitch() {
  const existing = document.getElementById("historyModeSwitch");
  if (existing) return;

  const wrapper = document.createElement("div");
  wrapper.id = "historyModeSwitch";
  wrapper.className = "history-mode-switch segmented-toggle";

  const modes = [
    { value: "listen", i18n: "history.mode.music" },
    { value: "watch", i18n: "history.mode.video" },
    { value: "all", i18n: "common.all" },
  ];

  modes.forEach(({ value, i18n: key }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segmented-option";
    btn.dataset.mode = value;
    btn.dataset.i18n = key;
    btn.textContent = i18n.t(key);
    if (value === historyState.activeMode) btn.classList.add("active");

    btn.addEventListener("click", async () => {
      if (historyState.activeMode === value) return;
      historyState.activeMode = value;

      wrapper.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === value));

      historyState.activeScrollCleanup?.();
      historyState.activeScrollCleanup = null;

      await renderHistory({ reset: true, query: document.getElementById("historySearchBox")?.value ?? "" });
      await activateSimpleBar("historyPanel");
      await activateHistoryScroll();
    });

    wrapper.appendChild(btn);
  });

  const historyControls = document.querySelector(".history-controls");
  if (historyControls) historyControls.appendChild(wrapper);
}

function attachCheckboxListeners() {
  historyPanel._cleanupCheckboxListener?.();
  historyPanel._cleanupTrashListener?.();

  if (!historyPanel._checkboxListenerAttached) {
    const handlePanelChange = (e) => {
      if (!historyState.cleaningMode || !e.target.matches(".history-checkbox")) return;
      const entry = e.target.closest(".history-entry");
      entry?.classList.toggle("selected", e.target.checked);
      updateClearBtnText();
    };
    historyPanel.addEventListener("change", handlePanelChange);
    historyPanel._checkboxListenerAttached = true;
    historyPanel._cleanupCheckboxListener = () => {
      historyPanel.removeEventListener("change", handlePanelChange);
      historyPanel._checkboxListenerAttached = false;
    };
  }

  // Inject trash icons
  historyPanel.querySelectorAll(".history-entry").forEach((entry) => {
    if (entry.querySelector(".history-trash")) return;
    const cb = entry.querySelector(".history-checkbox");
    const trashIcon = document.createElement("span");
    trashIcon.className = "history-trash no-select btn-action";
    trashIcon.appendChild(createSVG(svg_paths.trashIconPaths));
    const cbId = cb.id || `cb-${Date.now()}-${Math.random()}`;
    cb.id ||= cbId;
    trashIcon.dataset.checkboxFor = cbId;
    cb.insertAdjacentElement("afterend", trashIcon);
  });

  if (!historyPanel._trashClickListenerAttached) {
    const handleTrashClick = (e) => {
      const trashIcon = e.target.closest(".history-trash");
      if (!trashIcon) return;
      const cb = document.getElementById(trashIcon.dataset.checkboxFor);
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.closest(".history-entry")?.classList.toggle("selected", cb.checked);
      updateClearBtnText();
    };
    historyPanel.addEventListener("click", handleTrashClick);
    historyPanel._trashClickListenerAttached = true;
    historyPanel._cleanupTrashListener = () => {
      historyPanel.removeEventListener("click", handleTrashClick);
      historyPanel._trashClickListenerAttached = false;
    };
  }
}

function updateClearBtnText() {
  if (!historyState.cleaningMode) return;
  const selectedCount = document.querySelectorAll(".history-checkbox:checked").length;
  clearBtn.textContent = selectedCount > 0 ? i18n.t("history.deleteSelected", { count: selectedCount }) : i18n.t("history.clearAll");
}

function exitCleaningMode() {
  historyState.cleaningMode = false;
  document.body.classList.remove("cleaning-mode");
  clearBtn.textContent = i18n.t("history.clearHistory");
  cancelCleanBtn.style.display = "none";
  document.querySelectorAll(".history-checkbox").forEach((cb) => {
    cb.parentElement?.classList.remove("selected");
    cb.checked = false;
  });
  historyPanel._cleanupCheckboxListener?.();
  historyPanel._cleanupTrashListener?.();
  activateSimpleBar("historyPanel");
}

const handleClearButtonClick = async () => {
  if (!historyState.fullHistory.length) {
    await showAlert(i18n.t("history.warn.empty"), "", "warn");
    return;
  }

  const selectedIndexes = Array.from(document.querySelectorAll(".history-checkbox:checked"))
    .filter((cb) => cb.closest(".history-entry")?.style.display !== "none")
    .map((cb) => parseInt(cb.dataset.index));
  const filteredSet = new Set(historyState.filteredHistory.map((e) => historyState.fullHistory.indexOf(e)));

  if (historyState.isFiltering) {
    if (filteredSet.size === 0) {
      await showAlert(i18n.t("history.warn.empty"), "", "warn");
      return;
    }
  }

  if (!historyState.cleaningMode && historyState.fullHistory.length) {
    historyState.cleaningMode = true;
    document.body.classList.add("cleaning-mode");
    cancelCleanBtn.style.display = "inline-block";
    updateClearBtnText();
    attachCheckboxListeners();
    await activateSimpleBar("historyPanel");
    return;
  }

  if (selectedIndexes.length === 0) {
    if (historyState.isFiltering) {
      if (
        !(await showConfirm("", {
          heading: i18n.t("history.confirm.delete", { count: filteredSet.size }),
          body: "",
        }))
      )
        return;
      showPopupMessage(i18n.t("popupMessage.deleting"), "warning", null, 1);
      const deletedEntries = historyState.fullHistory.filter((_, i) => filteredSet.has(i));
      historyState.fullHistory = historyState.fullHistory.filter((_, i) => !filteredSet.has(i));
      await sendAction("syncDeleteToServer", { data: deletedEntries });
    } else {
      if (
        !(await showConfirm("", {
          heading: i18n.t("history.confirm.deleteAll", { count: historyState.fullHistory.length }),
          body: "",
        }))
      )
        return;

      showPopupMessage(i18n.t("popupMessage.deleting"), "warning", null, 1);
      await sendAction("syncDeleteToServer", { data: historyState.fullHistory });
      historyState.fullHistory = [];
    }
  } else {
    const indexSet = new Set(selectedIndexes);
    const count = selectedIndexes.length;
    const key = count > 1 ? "popupMessage.deleteHistory.other" : "popupMessage.deleteHistory.one";
    if (
      !(await showConfirm("", {
        heading: i18n.t(key, { count }),
        body: "",
      }))
    )
      return;

    showPopupMessage(i18n.t("popupMessage.deleting"), "warning", null, 1);
    const deletedEntries = historyState.fullHistory.filter((_, i) => indexSet.has(i));
    historyState.fullHistory = historyState.fullHistory.filter((_, i) => !indexSet.has(i));
    await sendAction("syncDeleteToServer", { data: deletedEntries });
  }
  hidePopupMessage();

  historyState.isFiltering = false;
  historyState.selectedSources.clear();
  historyState.filteredHistory = [];
  document.querySelector("#historySearchBox").value = "";
  historyFilterResetBtn?.classList.remove("filter-active");
  await sendAction("saveHistory", { data: historyState.fullHistory });

  historyPanel._cleanupCheckboxListener?.();
  historyPanel._cleanupTrashListener?.();

  await renderHistory();
  exitCleaningMode();
};

function buildHistorySourceCache() {
  if (!filterBtn.classList.contains("history-filter")) {
    filterBtn.className = "history-filter";
    filterBtn.appendChild(createSVG(svg_paths.filterIconPaths));
  }
  historyState.sourceMenuBuilt = false;
}

function renderSourceFilterMenu() {
  const { selectedSources } = historyState;
  filterMenuContent.innerHTML = "";

  const sources = [...new Set(historyState.fullHistory.map((e) => e.s))].sort((a, b) => {
    const diff = (selectedSources.has(a) ? 0 : 1) - (selectedSources.has(b) ? 0 : 1);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  if (filterMenuContent._sourceChangeListener) {
    filterMenuContent.removeEventListener("change", filterMenuContent._sourceChangeListener);
  }

  const handleSourceCheckboxChange = async (e) => {
    if (e.target.type !== "checkbox") return;
    e.target.checked ? selectedSources.add(e.target.value) : selectedSources.delete(e.target.value);

    historyState.activeScrollCleanup?.();
    historyState.activeScrollCleanup = null;

    historyFilterResetBtn?.classList.toggle("filter-active", selectedSources.size > 0);

    await renderHistory({ reset: true, query: document.getElementById("historySearchBox").value });
    await activateSimpleBar(["historyPanel", "historyFilterMenuContent"]);
    await activateHistoryScroll();
  };

  filterMenuContent._sourceChangeListener = handleSourceCheckboxChange;
  filterMenuContent.addEventListener("change", handleSourceCheckboxChange);

  const fragment = document.createDocumentFragment();
  sources.forEach((src) => {
    const label = document.createElement("label");
    const cb = Object.assign(document.createElement("input"), {
      type: "checkbox",
      value: src,
      checked: selectedSources.has(src),
    });
    const span = Object.assign(document.createElement("span"), { textContent: src });
    label.append(cb, " ", span);
    fragment.appendChild(label);
  });
  if (!fragment.childNodes.length) {
    fragment.appendChild(Object.assign(document.createElement("i"), { textContent: i18n.t("sourceFilter.notFound") }));
  }
  filterMenuContent.appendChild(fragment);

  historyState.sourceMenuBuilt = true;
}

const handleFilterButtonClick = async (e) => {
  e.stopPropagation();

  // Only rebuild DOM when stale
  if (!filterMenu.classList.contains("open") && !historyState.sourceMenuBuilt) {
    renderSourceFilterMenu();
  }

  filterMenu.classList.toggle("open");
  filterMenu.style.height = filterMenu.classList.contains("open") ? `${Math.min(filterMenuContent.scrollHeight, 160)}px` : "0";

  // Sync reset button visibility on every toggle
  historyFilterResetBtn?.classList.toggle("filter-active", historyState.selectedSources.size > 0);

  await destroyOtherSimpleBars("historyPanel");
  await activateSimpleBar("historyFilterMenuContent");
};
