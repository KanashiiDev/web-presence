const parserState = {
  isParserOpen: false,
  isParserAnimating: false,
  currentRenderCleanup: null,
};

const _renderedEntries = new Map();

async function renderList(filteredList = null, isSearch = null) {
  const container = document.getElementById("siteListContainer");
  container.style = "";

  parserState.currentRenderCleanup?.();
  parserState.currentRenderCleanup = null;
  parserState.isParserOpen = false;
  _renderedEntries.clear();
  container.replaceChildren();
  document.querySelector(".search-controls")?.classList.remove("fading");

  const contWrapper = document.querySelector("#siteList .simplebar-content-wrapper");
  if (contWrapper) contWrapper.style.paddingBottom = "";

  const spinner = createSpinner();
  container.appendChild(spinner);

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const tabUrl = new URL(tab.url);
  const tabHostname = normalizeHost(tabUrl.hostname);
  const tabPath = tabUrl.pathname;

  const list = filteredList ?? (await getFreshParserList(true));

  if (!list?.length) {
    spinner.remove();
    createEmptyState(container, isSearch);
    return false;
  }

  const { addListener, removeAll } = createListenerManager();

  const [{ parserEnabledState = {} }, { parserSettings = {} }] = await Promise.all([
    browser.storage.local.get("parserEnabledState"),
    browser.storage.local.get("parserSettings"),
  ]);

  let anySettingsDirty = false;
  const fragment = document.createDocumentFragment();

  list.sort((a, b) => {
    const titleA = (a.title ?? "").toLowerCase();
    const titleB = (b.title ?? "").toLowerCase();
    return titleA.localeCompare(titleB);
  });

  for (const entry of list) {
    const { wrapper, settingsDirty } = await buildParserEntry({
      entry,
      parserEnabledState,
      parserSettings,
      container,
      tabHostname,
      tabPath,
      addListener,
    });

    if (settingsDirty) anySettingsDirty = true;
    _renderedEntries.set(entry.id, wrapper);
    fragment.appendChild(wrapper);
  }

  if (anySettingsDirty) {
    await browser.storage.local.set({ parserSettings });
  }

  container.appendChild(fragment);
  loadFavIcons(document.querySelectorAll(".parser-icon"));

  parserState.currentRenderCleanup = removeAll;
  spinner.remove();
  return true;
}

function filterList(visibleIds = null) {
  const container = document.getElementById("siteListContainer");
  container.querySelector(".setup-list-message")?.remove();

  let visibleCount = 0;

  for (const [id, wrapper] of _renderedEntries) {
    const show = visibleIds === null || visibleIds.has(id);

    wrapper.style.display = show ? "" : "none";
    if (show) visibleCount++;
  }

  if (visibleCount === 0) {
    createEmptyState(container, 1);
  }
}
