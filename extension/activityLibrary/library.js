const msg = (action, data = {}) => browser.runtime.sendMessage({ action, ...data });

// DOM element cache
const domCache = new Map();
const getElem = (id) => {
  domCache.has(id) || domCache.set(id, document.getElementById(id));
  return domCache.get(id);
};

// State
const state = {
  repos: [], // [{ id, url, user, repo, branch, scripts, lastChecked}]
  installed: [], // userScriptsList from storage
  pendingUpdates: [],
  newScriptIds: new Set(),
  _initialized: false,
  listView: false,
  storeNewScriptNotification: true,
};

// WeakMap cache for generateScriptId - avoids recomputing for same meta object
const scriptIdCache = new WeakMap();

// Pagination
const paginationState = new Map(); // repoId → currentPage
const scriptRowCache = new Map();
const PAGE_SIZE = 20;

// Messaging
const apiCall = async (action, data = {}) => {
  const result = await msg(action, data);
  return result ?? { ok: false, error: "No response" };
};

const listRepos = () => apiCall("store_listRepos");
const addRepo = (url) => apiCall("store_addRepo", { url });
const removeRepo = (repoId) => apiCall("store_removeRepo", { repoId });
const checkUpdates = () => apiCall("store_checkUpdates");
const installScript = (repoId, meta) => apiCall("store_installScript", { repoId, scriptMeta: meta });
const updateScript = (repoId, meta) => apiCall("store_updateScript", { repoId, scriptMeta: meta });
const batchUpdate = (updates) => apiCall("store_batchUpdate", { updates });

const getInstalledScripts = async () => {
  const result = await browser.storage.local.get("userScriptsList").catch(() => ({}));
  return result.userScriptsList ?? [];
};

// Status Bar
let statusTimer = null;

const showStatus = (text, loading = false, duration = 3000) => {
  const bar = getElem("statusBar");
  const textEl = getElem("statusText");
  if (!bar || !textEl) return;

  bar.hidden = false;

  const spinner = bar.querySelector(".spinner-inline");
  if (loading && !spinner) {
    const s = document.createElement("div");
    s.className = "spinner-inline";
    bar.insertBefore(s, textEl);
  } else if (!loading) {
    spinner?.remove();
  }

  textEl.textContent = text;

  clearTimeout(statusTimer);
  statusTimer = null;
  if (!loading && duration > 0) {
    statusTimer = setTimeout(() => {
      bar.hidden = true;
    }, duration);
  }
};

const hideStatus = () => {
  clearTimeout(statusTimer);
  statusTimer = null;
  const bar = getElem("statusBar");
  if (bar) bar.hidden = true;
};

// Init
const MAIN_REPO_ID = "KanashiiDev__web-presence-activities__main";
const MAIN_REPO_URL = "https://github.com/KanashiiDev/web-presence-activities";

const init = async () => {
  if (state._initialized) return;

  await i18n.load("extension").catch(() => {});

  // Initial Setup
  const setup = await browser.storage.local.get("initialSetupDone");
  if (!setup.initialSetupDone) {
    await showInitialSetupDialog(1);
  }

  // Host Permission Check
  const hasPermission = await browser.permissions.contains({
    origins: ["*://*/*"],
  });
  if (!hasPermission) await showHostPermissionDialog(1);

  try {
    const { appearanceSettings = {} } = await browser.storage.local.get("appearanceSettings");
    if (appearanceSettings.theme) document.body.setAttribute("data-theme", appearanceSettings.theme);
  } catch {}

  const url = new URL(window.location.href);
  const hasSetup = url.searchParams.get("setup") === "1";

  if (hasSetup) {
    await showAlert(i18n.t("library.setup.header"), i18n.t("library.setup.body"), "tip");
    url.searchParams.delete("setup");
    window.location.replace(url.toString());
    await browser.storage.local.set({ storeServiceSetup: true });
  }

  const perm = await checkUserScriptsPermission();
  if (!perm) return;

  migrateToUserScriptSystem();

  injectHeaderIcons();
  applyTsPlugins();
  await loadAll();
  await ensureMainRepo();

  bindEvents();

  const { libraryListView = false, storeNewScriptNotification = true } = await browser.storage.local.get(["libraryListView", "storeNewScriptNotification"]);

  state.listView = libraryListView;
  state.storeNewScriptNotification = storeNewScriptNotification;

  state._initialized = true;

  const bindCheckbox = async ({ elemId, storageKey, defaultValue = false, onChange }) => {
    const elem = getElem(elemId);
    if (!elem) return;

    const result = await browser.storage.local.get(storageKey).catch(() => ({}));
    const isChecked = result[storageKey] ?? defaultValue;
    elem.checked = isChecked;

    elem.addEventListener("change", async (e) => {
      const checked = e.target.checked;
      await browser.storage.local.set({ [storageKey]: checked }).catch(() => {});

      if (onChange) {
        await onChange(checked);
      }
    });
  };

  await bindCheckbox({
    elemId: "chkAutoUpdate",
    storageKey: "storeAutoUpdate",
    defaultValue: true,
  });

  await bindCheckbox({
    elemId: "newScriptNotification",
    storageKey: "storeNewScriptNotification",
    defaultValue: true,
    onChange: (isChecked) => {
      state.storeNewScriptNotification = isChecked;
    },
  });

  await bindCheckbox({
    elemId: "chkLibraryListView",
    storageKey: "libraryListView",
    defaultValue: false,
    onChange: (isChecked) => {
      state.listView = isChecked;

      document.querySelectorAll(".script-list").forEach((el) => {
        el.classList.toggle("list-view", state.listView);
      });

      document.querySelectorAll(".script-row:not([style*='display: none'])").forEach(refreshDescriptionToggle);
    },
  });

  renderAll();
  applyTranslations("extension");
  initApplyAttrs();
  initStorageListener();
  initMotionPreference();
};

const injectHeaderIcons = () => {
  const checkBtn = getElem("btnCheckUpdates");
  checkBtn?.insertBefore(iconSVG("refreshIconPaths", 14), checkBtn.firstChild);

  const toggleBtn = getElem("btnToggleAdvanced");
  if (toggleBtn) {
    const icon = iconSVG("plusIconPaths", 12);
    icon.style.opacity = "0.7";
    toggleBtn.insertBefore(icon, toggleBtn.firstChild);
  }

  const emptyState = getElem("emptyState");
  if (emptyState) {
    const icon = createSVG(svg_paths.emptyCircleIconPaths, {
      width: 40,
      height: 40,
      stroke: "currentColor",
      strokeWidth: 1.4,
      viewBox: "-1 -1 25.5 25.5",
    });
    icon.style.opacity = "0.3";
    emptyState.insertBefore(icon, emptyState.firstChild);
  }

  const exLink = getElem("exampleRepoLink");
  if (exLink) exLink.href = MAIN_REPO_URL;

  const headerRight = document.querySelector(".header-right");
  if (headerRight) {
    const createToggleItem = (wrapperClass, labelI18n, labelText, inputId) => {
      const wrapper = document.createElement("div");
      wrapper.className = `${wrapperClass} item`;

      const span = document.createElement("span");
      span.className = `${wrapperClass} label`;
      span.setAttribute("data-i18n", labelI18n);
      span.textContent = labelText;

      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = inputId;

      const slider = document.createElement("span");
      slider.className = "slider";

      const switchLabel = document.createElement("label");
      switchLabel.className = "switch-label";
      switchLabel.append(input, slider);

      wrapper.append(span, switchLabel);
      return wrapper;
    };

    const menuContainer = document.createElement("div");
    menuContainer.className = "toggle-menu-container";
    menuContainer.style.position = "relative";

    const menuBtn = document.createElement("button");
    menuBtn.className = "btn-toggle-menu library-btn btn btn-secondary";
    menuBtn.id = "btnToggleMenu";
    menuBtn.appendChild(createSVG(svg_paths.gearIconPaths, 14));

    const dropdown = document.createElement("div");
    dropdown.className = "toggle-dropdown-menu";
    dropdown.style.display = "none";

    // Auto Update Toggle
    const autoUpdateWrapper = createToggleItem("auto-update-wrapper", "library.autoUpdate", "Auto Update", "chkAutoUpdate");

    // New Script Notification Toggle
    const notificationWrapper = createToggleItem("script-notification-wrapper", "library.newScriptNotification", "New Script Notification", "newScriptNotification");

    // View Toggle
    const libraryListViewWrapper = createToggleItem("list-view-wrapper", "library.listView", "List View", "chkLibraryListView");

    dropdown.append(autoUpdateWrapper, notificationWrapper, libraryListViewWrapper);
    menuContainer.append(menuBtn, dropdown);

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = dropdown.style.display === "flex";
      dropdown.style.display = isVisible ? "none" : "flex";
    });

    document.addEventListener("click", () => {
      dropdown.style.display = "none";
    });

    dropdown.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    headerRight.appendChild(menuContainer);
  }
};

const LEGACY_REPO_IDS = ["KanashiiDev__discord-music-rpc-activities__main"];

const ensureMainRepo = async () => {
  const { legacyRepoMerged_v1 } = await browser.storage.local.get("legacyRepoMerged_v1");

  if (!legacyRepoMerged_v1) {
    const repos = await listRepos().catch(() => ({ ok: true, list: [] }));
    const repoList = repos.list ?? [];

    const legacyRepos = repoList.filter((r) => LEGACY_REPO_IDS.includes(r.id));

    if (legacyRepos.length) {
      // If there is no new repo, add it first
      let mainRepo = repoList.find((r) => r.id === MAIN_REPO_ID);
      if (!mainRepo) {
        const result = await addRepo(MAIN_REPO_URL).catch(() => null);
        if (result?.ok) {
          const fresh = await listRepos().catch(() => ({ ok: true, list: [] }));
          mainRepo = (fresh.list ?? []).find((r) => r.id === MAIN_REPO_ID);
        }
      }

      // Update the repository references of the installed scripts
      const installed = await getInstalledScripts();
      const needsUpdate = installed.some((s) => LEGACY_REPO_IDS.includes(s.storeRepoId));
      if (needsUpdate) {
        const updated = installed.map((s) => (LEGACY_REPO_IDS.includes(s.storeRepoId) ? { ...s, storeRepoId: MAIN_REPO_ID, storeRepoUrl: MAIN_REPO_URL } : s));
        await browser.storage.local.set({ userScriptsList: updated });
      }

      // Delete legacy repositories
      for (const legacy of legacyRepos) {
        await removeRepo(legacy.id).catch(() => {});
      }
    }

    await browser.storage.local.set({ legacyRepoMerged_v1: true });
  }

  const currentRepos = await listRepos().catch(() => ({ ok: true, list: [] }));
  state.repos = currentRepos.list ?? [];
  state.installed = await getInstalledScripts();

  if (state.repos.some((r) => r.id === MAIN_REPO_ID)) return;

  const result = await addRepo(MAIN_REPO_URL).catch(() => null);
  if (result?.ok) {
    const [repoRes, installed] = await Promise.all([listRepos().catch(() => ({ ok: true, list: [] })), getInstalledScripts()]);
    state.repos = repoRes.list ?? [];
    state.installed = installed;
  }
};

const loadAll = async () => {
  const [repoRes, installed, { storeNewScriptIds = [] }] = await Promise.all([
    listRepos().catch(() => ({ ok: true, list: [] })),
    getInstalledScripts(),
    browser.storage.local.get("storeNewScriptIds"),
  ]);
  state.repos = repoRes.list ?? [];
  state.installed = installed;
  state.newScriptIds = new Set(storeNewScriptIds);
  recomputePendingUpdates();
};

// Build a lookup map once and reuse it wherever installedMap is needed
const buildInstalledMap = () => {
  const map = new Map();
  for (const s of state.installed) {
    if (s.id) map.set(s.id, s);
    if (s.storeScriptId) map.set(s.storeScriptId, s);
  }
  return map;
};

const recomputePendingUpdates = () => {
  const installedMap = buildInstalledMap();
  state.pendingUpdates = [];

  for (const repo of state.repos) {
    for (const meta of repo.scripts ?? []) {
      const sid = meta.id ?? generateScriptId(meta);
      const local = installedMap.get(sid);
      if (local?.version && isNewer(meta.version, local.version)) {
        state.pendingUpdates.push({ repoId: repo.id, scriptMeta: meta });
      }
    }
  }
};

// Event Binding
const eventCleanup = new Map();

const bindEvents = () => {
  for (const [elem, { type, handler }] of eventCleanup) {
    elem.removeEventListener(type, handler);
  }
  eventCleanup.clear();

  const on = (id, event, handler) => {
    const el = getElem(id);
    if (!el) return;
    el.addEventListener(event, handler);
    eventCleanup.set(el, { type: event, handler });
  };

  on("btnCheckUpdates", "click", handleCheckUpdates);
  on("btnBatchUpdate", "click", handleBatchUpdate);
  on("btnToggleAdvanced", "click", handleToggleAdvanced);
  on("btnConfirmAddRepo", "click", handleAddRepo);
  on("btnCancelAddRepo", "click", () => toggleAddRepoPanel(false));

  const urlInput = getElem("repoUrlInput");
  if (urlInput) {
    const kh = (e) => {
      if (e.key === "Enter") handleAddRepo();
      if (e.key === "Escape") toggleAddRepoPanel(false);
    };
    urlInput.addEventListener("keydown", kh);
    eventCleanup.set(urlInput, { type: "keydown", handler: kh });
  }

  const repoList = getElem("repoList");
  if (repoList) {
    const ch = (e) => handleRepoListClick(e);
    const ih = (e) => handleRepoListInput(e);
    repoList.addEventListener("click", ch);
    repoList.addEventListener("input", ih);
    eventCleanup.set(Symbol(), { el: repoList, type: "click", handler: ch });
    eventCleanup.set(Symbol(), { el: repoList, type: "input", handler: ih });
  }
};

const handleToggleAdvanced = () => {
  const panel = getElem("addRepoPanel");
  if (panel) toggleAddRepoPanel(panel.hidden);
};

const toggleAddRepoPanel = (open) => {
  const panel = getElem("addRepoPanel");
  if (!panel) return;
  panel.hidden = !open;
  if (open) {
    const urlInput = getElem("repoUrlInput");
    const errorDiv = getElem("addRepoError");
    if (urlInput) {
      urlInput.value = "";
      urlInput.focus();
    }
    if (errorDiv) errorDiv.textContent = "";
  }
};

const handleAddRepo = async () => {
  const urlInput = getElem("repoUrlInput");
  const errorDiv = getElem("addRepoError");
  const confirmBtn = getElem("btnConfirmAddRepo");
  if (!urlInput || !errorDiv || !confirmBtn) return;

  const url = urlInput.value.trim();
  if (!url) {
    errorDiv.textContent = i18n.t("library.addRepo.errorEmpty");
    return;
  }

  confirmBtn.disabled = true;
  errorDiv.textContent = "";
  showStatus(i18n.t("library.status.addingRepo"), true, 0);

  const result = await addRepo(url).catch((err) => ({ ok: false, error: err.message }));
  confirmBtn.disabled = false;

  if (!result.ok) {
    errorDiv.textContent = result.error ?? i18n.t("library.error.unknown");
    hideStatus();
    return;
  }

  toggleAddRepoPanel(false);
  await loadAll();
  renderAll();
  showStatus(i18n.t("library.status.repoAdded", [result.repo?.scripts?.length ?? 0]), false, 3500);
};

const handleCheckUpdates = async () => {
  const btn = getElem("btnCheckUpdates");
  if (!btn) return;

  btn.disabled = true;
  showStatus(i18n.t("library.status.checkingUpdates"), true, 0);

  const result = await checkUpdates().catch((err) => ({ ok: false, error: err.message }));
  btn.disabled = false;

  if (!result?.ok) {
    showStatus(i18n.t("library.error.prefix") + (result?.error ?? i18n.t("library.error.unknown")), false, 4000);
    return;
  }

  await loadAll();
  renderAll();

  const total = result.totalUpdates ?? 0;
  showStatus(total === 0 ? i18n.t("library.status.allUpToDate") : i18n.t("library.status.updatesFound", [result.totalUpdates ?? 0]), false, 4000);
};

const handleBatchUpdate = async () => {
  const updates = state.pendingUpdates;
  if (!updates.length) return;

  const btn = getElem("btnBatchUpdate");
  if (!btn) return;

  btn.disabled = true;
  showStatus(i18n.t("library.status.updatingBatch", [updates.length]), true, 0);

  const result = await batchUpdate(updates).catch((err) => ({ ok: false, error: err.message }));
  btn.disabled = false;

  if (!result?.ok) {
    showStatus(i18n.t("library.error.prefix") + (result?.error ?? i18n.t("library.error.unknown")), false, 4000);
    return;
  }

  const okCount = result.successful?.length ?? 0;
  const failCount = result.failed?.length ?? 0;
  await loadAll();
  renderAll();
  showStatus(failCount > 0 ? i18n.t("library.status.batchPartial", [okCount, failCount]) : i18n.t("library.status.batchDone", [okCount]), false, 3500);
};

const handleRepoListClick = async (e) => {
  const target = e.target;

  const repoHeader = target.closest(".repo-block-header");
  if (repoHeader && !target.closest(".library-btn, .script-action-btn")) {
    repoHeader.closest(".repo-block")?.classList.toggle("open");
    return;
  }

  // Remove repo
  const removeRepoBtn = target.closest("[data-action='removeRepo']");
  if (removeRepoBtn) {
    const repoId = removeRepoBtn.dataset.repoId;
    if (!repoId) return;

    if (repoId === MAIN_REPO_ID) {
      showStatus(i18n.t("library.error.cannotDeleteMain"), false, 3000);
      return;
    }

    if (!(await showConfirm("", { heading: i18n.t("library.confirm.removeRepo") + `\n[${MAIN_REPO_ID}]`, body: "" }))) return;

    removeRepoBtn.disabled = true;
    showStatus(i18n.t("library.status.removingRepo"), true, 0);
    scriptRowCache.delete(repoId);

    const result = await removeRepo(repoId).catch((err) => ({ ok: false, error: err.message }));
    if (!result?.ok) {
      showStatus(i18n.t("library.error.prefix") + (result?.error ?? i18n.t("library.error.unknown")), false, 4000);
      return;
    }

    state.repos = state.repos.filter((r) => r.id !== repoId);
    recomputePendingUpdates();
    renderUpdateBanner();
    updateRepoBadgeInPlace(repoId);

    document.querySelector(`.repo-block[data-repo-id="${CSS.escape(repoId)}"]`)?.remove();
    if (!state.repos.length) getElem("emptyState").hidden = false;

    showStatus(i18n.t("library.status.repoRemoved"), false, 2500);
    return;
  }

  // Remove script
  const removeScriptBtn = target.closest("[data-action='removeScript']");
  if (removeScriptBtn) {
    const scriptTitle = removeScriptBtn.dataset.scriptTitle + " - " + removeScriptBtn.dataset.scriptAuthor || "";
    const scriptId = removeScriptBtn.dataset.scriptId;
    const repoId = removeScriptBtn.dataset.repoId;
    if (!scriptId) return;
    if (!(await showConfirm("", { heading: i18n.t("userscript.editor.confirm.delete") + `\n[${scriptTitle}]`, body: "" }))) return;

    removeScriptBtn.disabled = true;
    removeScriptBtn.classList.add("loading");
    removeScriptBtn.replaceChildren(iconSVG("spinnerIconPaths", 13));
    showStatus(i18n.t("library.status.removingScript"), true, 0);

    const result = await msg("store_removeScript", { scriptId, repoId }).catch((err) => ({ ok: false, error: err.message }));

    removeScriptBtn.replaceChildren(iconSVG("trashIconPaths", 14));
    removeScriptBtn.classList.remove("loading");
    removeScriptBtn.disabled = false;

    if (!result?.ok) {
      showStatus(i18n.t("library.error.prefix") + (result?.error ?? i18n.t("library.error.unknown")), false, 4000);
      return;
    }

    state.installed = await getInstalledScripts();
    recomputePendingUpdates();
    renderUpdateBanner();

    const row = removeScriptBtn.closest(".script-row");
    if (row) {
      const actualScriptId = row.dataset.scriptId;
      const repo = state.repos.find((r) => r.id === repoId);
      const meta = repo?.scripts?.find((s) => (s.id ?? generateScriptId(s)) === actualScriptId);
      if (meta) updateScriptRowInPlace(row, meta, repoId, buildInstalledMap());
    }

    document.querySelector(`.repo-block[data-repo-id="${CSS.escape(repoId)}"]`);
    const block = document.querySelector(`.repo-block[data-repo-id="${CSS.escape(repoId)}"]`);
    if (block) applyFiltersInPlace(block);

    showStatus(i18n.t("library.status.scriptRemoved"), false, 2500);
    return;
  }

  const actionBtn = target.closest("[data-action='install'], [data-action='update']");
  if (actionBtn) {
    await handleScriptAction(actionBtn, actionBtn.dataset.action);
  }
};

const handleRepoListInput = (e) => {
  const searchInput = e.target.closest(".script-search");
  if (!searchInput) return;
  const repoId = searchInput.dataset.repoId;
  if (!repoId) return;
  const block = document.querySelector(`.repo-block[data-repo-id="${CSS.escape(repoId)}"]`);
  if (block) applyFiltersInPlace(block, true);
};

const handleScriptAction = async (btn, action) => {
  const repoId = btn.dataset.repoId;
  const scriptId = btn.dataset.scriptId;
  if (!repoId || !scriptId) return;

  const repo = state.repos.find((r) => r.id === repoId);
  if (!repo) return;

  const scriptMeta = repo.scripts?.find((s) => (s.id ?? generateScriptId(s)) === scriptId);
  if (!scriptMeta) return;

  btn.disabled = true;
  btn.replaceChildren(iconSVG("spinnerIconPaths", 13));

  const isInstall = action === "install";
  showStatus(i18n.t(isInstall ? "library.status.installing" : "library.status.updating", [scriptMeta.title ?? "Script"]), true, 0);

  const fn = isInstall ? () => installScript(repoId, scriptMeta) : () => updateScript(repoId, scriptMeta);
  const result = await fn().catch((err) => ({ ok: false, error: err.message }));

  btn.replaceChildren(iconSVG(isInstall ? "downloadIconPaths" : "refreshIconPaths", 13));
  btn.disabled = false;

  if (!result?.ok) {
    showStatus(i18n.t("library.error.prefix") + (result?.error ?? i18n.t("library.error.unknown")), false, 5000);
    return;
  }

  showStatus(i18n.t(isInstall ? "library.status.installed" : "library.status.updated", [scriptMeta.title]), false, 3000);

  state.installed = await getInstalledScripts();
  recomputePendingUpdates();
  renderUpdateBanner();
  updateRepoBadgeInPlace(repoId);

  const installedMap = buildInstalledMap();

  const row = document.querySelector(`.script-row[data-script-id="${CSS.escape(scriptId)}"]`);
  if (row) updateScriptRowInPlace(row, scriptMeta, repoId, installedMap);

  const block = document.querySelector(`.repo-block[data-repo-id="${CSS.escape(repoId)}"]`);
  if (block) applyFiltersInPlace(block);
};

const renderAll = () => {
  const list = getElem("repoList");
  const empty = getElem("emptyState");
  if (!list || !empty) return;

  renderUpdateBanner();

  if (!state.repos.length) {
    empty.hidden = false;
    list.replaceChildren();
    return;
  }
  empty.hidden = true;
  const existingBlocks = new Map([...list.querySelectorAll(".repo-block")].map((b) => [b.dataset.repoId, b]));

  const pendingMap = new Map();
  for (const item of state.pendingUpdates) {
    pendingMap.set(item.repoId, (pendingMap.get(item.repoId) ?? 0) + 1);
  }

  for (const repo of state.repos) {
    scriptRowCache.delete(repo.id);
    let block = existingBlocks.get(repo.id);
    const wasOpen = block?.classList.contains("open") ?? true;

    if (!block) {
      block = document.createElement("div");
      block.className = "repo-block" + (wasOpen ? " open" : "");
      block.dataset.repoId = repo.id;
      list.appendChild(block);
    }

    block.classList.toggle("main-repo", repo.id === MAIN_REPO_ID);

    renderRepoBlock(block, repo, pendingMap.get(repo.id) ?? 0);
    if (wasOpen) block.classList.add("open");
    existingBlocks.delete(repo.id);
  }

  for (const block of existingBlocks.values()) block.remove();
};

const renderUpdateBanner = () => {
  const banner = getElem("updateBanner");
  const textEl = getElem("updateBannerText");
  if (!banner || !textEl) return;

  const count = state.pendingUpdates.length;
  banner.hidden = count === 0;
  if (count > 0) textEl.textContent = i18n.t("library.banner.updatesAvailable", [count]);
};

const renderRepoBlock = (block, repo, precomputedUpdateCount) => {
  const updateCount = precomputedUpdateCount ?? state.pendingUpdates.filter((u) => u.repoId === repo.id).length;
  const scripts = repo.scripts ?? [];
  block.replaceChildren();

  // Header
  const header = document.createElement("div");
  header.className = "repo-block-header";

  const info = document.createElement("div");
  info.className = "repo-block-info";

  const nameEl = document.createElement("a");
  nameEl.className = "repo-block-name";
  nameEl.textContent = repo.id === MAIN_REPO_ID ? i18n.t("library.repo.officialName") : `${repo.user}/${repo.repo}`;
  nameEl.href = repo.url;

  const metaEl = document.createElement("div");
  metaEl.className = "repo-block-meta";
  const lastCheckedText = repo.lastChecked ? ` · ${i18n.t("library.repo.lastChecked")}: ${relativeTime(repo.lastChecked)}` : "";
  metaEl.textContent = `${scripts.length} ${i18n.t("library.repo.scriptCount")}${lastCheckedText}`;

  info.append(nameEl, metaEl);
  header.appendChild(info);

  if (repo.id === MAIN_REPO_ID) {
    const official = document.createElement("span");
    official.className = "repo-badge badge badge-sm badge-bold badge-primary";
    official.textContent = i18n.t("library.repo.official");
    header.appendChild(official);
  }

  const badges = document.createElement("div");
  badges.className = "repo-block-badges";
  if (updateCount > 0) {
    const b = document.createElement("span");
    b.className = "repo-badge badge badge-sm badge-bold badge-warning-dark";
    b.textContent = `↑ ${updateCount}`;
    badges.appendChild(b);
  }
  header.appendChild(badges);

  if (repo.id !== MAIN_REPO_ID) {
    const actions = document.createElement("div");
    actions.className = "repo-block-actions";
    const removeBtn = document.createElement("button");
    removeBtn.className = "library-btn btn btn-danger btn-sm";
    removeBtn.dataset.action = "removeRepo";
    removeBtn.dataset.repoId = repo.id;
    removeBtn.title = i18n.t("library.repo.removeTitle");
    removeBtn.textContent = i18n.t("library.repo.remove");
    actions.appendChild(removeBtn);
    header.appendChild(actions);
  }

  block.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "repo-block-body";

  const inner = document.createElement("div");
  inner.className = "repo-block-body-inner";

  const filterBar = document.createElement("div");
  filterBar.className = "script-filter-bar";

  const searchWrapper = document.createElement("div");
  searchWrapper.className = "script-search-wrapper";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "script-search input";
  searchInput.dataset.repoId = repo.id;
  searchInput.placeholder = i18n.t("parserlist.search_site");
  searchWrapper.appendChild(searchInput);

  const resetBtn = document.createElement("span");
  resetBtn.className = "script-filter-reset";
  resetBtn.dataset.repoId = repo.id;
  resetBtn.setAttribute("data-i18n", "common.reset");
  resetBtn.setAttribute("data-i18n-attr", "title");
  resetBtn.title = i18n.t("common.reset");
  resetBtn.appendChild(createSVG(svg_paths.crossIconPaths));
  searchWrapper.appendChild(resetBtn);

  filterBar.appendChild(searchWrapper);

  // Category Select Container
  const categorySelect = document.createElement("select");
  categorySelect.className = "script-category-select library-input";
  categorySelect.dataset.repoId = repo.id;
  categorySelect.multiple = true;
  filterBar.appendChild(categorySelect);

  // Tom Select init
  const categories = new Set();
  const tags = new Set();
  for (const meta of scripts) {
    if (meta.category) (Array.isArray(meta.category) ? meta.category : [meta.category]).forEach((c) => categories.add(c));
    if (meta.tags) meta.tags.forEach((t) => tags.add(t));
  }

  const tomOptions = [];
  const optgroups = [];

  if (categories.size > 0) {
    optgroups.push({ value: "cat", label: i18n.t("parserFilters.categories") });
    [...categories].sort().forEach((cat) => {
      tomOptions.push({
        value: `cat::${cat}`,
        text: i18n.t(`parserFilters.category.${cat}`) || cat,
        optgroup: "cat",
      });
    });
  }

  if (tags.size > 0) {
    optgroups.push({ value: "tag", label: i18n.t("parserFilters.tags") });
    [...tags].sort().forEach((tag) => {
      tomOptions.push({
        value: `tag::${tag}`,
        text: tag,
        optgroup: "tag",
      });
    });
  }

  const tom = new TomSelect(categorySelect, {
    multiple: true,

    plugins: {
      remove_button: {},
      simplebar: {
        isExtension: true,
      },
    },

    create: false,
    allowEmptyOption: true,
    placeholder: i18n.t("common.all"),
    persist: false,
    closeAfterSelect: false,
    maxOptions: null,
    options: tomOptions,
    optgroups: optgroups,

    onFocus() {
      this.settings.placeholder = "";
      this.inputState();
    },

    onItemAdd() {
      this.settings.placeholder = "";
      this.inputState();
    },

    onItemRemove() {
      if (this.items.length === 0) {
        this.settings.placeholder = i18n.t("common.all");
        this.inputState();
      }
    },

    onBlur() {
      if (this.items.length === 0) {
        this.settings.placeholder = i18n.t("common.all");
        this.inputState();
      }
    },

    onChange: () => {
      applyFiltersInPlace(block, true);
    },
  });

  const chipRow = document.createElement("div");
  chipRow.className = "filter-chip-row";

  const filters = [
    { key: "all", label: i18n.t("library.filter.all") },
    { key: "installed", label: i18n.t("library.filter.installed") },
    { key: "updates", label: i18n.t("library.filter.updates") },
    { key: "new", label: i18n.t("library.filter.new") },
  ];

  for (const f of filters) {
    const chip = document.createElement("button");
    chip.className = "filter-chip no-select" + (f.key === "all" ? " active" : "");
    chip.dataset.filter = f.key;
    chip.dataset.repoId = repo.id;
    chip.textContent = f.label;
    chipRow.appendChild(chip);
  }

  filterBar.appendChild(chipRow);

  chipRow.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    for (const c of chipRow.querySelectorAll(".filter-chip")) c.classList.remove("active");
    chip.classList.add("active");
    applyFiltersInPlace(block, true);
  });

  resetBtn.addEventListener("click", () => {
    const searchEl = block.querySelector(".script-search");
    const categorySelect = block.querySelector(".script-category-select");
    const chipRowEl = block.querySelector(".filter-chip-row");
    if (searchEl) searchEl.value = "";
    categorySelect?.tomselect?.clear();
    chipRowEl?.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    const allChip = chipRowEl?.querySelector(".filter-chip[data-filter='all']");
    if (allChip) allChip.classList.add("active");
    applyFiltersInPlace(block, true);
  });

  inner.appendChild(filterBar);

  if (repo.id === MAIN_REPO_ID) {
    const newInRepo = (repo.scripts ?? []).filter((s) => {
      const sid = s.id ?? generateScriptId(s);
      return state.newScriptIds.has(sid);
    });

    if (state.storeNewScriptNotification && newInRepo.length > 0) {
      const newBanner = document.createElement("div");
      newBanner.className = "repo-banner";

      const text = document.createElement("span");
      text.className = "repo-new-banner-text";
      text.textContent = i18n.t("library.banner.newActivities", [newInRepo.length]);

      const dismissBanner = () => {
        newBanner.remove();
        browser.storage.local.set({ storeNewScriptIds: [] }).catch(() => {});
        state.newScriptIds.clear();
      };

      const showBtn = document.createElement("button");
      showBtn.className = "library-btn btn btn-sm show";
      showBtn.textContent = i18n.t("library.banner.showNew");
      showBtn.addEventListener("click", () => {
        const chip = block.querySelector(".filter-chip[data-filter='new']");
        if (chip) {
          block.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
          applyFiltersInPlace(block, true);
        }
        dismissBanner();
      });

      const dismissBtn = document.createElement("button");
      dismissBtn.className = "library-btn btn btn-sm close";
      dismissBtn.textContent = i18n.t("common.close");
      dismissBtn.addEventListener("click", dismissBanner);

      newBanner.append(text, showBtn, dismissBtn);
      inner.appendChild(newBanner);
    }
  }

  const scriptListEl = document.createElement("div");
  scriptListEl.className = "script-list";
  scriptListEl.dataset.repoId = repo.id;
  if (state.listView) scriptListEl.classList.add("list-view");
  inner.appendChild(scriptListEl);

  body.appendChild(inner);
  block.appendChild(body);

  buildScriptListStructure(block, repo);
};

const buildScriptListStructure = (block, repo) => {
  const listEl = block.querySelector(`.script-list[data-repo-id="${CSS.escape(repo.id)}"]`);
  if (!listEl) return;

  const installedMap = buildInstalledMap();
  const repoCache = new Map();

  listEl.replaceChildren();

  for (const meta of repo.scripts ?? []) {
    const sid = meta.id ?? generateScriptId(meta);
    const row = renderScriptRow(meta, repo.id, installedMap);
    row.style.display = "none";
    listEl.appendChild(row);
    repoCache.set(sid, row);
  }

  scriptRowCache.set(repo.id, repoCache);
  loadFavIcons(listEl.querySelectorAll(".script-favicon"));
  applyFiltersInPlace(block);
};

const renderPagination = (block, repoId, totalVisible, currentPage) => {
  const existing = block.querySelector(".script-pagination");
  existing?.remove();

  const totalPages = Math.ceil(totalVisible / PAGE_SIZE);
  const activeChip = block.querySelector(".filter-chip.active");
  const activeFilter = activeChip?.dataset.filter ?? "all";
  const isFiltered = activeFilter !== "all";

  if (totalPages <= 1 && !isFiltered) return;

  const nav = document.createElement("div");
  nav.className = "script-pagination";
  nav.dataset.repoId = repoId;

  if (isFiltered) {
    const backBtn = document.createElement("button");
    backBtn.className = "pagination-btn pagination-back no-select";
    backBtn.textContent = i18n.t("library.filter.backToAll");
    backBtn.addEventListener("click", () => {
      block.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
      const allChip = block.querySelector(".filter-chip[data-filter='all']");
      if (allChip) allChip.classList.add("active");
      paginationState.set(repoId, 1);
      applyFiltersInPlace(block, true);
    });
    nav.appendChild(backBtn);
  }

  if (totalPages > 1) {
    for (let i = 1; i <= totalPages; i++) {
      const btn = document.createElement("button");
      btn.className = "pagination-btn no-select" + (i === currentPage ? " active" : "");
      btn.textContent = i;
      btn.dataset.page = i;
      btn.addEventListener("click", () => {
        paginationState.set(repoId, i);
        applyFiltersInPlace(block);
      });
      nav.appendChild(btn);
    }
  }

  const inner = block.querySelector(".repo-block-body-inner");
  inner?.appendChild(nav);
};

const refreshDescriptionToggle = (row) => {
  const descEl = row.querySelector(".script-description");
  const toggleBtn = row.querySelector(".script-description-toggle");
  if (!descEl || !toggleBtn) return;

  // Temporarily unclamped to get natural height
  const wasExpanded = descEl.classList.contains("script-description--expanded");
  descEl.classList.remove("script-description--clamped", "script-description--expanded");
  const natural = descEl.scrollHeight;
  if (wasExpanded) descEl.classList.add("script-description--expanded");

  const overflows = natural > descEl.clientHeight || wasExpanded;
  toggleBtn.hidden = !overflows;
  descEl.classList.toggle("script-description--clamped", overflows);
};

const applyFiltersInPlace = (block, resetPage = false) => {
  const listEl = block.querySelector(".script-list");
  const searchEl = block.querySelector(".script-search");
  const categorySelect = block.querySelector(".script-category-select");
  const activeChip = block.querySelector(".filter-chip.active");
  if (!listEl) return;

  const filter = activeChip?.dataset.filter ?? "all";
  const search = searchEl?.value.trim().toLowerCase() ?? "";

  const rawSelections = categorySelect?.tomselect?.getValue() ?? [];
  const selections = Array.isArray(rawSelections) ? rawSelections : rawSelections ? [rawSelections] : [];

  const selectedCats = new Set(selections.filter((v) => v.startsWith("cat::")).map((v) => v.replace("cat::", "")));
  const selectedTags = new Set(selections.filter((v) => v.startsWith("tag::")).map((v) => v.replace("tag::", "")));

  const installedMap = buildInstalledMap();
  const repoId = listEl.dataset.repoId;
  const repo = state.repos.find((r) => r.id === repoId);
  const allScripts = repo?.scripts ?? [];
  const repoCache = scriptRowCache.get(repoId);

  // Filter
  const matching = allScripts.filter((meta) => {
    const sid = meta.id ?? generateScriptId(meta);
    const local = findLocal(installedMap, sid, meta);
    const hasUpdate = local?.version && isNewer(meta.version, local.version);

    const matchFilter = (filter !== "installed" || !!local) && (filter !== "updates" || !!hasUpdate) && (filter !== "new" || state.newScriptIds.has(sid));

    let matchSearch = true;
    if (search) {
      const domain = Array.isArray(meta.domain) ? meta.domain.join(" ") : (meta.domain ?? "");
      const haystack = [meta.title ?? "", domain, meta.description ?? "", (meta.tags ?? []).join(" ")].map((s) => s.toLowerCase());
      matchSearch = haystack.some((s) => s.includes(search));
    }

    const catMode = "any"; // "any" | "all"
    const tagMode = "any"; // "any" | "all"

    const matchCat =
      selectedCats.size === 0 ||
      (meta.category &&
        (() => {
          const cats = Array.isArray(meta.category) ? meta.category : [meta.category];
          return catMode === "all" ? [...selectedCats].every((c) => cats.includes(c)) : cats.some((c) => selectedCats.has(c));
        })());

    const matchTag =
      selectedTags.size === 0 || (meta.tags && (tagMode === "all" ? [...selectedTags].every((t) => meta.tags.includes(t)) : meta.tags.some((t) => selectedTags.has(t))));

    const matchCategory = matchCat && matchTag;

    return matchFilter && matchSearch && matchCategory;
  });

  if (resetPage) paginationState.set(repoId, 1);
  const currentPage = paginationState.get(repoId) ?? 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageSet = new Set(matching.slice(start, end).map((m) => m.id ?? generateScriptId(m)));

  // Display toggling
  if (repoCache) {
    for (const [sid, row] of repoCache) {
      const visible = pageSet.has(sid);
      row.style.display = visible ? "" : "none";
      if (visible) refreshDescriptionToggle(row);
    }
  }

  if (state.listView) listEl.classList.add("list-view");

  // Empty state
  let emptyMsg = listEl.querySelector(".script-list-empty");
  if (matching.length === 0) {
    if (!emptyMsg) {
      emptyMsg = document.createElement("div");
      emptyMsg.className = "script-list-empty";
      emptyMsg.textContent = i18n.t("library.filter.noResults");
      listEl.appendChild(emptyMsg);
    }
  } else {
    emptyMsg?.remove();
  }

  renderPagination(block, repoId, matching.length, currentPage);

  const unloadedFavIcons = listEl.querySelectorAll(".script-row:not([style*='display: none']) .script-favicon:not([src])");
  if (typeof loadFavIcons === "function" && unloadedFavIcons.length > 0) loadFavIcons(unloadedFavIcons);

  const resetBtn = block.querySelector(".script-filter-reset");
  if (resetBtn) {
    const hasSearch = searchEl?.value.trim().length > 0;
    const hasCategory = (categorySelect?.tomselect?.getValue() ?? []).length > 0;
    const activeChip = block.querySelector(".filter-chip.active");
    const hasChip = activeChip && activeChip.dataset.filter !== "all";
    resetBtn.classList.toggle("filter-active", hasSearch || hasCategory || hasChip);
  }
};

// Issue report: browser info + DebugDB logs (GitHub Markdown)
const REPORT_LOG_ENTRY_LIMIT = 200;

const LOG_SOURCE_NOISE_BLOCKLIST = [
  "[background:keepAlive]",
  "[background:setupContextMenus]",
  "[background:scheduleHistoryAdd]",
  "[background:handleListUserScripts]",
  "[background:init]",
  "[GitHubStore]",
  "[mainParser:initParsers]",
  "[main:scheduleNextUpdate]",
];

const isNoiseLine = (text) => LOG_SOURCE_NOISE_BLOCKLIST.some((prefix) => text.includes(prefix));

const readMemoryLogsForReport = async () => {
  try {
    const res = await msg("debug_read_memory_logs");
    return Array.isArray(res?.entries) ? res.entries : [];
  } catch (err) {
    logError("[library:reportIssue]: Failed to read memory logs:", err);
    return [];
  }
};

const mergeAllEntries = (logEntries, activityEntries) => {
  const tagged = [...logEntries.map((e) => ({ ...e, channel: "log" })), ...activityEntries.map((e) => ({ ...e, channel: "activity" }))];
  return tagged.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
};

const readDebugLogsForReport = async (hostname) => {
  try {
    const [logRes, memRes] = await Promise.all([msg("debug_read_logs", { hostname }), msg("debug_read_memory_logs", { hostname })]);
    const logEntries = Array.isArray(logRes?.entries) ? logRes.entries : [];
    const memEntries = Array.isArray(memRes?.entries) ? memRes.entries : [];
    return mergeAllEntries(logEntries, memEntries);
  } catch (err) {
    logError("[library:reportIssue]: Failed to read logs:", err);
    return [];
  }
};

const formatReportLogTimestamp = (ts) => {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const sanitizeReportLogMessage = (message) => {
  let text;
  if (message === null || message === undefined) text = "";
  else if (typeof message === "object") {
    try {
      text = JSON.stringify(message);
    } catch {
      text = String(message);
    }
  } else {
    text = String(message);
  }
  return text.replace(/\s+/g, " ").replace(/`{3,}/g, "'''").trim();
};

const formatReportLogs = (entries, limit = REPORT_LOG_ENTRY_LIMIT) => {
  if (!entries.length) return "_No logs available._";

  const recent = limit > 0 ? [...entries].reverse().slice(0, limit).reverse() : entries;
  const omitted = entries.length - recent.length;
  const lines = recent.map((entry) => {
    const date = formatReportLogTimestamp(entry.ts);
    const level = String(entry.level ?? "info").toUpperCase();
    const source = entry.source ? ` ${entry.source}` : "";
    const count = entry.count > 1 ? ` (x${entry.count})` : "";
    return `${date}  [${level}]${source}: ${sanitizeReportLogMessage(entry.msg)}${count}`;
  });

  if (omitted > 0) lines.unshift(`... showing the ${recent.length} most recent of ${entries.length} entries (${omitted} older omitted) ...`);
  return lines.join("\n");
};

const getReportBrowserInfo = () => {
  const ua = navigator.userAgent || "unknown";
  const platform = navigator.userAgentData?.platform || navigator.platform || "unknown";
  const language = navigator.language || navigator.languages?.[0] || "unknown";

  let name = "Unknown";
  let version = "";

  const browsers = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/Vivaldi\/([\d.]+)/, "Vivaldi"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
  ];

  for (const [pattern, label] of browsers) {
    const match = ua.match(pattern);
    if (match) {
      name = label;
      version = match[1];
      break;
    }
  }

  return {
    browser: version ? `${name} ${version}` : name,
    platform,
    language,
    userAgent: ua,
  };
};

const extractReportHostname = (meta) => {
  if (!meta?.domain) return null;
  const d = Array.isArray(meta.domain) ? meta.domain[0] : meta.domain;
  if (typeof d !== "string") return null;
  try {
    const withoutProtocol = d.replace(/^https?:\/\//, "");
    const hostPart = withoutProtocol.split("/")[0];
    const cleaned = hostPart.replace(/^\*\./, "");
    return cleaned.toLowerCase() || null;
  } catch {
    return null;
  }
};

const getScriptLogTokens = (meta, sid) => {
  const tokens = new Set();
  const add = (value) => {
    if (typeof value !== "string") return;
    const token = value.trim().toLowerCase();
    if (token.length >= 3) tokens.add(token);
  };

  add(meta?.title);
  add(meta?.id);
  add(meta?.name);
  add(sid);

  const domains = Array.isArray(meta?.domain) ? meta.domain : meta?.domain ? [meta.domain] : [];
  for (const domain of domains) {
    const host = String(domain)
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .replace(/^\*\./, "")
      .toLowerCase();
    add(host);
    add(host.replace(/^www\./, ""));
  }

  return [...tokens];
};

const filterReportLogs = (entries, tokens, hostname) => {
  if (!tokens.length && !hostname) return entries;

  return entries.filter((entry) => {
    const text = typeof entry.msg === "string" ? entry.msg : "";
    const level = String(entry.level ?? "info").toLowerCase();

    if (text.includes("[selector:")) return false;

    if (level === "info" && isNoiseLine(text)) return false;

    if (hostname) {
      const entryHostname = String(entry.hostname ?? "").toLowerCase();
      if (!entryHostname) return false;
      if (entryHostname !== hostname && !entryHostname.endsWith("." + hostname)) return false;
    }

    const isDomainLine = text.includes("[isAllowedDomain]:");
    const isRegistrationLine = text.includes("[userScriptWorker]: Registered user script:");
    const isUserScriptLine = text.includes("[mainParser:userScript]");
    if (isDomainLine || isRegistrationLine || isUserScriptLine) {
      const lower = text.toLowerCase();
      return tokens.some((token) => lower.includes(token));
    }

    return true;
  });
};

const filterReportLogsByActiveTab = (entries, parserId) => {
  let refEntry = null;
  for (const entry of entries) {
    const text = typeof entry.msg === "string" ? entry.msg : String(entry.msg ?? "");
    if (!text.includes("New active tab selected")) continue;
    if (entry.parserId != null && entry.parserId !== parserId) continue;
    if (entry.parserId == null && !text.includes(parserId)) continue;
    if (refEntry === null || entry.ts >= refEntry.ts) refEntry = entry;
  }

  if (!refEntry) return entries;

  const refTs = refEntry.ts;
  const selectedTabId = refEntry.tabId != null ? String(refEntry.tabId) : null;

  return entries.filter((entry) => {
    if (entry.ts < refTs) return false;
    const text = typeof entry.msg === "string" ? entry.msg : String(entry.msg ?? "");
    const tabMatch = selectedTabId != null && (String(entry.tabId ?? "") === selectedTabId || text.includes(selectedTabId));
    const parserMatch = (entry.parserId != null && entry.parserId === parserId) || text.includes(parserId);
    return tabMatch || parserMatch;
  });
};

const buildTechnicalDetailsMarkdown = async (meta, sid) => {
  const { browser: browserName, platform, language, userAgent } = getReportBrowserInfo();
  const hostname = extractReportHostname(meta);
  const tokens = getScriptLogTokens(meta, sid);
  let entries = await readDebugLogsForReport(hostname);
  entries = filterReportLogsByActiveTab(entries, sid);
  entries = filterReportLogs(entries, tokens, hostname);
  const fence = "`".repeat(3);
  const logsBlock = entries.length ? [fence, formatReportLogs(entries), fence].join("\n") : "_No logs captured._";

  const details = [
    `<details>`,
    `<summary><strong>Technical Details</strong></summary>`,
    ``,
    `- **Browser:** ${browserName}`,
    `- **Platform:** ${platform}`,
    `- **Language:** ${language}`,
    `- **User Agent:** \`${userAgent}\``,
  ];

  const { webOnlyMode: storedWebOnlyMode } = await browser.storage.local.get("webOnlyMode");
  const webOnlyMode = storedWebOnlyMode ?? false;
  details.push(`- **Extension Mode:** ${webOnlyMode ? "Web" : "Bridge"}`);

  if (!webOnlyMode) {
    const { serverPort: storedPort } = await browser.storage.local.get("serverPort");
    const currentPort = storedPort ?? CONFIG.serverPort;
    const response = await fetchWithTimeout(`http://localhost:${currentPort}/health`, {}, CONFIG.requestTimeout).catch(() => null);
    details.push(`- **Bridge Status:** ${response && response.ok ? "Connected" : "Not Connected"}`);
  }

  details.push(``, `**Recent Logs**`, ``, logsBlock, ``, `</details>`);

  return details.join("\n");
};

const fillIssueBodyInPage = (issueBody) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const findBodyTextarea = () => {
    const components = document.querySelectorAll("[data-component='TextInput']");
    for (const component of components) {
      const textarea = component.querySelector("textarea");
      if (textarea) return textarea;
    }
    const explicit = document.querySelector("textarea[name='issue[body]'], textarea#issue_body, textarea[aria-label*='body' i]");
    if (explicit) return explicit;
    return document.querySelector("textarea");
  };

  const setNativeValue = (element, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    const tracker = element._valueTracker;
    if (tracker?.setValue) tracker.setValue(value);
  };

  const fillOnce = (textarea) => {
    if (!textarea) return false;
    textarea.focus();
    textarea.scrollIntoView({ block: "center" });
    setNativeValue(textarea, issueBody);
    return textarea.value === issueBody;
  };

  return (async () => {
    const deadline = Date.now() + 20000;
    let textarea = null;
    let wroteAtLeastOnce = false;
    let stableStreak = 0;

    while (Date.now() < deadline) {
      const pageLoaded = document.readyState === "complete";

      const found = findBodyTextarea();
      if (found) textarea = found;

      if (textarea) {
        const isEmpty = !textarea.value || textarea.value.trim() === "";

        if (!wroteAtLeastOnce || isEmpty) wroteAtLeastOnce = fillOnce(textarea);
      }

      if (pageLoaded && wroteAtLeastOnce && textarea && textarea.value === issueBody) {
        stableStreak += 1;
        if (stableStreak >= 5) return { ok: true };
      } else {
        stableStreak = 0;
      }

      await sleep(150);
    }

    return { ok: Boolean(textarea && textarea.value === issueBody) };
  })();
};

const fillGitHubIssueBody = async (tabId, issueBody) => {
  if (tabId == null) return false;
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: fillIssueBodyInPage,
      args: [issueBody],
    });
    return Boolean(injection?.result?.ok);
  } catch (_) {
    return false;
  }
};

// build the install/update/remove action buttons for a script row
const buildScriptActionButtons = (actionsEl, row, meta, sid, repoId, local, hasUpdate) => {
  const localId = local?.id ?? sid;
  actionsEl.replaceChildren();

  // Issue report button
  const repo = state.repos.find((r) => r.id === repoId);
  const repoUrl = repo?.url ?? `https://github.com/${repoId.replace(/__/g, "/").replace(/\/[^/]+$/, "")}`;
  const issueTitle = encodeURIComponent(`[Bug Report] ${meta.title ?? sid} ${meta.version ?? ""}`);

  const authors = Array.isArray(meta.authors) ? meta.authors : meta.authors ? [meta.authors] : [];
  const authorMentions = authors.map((a) => `@${a}`).join(", ");
  const manifest = browser.runtime.getManifest();
  const issueParts = [
    `**Script:** [${meta.title ?? sid}](${repoUrl}/blob/main/${meta.file ?? "activities"})`,
    `**Script Version:** ${meta.version ?? "—"}`,
    `**Extension Version:** ${manifest.version ?? "—"}`,
    authorMentions ? `**Author:** ${authorMentions}` : null,
    ``,
    `---`,
    `<!-- Describe the issue below -->`,
    ``,
  ].filter((l) => l !== null);

  const openIssueReport = async () => {
    const technicalDetails = await buildTechnicalDetailsMarkdown(meta, sid);
    const issueBody = [...issueParts, technicalDetails, ``].join("\n");

    // Only the (short) title goes into the URL. Embedding the full body in the
    // `?body=` parameter exceeds GitHub's "URI too long" limit, so the body is
    // injected into the compose textarea after the page fully loads instead.
    const composeUrl = `${repoUrl}/issues/new?title=${issueTitle}`;
    const tab = await browser.tabs.create({ url: composeUrl });
    await fillGitHubIssueBody(tab?.id, issueBody);
  };

  const btnIssue = document.createElement("button");
  btnIssue.className = "script-action-btn report-issue-btn";
  btnIssue.title = i18n.t("library.action.reportIssue");
  btnIssue.appendChild(iconSVG("issueIconPaths", 14));
  btnIssue.addEventListener("click", (e) => {
    e.stopPropagation();
    openIssueReport();
  });
  actionsEl.appendChild(btnIssue);

  if (!local) {
    const btn = makeActionBtn("install", sid, repoId, meta, i18n.t("library.action.install"), "install-btn");
    btn.appendChild(iconSVG("downloadIconPaths", 14));
    actionsEl.appendChild(btn);
  } else if (hasUpdate) {
    const btnUpd = makeActionBtn("update", sid, repoId, meta, i18n.t("library.action.update"), "update-btn");
    btnUpd.appendChild(iconSVG("refreshIconPaths", 14));
    row.classList.add("update-available");
    const updateBadge = document.createElement("span");
    updateBadge.className = "script-category-badge badge badge-sm badge-warning-dark";
    updateBadge.textContent = i18n.t("library.action.update");
    row.querySelector(".script-status-badges").appendChild(updateBadge);
    const btnRem = makeActionBtn("removeScript", localId, repoId, meta, i18n.t("library.action.remove"), "remove-btn");
    btnRem.appendChild(iconSVG("trashIconPaths", 14));
    actionsEl.append(btnUpd, btnRem);
  } else {
    const btnRem = makeActionBtn("removeScript", localId, repoId, meta, i18n.t("library.action.remove"), "remove-btn");
    btnRem.appendChild(iconSVG("trashIconPaths", 14));
    const btnOk = document.createElement("button");
    btnOk.className = "script-action-btn";
    btnOk.title = i18n.t("library.action.upToDate");
    btnOk.disabled = true;
    row.classList.add("installed");
    const installedBadge = document.createElement("span");
    installedBadge.className = "script-category-badge badge badge-sm badge-success-dark";
    installedBadge.textContent = i18n.t("library.filter.installed");
    row.querySelector(".script-status-badges").appendChild(installedBadge);
    btnOk.appendChild(iconSVG("checkIconPaths", 14));
    actionsEl.append(btnRem, btnOk);
  }
};

// Update a script row in place based on the new metadata
const updateScriptRowInPlace = (row, meta, repoId, installedMap) => {
  const sid = meta.id ?? generateScriptId(meta);
  const local = findLocal(installedMap, sid, meta);
  const hasUpdate = local?.version && isNewer(meta.version, local.version);

  row.classList.remove("update-available", "installed");

  const versionEl = row.querySelector(".script-version");
  if (versionEl) {
    versionEl.textContent = `v${meta.version}`;
    versionEl.classList.toggle("outdated", !!hasUpdate);
  }

  row.querySelector(".script-category-badge.badge-success-dark")?.remove();
  row.querySelector(".script-category-badge.badge-warning-dark")?.remove();

  const actionsEl = row.querySelector(".script-actions");
  if (actionsEl) {
    buildScriptActionButtons(actionsEl, row, meta, sid, repoId, local, hasUpdate);
    const headerRight = actionsEl.closest(".script-header-right");
    if (headerRight) {
      headerRight.classList.forEach((c) => {
        if (c.startsWith("count-")) headerRight.classList.remove(c);
      });
      headerRight.classList.add(`count-${actionsEl.children.length}`);
    }
  }
};

const updateRepoBadgeInPlace = (repoId) => {
  const block = document.querySelector(`.repo-block[data-repo-id="${CSS.escape(repoId)}"]`);
  if (!block) return;

  const count = state.pendingUpdates.filter((u) => u.repoId === repoId).length;
  const badges = block.querySelector(".repo-block-badges");
  if (!badges) return;

  let badge = badges.querySelector(".repo-badge.badge-warning-dark");
  if (count > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "repo-badge badge badge-sm badge-bold badge-warning-dark";
      badges.appendChild(badge);
    }
    badge.textContent = `↑ ${count}`;
  } else {
    badge?.remove();
  }
};

const findLocal = (installedMap, sid, meta) => {
  if (installedMap.has(sid)) return installedMap.get(sid);
  for (const [, script] of installedMap) {
    if (script.storeScriptId === sid) return script;
  }
  if (meta.file) {
    for (const [, script] of installedMap) {
      if (script.storeFilePath === meta.file) return script;
    }
  }
  return null;
};

const renderScriptRow = (meta, repoId, installedMap) => {
  const sid = meta.id ?? generateScriptId(meta);
  const local = findLocal(installedMap, sid, meta);
  const hasUpdate = local?.version && isNewer(meta.version, local.version);
  const isInstalled = !!local;
  const domain = Array.isArray(meta.domain) ? meta.domain[0] : (meta.domain ?? "");
  const primaryDomain = (domain || "").replace(/^\*\./, "");

  const row = document.createElement("div");
  row.className = "script-row card card-xs";
  row.dataset.scriptId = sid;

  const topDiv = document.createElement("div");
  topDiv.className = "script-top";

  if (domain) {
    const favIconContainer = document.createElement("div");
    favIconContainer.className = "script-favicon-container spinner";

    const img = document.createElement("img");
    img.className = "script-favicon";
    img.dataset.src = primaryDomain;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("click", () => {
      window.open(meta.homepage || `https://${primaryDomain}`, "_blank", "noopener,noreferrer");
    });
    favIconContainer.appendChild(img);

    const placeholder = document.createElement("div");
    placeholder.className = "script-favicon-placeholder";
    placeholder.style.display = "none";
    placeholder.textContent = (meta.title ?? "?")[0];

    topDiv.append(favIconContainer, placeholder);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "script-favicon-placeholder";
    placeholder.textContent = (meta.title ?? "?")[0];
    topDiv.appendChild(placeholder);
  }

  // Info
  const info = document.createElement("div");
  info.className = "script-info";

  const headerDiv = document.createElement("div");
  headerDiv.className = "script-header";

  const headerRightDiv = document.createElement("div");
  headerRightDiv.className = "script-header-right";

  const nameDiv = document.createElement("div");
  nameDiv.className = "script-name-wrap";

  const nameEl = document.createElement("div");
  nameEl.className = "script-name";
  nameEl.textContent = meta.title ?? domain ?? i18n.t("library.script.unknown");
  nameDiv.appendChild(nameEl);
  headerDiv.appendChild(nameDiv);

  const metaEl = document.createElement("div");
  metaEl.className = "script-meta";

  if (meta.version) {
    if (!hasUpdate) {
      const ver = document.createElement("span");
      ver.className = "script-version";
      ver.textContent = `v${meta.version}`;
      metaEl.appendChild(ver);
    } else if (local?.version) {
      const arrow = document.createElement("span");
      arrow.className = "script-version outdated";
      arrow.textContent = `v${local.version} → v${meta.version}`;
      metaEl.appendChild(arrow);
    }
  }

  headerDiv.appendChild(metaEl);
  nameDiv.appendChild(headerRightDiv);
  topDiv.appendChild(headerDiv);
  row.appendChild(topDiv);

  {
    const catWrap = document.createElement("div");
    catWrap.className = "script-status-badges";
    headerRightDiv.appendChild(catWrap);
  }
  // Author
  if (meta.authors?.length && meta.authors[0]?.trim() !== "") {
    const authorsContainer = document.createElement("div");
    authorsContainer.className = "script-authors";
    authorsContainer.textContent = "by ";

    for (const [i, author] of meta.authors.entries()) {
      const link = meta.authorsLinks?.[i];

      const authorWrap = document.createElement("div");
      authorWrap.className = `script-author-container${link ? "" : " no-link"}`;

      const authorEl = document.createElement("a");
      authorEl.className = "script-author";
      authorEl.textContent = author;

      if (link) {
        authorEl.href = link;
        authorEl.target = "_blank";
        authorEl.rel = "noopener noreferrer";
      } else {
        authorEl.href = "";
        authorEl.style.pointerEvents = "none";
        authorEl.tabIndex = -1;
      }
      authorWrap.appendChild(authorEl);
      authorsContainer.appendChild(authorWrap);
    }
    metaEl.appendChild(authorsContainer);
  }

  // Description
  if (meta.description) {
    const descEl = document.createElement("div");
    descEl.className = "script-description";
    descEl.textContent = meta.description;

    info.appendChild(descEl);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "script-description-toggle";
    toggleBtn.appendChild(iconSVG("chevronRightIconPaths"));
    toggleBtn.hidden = true;
    info.appendChild(toggleBtn);

    toggleBtn.addEventListener("click", () => {
      const expanded = descEl.classList.toggle("script-description--expanded");
      toggleBtn.classList.toggle("script-description-toggle--expanded", expanded);
    });
  }

  row.appendChild(info);

  // Description gap for accordion toggle
  const descGapEl = document.createElement("div");
  descGapEl.className = "script-description-gap";
  row.appendChild(descGapEl);

  // Tags (categories first, then tags)
  const tagsEl = document.createElement("div");
  tagsEl.className = "script-tags";
  for (const c of Array.isArray(meta.category) ? meta.category : meta.category ? [meta.category] : []) {
    const cat = document.createElement("span");
    cat.className = "script-tag script-category-tag badge badge-sm badge-ghost badge-pill badge-normal";
    cat.textContent = i18n.t(`parserFilters.category.${c}`);
    tagsEl.appendChild(cat);
  }
  for (const t of meta.tags ?? []) {
    const tag = document.createElement("span");
    tag.className = "script-tag badge badge-sm badge-ghost badge-pill badge-normal";
    tag.textContent = t;
    tagsEl.appendChild(tag);
  }
  if (tagsEl.children.length) row.appendChild(tagsEl);

  // Action Buttons
  const actionsEl = document.createElement("div");
  actionsEl.className = "script-actions";
  buildScriptActionButtons(actionsEl, row, meta, sid, repoId, local, hasUpdate);

  headerRightDiv.appendChild(actionsEl);
  headerRightDiv.classList.forEach((c) => {
    if (c.startsWith("count-")) headerRightDiv.classList.remove(c);
  });
  headerRightDiv.classList.add(`count-${actionsEl.children.length}`);
  return row;
};

const makeActionBtn = (action, scriptId, repoId, meta, title, extraClass = "") => {
  const btn = document.createElement("button");
  btn.className = `script-action-btn${extraClass ? ` ${extraClass}` : ""}`;
  btn.title = title;
  btn.dataset.action = action;
  btn.dataset.scriptId = scriptId;
  btn.dataset.scriptTitle = meta.title || "";
  btn.dataset.scriptAuthor = meta.authors || "";
  btn.dataset.repoId = repoId;
  return btn;
};

const generateScriptId = (meta) => {
  if (scriptIdCache.has(meta)) return scriptIdCache.get(meta);
  const domain = Array.isArray(meta.domain) ? meta.domain[0] : (meta.domain ?? "");
  const patterns = meta.urlPatterns ?? ["/.*/"];
  const id = generateParserKey(domain, patterns, meta.authors);
  scriptIdCache.set(meta, id);
  return id;
};

const isNewer = (remote, local) => {
  if (!remote || !local || remote === local) return false;
  const toNum = (v) =>
    String(v)
      .replace(/[^0-9.]/g, "")
      .split(".")
      .map(Number);
  const r = toNum(remote);
  const l = toNum(local);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
};

function relativeTime(dateValue) {
  if (dateValue == null || dateValue === "") return "—";

  let past = typeof dateValue === "number" ? dateValue : NaN;

  if (isNaN(past)) {
    const asNum = Number(dateValue);
    if (!isNaN(asNum) && asNum > 0) {
      past = asNum;
    } else {
      const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
      past = isNaN(d.getTime()) ? NaN : d.getTime();
    }
  }

  if (!past || isNaN(past)) return "—";

  const s = Math.floor((Date.now() - past) / 1000);
  if (s < 0 || s < 45) return i18n.t("time.just_now");
  if (s < 90) return i18n.t("time.minute_ago.one", [1]);
  if (s < 3600) return i18n.t("time.minute_ago.other", [Math.floor(s / 60)]);

  const mins = Math.floor(s / 60);
  if (mins < 90) return i18n.t("time.hour_ago.one", [1]);
  if (mins < 1440) return i18n.t("time.hour_ago.other", [Math.floor(mins / 60)]);

  const days = Math.floor(mins / 1440);
  if (days === 1) return i18n.t("time.yesterday");
  if (days < 7) return i18n.t("time.days_ago", [days]);

  const weeks = Math.floor(days / 7);
  if (weeks === 1) return i18n.t("time.week_ago.one", [1]);
  if (weeks < 5) return i18n.t("time.week_ago.other", [weeks]);

  const months = Math.floor(days / 30.4);
  if (months === 1) return i18n.t("time.month_ago.one", [1]);
  if (months < 12) return i18n.t("time.month_ago.other", [months]);

  const years = Math.floor(months / 12);
  if (years === 1) return i18n.t("time.year_ago.one", [1]);
  return i18n.t("time.year_ago.other", [years]);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

const migrateToUserScriptSystem = async () => {
  const { userScript_migrationDone_v1 } = await browser.storage.local.get("userScript_migrationDone_v1");
  if (userScript_migrationDone_v1) return;

  const storage = await browser.storage.local.get(null);
  const repoUserMap = new Map();
  const githubStoreRepos = storage.githubStoreRepos ?? {};
  const targetRepo = githubStoreRepos[MAIN_REPO_ID];

  if (targetRepo && targetRepo.scripts) {
    for (const script of targetRepo.scripts) {
      const domain = Array.isArray(script.domain) ? script.domain[0] : (script.domain ?? "");
      const primaryDomain = domain.replace(/^\*\./, "");

      if (primaryDomain && targetRepo.user) repoUserMap.set(primaryDomain, targetRepo.user);
    }
  }

  const resolvePrefix = (oldKey) => repoUserMap.get(oldKey);

  // parserSettings migration
  const parserSettings = storage.parserSettings ?? {};
  const newParserSettings = {};
  const matchedDomains = new Set();

  for (const [key, value] of Object.entries(parserSettings)) {
    if (!key.startsWith("settings_")) {
      newParserSettings[key] = value;
      continue;
    }

    const withoutPrefix = key.replace(/^settings_/, "");
    if (targetRepo?.user && withoutPrefix.startsWith(`${targetRepo.user}_`)) {
      newParserSettings[key] = value;
      continue;
    }

    const oldKey = withoutPrefix;
    const user = resolvePrefix(oldKey);

    if (user) {
      const newKey = `settings_${user}_${oldKey}`;
      newParserSettings[newKey] = value;

      if (oldKey.includes(".")) {
        matchedDomains.add(oldKey);
      }
    } else {
      newParserSettings[key] = value;
    }
  }

  // parserFilters migration
  const parserFilters = storage.parserFilters ?? [];
  const newParserFilters = parserFilters.map((filter) => ({
    ...filter,
    parsers:
      filter.parsers?.map((parser) => {
        if (parser.startsWith("kanashiiDev_")) return parser;
        if (targetRepo?.user && parser.startsWith(`${targetRepo.user}_`)) return parser;

        const user = resolvePrefix(parser);
        if (!user) return parser;
        return `${user}_${parser}`;
      }) ?? [],
  }));

  // Update Local Storage
  await browser.storage.local.set({
    parserSettings: newParserSettings,
    parserFilters: newParserFilters,
    userScript_migrationDone_v1: true,
  });

  if (matchedDomains.size > 0) {
    await autoInstallMatchedScripts(matchedDomains);
  }
};

const autoInstallMatchedScripts = async (matchedDomains) => {
  try {
    const { ok, list: repos } = await listRepos();
    if (!ok || !repos?.length) return;

    const mainRepo = repos.find((r) => r.id === "KanashiiDev__web-presence-activities__main");
    if (!mainRepo?.scripts?.length) return;

    const installed = await getInstalledScripts();
    const installedIds = new Set(installed.map((s) => s.id ?? s.storeScriptId));

    for (const meta of mainRepo.scripts) {
      const scriptDomain = Array.isArray(meta.domain) ? meta.domain[0] : (meta.domain ?? "");
      const primaryDomain = scriptDomain.replace(/^\*\./, "");

      if (!primaryDomain || !matchedDomains.has(primaryDomain)) continue;

      const scriptId = meta.id ?? generateParserKey(meta.domain, meta.urlPatterns ?? ["/.*/"], meta.authors);
      if (installedIds.has(scriptId)) continue;

      const result = await installScript(mainRepo.id, meta);
      if (result.ok) await handleSaveUserScript(result.scriptObj);
    }
  } catch (err) {
    logError("[Migration] autoInstallMatchedScripts error:", err);
  }
};

window.addEventListener("beforeunload", () => {
  for (const [key, val] of eventCleanup) {
    const elem = val.el ?? (typeof key !== "symbol" ? key : null);
    const type = val.type;
    const handler = val.handler;
    if (elem && typeof elem.removeEventListener === "function") {
      elem.removeEventListener(type, handler);
    }
  }
  eventCleanup.clear();
  domCache.clear();
});
