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
 * @param {Function} [config.onStart]  - runs once before first step
 * @param {Function} [config.onEnd]    - runs once after last step / skip
 */
async function createTutorial({ steps, storageKey, onStart, onEnd }) {
  // Build tooltip DOM
  function buildTooltip() {
    document.getElementById("tutorialTooltip")?.remove();

    const dialog = document.createElement("div");
    dialog.id = "tutorialTooltip";
    dialog.className = "tutorial-dialog";

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
    document.body.appendChild(dialog);

    return { dialog, header, text, nextBtn, skipBtn };
  }

  const { dialog, header, text, nextBtn, skipBtn } = buildTooltip();
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

  // Position tooltip relative to target; no-op when targetEl is absent
  function positionTooltip(targetEl) {
    if (!targetEl) return;

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
    const targetEl = step.selector ? document.querySelector(step.selector) : null;

    step.onShow?.();

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
  }

  // Remove tooltip, clear visual state, persist completion
  async function endTutorial() {
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
    async () => {
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
    () => {
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
    "#githubLink, #settingsToggle, #openFiltersBtn, #openDashboardBtn, #openLibraryBtn";

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
    ...(currentConnectionMode !== "web-only"
      ? [
          {
            text: i18n.t("tutorial.step7"),
            selector: "#openDashboardBtn",
            getFadingEls: popupFading,
          },
        ]
      : []),

    { text: i18n.t("tutorial.step8"), selector: "#openLibraryBtn", getFadingEls: popupFading },
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

  // Skeleton fallback when list is empty
  if (!ul.querySelector(".script-item")) {
    createSkeletonScriptItem();
    createdSkeleton = true;
  }

  // Shared selectors queried once per fade call
  const TABS_SEL = ".script-tab";
  const ITEMS_SEL = ".script-item";
  const TOOLBAR_SEL = "#btnNew, #btnImport, #btnExport, #btnGithubSettings";
  const ACTIONS_SEL = ".script-actions button";

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

  const steps = [
    { text: i18n.t("userscript.tutorial.btnToggle"), selector: ".script-item .btnToggle", getFadingEls: fadeScriptButtons },
    { text: i18n.t("userscript.tutorial.btnEdit"), selector: ".script-item .btnEdit", getFadingEls: fadeScriptButtons },
    { text: i18n.t("userscript.tutorial.btnExport"), selector: ".script-item .btnExport", getFadingEls: fadeScriptButtons },
    { text: i18n.t("userscript.tutorial.btnContribute"), selector: ".script-item .btnContribute", getFadingEls: fadeScriptButtons },
    { text: i18n.t("userscript.tutorial.btnDelete"), selector: ".script-item .btnDelete", getFadingEls: fadeScriptButtons },
    { text: i18n.t("userscript.tutorial.btnNew"), selector: "#btnNew", getFadingEls: fadeToolbarBtns },
    { text: i18n.t("userscript.tutorial.btnImport"), selector: "#btnImport", getFadingEls: fadeToolbarBtns },
    { text: i18n.t("userscript.tutorial.btnExportAll"), selector: "#btnExport", getFadingEls: fadeToolbarBtns },
    { text: i18n.t("userscript.tutorial.btnGithubSettings"), selector: "#btnGithubSettings", getFadingEls: fadeToolbarBtns },
  ];

  await createTutorial({
    steps,
    storageKey: "userScriptTutorialDone",
    onEnd: async () => {
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
  const HEADER_SEL = "#filterTabsContainer, #toggleFormBtn, #openHistoryBtn, #getSongInfoBtn, .filter-item, #btnToggleView";
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
      text: i18n.t("filters.tutorial.getSongInfo"),
      selector: "#getSongInfoBtn",
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

  const scriptStatus = document.createElement("span");
  scriptStatus.className = "script-status status-active";
  scriptStatus.textContent = "✓ Active";

  scriptHeader.appendChild(iconContainer);
  scriptHeader.appendChild(scriptTitle);
  scriptHeader.appendChild(scriptStatus);

  // Details section
  const scriptDetails = document.createElement("div");
  scriptDetails.className = "script-details";

  const description = document.createElement("p");
  description.className = "script-description";
  description.textContent = "Example script description.";

  const domain = document.createElement("small");
  domain.className = "script-domain";
  domain.textContent = "example.com [/*]";

  scriptDetails.appendChild(description);
  scriptDetails.appendChild(domain);

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
  const btnEdit = createActionButton("btnEdit", "Edit", svg_paths.penIconPaths);
  const btnExport = createActionButton("btnExport", "Export", svg_paths.exportIconPaths);
  const btnContribute = createActionButton("btnContribute", "Contribute", svg_paths.githubIconPaths);
  const btnDelete = createActionButton("btnDelete", "Delete", svg_paths.trashIconPaths);

  // Adding action elements
  scriptActions.appendChild(btnToggle);
  scriptActions.appendChild(btnEdit);
  scriptActions.appendChild(btnExport);
  scriptActions.appendChild(btnContribute);
  scriptActions.appendChild(btnDelete);

  // Combining the main element
  skeletonLi.appendChild(scriptInfo);
  skeletonLi.appendChild(scriptActions);

  // Adding to the DOM
  ul.appendChild(skeletonLi);

  return skeletonLi;
}
