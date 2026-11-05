// Last.fm scrobbling setup. Toggle + allow list in storage.local; keys managed in the dialog;
// session key flow polls background auth until approved on last.fm.

const LF_KEYS = {
  enabled: "lastFmScrobbleEnabled",
  sources: "lastFmScrobbleSources",
  apiKey: "lastFmApiKey",
  apiSecret: "lastFmApiSecret",
  sessionKey: "lastFmSessionKey",
};

// Matches background auth-poll interval.
const LF_AUTH_POLL_INTERVAL_MS = 2500;

const LastFmState = {
  enabled: false,
  sources: [],
  apiKey: "",
  apiSecret: "",
  sessionKey: "",
  parserList: [],
  searchQuery: "",
  saveTimer: null,
  dragRow: null,
};

// STORAGE
const LastFmStorage = {
  async load() {
    try {
      const stored = await browser.storage.local.get(["parserList", LF_KEYS.enabled, LF_KEYS.sources, LF_KEYS.apiKey, LF_KEYS.apiSecret, LF_KEYS.sessionKey]);
      LastFmState.parserList = Array.isArray(stored.parserList) ? stored.parserList : [];
      LastFmState.enabled = stored[LF_KEYS.enabled] === true;
      LastFmState.sources = Array.isArray(stored[LF_KEYS.sources]) ? stored[LF_KEYS.sources].filter((s) => typeof s === "string") : [];
      // User-entered credentials only; effective key = user value || built-in default,
      // resolved at use site.
      LastFmState.apiKey = typeof stored[LF_KEYS.apiKey] === "string" ? stored[LF_KEYS.apiKey] : "";
      LastFmState.apiSecret = typeof stored[LF_KEYS.apiSecret] === "string" ? stored[LF_KEYS.apiSecret] : "";
      LastFmState.sessionKey = typeof stored[LF_KEYS.sessionKey] === "string" ? stored[LF_KEYS.sessionKey] : "";
    } catch (error) {
      logError("[LastFmStorage:load]: Failed to load Last.fm settings:", error);
      LastFmState.parserList = [];
      LastFmState.enabled = false;
      LastFmState.sources = [];
    }
  },

  // Allowlist debounced; dragging triggers many save rounds.
  save() {
    if (LastFmState.saveTimer) clearTimeout(LastFmState.saveTimer);
    LastFmState.saveTimer = setTimeout(async () => {
      LastFmState.saveTimer = null;
      try {
        await browser.storage.local.set({ [LF_KEYS.sources]: LastFmState.sources.filter((s) => s.trim()) });
      } catch (error) {
        logError("[LastFmStorage:save]: Failed to save Last.fm source allow list:", error);
        showAlert(i18n.t("common.error"), "", "warn");
      }
      activateSimpleBar(["lfSourceList", "lfAllowList"]);
    }, 250);
  },

  async setSources(sources) {
    LastFmState.sources = sources;
    this.save();
  },

  async setEnabled(enabled) {
    try {
      await browser.storage.local.set({ [LF_KEYS.enabled]: enabled === true });
    } catch (error) {
      logError("[LastFmStorage:setEnabled]: Failed to save Last.fm enabled state:", error);
      showAlert(i18n.t("common.error"), "", "warn");
    }
  },

  async saveCredentials() {
    try {
      await browser.storage.local.set({
        [LF_KEYS.apiKey]: LastFmState.apiKey.trim(),
        [LF_KEYS.apiSecret]: LastFmState.apiSecret.trim(),
      });
      LastFmState.apiKey = LastFmState.apiKey.trim();
      LastFmState.apiSecret = LastFmState.apiSecret.trim();
      return true;
    } catch (error) {
      logError("[LastFmStorage:saveCredentials]: Failed to save Last.fm API keys:", error);
      showAlert(i18n.t("common.error"), "", "warn");
      return false;
    }
  },
};

// HELPERS
function dKey(encodedData, salt = "LastFmExtensionKey") {
  try {
    const decoded = atob(encodedData);
    let result = "";
    const sl = salt.length;

    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ salt.charCodeAt(i % sl) ^ ((i * 31) & 0xff));
    }
    return result;
  } catch (e) {
    return "";
  }
}

function lfGetParserLabel(parser) {
  return parser?.title || (Array.isArray(parser?.domain) ? parser?.domain[0] : parser?.domain) || "";
}

function lfGetParserMode(parser) {
  return parser?.mode || "listen";
}

function lfGetParserDomains(parser) {
  const domains = Array.isArray(parser?.domain) ? parser.domain : [parser?.domain];
  return domains.filter((d) => typeof d === "string" && d);
}

function lfGetPrimaryParserDomain(parser) {
  const first = Array.isArray(parser?.domain) ? parser.domain[0] : parser?.domain;
  return (first || "").replace(/^\*\./, "");
}

// Mirrors extension/background/lastfm.js defaults. Shared credentials ship with the app;
// overridable with the user's own account. Update both copies together.
const [LF_D_K1, LF_D_K2] = (() => {
  const _0x = [76, 97, 115, 116, 70, 109, 69, 120, 116, 101, 110, 115, 105, 111, 110, 75, 101, 121];

  const _d = (v) => {
    try {
      const b = atob(v);
      const r = [];

      for (let i = 0; i < b.length; i++) {
        r[i] = String.fromCharCode(b.charCodeAt(i) ^ _0x[i % _0x.length] ^ ((i * 31) & 255));
      }

      return r.join("");
    } catch {
      return "";
    }
  };

  return [_d("fB8pTwuQzJC1Rm4WK83o+/dHBhR8ytiXn0trQT3H+pc="), _d("fksvGwzCm8W7FjwSJJ2/+fBHBkh7x9yWlEYwFT3Jqpo=")];
})();

// STATUS ROW
const LastFmStatus = {
  render() {
    const row = document.getElementById("lfStatusRow");
    if (!row) return;

    const dot = row.querySelector(".lf-status-dot");
    const text = row.querySelector(".lf-status-text");
    if (!dot || !text) return;

    const effectiveKey = LastFmState.apiKey || LF_D_K1;
    const effectiveSecret = LastFmState.apiSecret || LF_D_K2;
    const hasCredentials = !!effectiveKey && !!effectiveSecret;
    if (hasCredentials && LastFmState.sessionKey) {
      dot.classList.add("lf-status-ok");
      text.textContent = i18n.t("settings.lastfm.status.ready");
    } else if (hasCredentials) {
      dot.classList.remove("lf-status-ok");
      text.textContent = i18n.t("settings.lastfm.status.notAuthorized");
    } else {
      dot.classList.remove("lf-status-ok");
      text.textContent = i18n.t("settings.lastfm.status.notConfigured");
    }
  },
};

// SOURCE TRANSFER LIST - drag sites into the allow list. Only listen-mode parsers offered;
// custom entries of removed parsers stay removable.
const LastFmListController = {
  getZones() {
    return {
      source: document.getElementById("lfSourceList"),
      allow: document.getElementById("lfAllowList"),
    };
  },

  renderSearchBar() {
    const searchContainer = document.getElementById("lfSearchContainer");
    if (!searchContainer) return;

    let searchBar = searchContainer.querySelector(".filter-search-bar");
    if (!searchBar) {
      searchBar = document.createElement("div");
      searchBar.className = "filter-search-bar";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "input filter-search-input";
      input.placeholder = i18n.t("settings.lastfm.sourcesSearch");

      const resetBtn = document.createElement("button");
      resetBtn.className = "filter-search-reset";
      resetBtn.title = i18n.t("common.reset");
      resetBtn.style.display = "none";
      resetBtn.appendChild(createSVG(svg_paths.crossIconPaths));

      // Hiding rows is cheap: no rebuild, no debounce
      input.addEventListener("input", (e) => {
        LastFmState.searchQuery = e.target.value;
        resetBtn.style.display = e.target.value ? "" : "none";
        this.applySearch();
      });

      resetBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        input.value = "";
        LastFmState.searchQuery = "";
        resetBtn.style.display = "none";
        this.applySearch();
      });

      searchBar.append(input, resetBtn);
      searchContainer.appendChild(searchBar);
    }
  },

  // Filter without rebuilding; only the source zone is searchable, allow list stays visible.
  applySearch() {
    const zone = document.getElementById("lfSourceList");
    if (!zone) return;

    zone.querySelector(".empty-state")?.remove();

    const query = (LastFmState.searchQuery || "").toLowerCase().trim();
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
      empty.textContent = i18n.t("settings.lastfm.sourcesEmpty");
      zone.appendChild(empty);
    } else if (visibleCount === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = i18n.t("settings.lastfm.noResults");
      zone.appendChild(empty);
    }
    activateSimpleBar(["lfSourceList", "lfAllowList"]);
  },

  // Dropzone hint shows only when the allow list is empty.
  updateEmptyState() {
    const zones = this.getZones();
    if (!zones.allow) return;

    zones.allow.querySelector(".empty-state")?.remove();
    if (zones.allow.querySelectorAll(".priority-item").length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = i18n.t("settings.lastfm.sourcesDropzone");
      zones.allow.appendChild(empty);
    }
  },

  render() {
    const zones = this.getZones();
    if (!zones.source || !zones.allow) return;

    // Allow list zone: saved entries in order.
    const parsersByLabel = new Map();
    for (const parser of LastFmState.parserList) {
      if (parser?.mode && parser?.mode !== "listen") continue;
      const label = lfGetParserLabel(parser);
      if (label && !parsersByLabel.has(label)) parsersByLabel.set(label, parser);
    }

    zones.allow.replaceChildren();
    LastFmState.sources.forEach((name, index) => {
      zones.allow.appendChild(this.createAllowItem(parsersByLabel.get(name) ?? null, name, { member: true, rank: index + 1 }));
    });
    this.updateEmptyState();

    // Source zone: listen-mode parsers not on the allow list.
    zones.source.replaceChildren();
    const allowedNames = new Set(LastFmState.sources);
    for (const parser of LastFmState.parserList) {
      if (parser?.mode && parser?.mode !== "listen") continue;
      const label = lfGetParserLabel(parser);
      if (!label || allowedNames.has(label)) continue;
      zones.source.appendChild(this.createAllowItem(parser, label, { member: false }));
    }

    if (zones.source.querySelectorAll(".priority-item").length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = i18n.t("settings.lastfm.sourcesEmpty");
      zones.source.appendChild(empty);
    }

    loadFavIcons([...zones.source.querySelectorAll(".parser-icon"), ...zones.allow.querySelectorAll(".parser-icon")]);
    this.applySearch();
    activateSimpleBar(["lfSourceList", "lfAllowList"]);
  },

  // Order = allow list zone contents in DOM order. All interactions resolve through this.
  commit() {
    const zones = this.getZones();
    if (!zones.source || !zones.allow) return;

    const memberRows = [...zones.allow.querySelectorAll(".priority-item")];
    LastFmState.sources = memberRows.map((row) => row.dataset.sourceName);

    // Rows may have crossed zones since they were built - resync rank + action button
    memberRows.forEach((row, index) => this.setRowRole(row, true, index + 1));
    for (const row of zones.source.querySelectorAll(".priority-item")) {
      this.setRowRole(row, false);
    }

    this.updateEmptyState();
    this.applySearch();
    LastFmStorage.save();
  },

  // Sets row role: rank chip + remove button for members, add button for source rows.
  // Dragging moves rows between zones; role syncs here and in commit().
  setRowRole(row, member, rank) {
    const currentAction = row.querySelector(".priority-action");
    const wantedRole = member ? "remove" : "add";
    if (currentAction && currentAction.dataset.role === wantedRole) return;
    currentAction?.remove();

    const action = createIconButton(member ? svg_paths.crossIconPaths : svg_paths.plusIconPaths, {
      className: member ? "icon-btn icon-btn-danger priority-action" : "icon-btn priority-action",
      title: i18n.t(member ? "settings.lastfm.remove" : "settings.lastfm.add"),
    });
    action.dataset.role = wantedRole;
    action.addEventListener("click", () => {
      const zones = this.getZones();
      if (LastFmState.dragRow === row) LastFmState.dragRow = null;
      const zone = member ? zones.source : zones.allow;
      if (zone === zones.source) row.style.display = ""; // show it again under an active search filter
      const content = zone.querySelector(".simplebar-content");
      (content ?? zone).appendChild(row);
      this.commit();
    });
    row.appendChild(action);
  },

  createAllowItem(parser, name, { member, rank }) {
    const row = document.createElement("div");
    row.className = "priority-item";
    row.dataset.sourceName = name;
    row.dataset.searchText = `${name} ${parser ? lfGetParserDomains(parser).join(" ") : ""}`.toLowerCase();
    row.draggable = true;

    const grip = document.createElement("span");
    grip.className = "priority-grip";
    grip.appendChild(createSVG(svg_paths.dragIconPaths, { width: 14, height: 14 }));
    row.appendChild(grip);

    if (parser) {
      const iconWrap = document.createElement("div");
      iconWrap.className = "parser-icon-container spinner";

      const icon = document.createElement("img");
      icon.className = "parser-icon hidden-visibility";
      icon.loading = "lazy";
      icon.decoding = "async";
      const primaryDomain = lfGetPrimaryParserDomain(parser);
      icon.dataset.src = primaryDomain;
      icon.addEventListener("click", () => window.open(parser.homepage || `https://${primaryDomain}`, "_blank", "noopener,noreferrer"));
      iconWrap.appendChild(icon);
      row.appendChild(iconWrap);
    } else {
      const iconWrap = document.createElement("div");
      iconWrap.className = "parser-icon-container";

      const icon = document.createElement("img");
      icon.className = "parser-icon";
      icon.src = browser.runtime.getURL("icons/128x128.png");
      iconWrap.appendChild(icon);
      row.appendChild(iconWrap);
    }

    const title = document.createElement("span");
    title.className = "parser-title priority-title";
    title.textContent = name;
    const domainText = parser ? lfGetParserDomains(parser).join(", ") : "";
    title.title = domainText;
    row.appendChild(title);

    this.setRowRole(row, member, rank);
    this.wireDragEvents(row);

    return row;
  },

  // HTML5 drag & drop across zones. Live preview moves the row; commit() saves zone contents.
  wireDragEvents(row) {
    const zones = this.getZones();

    const finishDrag = () => {
      const dragRow = LastFmState.dragRow;
      if (!dragRow) return;
      LastFmState.dragRow = null;
      dragRow.classList.remove("dragging");
      this.commit();
    };

    row.addEventListener("dragstart", (e) => {
      LastFmState.dragRow = row;
      row.classList.add("dragging");
      // A row leaving the allow list zone frees the dropzone hint during the preview
      zones.allow.querySelector(".empty-state")?.remove();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", row.dataset.sourceName);
    });

    row.addEventListener("dragover", (e) => {
      const dragRow = LastFmState.dragRow;
      if (!dragRow || dragRow === row) return;
      e.preventDefault();
      e.stopPropagation();

      const zone = row.parentElement;
      // Reordering inside the source zone is meaningless - allow list members only
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

  // Zone drop targets: gaps and empty areas of both columns are droppable.
  initZoneDropTargets() {
    const zones = this.getZones();
    if (!zones.source || !zones.allow) return;

    for (const zone of [zones.source, zones.allow]) {
      zone.addEventListener("dragover", (e) => {
        const dragRow = LastFmState.dragRow;
        if (!dragRow) return;
        e.preventDefault();

        // Hovering the empty area of the allow list zone appends the row last
        if (zone === zones.allow && dragRow.parentElement !== zones.allow) {
          const content = zones.allow.querySelector(".simplebar-content");
          (content ?? zones.allow).appendChild(dragRow);
        }
      });

      zone.addEventListener("drop", (e) => {
        if (!LastFmState.dragRow) return;
        e.preventDefault();
        const dragRow = LastFmState.dragRow;
        LastFmState.dragRow = null;
        dragRow.classList.remove("dragging");
        this.commit();
      });
    }
  },
};

// SETTINGS DIALOG
let lfAuthPollTimer = null;
let lfAuthWaiting = false;

function lfStopAuthPoll() {
  if (lfAuthPollTimer) {
    clearInterval(lfAuthPollTimer);
    lfAuthPollTimer = null;
  }
  lfAuthWaiting = false;
}

function lfRenderSessionStatus(statusEl, textEl) {
  const authorized = !!LastFmState.sessionKey;
  if (statusEl) statusEl.className = authorized ? "lf-status-dot lf-status-ok" : "lf-status-dot";
  if (textEl) textEl.textContent = i18n.t(authorized ? "settings.lastfm.session.authorized" : "settings.lastfm.session.notAuthorized");
}

function lfCreateLabelledRow(labelKey, control) {
  const row = document.createElement("div");
  row.className = "lf-field-row";
  const label = document.createElement("label");
  label.className = "lf-field-label";
  label.textContent = i18n.t(labelKey);
  row.append(label, control);
  return row;
}

function lfCreateCreateAccountHint() {
  const hint = document.createElement("small");
  hint.className = "lf-hint api-hint";
  const useBuiltin = !!LF_D_K1;
  if (useBuiltin) {
    const text = document.createElement("span");
    text.textContent = i18n.t("settings.lastfm.keysHint.builtin") + " ";
    hint.append(text);
  }
  const link = document.createElement("a");
  link.className = "lf-link";
  link.href = "https://www.last.fm/api/account/create";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = i18n.t("settings.lastfm.keysHint.manage");
  hint.append(link);
  return hint;
}

function openLastFmSettingsDialog() {
  lfStopAuthPoll();

  const body = document.createElement("div");
  body.className = "lf-dialog-body";

  // API credentials
  const apiKeyInput = document.createElement("input");
  apiKeyInput.type = "text";
  apiKeyInput.className = "input";
  apiKeyInput.value = LastFmState.apiKey;
  apiKeyInput.placeholder = i18n.t(LF_D_K1 ? "settings.lastfm.apiBuiltinPlaceholder" : "settings.lastfm.apiKeyPlaceholder");
  apiKeyInput.spellcheck = false;
  apiKeyInput.addEventListener("input", (e) => {
    LastFmState.apiKey = e.target.value;
  });

  const apiSecretInput = document.createElement("input");
  apiSecretInput.type = "text";
  apiSecretInput.className = "input";
  apiSecretInput.value = LastFmState.apiSecret;
  apiSecretInput.placeholder = i18n.t(LF_D_K1 ? "settings.lastfm.apiBuiltinPlaceholder" : "settings.lastfm.apiSecretPlaceholder");
  apiSecretInput.spellcheck = false;
  apiSecretInput.addEventListener("input", (e) => {
    LastFmState.apiSecret = e.target.value;
  });

  const sessionHint = document.createElement("small");
  sessionHint.className = "lf-hint";
  sessionHint.textContent = i18n.t("settings.lastfm.session.hint");

  // Session key status
  const sessionStatusEl = document.createElement("span");
  sessionStatusEl.className = "lf-status-dot";
  const sessionTextEl = document.createElement("span");
  sessionTextEl.className = "lf-status-text";
  lfRenderSessionStatus(sessionStatusEl, sessionTextEl);

  const sessionRow = document.createElement("div");
  sessionRow.className = "lf-session-row";
  sessionRow.append(sessionStatusEl, sessionTextEl);

  const authButton = document.createElement("button");
  authButton.type = "button";
  authButton.className = "btn btn-secondary btn-sm";
  authButton.textContent = i18n.t(LastFmState.sessionKey ? "settings.lastfm.sessionBtnAgain" : "settings.lastfm.sessionBtn");
  sessionRow.append(authButton);

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "btn btn-secondary lf-save-btn";
  saveButton.textContent = i18n.t("settings.lastfm.saveKeys");

  saveButton.addEventListener("click", async () => {
    await LastFmStorage.saveCredentials();
    showAlert(i18n.t("settings.lastfm.keysSaved"), "", "info");
    LastFmStatus.render();
    lfRenderSessionStatus(sessionStatusEl, sessionTextEl);
  });

  // Session key flow: save keys, open approval page, poll until approved on last.fm.
  authButton.addEventListener("click", async () => {
    if (lfAuthWaiting) return;
    const saved = await LastFmStorage.saveCredentials();
    if (!saved) return;
    if (!(LastFmState.apiKey || LF_D_K1) || !(LastFmState.apiSecret || LF_D_K2)) {
      await showAlert(i18n.t("common.error"), i18n.t("settings.lastfm.warn.keysRequired"), "warn");
      return;
    }

    const response = await sendAction("lastfm_authStart");
    if (!response?.ok) {
      await showAlert(i18n.t("settings.lastfm.auth.error"), response?.error ?? "", "warn");
      return;
    }

    LastFmStatus.render();
    sessionTextEl.textContent = i18n.t("settings.lastfm.status.opening");
    lfAuthWaiting = true;

    lfAuthPollTimer = setInterval(async () => {
      if (!modal.isConnected) {
        lfStopAuthPoll();
        sendAction("lastfm_authCancel");
        return;
      }
      try {
        const poll = await sendAction("lastfm_authPoll");
        if (!modal.isConnected) {
          lfStopAuthPoll();
          sendAction("lastfm_authCancel");
          return;
        }
        if (poll.ok) {
          lfStopAuthPoll();
          const stored = await browser.storage.local.get(LF_KEYS.sessionKey);
          LastFmState.sessionKey = stored[LF_KEYS.sessionKey] ?? LastFmState.sessionKey;
          sessionTextEl.textContent = i18n.t("settings.lastfm.session.authorized");
          sessionStatusEl.className = "lf-status-dot lf-status-ok";
          LastFmStatus.render();
          authButton.textContent = i18n.t("settings.lastfm.sessionBtnAgain");
          await showAlert(i18n.t("settings.lastfm.auth.success"), "", "info");
        } else if (poll.pending === true) {
          sessionTextEl.textContent = i18n.t("settings.lastfm.status.waiting");
        } else {
          lfStopAuthPoll();
          authButton.textContent = i18n.t("settings.lastfm.sessionBtn");
          await showAlert(i18n.t("settings.lastfm.auth.error"), poll.error ?? "", "warn");
        }
      } catch (err) {
        lfStopAuthPoll();
        logError("[LastFmDialog]: Session key poll failed:", err);
        await showAlert(i18n.t("settings.lastfm.auth.error"), err?.message ?? "", "warn");
      }
    }, LF_AUTH_POLL_INTERVAL_MS);
  });

  const apiKeyRow = lfCreateLabelledRow("settings.lastfm.apiKeyLabel", apiKeyInput);
  apiKeyRow.classList.add("lf-key-row");
  const apiSecretRow = lfCreateLabelledRow("settings.lastfm.apiSecretLabel", apiSecretInput);
  apiSecretRow.classList.add("lf-key-row");

  const keyInputsInner = document.createElement("div");
  keyInputsInner.className = "lf-key-inputs";
  keyInputsInner.append(apiKeyRow, apiSecretRow);

  const keysWrapper = document.createElement("div");
  keysWrapper.className = "lf-keys-wrapper";
  keysWrapper.append(keyInputsInner, saveButton);

  body.append(lfCreateLabelledRow("settings.lastfm.sessionTitle", sessionRow), sessionHint, keysWrapper, lfCreateCreateAccountHint());

  // Close button beside Save in the footer row; both flex aligned.
  const modal = createContentModal(i18n.t("settings.lastfm.dialogTitle"), body, "lf-dialog", []);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      lfStopAuthPoll();
      sendAction("lastfm_authCancel");
    }
  });
  return modal;
}

// SECTION
async function initLastFm() {
  await LastFmStorage.load();

  const toggleInput = document.getElementById("lfEnabledInput");
  if (toggleInput) {
    toggleInput.checked = LastFmState.enabled;
    toggleInput.addEventListener("change", () => {
      LastFmState.enabled = toggleInput.checked;
      LastFmStorage.setEnabled(LastFmState.enabled);

      if (!LastFmState.sessionKey) {
        const modal = openLastFmSettingsDialog();
        const authButton = modal.querySelector(".lf-session-row .btn");
        if (authButton) {
          authButton.classList.add("highlight-auth-button");
          setTimeout(() => authButton.classList.remove("highlight-auth-button"), 2000);
        }
      }
    });
  }

  LastFmStatus.render();

  const settingsButton = document.getElementById("lfSettingsBtn");
  const settingsIcon = document.getElementById("lfSettingsIcon");
  if (settingsIcon) settingsIcon.appendChild(createSVG(svg_paths.gearIconPaths));
  if (settingsButton) settingsButton.addEventListener("click", openLastFmSettingsDialog);

  LastFmListController.renderSearchBar();
  LastFmListController.initZoneDropTargets();
  LastFmListController.render();

  await activateSimpleBar(["lfSourceList", "lfAllowList"]);
}
