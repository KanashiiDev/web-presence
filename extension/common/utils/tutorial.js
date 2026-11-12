/**
 * Tutorial Engine
 *
 * @param {object} config
 * @param {Array<{
 *   text: string,
 *   selector: string|null,
 *   onShow?: () => void,
 *   getFadingEls?: (targetEl: Element|null) => Element[]|null
 * }>} config.steps
 * @param {string} config.storageKey
 * @param {number} [config.dialogWidth] - optional fixed tooltip width (px) for text-heavy tutorials
 * @param {Function} [config.onStart]  - runs once before first step
 * @param {Function} [config.onEnd]    - runs once after last step / skip
 */
async function createTutorial({ steps, storageKey, dialogWidth, onStart, onEnd }) {
  // Build tooltip DOM
  function buildTooltip() {
    document.getElementById("tutorialTooltip")?.remove();
    document.getElementById("tutorialOverlay")?.remove();

    // Dim backdrop for target-less steps (intro / finish)
    const overlay = document.createElement("div");
    overlay.id = "tutorialOverlay";
    overlay.className = "tutorial-overlay";

    const dialog = document.createElement("div");
    dialog.id = "tutorialTooltip";
    dialog.className = "tutorial-dialog";
    if (dialogWidth) {
      dialog.style.minWidth = `${dialogWidth}px`;
      dialog.style.maxWidth = `${dialogWidth}px`;
    }

    const header = document.createElement("h2");
    const text = document.createElement("p");
    const actions = document.createElement("div");
    actions.className = "tutorial-actions";

    const nextBtn = document.createElement("button");
    nextBtn.className = "tutorial-button next";

    const skipBtn = document.createElement("button");
    skipBtn.className = "tutorial-button skip";

    actions.append(nextBtn, skipBtn);
    dialog.append(header, text, actions);
    document.body.append(overlay, dialog);

    return { overlay, dialog, header, text, nextBtn, skipBtn };
  }

  const { overlay, dialog, header, text, nextBtn, skipBtn } = buildTooltip();
  let currentStep = 0;

  // Swap a CSS class across a live NodeList > new target set, avoids repeated querySelectorAll
  function swapClass(className, nextEls) {
    document.querySelectorAll(`.${className}`).forEach((el) => el.classList.remove(className));
    nextEls?.forEach((el) => el?.classList.add(className));
  }

  // Highlight target, clear previous
  function highlight(targetEl) {
    swapClass("tutorialTooltip-highlight", targetEl ? [targetEl] : null);
    targetEl?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Apply fading using the step's own getFadingEls fn
  function applyFading(targetEl, getFadingEls) {
    swapClass("fading", getFadingEls?.(targetEl) ?? null);
  }

  // Position tooltip relative to target; centered fallback when the step has no target element
  function positionTooltip(targetEl) {
    if (!targetEl) {
      const scrollY = window.scrollY ?? document.documentElement.scrollTop;
      dialog.style.top = `${Math.max(8, scrollY + (window.innerHeight - dialog.offsetHeight) / 2)}px`;
      dialog.style.left = `${Math.max(8, (window.innerWidth - dialog.offsetWidth) / 2)}px`;
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const scrollY = window.scrollY ?? document.documentElement.scrollTop;
    const scrollX = window.scrollX ?? document.documentElement.scrollLeft;
    const viewportH = window.innerHeight;
    const dialogH = dialog.offsetHeight;

    // Prefer below, fall back to above when it would overflow
    const top = rect.bottom + dialogH > Math.min(viewportH, document.body.scrollHeight) ? rect.top + scrollY - dialogH - 12 : rect.bottom + scrollY + 8;

    dialog.style.top = `${top}px`;
    dialog.style.left = `${rect.left + scrollX}px`;

    // Clamp to right viewport edge after initial placement
    const { right } = dialog.getBoundingClientRect();
    if (right > window.innerWidth) {
      dialog.style.left = `${window.innerWidth - dialog.offsetWidth - 10}px`;
    }
  }

  // Render a single step
  function showStep(index) {
    const step = steps[index];
    if (!step) return; // guard against out-of-bounds

    const isLastStep = index + 1 >= steps.length;

    step.onShow?.();

    // Query the target after onShow: onShow may open a dialog or create the element to point at
    const targetEl = step.selector ? document.querySelector(step.selector) : null;

    header.textContent = i18n.t("tutorial.step", { step: `${index + 1}/${steps.length}` });
    text.textContent = step.text;
    nextBtn.textContent = i18n.t(isLastStep ? "tutorial.finish" : "button.next");
    skipBtn.textContent = i18n.t("button.skip");
    nextBtn.classList.toggle("finish", isLastStep);
    // Skip button only shown on first step
    skipBtn.style.display = index === 0 && !isLastStep ? "" : "none";

    highlight(targetEl);
    applyFading(targetEl, step.getFadingEls);
    positionTooltip(targetEl);
    // Backdrop only for centered, target-less steps
    overlay.style.display = targetEl ? "none" : "";
  }

  // Remove tooltip, clear visual state, persist completion
  async function endTutorial() {
    overlay.remove();
    dialog.remove();
    swapClass("tutorialTooltip-highlight", null);
    swapClass("fading", null);

    await onEnd?.();
    await browser.storage.local.set({ [storageKey]: true });
  }

  // Attach listeners once; AbortController lets us clean up on end
  const ac = new AbortController();
  const { signal } = ac;

  nextBtn.addEventListener(
    "click",
    async (e) => {
      e.stopPropagation();
      currentStep++;
      if (currentStep >= steps.length) {
        ac.abort();
        await endTutorial();
      } else {
        showStep(currentStep);
      }
    },
    { signal },
  );

  skipBtn.addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      ac.abort();
      endTutorial();
    },
    { signal },
  );

  await onStart?.();
  showStep(0);
}

// Initial popup tutorial
async function showInitialTutorial(currentConnectionMode) {
  const siteList = document.getElementById("siteList");

  // Cached selector string; querySelector is called lazily inside getFadingEls
  const ALL_ENTRIES_SEL =
    ".header-container, .parser-entry, .search-controls, .simplebar-track.simplebar-vertical, " +
    "#openSelector, #openManager, #mainFooterButtons, #clearHistoryBtn, #cancelCleanBtn, " +
    "#githubLink, #settingsToggle, #openFiltersBtn, #openCustomStatusBtn, #openDashboardBtn, #openLibraryBtn";

  // Returns all entries except the one containing targetEl
  function popupFading(targetEl) {
    const parent = targetEl?.closest(".parser-entry, #mainFooterButtons");
    return [...document.querySelectorAll(ALL_ENTRIES_SEL)].filter((el) => el !== targetEl && el !== parent);
  }

  const baseSteps = [
    { text: i18n.t("tutorial.step1"), selector: ".parser-entry", getFadingEls: popupFading },
    { text: i18n.t("tutorial.step2"), selector: ".parser-entry .switch-label", getFadingEls: popupFading },
    { text: i18n.t("tutorial.step3"), selector: "#openSelector", getFadingEls: popupFading },
    { text: i18n.t("tutorial.step4"), selector: "#openManager", getFadingEls: popupFading },
    { text: i18n.t("tutorial.step5"), selector: "#settingsToggle", getFadingEls: popupFading },
    { text: i18n.t("tutorial.step6"), selector: "#openFiltersBtn", getFadingEls: popupFading },
    { text: i18n.t("tutorial.step7"), selector: "#openCustomStatusBtn", getFadingEls: popupFading },
    ...(currentConnectionMode !== "web-only"
      ? [
          {
            text: i18n.t("tutorial.step8"),
            selector: "#openDashboardBtn",
            getFadingEls: popupFading,
          },
        ]
      : []),

    { text: i18n.t("tutorial.step9"), selector: "#openLibraryBtn", getFadingEls: popupFading },
  ];

  await createTutorial({
    steps: baseSteps,
    storageKey: "initialTutorialDone",
    onStart: async () => {
      siteList.style.pointerEvents = "none";
    },
    onEnd: async () => {
      siteList.style.pointerEvents = "";
    },
  });
}

// Userscript Manager Tutorial
async function showUserScriptTutorial() {
  const ul = document.getElementById("scriptList");
  const editor = document.getElementById("editor");
  let createdSkeleton = false;

  const pageClickBlocker = new AbortController();
  document.addEventListener(
    "click",
    (e) => {
      if (!e.target.closest?.(".tutorial-dialog")) e.stopPropagation();
    },
    { capture: true, signal: pageClickBlocker.signal },
  );

  // Skeleton fallback when list is empty
  if (!ul.querySelector(".script-item")) {
    createSkeletonScriptItem();
    createdSkeleton = true;
  }

  // Shared selectors queried once per fade call
  const TABS_SEL = ".script-tab, #usmBtnListToggle, #scriptSearch";
  const ITEMS_SEL = ".script-item";
  const TOOLBAR_SEL = "#btnNew, #btnImport, #btnExport, #btnGithubSettings";
  const ACTIONS_SEL = ".script-actions button";
  const MENU_SEL = ".script-item .usm-overflow-menu";

  function fadeScriptItems(targetEl) {
    const parentItem = targetEl?.closest(".script-item");
    return [...document.querySelectorAll(`${TABS_SEL}, ${ITEMS_SEL}`)].filter((el) => el !== parentItem);
  }

  function fadeScriptButtons(targetEl) {
    const parentItem = targetEl?.closest(".script-item");
    return [...document.querySelectorAll(`${TABS_SEL}, ${ITEMS_SEL}, ${TOOLBAR_SEL}, ${ACTIONS_SEL}`)].filter((el) => el !== parentItem && el !== targetEl);
  }

  function fadeToolbarBtns(targetEl) {
    return [...document.querySelectorAll(TABS_SEL), ...fadeScriptItems(targetEl), ...document.querySelectorAll(TOOLBAR_SEL)].filter((el) => el !== targetEl);
  }

  function closeOverflowMenus() {
    document.querySelectorAll(".usm-overflow-menu").forEach((menu) => {
      menu.hidden = true;
    });
  }

  let revealedItem = null;

  function revealActions(itemEl, reveal) {
    const actions = itemEl?.querySelector(".script-actions");
    if (!actions) return;
    actions.style.opacity = reveal ? "1" : "";
    actions.style.pointerEvents = reveal ? "auto" : "";
  }

  function toggleRowStatus(itemEl, hide) {
    const status = itemEl?.querySelector(".script-status");
    if (status) status.style.visibility = hide ? "hidden" : "";
  }

  function focusRow() {
    revealActions(revealedItem, false);
    revealedItem = document.querySelector(".script-item") ?? null;
    revealActions(revealedItem, true);
    return revealedItem;
  }

  function unfocusRow() {
    toggleRowStatus(revealedItem, false);
    revealActions(revealedItem, false);
    revealedItem = null;
  }

  function openFirstMenu() {
    const row = focusRow();
    closeOverflowMenus();
    const menu = row?.querySelector(".usm-overflow-menu");
    if (menu) menu.hidden = false;
  }

  const steps = [
    {
      text: i18n.t("userscript.tutorial.scriptRow"),
      selector: ".script-item",
      getFadingEls: fadeScriptItems,
      onShow: focusRow,
    },
    {
      text: i18n.t("userscript.tutorial.btnToggle"),
      selector: ".script-item .btnToggle",
      getFadingEls: fadeScriptButtons,
      onShow: () => {
        closeOverflowMenus();
        const row = focusRow();
        toggleRowStatus(row, true);
      },
    },
    {
      text: i18n.t("userscript.tutorial.btnMore"),
      selector: ".script-item .btnMore",
      getFadingEls: fadeScriptButtons,
      onShow: () => openFirstMenu(),
    },
    { text: i18n.t("userscript.tutorial.btnExport"), selector: `${MENU_SEL} .btnExport`, getFadingEls: fadeScriptButtons, onShow: () => openFirstMenu() },
    { text: i18n.t("userscript.tutorial.btnContribute"), selector: `${MENU_SEL} .btnContribute`, getFadingEls: fadeScriptButtons, onShow: () => openFirstMenu() },
    { text: i18n.t("userscript.tutorial.btnDelete"), selector: `${MENU_SEL} .btnDelete`, getFadingEls: fadeScriptButtons, onShow: () => openFirstMenu() },
    {
      text: i18n.t("userscript.tutorial.btnNew"),
      selector: "#btnNew",
      getFadingEls: fadeToolbarBtns,
      onShow: () => {
        closeOverflowMenus();
        unfocusRow();
      },
    },
    { text: i18n.t("userscript.tutorial.btnImport"), selector: "#btnImport", getFadingEls: fadeToolbarBtns },
    { text: i18n.t("userscript.tutorial.btnExportAll"), selector: "#btnExport", getFadingEls: fadeToolbarBtns },
    { text: i18n.t("userscript.tutorial.btnGithubSettings"), selector: "#btnGithubSettings", getFadingEls: fadeToolbarBtns },
  ];

  await createTutorial({
    steps,
    storageKey: "userScriptTutorialDone",
    onEnd: async () => {
      pageClickBlocker.abort();
      closeOverflowMenus();
      unfocusRow();
      if (createdSkeleton) ul.querySelector(".tutorial-skeleton-item")?.remove();
      const emptyMsg = document.querySelector(".script-empty-message");
      if (emptyMsg) emptyMsg.style.display = "";
      editor.hidden = true;
    },
  });
}

// Filters Tutorial
async function showFiltersTutorial() {
  const formContainer = document.getElementById("formContainer");
  const HEADER_SEL = "#filterTabsContainer, #filterSearchContainer, #toggleFormBtn, #openHistoryBtn, #getActivityInfoBtn, .filter-item, #btnToggleView";
  const SECTION_SEL = ".inline-entries-section, .inline-parser-section, .inline-editor-footer, .new-filter-header";
  const filtersList = document.getElementById("filtersList");
  const emptyState = filtersList.querySelector(".empty-state");
  if (emptyState) emptyState.style.display = "none";

  function fadeHeaderBtns(targetEl) {
    return [...document.querySelectorAll(HEADER_SEL)].filter((el) => el !== targetEl);
  }

  function fadeFormSections(targetEl) {
    const parentSection = targetEl?.closest(SECTION_SEL);
    return [...fadeHeaderBtns(targetEl), ...document.querySelectorAll(SECTION_SEL)].filter((el) => el !== parentSection);
  }

  const steps = [
    {
      text: i18n.t("filters.tutorial.tabs"),
      selector: "#filterTabsContainer",
      getFadingEls: fadeHeaderBtns,
    },
    {
      text: i18n.t("filters.tutorial.getActivityInfo"),
      selector: "#getActivityInfoBtn",
      getFadingEls: fadeHeaderBtns,
    },
    {
      text: i18n.t("filters.tutorial.openHistory"),
      selector: "#openHistoryBtn",
      getFadingEls: fadeHeaderBtns,
    },
    {
      text: i18n.t("filters.tutorial.toggleForm"),
      selector: "#toggleFormBtn",
      getFadingEls: fadeHeaderBtns,
      onShow: () => {
        // Hide first to avoid flash, then ensure the form is open
        formContainer.style.display = "none";
        if (!formContainer.classList.contains("active")) {
          document.getElementById("toggleFormBtn")?.click();
        }
        // Defer so the click's transition resolves before we restore + fade
        setTimeout(() => {
          formContainer.classList.add("fading");
          formContainer.style.display = "";
        }, 10);
      },
    },
    { text: i18n.t("filters.tutorial.modeOptions"), selector: ".mode-options", getFadingEls: fadeFormSections },
    { text: i18n.t("filters.tutorial.modeBlock"), selector: ".mode-option:nth-child(1)", getFadingEls: fadeFormSections },
    { text: i18n.t("filters.tutorial.modeReplace"), selector: ".mode-option:nth-child(2)", getFadingEls: fadeFormSections },
    { text: i18n.t("filters.tutorial.inlineEntries"), selector: ".inline-entries-section", getFadingEls: fadeFormSections },
    { text: i18n.t("filters.tutorial.parserChips"), selector: ".inline-parser-section", getFadingEls: fadeFormSections },
    { text: i18n.t("filters.tutorial.formFooter"), selector: ".inline-editor-footer", getFadingEls: fadeFormSections },
  ];

  await createTutorial({
    steps,
    storageKey: "filtersTutorialDone",
    onEnd: async () => {
      // Close form if tutorial left it open
      if (formContainer.classList.contains("active")) {
        document.getElementById("toggleFormBtn")?.click();
      }
      if (emptyState) emptyState.style.display = "";
    },
  });
}

// Last.fm Tutorial
async function showLastFmTutorial({ openSettingsDialog } = {}) {
  const card = document.querySelector('[data-section="lastfm"] .content');
  const SEL = ".lf-toggle-row, #lfStatusRow, #lfSearchContainer, #lfSourceList, #lfAllowList";
  let tutorialModal = null;

  function lfFading(targetEl) {
    return [...document.querySelectorAll(SEL)].filter((el) => el !== targetEl && !el.contains(targetEl));
  }

  function disposeModal() {
    tutorialModal?.remove();
    tutorialModal = null;
  }

  const steps = [
    { text: i18n.t("lastfm.tutorial.intro") },
    { text: i18n.t("lastfm.tutorial.toggle"), selector: "#lfEnabledToggle", getFadingEls: lfFading },
    { text: i18n.t("lastfm.tutorial.settingsBtn"), selector: "#lfSettingsBtn", getFadingEls: lfFading },
    {
      text: i18n.t("lastfm.tutorial.auth"),
      selector: ".lf-session-row .btn",
      getFadingEls: lfFading,
      onShow: () => {
        if (!tutorialModal && openSettingsDialog) {
          tutorialModal = openSettingsDialog();
          // Tutorial is read-only here: prevent accidental clicks inside the dialog
          if (tutorialModal) tutorialModal.style.pointerEvents = "none";
        }
      },
    },
    {
      text: i18n.t("lastfm.tutorial.status"),
      selector: "#lfStatusRow",
      getFadingEls: lfFading,
      onShow: disposeModal,
    },
    { text: i18n.t("lastfm.tutorial.search"), selector: "#lfSearchContainer", getFadingEls: lfFading },
    { text: i18n.t("lastfm.tutorial.sourceList"), selector: "#lfSourceList", getFadingEls: lfFading },
    { text: i18n.t("lastfm.tutorial.allowList"), selector: "#lfAllowList", getFadingEls: lfFading },
    { text: i18n.t("lastfm.tutorial.activate"), selector: "#lfEnabledToggle", getFadingEls: lfFading },
  ];

  await createTutorial({
    steps,
    storageKey: "lastFmTutorialDone",
    dialogWidth: 320,
    onStart: () => {
      if (card) card.style.pointerEvents = "none";
    },
    onEnd: async () => {
      disposeModal();
      if (card) card.style.pointerEvents = "";
    },
  });
}

// Custom Status Tutorial
async function showCustomStatusTutorial() {
  const card = document.querySelector('[data-section="customstatus"] .content');
  const SEL = "#csProfilesContainer, .cs-toggle-row, #csFields, #csPreview, #csSaveButtons";

  function csFading(targetEl) {
    return [...document.querySelectorAll(SEL)].filter((el) => el !== targetEl && !el.contains(targetEl));
  }

  const steps = [
    { text: i18n.t("customstatus.tutorial.intro") },
    { text: i18n.t("customstatus.tutorial.profiles"), selector: "#csProfilesContainer", getFadingEls: csFading },
    { text: i18n.t("customstatus.tutorial.fields"), selector: "#csFields", getFadingEls: csFading },
    { text: i18n.t("customstatus.tutorial.preview"), selector: "#csPreview", getFadingEls: csFading },
    { text: i18n.t("customstatus.tutorial.save"), selector: "#csSaveButtons", getFadingEls: csFading },
    { text: i18n.t("customstatus.tutorial.activate"), selector: ".cs-toggle-row", getFadingEls: csFading },
    { text: i18n.t("customstatus.tutorial.activeMode") },
  ];

  await createTutorial({
    steps,
    storageKey: "customStatusTutorialDone",
    dialogWidth: 320,
    onStart: () => {
      if (card) card.style.pointerEvents = "none";
    },
    onEnd: async () => {
      if (card) card.style.pointerEvents = "";
    },
  });
}

function createSkeletonScriptItem() {
  const ul = document.querySelector("#scriptList");
  const emptyMsg = document.querySelector(".script-empty-message");
  if (emptyMsg) emptyMsg.style.display = "none";

  // Main element
  const skeletonLi = document.createElement("li");
  skeletonLi.className = "script-item registered enabled tutorial-skeleton-item";

  // SCRIPT INFO DIV
  const scriptInfo = document.createElement("div");
  scriptInfo.className = "script-info";

  // Header section
  const scriptHeader = document.createElement("div");
  scriptHeader.className = "script-header";

  const iconContainer = document.createElement("div");
  iconContainer.className = "parser-icon-container";

  const imgIcon = document.createElement("img");
  imgIcon.className = "parser-icon";
  imgIcon.src = browser.runtime.getURL("icons/128x128.png");
  iconContainer.appendChild(imgIcon);

  const scriptTitle = document.createElement("strong");
  scriptTitle.className = "script-title";
  scriptTitle.textContent = "Example Script (Tutorial)";

  scriptHeader.appendChild(iconContainer);
  scriptHeader.appendChild(scriptTitle);

  // Details section
  const scriptDetails = document.createElement("div");
  scriptDetails.className = "script-details";

  scriptInfo.appendChild(scriptHeader);
  scriptInfo.appendChild(scriptDetails);

  // SCRIPT ACTIONS DIV
  const scriptActions = document.createElement("div");
  scriptActions.className = "script-actions";

  // Button Creator Helper Function
  const createActionButton = (className, title, iconPaths) => {
    const btn = document.createElement("button");
    btn.className = className;
    btn.title = title;
    btn.appendChild(createSVG(iconPaths));
    return btn;
  };

  // Defining buttons
  const btnToggle = createActionButton("btnToggle btn-disable", "Disable", svg_paths.pauseIconPaths);
  const btnMore = createActionButton("btnMore", "More Actions", svg_paths.moreIconPaths);

  const skeletonMenu = document.createElement("div");
  skeletonMenu.className = "usm-overflow-menu";
  skeletonMenu.hidden = true;
  skeletonMenu.appendChild(createActionButton("btnExport", "Export", svg_paths.exportIconPaths));
  skeletonMenu.appendChild(createActionButton("btnContribute", "Contribute", svg_paths.githubIconPaths));
  skeletonMenu.appendChild(createActionButton("btnDelete", "Delete", svg_paths.trashIconPaths));

  // Adding action elements
  scriptActions.appendChild(btnToggle);
  scriptActions.appendChild(btnMore);
  scriptActions.appendChild(skeletonMenu);

  // Combining the main element
  skeletonLi.appendChild(scriptInfo);
  skeletonLi.appendChild(scriptActions);

  // Adding to the DOM
  ul.appendChild(skeletonLi);

  return skeletonLi;
}
