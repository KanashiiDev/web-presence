// INIT
async function initFilter() {
  await FilterStorage.loadParsers();
  await FilterStorage.loadFilters();

  FilterTabsController.render();
  FilterListController.render();

  // Setup event listeners for main buttons
  const toggleFormBtn = document.getElementById("toggleFormBtn");
  if (toggleFormBtn) {
    FilterEvents.add(toggleFormBtn, "click", () => FormController.toggle());
  }

  const blockCurrentBtn = document.getElementById("getActivityInfoBtn");
  if (blockCurrentBtn) {
    FilterEvents.add(blockCurrentBtn, "click", () => QuickActions.blockCurrent());
  }

  // Setup View Toggle Button
  function updateViewUI(isGridView, toggleLabel, filterList) {
    if (toggleLabel) {
      toggleLabel.replaceChildren(createSVG(!isGridView ? svg_paths.gridViewIconPaths : svg_paths.listViewIconPaths));
    }
    filterList?.classList.toggle("grid", isGridView);
  }

  async function setupViewToggle() {
    const filterList = document.querySelector("#filtersList");
    const toggleView = document.querySelector("#btnToggleView");
    const toggleLabel = document.querySelector("#btnToggleViewLabel");

    if (!toggleView) return;
    toggleView.style.visibility = "";

    let { filterListView = false } = await browser.storage.local.get("filterListView");
    updateViewUI(filterListView, toggleLabel, filterList);

    toggleView.addEventListener("click", () => {
      filterListView = !filterListView;
      updateViewUI(filterListView, toggleLabel, filterList);
      browser.storage.local.set({ filterListView }).catch(() => {});
    });
  }

  updateViewUI();
  setupViewToggle();
  const tutorial = await browser.storage.local.get("filtersTutorialDone");
  if (!tutorial.filtersTutorialDone) {
    await showFiltersTutorial();
  }
}

window.initFilter = initFilter;
