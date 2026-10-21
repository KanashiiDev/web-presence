function _createPanelState() {
  return { entries: [], levelFilter: "all", searchQuery: "", tabIdFilter: "", hostnameFilter: "" };
}

const _debugState = _createPanelState();
const _activityState = _createPanelState();

// Messaging
async function _debugSend(action, extra = {}) {
  return browser.runtime.sendMessage({ action, ...extra });
}

async function _readEntries(action) {
  const res = await _debugSend(action);
  return res?.entries ?? [];
}

async function _clearEntries(action) {
  await _debugSend(action);
}

const _readLogs = () => _readEntries("debug_read_logs");
const _readMemoryLogs = () => _readEntries("debug_read_memory_logs");
const _clearLogs = () => _clearEntries("debug_clear_logs");
const _clearMemoryLogs = () => _clearEntries("debug_clear_memory_logs");

function _fmtTime(ts) {
  const d = new Date(ts);

  return (
    [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-") +
    " " +
    [String(d.getHours()).padStart(2, "0"), String(d.getMinutes()).padStart(2, "0"), String(d.getSeconds()).padStart(2, "0")].join(":")
  );
}

function _makeColGrip(col) {
  const grip = document.createElement("span");
  grip.className = "debug-col-grip";
  grip.dataset.col = col;
  grip.textContent = "";
  return grip;
}

function _buildRow(entry, lineNum) {
  const row = document.createElement("div");
  row.className = `debug-log-row level-${entry.level}`;

  const line = document.createElement("span");
  line.className = "debug-log-line";
  line.textContent = lineNum;

  const time = document.createElement("span");
  time.className = "debug-log-time";
  time.textContent = _fmtTime(entry.ts);

  const level = document.createElement("span");
  level.className = "debug-log-level";
  level.textContent = entry.level;

  const source = document.createElement("span");
  source.className = "debug-log-source";
  source.textContent = entry.source ?? "";

  const meta = document.createElement("span");
  meta.className = "debug-log-meta";
  const metaParts = [];
  if (entry.tabId != null) metaParts.push(`tab:${entry.tabId}`);
  if (entry.hostname != null) metaParts.push(`host:${entry.hostname}`);
  meta.textContent = metaParts.join("  |  ");

  time.appendChild(_makeColGrip("time"));
  level.appendChild(_makeColGrip("level"));
  source.appendChild(_makeColGrip("source"));
  meta.appendChild(_makeColGrip("meta"));

  const msg = document.createElement("span");
  msg.className = "debug-log-msg";

  if (entry.msg !== null && typeof entry.msg === "object") {
    const d = entry.msg;

    const track = document.createElement("span");
    track.className = "activity-track";
    track.textContent = `${d.title ?? "—"} — ${d.artist ?? "—"}`;
    msg.appendChild(track);

    const pills = document.createElement("span");
    pills.className = "activity-pills";

    const pill = (label, value, okWhen) => {
      const isOk = typeof okWhen === "boolean" ? okWhen : value === okWhen;
      const badge = createBadge(`${label}: ${value ?? "—"}`, `activity-pill badge-xs ${isOk ? "badge-success-dark" : "badge-warning-dark"}`);
      pills.appendChild(badge);
    };

    pill("status", d.status, "SONG");
    pill("paused", d.paused, false);
    pill("seeking", d.seeking, false);
    pill("audible", d.audible, true);
    pill("connected", d.connected, true);
    msg.appendChild(pills);

    const timing = document.createElement("span");
    timing.className = "activity-timing";
    const pos = d.position != null && d.duration != null ? `${d.position}s / ${d.duration}s` : d.position != null ? `${d.position}s` : "—";
    timing.textContent = [
      `pos: ${pos}`,
      d.progress != null ? `progress: ${d.progress}%` : null,
      d.positionDiff != null ? `Δpos: ${d.positionDiff}s` : null,
      d.timeSinceUpdate != null ? `Δt: ${d.timeSinceUpdate}s` : null,
    ]
      .filter(Boolean)
      .join("  ·  ");
    msg.appendChild(timing);

    if (d.updateReason || d.shouldUpdate != null) {
      const decision = createBadge(
        d.shouldUpdate ? `▶ ${d.updateReason ?? "update"}` : `⏭ skip${d.updateReason ? ": " + d.updateReason : ""}`,
        `activity-decision ${d.shouldUpdate ? "badge-xs badge-primary" : "badge-xs badge-secondary"}`,
      );
      msg.appendChild(decision);
    }
  } else {
    const countBadge = entry.count > 1 ? ` ×${entry.count}` : "";
    msg.textContent = (entry.msg ?? "") + countBadge;
    if (msg.textContent === "[background:init]: Extension initializing") row.classList.add("init");
  }

  row.append(line, time, level, source, meta, msg);
  return row;
}

const _colMinWidth = { time: 60, level: 24, source: 40, meta: 60 };

async function _initColResize(listId) {
  const list = document.getElementById(listId);
  if (!list || list.dataset.wpColResize === "1") return;
  list.dataset.wpColResize = "1";

  const container = list.closest(".debug-log-container");
  const stored = await browser.storage.local.get("debugLogColWidths");
  const saved = stored.debugLogColWidths;
  if (saved) {
    for (const col of Object.keys(_colMinWidth)) {
      if (saved[col] != null) {
        container.style.setProperty(`--wp-log-col-${col}`, `${saved[col]}px`);
      }
    }
  }

  let active = null;
  let rafId = null;

  const _applyWidth = (col, width, container) => {
    container.style.setProperty(`--wp-log-col-${col}`, `${width}px`);
  };

  const _saveColWidths = debounce(() => {
    const computed = getComputedStyle(container);
    const widths = {};
    for (const col of Object.keys(_colMinWidth)) {
      const raw = computed.getPropertyValue(`--wp-log-col-${col}`).trim();
      if (raw) widths[col] = parseFloat(raw);
    }
    browser.storage.local.set({ debugLogColWidths: widths }).catch(() => {});
  }, 300);

  const begin = (grip) => {
    const col = grip.dataset.col;
    if (!_colMinWidth[col]) return null;
    const container = grip.closest(".debug-log-container");
    const computed = getComputedStyle(container);
    const raw = computed.getPropertyValue(`--wp-log-col-${col}`).trim();
    const startWidth = raw ? parseFloat(raw) : _colMinWidth[col];
    return { col, startX: null, startWidth, container };
  };

  list.addEventListener("mousedown", (e) => {
    const grip = e.target.closest(".debug-col-grip");
    if (!grip) return;
    const state = begin(grip);
    if (!state) return;
    e.preventDefault();
    state.startX = e.clientX;
    active = state;
    grip.classList.add("dragging");
  });

  window.addEventListener("mousemove", (e) => {
    if (!active || active.startX === null) return;
    let width = active.startWidth + (e.clientX - active.startX);
    width = Math.max(_colMinWidth[active.col], width);
    active.pendingWidth = width;
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        _applyWidth(active.col, active.pendingWidth, active.container);
        rafId = null;
      });
    }
  });

  window.addEventListener("mouseup", () => {
    if (!active) return;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
      if (active.pendingWidth != null) _applyWidth(active.col, active.pendingWidth, active.container);
    }
    document.querySelector(".debug-col-grip.dragging")?.classList.remove("dragging");
    active = null;
    _saveColWidths();
  });
}

// Shared filter/stats/render helpers
function _filterEntries(entries, levelFilter, searchQuery, tabIdFilter, hostnameFilter) {
  const q = searchQuery.trim().toLowerCase();
  const tabId = tabIdFilter.trim();
  const hostname = hostnameFilter.trim().toLowerCase();
  return entries.filter((e) => {
    if (levelFilter !== "all" && e.level !== levelFilter) return false;
    if (tabId && String(e.tabId ?? "") !== tabId) return false;
    if (hostname) {
      const entryHostname = String(e.hostname ?? "").toLowerCase();
      if (!entryHostname) return false;
      if (entryHostname !== hostname && !entryHostname.endsWith("." + hostname)) return false;
    }
    if (q) {
      const msgText = e.msg && typeof e.msg === "object" ? `${e.msg.title ?? ""} ${e.msg.artist ?? ""}` : (e.msg ?? "");
      if (![e.source, e.level, msgText].join(" ").toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function _countLevels(entries) {
  return entries.reduce(
    (acc, e) => {
      if (e.level in acc) acc[e.level]++;
      return acc;
    },
    { info: 0, warn: 0, error: 0 },
  );
}

function _renderToList(list, filtered) {
  list.innerHTML = "";

  const maxChars = String(filtered.length).length;
  list.style.setProperty("--line-max-chars", maxChars);

  // Render newest-first
  const fragment = document.createDocumentFragment();
  for (let i = filtered.length - 1; i >= 0; i--) {
    fragment.appendChild(_buildRow(filtered[i], i + 1));
  }
  list.appendChild(fragment);
}

// Panel renderer
const _panelConfigs = {
  logs: {
    state: _debugState,
    elements: { list: "debugLogList", container: "debugLogContainer", empty: "debugEmpty", stats: "debugStats" },
    totalLabel: (entries, filtered) => `${i18n.t("filter.header.entries", { count: entries.length })} `,
    levelLabels: {
      info: () => i18n.t("debug.filter.info"),
      warn: () => i18n.t("debug.filter.warn"),
      error: () => i18n.t("debug.filter.error"),
    },
    afterRender: _buildSummaryAndMinimap,
  },
  activity: {
    state: _activityState,
    elements: { list: "activityLogList", container: "activityLogContainer", empty: "activityEmpty", stats: "activityStats" },
    totalLabel: (entries, filtered) => i18n.t("filter.header.entries", { count: filtered.length }),
    levelLabels: {
      warn: () => "warn",
      error: () => "error",
    },
    alwaysShowList: true,
  },
};

const _renderInFlight = { logs: false };

async function _renderPanel(name) {
  if (_renderInFlight[name]) return;
  if (name in _renderInFlight) _renderInFlight[name] = true;
  try {
    const cfg = _panelConfigs[name];
    const list = document.getElementById(cfg.elements.list);
    const listContainer = document.getElementById(cfg.elements.container);
    const empty = document.getElementById(cfg.elements.empty);
    const stats = document.getElementById(cfg.elements.stats);
    if (!list) return;

    const { entries, levelFilter, searchQuery, tabIdFilter, hostnameFilter } = cfg.state;
    const filtered = _filterEntries(entries, levelFilter, searchQuery, tabIdFilter, hostnameFilter);
    const counts = _countLevels(entries);

    stats.innerHTML = "";

    for (const level of ["info", "warn", "error"]) {
      const labelFn = cfg.levelLabels[level];
      if (!labelFn || !counts[level]) continue;
      const s = document.createElement("span");
      if (level === "warn") s.className = "stat-warn";
      if (level === "error") s.className = "stat-error";
      s.textContent = `${counts[level]} ${labelFn()}`;
      stats.appendChild(s);
    }

    empty.style.display = filtered.length === 0 ? "" : "none";
    if (filtered.length === 0) {
      list.innerHTML = "";
      cfg.afterRender?.([]);
      return;
    }

    _renderToList(list, filtered);
    if (cfg.alwaysShowList) list.style.display = "block";
    await activateSimpleBar(listContainer);
    cfg.afterRender?.(filtered);
  } finally {
    if (name in _renderInFlight) _renderInFlight[name] = false;
  }
}

function _renderLogs() {
  return _renderPanel("logs");
}
function _renderActivity() {
  return _renderPanel("activity");
}

function _buildSummaryAndMinimap(filteredEntries) {
  const minimap = document.getElementById("debugMinimap");
  const errorListContainer = document.getElementById("summaryErrorList");

  if (!errorListContainer || !minimap) return;

  minimap.innerHTML = "";
  errorListContainer.innerHTML = "";

  if (filteredEntries.length === 0) {
    errorListContainer.style.display = "none";
    return;
  }

  errorListContainer.style.display = "block";

  const totalLines = filteredEntries.length;
  const listRows = document.getElementById("debugLogList").children;

  filteredEntries.forEach((entry, index) => {
    let isNoteworthyDot = false;
    let dotClass = "";

    if (entry.level === "error") {
      isNoteworthyDot = true;
      dotClass = "level-error";

      const errLink = document.createElement("div");
      errLink.className = "text-danger";
      errLink.textContent = `[${index + 1}]: ${typeof entry.msg === "object" ? JSON.stringify(entry.msg) : entry.msg}`;
      errLink.addEventListener("click", () => {
        listRows[totalLines - 1 - index]?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      errorListContainer.appendChild(errLink);
    } else if (entry.level === "warn") {
      isNoteworthyDot = true;
      dotClass = "level-warn";
    } else if (entry.msg === "[background:init]: Extension initializing") {
      dotClass = "level-init";
    }

    // Creating a Minimap Point
    if (isNoteworthyDot) {
      const dot = document.createElement("div");
      dot.className = `minimap-dot ${dotClass}`;

      // index / totalLines gives us the proportional vertical percentage.
      // Since our render process is reverse chronological (newest-first), we reverse the vertical placement:
      const topPercent = ((totalLines - 1 - index) / totalLines) * 100;
      dot.style.top = `${topPercent}%`;

      // When clicking on the dot in the minimap, jump directly to that log line
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        const targetRow = listRows[totalLines - 1 - index];
        if (targetRow) targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      minimap.appendChild(dot);
    }
  });
}

// Export
function _mergeAllEntries(logEntries, activityEntries) {
  // Tag each entry with its origin so it's still identifiable after merging,
  // then sort chronologically since the two stores refresh on different intervals.
  const tagged = [...logEntries.map((e) => ({ ...e, channel: "log" })), ...activityEntries.map((e) => ({ ...e, channel: "activity" }))];
  return tagged.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

// ts/id are internal bookkeeping (autoincrement DB key, raw epoch ms) that
// add noise without aiding debugging once entries are already chronologically
// ordered in the array.
function _stripNoise(entry) {
  const { ts, id, ...rest } = entry;
  return rest;
}

async function _exportLogs() {
  // Pull fresh copies of both stores at export time, instead of relying on
  // whatever happens to be cached in _debugState / _activityState already.
  const [logEntries, activityEntries] = await Promise.all([_readLogs(), _readMemoryLogs()]);
  const allEntries = _mergeAllEntries(logEntries, activityEntries);
  const entries = allEntries.map(_stripNoise);

  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: entries.length,
      omittedCount: allEntries.length - entries.length,
      logCount: logEntries.length,
      activityCount: activityEntries.length,
      entries,
    },
    null,
    2,
  );

  let blob, filename;

  if (typeof pako !== "undefined" && typeof uint8ToBase64 === "function") {
    // Compressed export → .gz
    blob = new Blob([pako.gzip(payload)], { type: "application/gzip" });
    filename = `web-presence-debug-${Date.now()}.json.gz`;
  } else {
    // Plain JSON fallback
    blob = new Blob([payload], { type: "application/json" });
    filename = `web-presence-debug-${Date.now()}.json`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showAlert(i18n.t("backup.export.complete"));
}

// Refresh
async function _refreshActivity() {
  if (document.getSelection()?.toString().length > 0) return;

  try {
    const entries = await _readMemoryLogs();

    if (entries.length > DEBUG_MAX_ENTRIES) entries.splice(0, entries.length - DEBUG_MAX_ENTRIES);

    const latest = entries[entries.length - 1];
    const latestTs = latest?.ts ?? 0;

    if (entries.length === _lastActivityCount && latestTs === _lastActivityLatestTs) return;

    _lastActivityCount = entries.length;
    _lastActivityLatestTs = latestTs;
    _activityState.entries = entries;
    await _renderActivity();
  } catch (err) {
    console.error("[debug] activity refresh failed:", err);
  }
}

async function _refreshLogs() {
  if (document.getSelection()?.toString().length > 0) return;
  const entries = await _readLogs();

  if (entries.length > DEBUG_MAX_ENTRIES) entries.splice(0, entries.length - DEBUG_MAX_ENTRIES);

  const latest = entries[entries.length - 1];
  const latestTs = latest?.ts ?? 0;

  if (entries.length === _lastLogCount && latestTs === _lastLogLatestTs) return;

  _lastLogCount = entries.length;
  _lastLogLatestTs = latestTs;
  _debugState.entries = entries;
  _renderLogs();
}

// Auto-refresh
let _debugAutoRefreshTimer = null;
let _activityAutoRefreshTimer = null;
const DEBUG_REFRESH_INTERVAL_MS = 3000;

let _lastLogCount = 0;
let _lastLogLatestTs = 0;
let _lastActivityCount = 0;
let _lastActivityLatestTs = 0;

function _startAutoRefresh() {
  if (!_debugAutoRefreshTimer) {
    _refreshLogs();
    _debugAutoRefreshTimer = setInterval(_refreshLogs, DEBUG_REFRESH_INTERVAL_MS);
  }

  if (!_activityAutoRefreshTimer) {
    _refreshActivity();
    _activityAutoRefreshTimer = setInterval(_refreshActivity, DEBUG_REFRESH_INTERVAL_MS);
  }
}

function _stopAutoRefresh() {
  clearInterval(_debugAutoRefreshTimer);
  _debugAutoRefreshTimer = null;
  clearInterval(_activityAutoRefreshTimer);
  _activityAutoRefreshTimer = null;
}

// UI wiring helpers
function _wireLevelFilterButtons(selector, state, renderFn) {
  const btns = document.querySelectorAll(selector);
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.levelFilter = btn.dataset.level;
      renderFn();
    });
  });
}

function _wireSearchInput(elementId, state, renderFn) {
  document.getElementById(elementId)?.addEventListener(
    "input",
    debounce((e) => {
      state.searchQuery = e.target.value;
      renderFn();
    }, 150),
  );
}

function _wireFilterInput(elementId, state, key, renderFn) {
  document.getElementById(elementId)?.addEventListener(
    "input",
    debounce((e) => {
      state[key] = e.target.value;
      renderFn();
    }, 150),
  );
}

// Init
function initDebug() {
  // Tab switcher
  const tabBtns = document.querySelectorAll(".debug-tab-bar button");
  const panels = document.querySelectorAll(".debug-panel");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      panels.forEach((p) => {
        p.style.display = p.dataset.panel === tab ? "" : "none";
        tab === "logs" ? _renderLogs() : _renderActivity();
      });
    });
  });

  // Level filter buttons
  _wireLevelFilterButtons(".debug-panel[data-panel='activity'] .debug-filters button", _activityState, _renderActivity);
  _wireLevelFilterButtons(".debug-panel[data-panel='logs'] .debug-filters button", _debugState, _renderLogs);

  // Search inputs
  _wireSearchInput("activitySearch", _activityState, _renderActivity);
  _wireSearchInput("debugSearch", _debugState, _renderLogs);

  // Resizable log columns
  _initColResize("debugLogList");
  _initColResize("activityLogList");

  // Metadata filter inputs (logs panel)
  _wireFilterInput("debugTabIdFilter", _debugState, "tabIdFilter", _renderLogs);
  _wireFilterInput("debugHostnameFilter", _debugState, "hostnameFilter", _renderLogs);

  // Metadata filter toggle
  document.getElementById("debugFiltersToggleBtn")?.addEventListener("click", () => {
    const tabIdEl = document.getElementById("debugTabIdFilter");
    const hostnameEl = document.getElementById("debugHostnameFilter");
    const hidden = tabIdEl.style.display === "none";
    tabIdEl.style.display = hidden ? "" : "none";
    hostnameEl.style.display = hidden ? "" : "none";
  });

  // Append icons to toggle and reset buttons
  const toggleBtn = document.getElementById("debugFiltersToggleBtn");
  if (toggleBtn && !toggleBtn.querySelector("svg")) toggleBtn.appendChild(createSVG(svg_paths.filterIconPaths));
  ["debugSearchResetBtn", "debugTabIdResetBtn", "debugHostnameResetBtn", "activitySearchResetBtn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn && !btn.querySelector("svg")) btn.appendChild(createSVG(svg_paths.crossIconPaths));
  });

  // Metadata filter clear (search + tab id + hostname)
  document.getElementById("debugSearchResetBtn")?.addEventListener("click", () => {
    const searchEl = document.getElementById("debugSearch");
    const tabIdEl = document.getElementById("debugTabIdFilter");
    const hostnameEl = document.getElementById("debugHostnameFilter");
    if (searchEl) searchEl.value = "";
    if (tabIdEl) tabIdEl.value = "";
    if (hostnameEl) hostnameEl.value = "";
    _debugState.searchQuery = "";
    _debugState.tabIdFilter = "";
    _debugState.hostnameFilter = "";
    document.getElementById("debugSearchResetBtn")?.classList.remove("filter-active");
    document.getElementById("debugTabIdResetBtn")?.classList.remove("filter-active");
    document.getElementById("debugHostnameResetBtn")?.classList.remove("filter-active");
    _renderLogs();
  });

  // Show/hide search reset button based on input content
  document.getElementById("debugSearch")?.addEventListener("input", () => {
    const resetBtn = document.getElementById("debugSearchResetBtn");
    if (resetBtn) resetBtn.classList.toggle("filter-active", document.getElementById("debugSearch").value.trim().length > 0);
  });

  // Tab ID filter clear
  document.getElementById("debugTabIdResetBtn")?.addEventListener("click", () => {
    const tabIdEl = document.getElementById("debugTabIdFilter");
    if (tabIdEl) tabIdEl.value = "";
    _debugState.tabIdFilter = "";
    document.getElementById("debugTabIdResetBtn")?.classList.remove("filter-active");
    _renderLogs();
  });

  document.getElementById("debugTabIdFilter")?.addEventListener("input", () => {
    const resetBtn = document.getElementById("debugTabIdResetBtn");
    if (resetBtn) resetBtn.classList.toggle("filter-active", document.getElementById("debugTabIdFilter").value.trim().length > 0);
  });

  // Hostname filter clear
  document.getElementById("debugHostnameResetBtn")?.addEventListener("click", () => {
    const hostnameEl = document.getElementById("debugHostnameFilter");
    if (hostnameEl) hostnameEl.value = "";
    _debugState.hostnameFilter = "";
    document.getElementById("debugHostnameResetBtn")?.classList.remove("filter-active");
    _renderLogs();
  });

  document.getElementById("debugHostnameFilter")?.addEventListener("input", () => {
    const resetBtn = document.getElementById("debugHostnameResetBtn");
    if (resetBtn) resetBtn.classList.toggle("filter-active", document.getElementById("debugHostnameFilter").value.trim().length > 0);
  });

  // Activity search clear
  document.getElementById("activitySearchResetBtn")?.addEventListener("click", () => {
    const activitySearchEl = document.getElementById("activitySearch");
    if (activitySearchEl) activitySearchEl.value = "";
    _activityState.searchQuery = "";
    document.getElementById("activitySearchResetBtn")?.classList.remove("filter-active");
    _renderActivity();
  });

  document.getElementById("activitySearch")?.addEventListener("input", () => {
    const resetBtn = document.getElementById("activitySearchResetBtn");
    if (resetBtn) resetBtn.classList.toggle("filter-active", document.getElementById("activitySearch").value.trim().length > 0);
  });

  // Activity clear
  document.getElementById("activityClearBtn")?.addEventListener("click", async () => {
    await _clearMemoryLogs();
    _activityState.entries = [];
    _renderActivity();
  });

  document.getElementById("debugRefreshBtn")?.addEventListener("click", _refreshLogs);
  document.getElementById("debugExportBtn")?.addEventListener("click", _exportLogs);

  // Clear both log stores
  document.getElementById("debugClearBtn")?.addEventListener("click", async () => {
    if (!(await showConfirm("", {}))) return;
    await Promise.all([_clearLogs(), _clearMemoryLogs()]);
    _debugState.entries = [];
    _activityState.entries = [];
    _renderLogs();
  });

  // Auto-refresh tied to section visibility
  const section = document.querySelector('[data-section="debug"]');
  let observer = null;
  if (section) {
    observer = new MutationObserver(() => {
      section.style.display !== "none" ? _startAutoRefresh() : _stopAutoRefresh();
    });
    observer.observe(section, { attributes: true, attributeFilter: ["style"] });

    if (section.style.display !== "none") _startAutoRefresh();
  }

  window.addEventListener("beforeunload", () => {
    _stopAutoRefresh();
    if (observer) observer.disconnect();
    browser.runtime.onMessage.removeListener(_onMemoryLogsUpdated);
  });
}

let _activityRenderDebounce = null;

function _isMergeableDuplicate(prev, next) {
  if (!prev) return false;
  if (typeof prev.msg !== "string" || typeof next.msg !== "string") return false;
  return prev.msg === next.msg && prev.source === next.source && prev.level === next.level;
}

function _onMemoryLogsUpdated(message) {
  if (message.action !== "MEMORY_LOGS_UPDATED" || !message.newEntries) return;

  for (const entry of message.newEntries) {
    const last = _activityState.entries[_activityState.entries.length - 1];
    if (_isMergeableDuplicate(last, entry)) {
      _activityState.entries[_activityState.entries.length - 1] = entry;
    } else {
      _activityState.entries.push(entry);
    }
  }

  if (_activityState.entries.length > 500) _activityState.entries.splice(0, _activityState.entries.length - 500);

  clearTimeout(_activityRenderDebounce);
  _activityRenderDebounce = setTimeout(_renderActivity, 100);
}

browser.runtime.onMessage.addListener(_onMemoryLogsUpdated);
