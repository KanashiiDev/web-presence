// Incremented on every load so a slow older response cannot overwrite a newer selection.
let teLoadSeq = 0;

const TE_STATUS = { UNTRANSLATED: "untranslated", TRANSLATED: "translated", OUTDATED: "outdated", PR_PENDING: "prPending" };
const TE_STATUS_BY_LABEL = { Untranslated: TE_STATUS.UNTRANSLATED, Translated: TE_STATUS.TRANSLATED, Outdated: TE_STATUS.OUTDATED, "PR Pending": TE_STATUS.PR_PENDING };
const teCollator = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator() : null;

const teState = {
  languages: [],
  rows: [],
  filter: "all",
  query: "",
  sort: "asc",
  currentLang: "",
  currentFile: "",
  saveTimer: null,
  saveGeneration: 0,
  saveChain: Promise.resolve(),
  prError: "",
  draftWarning: "",
  freshness: null,
  conflictsExpanded: false,
  dataVersion: 0,
  visibleSignature: "",
  searchTimer: null,
  editingKey: "",
  bannerVersion: -1,
  submitPreviewBusy: false,
};

const teElements = {
  sidebar: document.getElementById("sidebar"),
  languageSelect: document.getElementById("languageSelect"),
  fileSelect: document.getElementById("fileSelect"),
  searchInput: document.getElementById("searchInput"),
  searchResetBtn: document.getElementById("searchInputResetBtn"),
  sortSelect: document.getElementById("sortSelect"),
  filterTabs: document.getElementById("filterTabs"),
  conflictBanner: document.getElementById("conflictBanner"),
  nextUntranslatedBtn: document.getElementById("nextUntranslatedBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  exportDraftsBtn: document.getElementById("exportDraftsBtn"),
  importDraftsBtn: document.getElementById("importDraftsBtn"),
  exportLocaleBtn: document.getElementById("exportLocaleBtn"),
  importLocaleBtn: document.getElementById("importLocaleBtn"),
  downloadSourceBtn: document.getElementById("downloadSourceBtn"),
  importDraftsInput: document.getElementById("importDraftsInput"),
  importLocaleInput: document.getElementById("importLocaleInput"),
  submitBtn: document.getElementById("submitBtn"),
  progressText: document.getElementById("progressText"),
  progressFill: document.getElementById("progressFill"),
  progressOutdated: document.getElementById("progressOutdated"),
  progressPending: document.getElementById("progressPending"),
  documentTitle: document.getElementById("documentTitle"),
  saveStatus: document.getElementById("saveStatus"),
  viewport: document.getElementById("tableViewport"),
  spacer: document.getElementById("tableSpacer"),
  emptyState: document.getElementById("emptyState"),
  viewTabs: document.getElementById("viewTabs"),
  editorView: document.getElementById("editorView"),
  discussionsView: document.getElementById("discussionsView"),
  discCategoryFilter: document.getElementById("discCategoryFilter"),
  discList: document.getElementById("discList"),
  discListContent: document.getElementById("discListContent"),
  discDetail: document.getElementById("discDetail"),
  discDetailContent: document.getElementById("discDetailContent"),
  discPagination: document.getElementById("discPagination"),
  discNewBtn: document.getElementById("discNewBtn"),
  discRefreshBtn: document.getElementById("discRefreshBtn"),
};

function teStatusLabel(status) {
  return i18n.t(`translationEditor.status.${TE_STATUS_BY_LABEL[status] || TE_STATUS.UNTRANSLATED}`);
}

function teSaveStatusLabel(status) {
  if (status === "Saving") return i18n.t("translationEditor.saving");
  if (status === "Save failed") return i18n.t("translationEditor.saveFailed");
  return i18n.t("translationEditor.saved");
}

const TE_QA_NAME_KEYS = {
  "placeholder-integrity": "translationEditor.qa.name.placeholder",
  "special-token-integrity": "translationEditor.qa.name.token",
  "whitespace-integrity": "translationEditor.qa.name.whitespace",
  "double-space": "translationEditor.qa.name.doubleSpace",
  capitalization: "translationEditor.qa.name.capitalization",
  "ending-punctuation": "translationEditor.qa.name.punctuation",
  length: "translationEditor.qa.name.length",
  "source-freshness": "translationEditor.qa.name.freshness",
};

const teQaTooltipState = { openTimer: null, closeTimer: null, badge: null, element: null };

function teQaTooltipElement() {
  if (teQaTooltipState.element) return teQaTooltipState.element;
  const element = document.createElement("div");
  element.className = "qa-tooltip";
  element.id = "qaTooltip";
  element.setAttribute("role", "tooltip");
  element.hidden = true;
  element.addEventListener("mouseenter", teCancelQaTooltipClose);
  element.addEventListener("mouseleave", teScheduleQaTooltipClose);
  document.body.appendChild(element);
  window.addEventListener("scroll", teHideQaTooltip, true);
  window.addEventListener("resize", teHideQaTooltip);
  teQaTooltipState.element = element;
  return element;
}

function teCancelQaTooltipClose() {
  if (teQaTooltipState.closeTimer) {
    clearTimeout(teQaTooltipState.closeTimer);
    teQaTooltipState.closeTimer = null;
  }
}

function teHideQaTooltip() {
  if (teQaTooltipState.openTimer) {
    clearTimeout(teQaTooltipState.openTimer);
    teQaTooltipState.openTimer = null;
  }
  teCancelQaTooltipClose();
  if (teQaTooltipState.element) teQaTooltipState.element.hidden = true;
  teQaTooltipState.badge = null;
}

function teScheduleQaTooltipClose() {
  teCancelQaTooltipClose();
  teQaTooltipState.closeTimer = setTimeout(teHideQaTooltip, 160);
}

function tePositionQaTooltip(badge, element) {
  const rect = badge.getBoundingClientRect();
  const gap = 8;
  const left = Math.max(gap, Math.min(rect.left, window.innerWidth - element.offsetWidth - gap));
  let top = rect.bottom + gap;
  if (top + element.offsetHeight > window.innerHeight - gap) top = Math.max(gap, rect.top - element.offsetHeight - gap);
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}

function teShowQaTooltip(badge, issues) {
  if (!Array.isArray(issues) || !issues.length) return;
  if (teQaTooltipState.openTimer) {
    clearTimeout(teQaTooltipState.openTimer);
    teQaTooltipState.openTimer = null;
  }
  teCancelQaTooltipClose();
  const element = teQaTooltipElement();
  element.replaceChildren();
  issues.forEach((issue) => {
    const item = document.createElement("div");
    item.className = "qa-tooltip-item";
    const icon = document.createElement("span");
    const isError = issue.severity === "error";
    icon.className = `qa-tooltip-icon ${isError ? "qa-error" : "qa-warning"}`;
    icon.appendChild(createSVG(isError ? svg_paths.crossIconPaths : svg_paths.exclamationIconPaths));
    const name = document.createElement("span");
    const nameKey = TE_QA_NAME_KEYS[issue.rule];
    name.textContent = nameKey ? i18n.t(nameKey) : issue.message;
    item.append(icon, name);
    element.appendChild(item);
  });
  element.hidden = false;
  tePositionQaTooltip(badge, element);
  teQaTooltipState.badge = badge;
}

function teScheduleQaTooltipOpen(badge, issues) {
  teCancelQaTooltipClose();
  if (teQaTooltipState.badge === badge && teQaTooltipState.element && !teQaTooltipState.element.hidden) return;
  if (teQaTooltipState.openTimer) clearTimeout(teQaTooltipState.openTimer);
  teQaTooltipState.openTimer = setTimeout(() => {
    teQaTooltipState.openTimer = null;
    teShowQaTooltip(badge, issues);
  }, 120);
}

function teUpdateQaBadge(row, qaColumn) {
  const existing = qaColumn.querySelector(".qa-badge");
  if (existing === teQaTooltipState.badge) teHideQaTooltip();
  existing?.remove();
  const issues = teCollectQaIssues(row.source, row.target, row.key);
  row.qaIssues = issues;
  if (!issues.length) return;

  const hasError = issues.some((issue) => issue.severity === "error");
  const badge = document.createElement("span");
  badge.className = `qa-badge ${hasError ? "qa-error" : "qa-warning"}`;
  badge.textContent = i18n.t("translationEditor.qa.badge");
  badge.tabIndex = 0;
  badge.setAttribute("aria-describedby", "qaTooltip");
  badge.addEventListener("mouseenter", () => teScheduleQaTooltipOpen(badge, issues));
  badge.addEventListener("mouseleave", teScheduleQaTooltipClose);
  badge.addEventListener("focus", () => teShowQaTooltip(badge, issues));
  badge.addEventListener("blur", teScheduleQaTooltipClose);
  badge.addEventListener("keydown", (event) => {
    if (event.key === "Escape") teHideQaTooltip();
  });
  qaColumn.appendChild(badge);
}

const teTable = new TranslationVirtualTable({
  viewport: teElements.viewport,
  spacer: teElements.spacer,
  rowHeight: 42,
  createRow: teCreateRow,
  isPinned: (row) => row.key === teState.editingKey,
});

function teCreateRow(row) {
  const element = document.createElement("div");
  element.className = "table-row";
  element.dataset.status = row.status;
  element.classList.toggle("is-edited", !!row.edited);

  const sourceColumn = document.createElement("div");
  sourceColumn.className = "col-source";

  const source = document.createElement("div");
  source.className = "source-text te-copyable";
  source.textContent = row.source;
  source.title = row.source;
  sourceColumn.appendChild(source);

  const copyFeedback = document.createElement("span");
  copyFeedback.className = "te-copy-feedback";
  copyFeedback.hidden = true;
  sourceColumn.appendChild(copyFeedback);
  let copyFeedbackTimer = null;

  const showCopyFeedback = (ok) => {
    copyFeedback.textContent = i18n.t(ok ? "translationEditor.copySource.success" : "translationEditor.copySource.failed");
    copyFeedback.classList.toggle("is-error", !ok);
    copyFeedback.hidden = false;
    source.classList.toggle("te-copied", ok);
    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = setTimeout(() => {
      copyFeedback.hidden = true;
      source.classList.remove("te-copied");
    }, 1400);
  };

  source.addEventListener("click", async () => {
    // A drag selection must stay selectable instead of being copied away.
    if (window.getSelection()?.toString()) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(row.source);
      } else {
        const helper = document.createElement("textarea");
        helper.value = row.source;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand("copy");
        helper.remove();
        if (!copied) throw new Error("copy rejected");
      }
      showCopyFeedback(true);
    } catch (err) {
      if (typeof logError === "function") logError("[Translation Editor]: copy source failed", err);
      showCopyFeedback(false);
    }
  });

  const keyRow = document.createElement("div");
  keyRow.className = "te-key-row";
  const key = document.createElement("div");
  key.className = "col-key";
  key.textContent = row.key;
  key.title = row.key;
  keyRow.appendChild(key);
  sourceColumn.appendChild(keyRow);
  element.appendChild(sourceColumn);

  const qaColumn = document.createElement("div");
  qaColumn.className = "qa-column";
  teUpdateQaBadge(row, qaColumn);
  element.appendChild(qaColumn);

  function teRefreshRowStatus() {
    element.dataset.status = row.status;
    element.classList.toggle("is-edited", !!row.edited);
    const pill = element.querySelector(".status-pill");
    pill.className = `status-pill status-${row.status.toLowerCase().replace(/\s+/g, "-")}`;
    pill.textContent = teStatusLabel(row.status);
  }

  const targetCell = document.createElement("div");
  targetCell.className = "col-target";

  const target = document.createElement("input");
  target.className = "target-input";
  target.type = "text";
  target.value = row.prPending ? row.prValue : row.target;
  target.title = target.value;
  target.readOnly = !!row.prPending;
  target.addEventListener("focus", () => {
    if (!row.prPending) teState.editingKey = row.key;
  });
  target.addEventListener("input", () => {
    if (row.prPending) return;
    row.target = target.value;
    if (!row.edited) {
      row.draftSourceHash = row.currentSourceHash;
      row.draftBaseTargetHash = row.currentTargetHash;
    }
    row.edited = row.target !== row.originalTarget;
    if (row.edited) {
      row.reconfirmed = false;
      row.localOnly = false;
    }
    row.status = teComputeStatus(row);
    target.title = row.target;
    teRefreshRowStatus();
    teUpdateQaBadge(row, qaColumn);
    teRefreshRestore();
    teUpdateProgress();
    teUpdateFilterCounts();
    element.style.display = teRowMatchesFilter(row, teState.filter, teState.query) ? "" : "none";
    teScheduleSave();
  });
  target.addEventListener("blur", (event) => {
    if (teState.editingKey === row.key) teState.editingKey = "";
    if (event.relatedTarget && element.contains(event.relatedTarget)) return;
    requestAnimationFrame(() => {
      if (document.activeElement?.classList?.contains("target-input")) return;
      teRender();
    });
  });
  targetCell.appendChild(target);

  const restoreBtn = document.createElement("button");
  restoreBtn.type = "button";
  restoreBtn.className = "te-restore-btn";
  restoreBtn.textContent = i18n.t("translationEditor.restore");
  restoreBtn.addEventListener("click", () => {
    if (row.prPending) return;
    teRestoreRowTarget(row);
    target.value = row.target;
    target.title = row.target;
    teRefreshRowStatus();
    teUpdateQaBadge(row, qaColumn);
    teRefreshRestore();
    teUpdateProgress();
    teUpdateFilterCounts();
    teRender();
    teScheduleSave();
    teCommitPendingSave();
  });
  targetCell.appendChild(restoreBtn);

  // Explicit "still correct" acknowledgement for a changed English source.
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "te-restore-btn";
  confirmBtn.textContent = i18n.t("common.apply");
  async function teApplyLocalConfirm(localOnly = false) {
    row.reconfirmed = true;
    row.localOnly = localOnly;
    row.status = teComputeStatus(row);
    teRefreshRowStatus();
    teUpdateQaBadge(row, qaColumn);
    teRefreshRestore();
    teUpdateProgress();
    teUpdateFilterCounts();
    teUpdateConflictBanner();
    teRender();
    try {
      const current = (await teLoadDraft(teState.currentLang, teState.currentFile))?.entries || {};
      await teSaveDraft(teState.currentLang, teState.currentFile, {
        ...current,
        [row.key]: {
          target: row.target,
          sourceHash: row.currentSourceHash,
          baseTargetHash: row.currentTargetHash,
          reconfirmed: true,
          localOnly,
        },
      });
      await teCommitPendingSave();
      await teRefreshSubmitCount();
    } catch (_err) {
      // The in-memory state is already updated; persistence is best effort.
    }
  }

  confirmBtn.addEventListener("click", () => {
    if (row.prPending) return;
    const body = document.createElement("div");
    const question = document.createElement("div");
    question.textContent = i18n.t("translationEditor.confirmModal.question", { key: row.key });
    body.appendChild(question);

    const localBtn = document.createElement("button");
    localBtn.type = "button";
    localBtn.className = "btn";
    localBtn.textContent = i18n.t("translationEditor.confirmModal.localOnly");
    localBtn.addEventListener("click", async () => {
      modal.remove();
      await teApplyLocalConfirm(true);
    });

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "btn btn-primary";
    submitBtn.textContent = i18n.t("translationEditor.confirmModal.submit");
    submitBtn.addEventListener("click", async () => {
      modal.remove();
      await teApplyLocalConfirm(false);
    });

    const modal = createContentModal(i18n.t("translationEditor.confirmModal.title"), body, "", [localBtn, submitBtn]);
  });
  targetCell.appendChild(confirmBtn);

  function teRefreshRestore() {
    const needsConfirm = !row.prPending && !row.edited && !row.reconfirmed && (row.keyStatus === "outdated" || row.keyStatus === "unverified");
    restoreBtn.hidden = !!row.prPending || !teShouldShowRestore(row);
    confirmBtn.hidden = !needsConfirm;
  }
  teRefreshRestore();
  element.appendChild(targetCell);

  const status = document.createElement("div");
  status.className = "col-status";
  const pill = document.createElement("span");
  pill.className = `status-pill status-${row.status.toLowerCase().replace(/\s+/g, "-")}`;
  pill.textContent = teStatusLabel(row.status);
  if (row.prPending) {
    const conflicts = row.prConflicts.map((pr) => `#${pr.number}`).join(", ");
    pill.title = i18n.t("translationEditor.prTitle", { number: row.prNumber, url: row.prUrl });
    if (conflicts) pill.title += ` | ${i18n.t("translationEditor.prConflict", { list: conflicts })}`;
  }
  let statusContent = pill;
  if (row.prPending && row.prUrl) {
    const link = document.createElement("a");
    link.className = "te-pr-link";
    link.href = row.prUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = pill.title;
    link.appendChild(pill);
    statusContent = link;
  }
  status.appendChild(statusContent);
  status.appendChild(teCreateDiscussionButton(row));
  element.appendChild(status);

  return element;
}

function teRowHasQaIssues(row) {
  if (!Array.isArray(row.qaIssues)) row.qaIssues = teCollectQaIssues(row.source, row.target, row.key);
  return row.qaIssues.length > 0;
}

function teRowMatchesFilter(row, filter, query = "") {
  // Keep the row being edited visible even if the edited text no longer
  // matches the active search/filter; it is re-evaluated on blur.
  if (row.key === teState.editingKey) return true;
  if (filter === "untranslated" && row.status !== "Untranslated") return false;
  if (filter === "translated" && row.status !== "Translated") return false;
  if (filter === "outdated" && row.status !== "Outdated") return false;
  if (filter === "pr-pending" && row.status !== "PR Pending") return false;
  if (filter === "qa-issues" && !teRowHasQaIssues(row)) return false;
  if (!query) return true;
  return (
    row.key.toLowerCase().includes(query) ||
    row.source.toLowerCase().includes(query) ||
    row.target.toLowerCase().includes(query) ||
    row.prValue.toLowerCase().includes(query)
  );
}

function teGetVisibleRows() {
  const query = teState.query.toLowerCase();
  const filtered = teState.rows.filter((row) => teRowMatchesFilter(row, teState.filter, query));

  const compare = (a, b) => (teCollator ? teCollator.compare(a.key, b.key) : a.key.localeCompare(b.key));
  filtered.sort(teState.sort === "asc" ? compare : (a, b) => compare(b, a));
  return filtered;
}

function teUpdateProgress() {
  const total = teState.rows.length;
  const counts = { Translated: 0, Outdated: 0, "PR Pending": 0, Untranslated: 0 };
  teState.rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status]++;
    else counts.Untranslated++;
  });
  const percent = total ? Math.round((counts.Translated / total) * 100) : 0;
  const width = (count) => (total ? `${(count / total) * 100}%` : "0%");
  teElements.progressText.textContent = i18n.t("translationEditor.progress", { translated: counts.Translated, total, percent });
  // Every segment uses the same denominator, so the bar and the label agree.
  teElements.progressFill.style.width = width(counts.Translated);
  teElements.progressOutdated.style.width = width(counts.Outdated);
  teElements.progressPending.style.width = width(counts["PR Pending"]);
}

function teUpdateFilterCounts() {
  const counts = { all: teState.rows.length, untranslated: 0, translated: 0, outdated: 0, "pr-pending": 0, "qa-issues": 0 };
  teState.rows.forEach((row) => {
    const statusKey = TE_STATUS_BY_LABEL[row.status];
    if (statusKey) counts[statusKey === TE_STATUS.PR_PENDING ? "pr-pending" : statusKey]++;
    if (teRowHasQaIssues(row)) counts["qa-issues"]++;
  });
  Object.entries(counts).forEach(([filter, count]) => {
    const badge = teElements.filterTabs.querySelector(`[data-filter="${filter}"] .te-count`);
    if (badge) badge.textContent = count;
  });
}

const TE_LAST_LANG_KEY = "translationEditor.lastLang";

async function teSaveLastLang(lang) {
  try {
    await browser.storage.local.set({ [TE_LAST_LANG_KEY]: lang });
  } catch (_err) {
    // Remembering the language is a convenience; never block loading.
  }
}

async function teLoadLastLang() {
  try {
    const stored = await browser.storage.local.get(TE_LAST_LANG_KEY);
    return stored?.[TE_LAST_LANG_KEY] || "";
  } catch (_err) {
    return "";
  }
}

function teSetSaveStatus(status) {
  teElements.saveStatus.textContent = teSaveStatusLabel(status);
  teElements.saveStatus.className = `save-status ${status === "Save failed" ? "failed" : status === "Saving" ? "saving" : ""}`;
}

async function teRefreshSubmitCount() {
  if (!teState.currentLang) return;
  const drafts = await teLoadAllDrafts();
  const prefix = `${teState.currentLang}/`;
  let count = 0;
  for (const [key, draft] of Object.entries(drafts)) {
    if (!key.startsWith(prefix) || draft.status === "submitted" || !draft.entries) continue;
    count += Object.values(draft.entries).filter((entry) => entry && entry.localOnly !== true).length;
  }
  teElements.submitBtn.textContent = count ? `${i18n.t("translationEditor.submit")} | ${count}` : i18n.t("translationEditor.submit");
}

function teBuildDraftEntries() {
  return teBuildDraftEntriesFromRows(teState.rows);
}

function teFlushDraft() {
  // An empty row set means a failed/aborted load. Never overwrite a draft with {}.
  if (!teState.currentLang || !teState.currentFile || !teState.rows.length) return Promise.resolve();
  const { currentLang, currentFile } = teState;
  const entries = teBuildDraftEntries();
  const generation = teState.saveGeneration;
  teSetSaveStatus("Saving");
  teState.saveChain = teState.saveChain
    .then(() => teSaveDraft(currentLang, currentFile, entries))
    .then(async () => {
      if (generation === teState.saveGeneration) teSetSaveStatus("Saved");
      await teRefreshSubmitCount();
    })
    .catch(() => {
      if (generation === teState.saveGeneration) teSetSaveStatus("Save failed");
    });
  return teState.saveChain;
}

function teScheduleSave() {
  teState.saveGeneration++;
  teSetSaveStatus("Saving");
  clearTimeout(teState.saveTimer);
  teState.saveTimer = setTimeout(() => {
    teState.saveTimer = null;
    teFlushDraft();
  }, 250);
}

async function teCommitPendingSave() {
  if (!teState.saveTimer) {
    await teState.saveChain;
    return;
  }
  clearTimeout(teState.saveTimer);
  teState.saveTimer = null;
  await teFlushDraft();
}

function tePendingFreshnessKeys() {
  const freshness = teState.freshness;
  const confirmed = (key) => teState.rows.some((row) => row.key === key && row.reconfirmed);
  return {
    missing: (freshness?.missingKeys || []).filter((key) => !confirmed(key)),
    outdated: (freshness?.outdatedKeys || []).filter((key) => !confirmed(key)),
    unverified: (freshness?.unverifiedKeys || []).filter((key) => !confirmed(key)),
  };
}

function teConflictGroups() {
  const pending = tePendingFreshnessKeys();
  const groups = [];
  if (pending.missing.length)
    groups.push({
      title: i18n.t("translationEditor.validation.missingKey", { key: "" }).replace(/:\s*$/, ""),
      keys: pending.missing,
    });
  if (pending.outdated.length)
    groups.push({
      title: i18n.t("translationEditor.qa.name.freshness"),
      keys: pending.outdated,
    });
  if (pending.unverified.length)
    groups.push({
      title: i18n.t("translationEditor.qa.unverified", { key: "" }).replace(/^:\s*/, ""),
      keys: pending.unverified,
    });
  if (teState.draftWarning) groups.push({ title: teState.draftWarning, keys: [] });
  return groups;
}

function teUpdateConflictBanner() {
  const banner = teElements.conflictBanner;
  const groups = teConflictGroups();
  const hasPrConflicts = teState.rows.some((row) => row.prConflicts.length);
  if (!teState.prError && !groups.length && !hasPrConflicts) {
    banner.style.display = "none";
    return;
  }

  banner.replaceChildren();

  if (teState.prError) {
    const header = document.createElement("div");
    header.className = "te-conflict-header";
    const title = document.createElement("div");
    title.className = "te-conflict-title";
    title.textContent = i18n.t("translationEditor.prError", { error: teState.prError });
    header.appendChild(title);
    banner.appendChild(header);
    banner.classList.remove("collapsed");
    banner.style.display = "";
    return;
  }

  if (!hasPrConflicts && groups.length) {
    const details = document.createElement("div");
    details.className = "te-conflict-details";
    groups.forEach(({ title, keys }) => {
      const group = document.createElement("div");
      group.className = "te-conflict-group";
      const heading = document.createElement("div");
      heading.className = "te-conflict-group-title";
      heading.textContent = title;
      group.appendChild(heading);
      if (keys.length) {
        const keyLine = document.createElement("div");
        keyLine.className = "te-conflict-group-keys";
        keyLine.textContent = keys.slice(0, 8).join(", ") + (keys.length > 8 ? ` +${keys.length - 8}` : "");
        group.appendChild(keyLine);
      }
      details.appendChild(group);
    });
    banner.appendChild(details);
    banner.classList.remove("collapsed");
    banner.style.display = "";
    return;
  }

  const conflicts = teState.rows.filter((row) => row.prConflicts.length);
  if (!conflicts.length) {
    banner.style.display = "none";
    return;
  }

  const header = document.createElement("div");
  header.className = "te-conflict-header";
  const heading = document.createElement("div");
  heading.className = "te-conflict-heading";
  const title = document.createElement("span");
  title.className = "te-conflict-title";
  title.textContent = i18n.t("translationEditor.conflicts.title");
  const summary = document.createElement("span");
  summary.textContent = i18n.t("translationEditor.conflictTitle", { count: conflicts.length });
  heading.append(title, summary);
  const toggle = document.createElement("button");
  toggle.className = "btn btn-sm te-conflict-toggle";
  toggle.textContent = i18n.t(teState.conflictsExpanded ? "translationEditor.conflicts.hide" : "translationEditor.conflicts.show");
  toggle.addEventListener("click", () => {
    teState.conflictsExpanded = !teState.conflictsExpanded;
    banner.classList.toggle("collapsed", !teState.conflictsExpanded);
    toggle.textContent = i18n.t(teState.conflictsExpanded ? "translationEditor.conflicts.hide" : "translationEditor.conflicts.show");
  });
  header.append(heading, toggle);

  const details = document.createElement("div");
  details.className = "te-conflict-details";
  conflicts.slice(0, 20).forEach((row) => {
    const line = document.createElement("div");
    line.textContent = `${row.key}: `;
    row.prConflicts.forEach((pr) => {
      const link = document.createElement("a");
      link.href = pr.html_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `#${pr.number}`;
      line.appendChild(link);
    });
    details.appendChild(line);
  });

  banner.append(header, details);
  banner.classList.toggle("collapsed", !teState.conflictsExpanded);
  banner.style.display = "";
}

function teRender() {
  const visibleRows = teGetVisibleRows();
  if (visibleRows.length) {
    teElements.emptyState.style.display = "none";
  } else {
    teElements.emptyState.textContent = i18n.t("translationEditor.empty");
    teElements.emptyState.style.display = "";
  }
  const signature = `${teState.dataVersion}|${teState.filter}|${teState.sort}|${teState.query}|${visibleRows.length}`;
  if (signature !== teState.visibleSignature) {
    teState.visibleSignature = signature;
    teTable.setRows(visibleRows);
  }
  teUpdateProgress();
  teUpdateFilterCounts();
  if (teState.dataVersion !== teState.bannerVersion) {
    teState.bannerVersion = teState.dataVersion;
    teUpdateConflictBanner();
  }
  activateSimpleBar(teElements.viewport);
}

let teLanguageTom = null;
let teFileTom = null;
let teSortTom = null;
let teDiscCategoryTom = null;

function teSyncDiscCategorySelect(value) {
  if (typeof TomSelect === "undefined" || !teDiscCategoryTom) return;
  teDiscCategoryTom.clearOptions(() => false);
  teDiscCategoryTom.sync();
  teDiscCategoryTom.setValue(value || "", true);
}

function teLanguageOption(entry) {
  const publishedNote = entry.published === false ? ` · ${i18n.t("translationEditor.language.unpublished")}` : "";
  return {
    value: entry.lang,
    text: `${entry.label} (${entry.lang}) · ${entry.progress}%${publishedNote}`,
    label: entry.label,
    lang: entry.lang,
    progress: String(entry.progress),
  };
}

function teLanguageOptionMarkup(data, escape) {
  return (
    '<div class="te-lang-option">' +
    `<span class="te-lang-name">${escape(data.label || data.text)}</span>` +
    `<span class="te-lang-code">${escape(data.lang || data.value)}</span>` +
    `<span class="te-lang-progress">${escape(data.progress || "0")}%</span>` +
    "</div>"
  );
}

function teFillSelects() {
  const select = teElements.languageSelect;
  select.replaceChildren();
  teState.languages.forEach((entry) => {
    const data = teLanguageOption(entry);
    const option = document.createElement("option");
    option.value = data.value;
    option.textContent = data.text;
    option.dataset.label = data.label;
    option.dataset.lang = data.lang;
    option.dataset.progress = data.progress;
    select.appendChild(option);
  });

  if (typeof TomSelect !== "undefined" && !teLanguageTom) {
    teLanguageTom = new TomSelect(select, {
      sortField: false,
      placeholder: i18n.t("translationEditor.language"),
      plugins: { simplebar: { isExtension: true } },
      render: {
        option: teLanguageOptionMarkup,
        item: teLanguageOptionMarkup,
      },
      onItemAdd() {
        this.close();
        this.blur();
      },
    });
  }

  teFillFileSelect();
}

function teSimpleTomConfig() {
  return {
    sortField: false,
    controlInput: null,
    plugins: { simplebar: { isExtension: true } },
  };
}

function teFillFileSelect() {
  const language = teState.languages.find((entry) => entry.lang === teElements.languageSelect.value);
  const select = teElements.fileSelect;
  select.replaceChildren();
  (language?.namespaces || []).forEach((namespace) => {
    const option = document.createElement("option");
    option.value = namespace;
    option.textContent = `${namespace}.json`;
    select.appendChild(option);
  });

  if (typeof TomSelect === "undefined") return;
  if (!teFileTom) {
    teFileTom = new TomSelect(select, teSimpleTomConfig());
    return;
  }
  const selected = select.value;
  teFileTom.clearOptions(() => false);
  teFileTom.sync();
  teFileTom.setValue(selected, true);
}

// Only value-identical renames are recorded by sync-source.js in .source.json.
// Carry the draft over, but recompute both key-dependent hashes for the new key
// so a safe rename is not reported as a source/target change.
async function teRemapDraftRenames(entries, renames, source) {
  if (!entries || !renames || !Object.keys(renames).length) return entries;
  let next = { ...entries };
  for (const [oldKey, newKey] of Object.entries(renames)) {
    if (!(oldKey in next) || newKey in next) continue;
    const entry = { ...next[oldKey] };
    if (source && typeof source[newKey] === "string") {
      entry.sourceHash = await teHashSource(source[newKey], newKey);
      if (typeof entry.target === "string") entry.baseTargetHash = await teHashTarget(entry.target, newKey);
    }
    next = { ...next, [newKey]: entry };
    delete next[oldKey];
  }
  return next;
}

function teApplyDraftToRows(rows, draftEntries) {
  if (!draftEntries) return;
  rows.forEach((row) => {
    const entry = draftEntries[row.key];
    if (!entry || typeof entry.target !== "string") return;
    row.target = entry.target;
    row.edited = true;
    row.draftSourceHash = typeof entry.sourceHash === "string" ? entry.sourceHash : row.currentSourceHash;
    row.draftBaseTargetHash = typeof entry.baseTargetHash === "string" ? entry.baseTargetHash : row.currentTargetHash;
    row.reconfirmed = entry.reconfirmed === true;
    row.localOnly = entry.localOnly === true;
    row.status = teComputeStatus(row);
  });
}

function teResetRowsToOriginal(rows) {
  rows.forEach((row) => {
    row.edited = false;
    row.reconfirmed = false;
    row.localOnly = false;
    row.target = row.originalTarget;
    row.draftSourceHash = row.currentSourceHash;
    row.draftBaseTargetHash = row.currentTargetHash;
    row.status = teComputeStatus(row);
  });
}

async function teLoadCurrentFile(forcePrRefresh = false) {
  const lang = teElements.languageSelect.value;
  const namespace = teElements.fileSelect.value;
  if (!lang || !namespace) return;
  const file = `${namespace}.json`;
  const seq = ++teLoadSeq;
  const isStale = () => seq !== teLoadSeq;

  teElements.emptyState.textContent = i18n.t("translationEditor.loading");
  teElements.emptyState.style.display = "";
  try {
    const isNewLanguage = !!teState.languages.find((entry) => entry.lang === lang)?.pending;
    const loaded = await teLoadGithubRows(lang, namespace, isNewLanguage);
    if (isStale()) return;
    const { rows, source, target, meta, renames, enBlobSha, targetBlobSha } = loaded;

    // A language absent from the locales repo loads with an empty target by
    // design. Freshness would flag every key as missing and unverified, which
    // is not a real conflict for a language that has no file yet.
    let freshness = null;
    if (loaded.targetText !== null) {
      freshness = await teCheckLanguageOpen({
        source,
        target,
        meta: meta?.namespaces?.[namespace],
        ns: namespace,
        enBlobSha,
        targetBlobSha,
      });
    }
    if (isStale()) return;
    teState.freshness = freshness;
    if (freshness) teApplyFreshness(rows, freshness);

    let draft = null;
    let draftLoadFailed = false;
    try {
      draft = await teLoadDraft(lang, file);
    } catch (_err) {
      draftLoadFailed = true;
    }
    if (isStale()) return;
    teState.draftWarning = "";
    if (draft?.entries) {
      draft = { ...draft, entries: await teRemapDraftRenames(draft.entries, renames, source) };
      // Rebase stale hashes onto the source/target files we just loaded, so a
      // draft edited before an English change is not permanently "source-changed".
      const rebased = { ...draft.entries };
      let hashesUpdated = false;
      for (const row of rows) {
        const entry = rebased[row.key];
        if (!entry || typeof entry.target !== "string") continue;
        if (entry.sourceHash !== row.currentSourceHash || entry.baseTargetHash !== row.currentTargetHash) {
          rebased[row.key] = { ...entry, sourceHash: row.currentSourceHash, baseTargetHash: row.currentTargetHash };
          hashesUpdated = true;
        }
      }
      if (hashesUpdated) {
        draft = { ...draft, entries: rebased };
        try {
          await teUpdateDraft(lang, file, { entries: rebased });
        } catch (_err) {
          // UI state stays correct even if persistence fails.
        }
      }
      const comparison = await teCompareDraft({ draft, source, target });
      if (isStale()) return;
      const changedKeys = Object.entries(comparison.keys)
        .filter(([key, info]) => info.status !== "ok" && !draft.entries?.[key]?.reconfirmed)
        .map(([key]) => key);
      if (changedKeys.length) {
        // The conflict banner renders these as grouped keys; no separate
        // draftWarning string is needed here.
        changedKeys.forEach((key) => {
          const row = rows.find((entry) => entry.key === key);
          if (row) row.status = "Outdated";
        });
      }
    }
    let draftEntries = draft?.entries;
    if (draftEntries) {
      const recovery = teRecoverEmptyDrafts(rows, draftEntries);
      if (recovery.recovered.length) {
        draftEntries = recovery.entries;
        draft = { ...draft, entries: draftEntries };
        try {
          await teUpdateDraft(lang, file, { entries: draftEntries });
        } catch (_err) {
          // The recovered UI state stays valid even if the storage write fails.
        }
        if (isStale()) return;
      }
      teApplyDraftToRows(rows, draftEntries);
    }

    let openPrs = [];
    let prLoadFailed = false;
    try {
      openPrs = await teLoadOpenPrs(forcePrRefresh);
      teApplyPrState(rows, lang, namespace, openPrs);
      teState.prError = "";
    } catch (err) {
      prLoadFailed = true;
      teApplyPrState(rows, lang, namespace, []);
      teState.prError = err.message;
    }
    if (isStale()) return;

    if (draft?.status === "submitted") {
      rows.forEach((row) => {
        row.prPending = true;
        row.prUrl = draft.prUrl || "";
        row.prNumber = draft.prNumber || null;
        row.prValue = row.target;
        row.status = "PR Pending";
      });
    }

    if (draft?.status === "submitted" && draft.submissionIds?.length && !prLoadFailed) {
      const results = await teLoadSubmissionResults(draft.submissionIds.map((id) => ({ id, prNumber: draft.prNumber })));
      if (isStale()) return;
      if (results.length) {
        const failed = results.filter((entry) => !["applied", "already-applied"].includes(entry.result.status));
        if (!failed.length) {
          await teClearDraft(lang, file);
          if (isStale()) return;
          teResetRowsToOriginal(rows);
        } else {
          teState.draftWarning = failed.map((entry) => i18n.t("translationEditor.qa.sourceFreshness", { key: entry.result.status })).join(" | ");
          // A failed submission did not refresh the metadata hash, so the
          // per-key confirmation is no longer valid for this source state.
          const entries = (await teLoadDraft(lang, file))?.entries || {};
          for (const entry of Object.values(entries)) {
            delete entry.reconfirmed;
            delete entry.localOnly;
          }
          rows.forEach((row) => {
            row.reconfirmed = false;
            row.localOnly = false;
          });
          await teUpdateDraft(lang, file, { status: "draft", prUrl: "", prNumber: null, submissionIds: [], entries });
          if (isStale()) return;
        }
      } else if (draft.prNumber) {
        // A submission merged before result comments existed (or while the
        // comment was not delivered) has no feedback to read. A merged PR is
        // proof the submission was consumed, so clear the stale draft.
        try {
          const token = await githubContributeService.getToken();
          const pr = await githubContributeService.request(`/repos/${TE_REPO.owner}/${TE_REPO.name}/pulls/${draft.prNumber}`, {}, token);
          if (pr?.merged) {
            await teClearDraft(lang, file);
            if (isStale()) return;
            teResetRowsToOriginal(rows);
          }
        } catch (_err) {
          // Keep the draft when PR state cannot be verified.
        }
      }
    }

    // One synchronous state transition: the old table never gets paired with
    // the new file key, so a keystroke cannot write into the wrong draft.
    teState.currentLang = lang;
    teState.currentFile = file;
    teState.rows = rows;
    await teSaveLastLang(lang);
    teState.editingKey = "";
    teState.dataVersion++;
    teElements.documentTitle.textContent = `${teState.languages.find((entry) => entry.lang === lang)?.label || lang} / ${namespace}.json`;
    teElements.viewport.scrollTop = 0;
    teSetSaveStatus(draftLoadFailed ? "Save failed" : "Saved");
    await teRefreshSubmitCount();
    teRender();
  } catch (err) {
    if (isStale()) return;
    teState.currentLang = "";
    teState.currentFile = "";
    teState.rows = [];
    teState.editingKey = "";
    teState.prError = "";
    teState.draftWarning = "";
    teState.freshness = null;
    teState.dataVersion++;
    teSetSaveStatus("Save failed");
    teRender();
    teElements.emptyState.textContent = i18n.t("translationEditor.loadError", { error: err.message });
    teElements.emptyState.style.display = "";
  }
}

function teGoToNextUntranslated() {
  const visibleRows = teGetVisibleRows();
  const current = Math.floor(teElements.viewport.scrollTop / teTable.rowHeight);
  let next = visibleRows.findIndex((row, index) => index > current && row.status === "Untranslated");
  if (next < 0) next = visibleRows.findIndex((row) => row.status === "Untranslated");
  teTable.scrollToRow(next);
}

async function teActivateStatusScroll(root) {
  const sections = Array.from(root?.querySelectorAll?.(".contribute-status") || []);
  if (sections.length) await activateSimpleBar(sections);
}

function teListSection(items, title, variant = "") {
  const section = document.createElement("div");
  if (variant) section.className = `contribute-status ${variant}`;
  const heading = document.createElement("div");
  heading.textContent = title;
  section.appendChild(heading);
  const list = document.createElement("ul");
  items.slice(0, 30).forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    list.appendChild(item);
  });
  section.appendChild(list);
  return section;
}

function teIssueSection(issues, title, variant) {
  const section = document.createElement("div");
  section.className = `contribute-status ${variant}`;
  const heading = document.createElement("div");
  heading.textContent = title;
  section.appendChild(heading);

  const groups = new Map();
  issues.forEach((issue) => {
    const groupKey = issue.key || "";
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(issue);
  });

  groups.forEach((groupIssues, groupKey) => {
    const group = document.createElement("div");
    group.className = "te-qa-group";
    if (groupKey) {
      const label = document.createElement("div");
      label.className = "te-qa-group-key";
      label.textContent = groupKey;
      label.title = groupKey;
      group.appendChild(label);
    }
    groupIssues.slice(0, 20).forEach((issue) => {
      teQaIssueLabel(issue, true).forEach((text) => {
        const line = document.createElement("div");
        line.className = "te-qa-line";
        line.textContent = text;
        group.appendChild(line);
      });
    });
    section.appendChild(group);
  });
  return section;
}

function teSubmitFileRow(file) {
  const row = document.createElement("div");
  row.className = "te-submit-file";

  const line = document.createElement("div");
  line.className = "te-submit-file-row";

  const path = document.createElement("span");
  path.className = "te-submit-path";
  path.textContent = file.namespace ? file.path : i18n.t("translationEditor.submitModal.metadata");
  path.title = file.path;
  line.appendChild(path);

  const count = document.createElement("span");
  count.className = "badge badge-sm";
  count.textContent = file.namespace ? String(file.keys.length) : file.keys.join(", ");
  line.appendChild(count);

  const toggle = document.createElement("button");
  toggle.className = "btn btn-sm te-submit-toggle";
  toggle.textContent = i18n.t("translationEditor.submitModal.showKeys");
  line.appendChild(toggle);
  row.appendChild(line);

  const keys = document.createElement("div");
  keys.className = "te-submit-keys";
  keys.hidden = true;
  if (file.keys.length) {
    file.keys.forEach((key) => {
      const chip = document.createElement("span");
      chip.className = "te-submit-key";
      chip.textContent = key;
      chip.title = key;
      keys.appendChild(chip);
    });
  } else {
    const empty = document.createElement("span");
    empty.className = "te-submit-key";
    empty.textContent = i18n.t("translationEditor.submitModal.noKeys");
    keys.appendChild(empty);
  }
  toggle.addEventListener("click", () => {
    keys.hidden = !keys.hidden;
    toggle.textContent = i18n.t(keys.hidden ? "translationEditor.submitModal.showKeys" : "translationEditor.submitModal.hideKeys");
    if (!keys.hidden) void activateSimpleBar(keys);
  });

  row.appendChild(keys);
  return row;
}

function teShowSubmitModal({ lang, files, blocked = [], errors, warnings, issues = [] }) {
  const body = document.createElement("div");
  const keyCount = files.reduce((count, file) => count + file.keys.length, 0);

  const header = document.createElement("div");
  header.className = "te-submit-header";
  const summary = document.createElement("span");
  summary.className = "te-submit-count";
  summary.textContent = i18n.t("translationEditor.submitModal.summary", { lang, files: files.length, keys: keyCount });
  header.appendChild(summary);
  body.appendChild(header);

  if (blocked.length) {
    body.appendChild(
      teListSection(
        blocked.map((entry) => `${entry.namespace}:${entry.key} — ${entry.reason}`),
        i18n.t("translationEditor.submitModal.partialSummary", { passing: keyCount, blocked: blocked.length }),
        "warning",
      ),
    );
  }

  const fileList = document.createElement("div");
  fileList.className = "te-submit-files";
  files.forEach((file) => fileList.appendChild(teSubmitFileRow(file)));
  body.appendChild(fileList);

  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  if (warningIssues.length) {
    body.appendChild(teIssueSection(warningIssues, i18n.t("translationEditor.submitModal.warnings", { count: warnings.length }), "warning"));
  } else if (warnings.length) {
    body.appendChild(teListSection(warnings, i18n.t("translationEditor.submitModal.warnings", { count: warnings.length }), "warning"));
  }
  if (errorIssues.length) {
    body.appendChild(teIssueSection(errorIssues, i18n.t("translationEditor.submitModal.errors", { count: errors.length }), "error"));
  } else if (errors.length) {
    body.appendChild(teListSection(errors, i18n.t("translationEditor.submitModal.errors", { count: errors.length }), "error"));
  }

  const status = document.createElement("div");
  status.className = "submit-status";
  body.appendChild(status);

  const confirm = document.createElement("button");
  confirm.className = "btn btn-primary";
  confirm.textContent = blocked.length ? i18n.t("translationEditor.submitModal.confirmPassing") : i18n.t("translationEditor.submitModal.confirm");
  confirm.disabled = errors.length > 0 || !files.length;
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    const token = await githubContributeService.getToken();
    if (!token) {
      status.textContent = i18n.t("translationEditor.submitModal.connectHeader");
      confirm.disabled = false;
      return;
    }
    // A branch can carry submissions for several languages; keep the PR
    // metadata language-neutral so it never misrepresents the PR contents.
    const languages = [...new Set(files.map((file) => file.lang).filter(Boolean))];
    const prTitle = "locale(submissions)";
    const prBody = [
      "## Translation submissions",
      "",
      `Languages: ${languages.join(", ")}`,
      `Files: ${files.map((file) => `\`${file.path}\``).join(", ")}`,
      `Keys: ${keyCount}`,
      "",
      `*Submitted via Web Presence v${browser.runtime.getManifest().version}*`,
    ].join("\n");
    // While the PR is being created and processed, neither the close button
    // nor an outside click may dismiss the modal and abort the flow.
    modal.dataset.locked = "1";
    try {
      const result = await teSubmitSubmissions({
        submissions: files,
        title: prTitle,
        body: prBody,
        token,
        onStatus: (value) => {
          const key = `translationEditor.stage.${value}`;
          status.textContent = i18n.t(key) === key ? value : i18n.t(key);
        },
      });
      for (const file of files) {
        await teUpdateDraft(lang, `${file.namespace}.json`, {
          status: "submitted",
          prUrl: result.prUrl,
          prNumber: result.prNumber,
          submissionIds: [file.id],
        });
      }

      // Keep the modal open until the worker publishes a result. The PR merge
      // and processor run asynchronously, so poll the immutable result file.
      const ids = files.map((file) => ({ id: file.id, prNumber: result.prNumber }));
      const deadline = Date.now() + 2 * 60 * 1000;
      const finalResults = [];
      teElements.submitBtn.disabled = true;
      status.textContent = i18n.t("translationEditor.submitModal.waitingForResult");
      while (Date.now() < deadline && modal.isConnected) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        if (!modal.isConnected) break;
        const results = await teLoadSubmissionResults(ids);
        if (results.length) {
          finalResults.push(...results);
          break;
        }
      }
      teElements.submitBtn.disabled = false;
      if (!modal.isConnected) return;
      modal.remove();
      await teLoadCurrentFile(true);

      if (!finalResults.length) {
        await showAlert(i18n.t("translationEditor.submitModal.processing", { url: result.prUrl }));
        return;
      }
      const failed = finalResults.filter((entry) => !["applied", "already-applied"].includes(entry.result.status));
      if (failed.length) {
        // The PR comment is the authoritative feedback channel; show it
        // directly so the contributor sees the skipped keys and their reasons.
        const detail = failed.map((entry) => `${entry.id}: ${entry.result.detail || entry.result.status}`).join("\n\n");
        await showAlert(i18n.t("translationEditor.submitModal.failed", { error: failed.map((entry) => entry.result.status).join(", ") }), detail, "warn");
        return;
      }
      const statusLabel = i18n.t(result.updated ? "translationEditor.submitModal.updated" : "translationEditor.submitModal.created");
      await showAlert(i18n.t("translationEditor.submitModal.success", { status: statusLabel, url: result.prUrl }));
    } catch (err) {
      status.textContent = i18n.t("translationEditor.submitModal.failed", { error: err.message });
      delete modal.dataset.locked;
      confirm.disabled = false;
      teElements.submitBtn.disabled = false;
    }
  });

  const modal = createContentModal(i18n.t("translationEditor.submitModal.title"), body, "", [confirm]);
  void teActivateStatusScroll(body);
}

async function teBuildPreviewChanges({ draftEntries, sourceFlat, targetFlat, pendingKeys, lang, namespace, warnings, skipMissing = false, isNewTarget = false }) {
  const filtered = Object.entries(draftEntries || {}).filter(([key, entry]) => {
    if (typeof entry.target !== "string" || !Object.prototype.hasOwnProperty.call(sourceFlat, key)) return false;
    if (skipMissing || entry.target !== targetFlat[key]) return true;
    // Only an explicit per-key acknowledgement re-sends an unchanged value.
    return entry.reconfirmed === true && entry.localOnly !== true;
  });
  // Rebase hashes against the files actually loaded for this preview. A draft
  // captured against an older English source must not block submission: the
  // editor recomputes them on every submit, and per-key QA still rejects real
  // breakage (for example a missing placeholder).
  // Validate against the target we are ABOUT to write, not the stale file we
  // loaded. Otherwise every submitted key looks "missing" for a new language
  // whose target file does not exist yet.
  const effectiveTarget = { ...targetFlat };
  for (const [key, entry] of filtered) effectiveTarget[key] = entry.target;
  const changes = await Promise.all(
    filtered.map(async ([key, entry]) => {
      const currentSourceHash = await teHashSource(sourceFlat[key], key);
      // A new language has no target file yet, and the submission processor
      // seeds its target from the English source. Hash that same value so the
      // three-way patch sees the real base instead of an empty string.
      const baseTargetValue = isNewTarget ? sourceFlat[key] : (targetFlat[key] ?? "");
      const baseTargetHash = await teHashTarget(baseTargetValue, key);
      const reconfirm = entry.reconfirmed === true;
      return {
        key,
        source: sourceFlat[key],
        target: entry.target,
        sourceHash: currentSourceHash,
        baseTargetHash,
        currentSourceHash,
        reconfirm,
      };
    }),
  );

  changes.forEach(({ key }) => {
    if (pendingKeys?.get(`${lang}/${namespace}`)?.has(key)) warnings.push(i18n.t("translationEditor.submitModal.pendingConflict", { key }));
    // Reconfirmed keys are intentionally not warned about here: the user has
    // already reviewed the new English source and confirmed the value.
  });
  const validation = teValidateChanges(sourceFlat, effectiveTarget, changes, {
    skipMissing,
    keyScope: changes.map((change) => change.key),
  });
  const errorCodes = new Map();
  for (const issue of validation.issues || []) {
    if (issue.severity !== "error") continue;
    const codes = errorCodes.get(issue.key) || [];
    if (!codes.includes(issue.rule)) codes.push(issue.rule);
    errorCodes.set(issue.key, codes);
  }
  const blocked = [];
  const passing = changes.filter((change) => {
    const codes = errorCodes.get(change.key) || [];
    if (codes.length) {
      blocked.push({ key: change.key, reason: codes.join(", ") });
      return false;
    }
    return true;
  });
  return { changes: passing, blocked, validation };
}

async function teOpenSubmitPreview() {
  if (teState.submitPreviewBusy) return;
  teState.submitPreviewBusy = true;
  teElements.submitBtn.disabled = true;
  const submitLabel = teElements.submitBtn.textContent;
  teElements.submitBtn.textContent = i18n.t("translationEditor.submitModal.checking");
  try {
    await teCommitPendingSave();
    const lang = teNormalizeLang(teState.currentLang || teElements.languageSelect.value);
    const languageEntry = teState.languages.find((entry) => entry.lang === lang);
    if (teSubmissionIsBlocked(languageEntry)) {
      await showAlert(i18n.t("translationEditor.submitModal.notPublished"));
      return;
    }
    const drafts = await teLoadAllDrafts();
    const prefix = `${lang}/`;
    const pendingDrafts = Object.entries(drafts).filter(
      ([key, draft]) => key.startsWith(prefix) && draft.status !== "submitted" && draft.entries && Object.keys(draft.entries).length,
    );
    if (!pendingDrafts.length) {
      await showAlert(i18n.t("translationEditor.submitModal.noLanguageChanges"));
      return;
    }

    const submissions = [];
    const blockedKeys = [];
    const errors = [];
    const warnings = [];
    const issues = [];
    try {
      const manifest = await teFetchManifest();
      const renames = await teFetchSourceMetaAtSnapshot(manifest)
        .then((sourceMeta) => teNamespaceRenames(sourceMeta, namespace) || {})
        .catch(() => ({}));
      const openPrs = await teLoadOpenPrs(true);
      // Scope pending keys by language/namespace: the same key in another
      // language's PR is not a conflict for this submission.
      const pendingKeys = new Map();
      openPrs.forEach((pr) => {
        for (const [fileKey, values] of Object.entries(pr.entries)) {
          if (!pendingKeys.has(fileKey)) pendingKeys.set(fileKey, new Set());
          Object.keys(values).forEach((key) => pendingKeys.get(fileKey).add(key));
        }
      });

      for (const [key, draft] of pendingDrafts) {
        const namespace = key.slice(prefix.length).replace(/\.json$/, "");
        // Use the same snapshot-pinned, sha-verified source as loading. The
        // mutable main branch could otherwise change hashes under the draft.
        const [sourceRaw, target] = await Promise.all([teFetchMainSource(namespace), teFetchSnapshotTarget(manifest, lang, namespace, true)]);
        const targetFile = { text: target.text || "", json: target.json };
        const sourceFlat = teFlattenTranslations(sourceRaw.json);
        const targetFlat = teFlattenTranslations(targetFile.json);
        if (targetFile.text) {
          teValidateLocaleSyntax(targetFile.text).forEach((issue) => {
            issues.push(issue);
            errors.push(...teQaIssueLabel(issue));
          });
        }
        const { changes, blocked, validation } = await teBuildPreviewChanges({
          draftEntries: await teRemapDraftRenames(draft.entries, renames, sourceFlat),
          sourceFlat,
          targetFlat,
          pendingKeys,
          lang,
          namespace,
          warnings,
          isNewTarget: !target.text,
        });
        blocked.forEach((entry) => blockedKeys.push({ ...entry, namespace }));
        if (!changes.length) continue;

        // Key errors are shown in the blocked list instead of disabling submit.
        warnings.push(...validation.warnings);
        issues.push(...(validation.issues || []).filter((issue) => issue.severity === "warning"));

        const submission = await teBuildSubmission({
          lang,
          ns: namespace,
          changes,
          baseCommit: manifest.snapshot,
          sourceCommit: manifest.source.commit,
        });
        if (!submission) {
          warnings.push(i18n.t("translationEditor.qa.sourceFreshness", { key: changes[0].key }));
          continue;
        }
        submissions.push(submission);
      }
    } catch (err) {
      errors.push(i18n.t("translationEditor.refreshError", { error: err.message }));
    }
    if (!submissions.length && !errors.length && !blockedKeys.length) {
      await showAlert(i18n.t("translationEditor.submitModal.noChanges"));
      return;
    }
    teShowSubmitModal({ lang, files: submissions, blocked: blockedKeys, errors, warnings, issues });
  } finally {
    teState.submitPreviewBusy = false;
    teElements.submitBtn.disabled = false;
    teElements.submitBtn.textContent = submitLabel;
  }
}

function teShowEditorView() {
  if (teElements.editorView) teElements.editorView.hidden = false;
  if (teElements.discussionsView) teElements.discussionsView.hidden = true;
  teElements.viewTabs?.querySelectorAll("[data-view]").forEach((tab) => {
    const active = tab.dataset.view === "editor";
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  // While hidden the viewport reports clientHeight 0, so rows may have been
  // rendered empty. Recompute once the editor is visible again.
  requestAnimationFrame(() => teTable.render());
}

function teShowDiscussionsView() {
  if (teElements.editorView) teElements.editorView.hidden = true;
  if (teElements.discussionsView) teElements.discussionsView.hidden = false;
  teElements.viewTabs?.querySelectorAll("[data-view]").forEach((tab) => {
    const active = tab.dataset.view === "discussions";
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  teEnterDiscussionsView();
}

function teSwitchView(view) {
  if (view === "discussions") {
    teRunWhenAuthenticated(teShowDiscussionsView);
    return;
  }
  teShowEditorView();
}

async function teExportDrafts() {
  await teCommitPendingSave();
  const allDrafts = await teLoadAllDrafts();
  const lang = teState.currentLang || teElements.languageSelect.value || "";
  const grouped = teCollectDraftsForExport(allDrafts, lang || null);
  const count = Object.values(grouped).reduce((total, drafts) => total + Object.values(drafts).reduce((sum, entries) => sum + Object.keys(entries).length, 0), 0);
  if (!count) {
    await showAlert(i18n.t("translationEditor.submitModal.noLanguageChanges"));
    return;
  }
  const blob = new Blob([teSerializeDraftExport(grouped)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `web-presence-drafts-${lang || "all"}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await showAlert(i18n.t("translationEditor.exportedDrafts", { count }));
}

async function teFetchTargetFileForTransfer(lang, namespace) {
  try {
    return await teFetchGithubFile(lang, namespace);
  } catch (err) {
    // A language that has not been submitted yet has no target file on main.
    // Treat it as empty; the PR creates the file when the submission lands.
    if (err?.status === 404) return { text: "", json: {} };
    throw err;
  }
}

async function teGetRenamesFor(namespace) {
  try {
    const manifest = await teFetchManifest();
    const sourceMeta = await teFetchSourceMetaAtSnapshot(manifest);
    return teNamespaceRenames(sourceMeta, namespace) || {};
  } catch (_err) {
    return {};
  }
}

function teRemapPlainValues(entries, renames) {
  if (!renames || !Object.keys(renames).length) return entries;
  const next = { ...entries };
  for (const [oldKey, newKey] of Object.entries(renames)) {
    if (Object.prototype.hasOwnProperty.call(next, oldKey) && !Object.prototype.hasOwnProperty.call(next, newKey)) {
      next[newKey] = next[oldKey];
      delete next[oldKey];
    }
  }
  return next;
}

async function teImportDraftsFromFile(file) {
  const text = await file.text();
  const parsed = teParseDraftExport(text);
  if (!parsed.ok) {
    await showAlert(i18n.t("translationEditor.importModal.invalidFile", { error: parsed.errors.join(", ") }));
    return;
  }
  const acceptedByLang = Object.create(null);
  const rejected = [];
  const errors = [];
  for (const { lang, drafts } of parsed.data.languages) {
    for (const [fileKey, entries] of Object.entries(drafts)) {
      const namespace = fileKey.replace(/\.json$/, "");
      try {
        const [sourceRaw, targetFile, renames] = await Promise.all([
          teFetchMainSource(namespace),
          teFetchTargetFileForTransfer(lang, namespace),
          teGetRenamesFor(namespace),
        ]);
        const result = await teBuildDraftEntriesFromImport({
          entries: teRemapPlainValues(entries, renames),
          source: teFlattenTranslations(sourceRaw.json),
          target: teFlattenTranslations(targetFile.json),
        });
        if (Object.keys(result.accepted).length) {
          if (!acceptedByLang[lang]) acceptedByLang[lang] = Object.create(null);
          acceptedByLang[lang][namespace] = result.accepted;
        }
        rejected.push(...result.rejected);
      } catch (err) {
        errors.push(`${lang}/${namespace}: ${err.message}`);
      }
    }
  }
  const acceptedCount = Object.values(acceptedByLang).reduce(
    (total, drafts) => total + Object.values(drafts).reduce((sum, entries) => sum + Object.keys(entries).length, 0),
    0,
  );
  if (!acceptedCount) {
    await showAlert(i18n.t("translationEditor.importModal.nothingToImport"));
    return;
  }
  teShowImportModal({ acceptedByLang, rejected, errors, acceptedCount });
}

async function teDownloadSourceFile() {
  const namespace = teElements.fileSelect.value;
  if (!namespace) return;
  const sourceRaw = await teFetchMainSource(namespace);
  const blob = new Blob([sourceRaw.text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `en.${namespace}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function teExportLocaleFile() {
  await teCommitPendingSave();
  const lang = teState.currentLang || teElements.languageSelect.value;
  const namespace = teElements.fileSelect.value;
  if (!lang || !namespace) return;
  const [sourceRaw, targetFile] = await Promise.all([teFetchMainSource(namespace), teFetchTargetFileForTransfer(lang, namespace)]);
  const drafts = await teLoadAllDrafts();
  const draftEntries = drafts[`${lang}/${namespace}.json`]?.entries || {};
  const draftValues = Object.fromEntries(
    Object.entries(draftEntries)
      .filter(([, entry]) => typeof entry?.target === "string")
      .map(([key, entry]) => [key, entry.target]),
  );
  // Repo state plus local work: exporting a file should carry the translations
  // the contributor currently sees, not a stale copy from the repository.
  const text = teSerializeLocaleExport(teFlattenTranslations(sourceRaw.json), {
    ...teFlattenTranslations(targetFile.json),
    ...draftValues,
  });
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${lang}.${namespace}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function teImportLocaleFile(file) {
  const lang = teState.currentLang || teElements.languageSelect.value;
  const namespace = teElements.fileSelect.value;
  if (!lang || !namespace) return;
  const text = await file.text();
  const parsed = teParseLocaleImport(text);
  if (!parsed.ok) {
    await showAlert(i18n.t("translationEditor.importModal.invalidFile", { error: parsed.errors.join(", ") }));
    return;
  }
  const [sourceRaw, targetFile, renames] = await Promise.all([teFetchMainSource(namespace), teFetchTargetFileForTransfer(lang, namespace), teGetRenamesFor(namespace)]);
  const entries = Object.fromEntries(Object.entries(parsed.entries).map(([key, value]) => [key, { target: value }]));
  const result = await teBuildDraftEntriesFromImport({
    entries: teRemapPlainValues(entries, renames),
    source: teFlattenTranslations(sourceRaw.json),
    target: teFlattenTranslations(targetFile.json),
  });
  const rejected = [...parsed.rejected, ...result.rejected];
  const acceptedCount = Object.keys(result.accepted).length;
  if (!acceptedCount) {
    await showAlert(i18n.t("translationEditor.importModal.nothingToImport"));
    return;
  }
  teShowImportModal({ acceptedByLang: { [lang]: { [namespace]: result.accepted } }, rejected, errors: [], acceptedCount });
}

function teShowImportModal({ acceptedByLang, rejected, errors, acceptedCount }) {
  const body = document.createElement("div");
  const summary = document.createElement("div");
  summary.textContent = i18n.t("translationEditor.importModal.accepted", { count: acceptedCount });
  body.appendChild(summary);
  if (rejected.length) {
    const warning = document.createElement("div");
    warning.className = "contribute-status warning";
    warning.textContent = i18n.t("translationEditor.importModal.rejected", {
      count: rejected.length,
      keys: rejected
        .slice(0, 10)
        .map((entry) => entry.key)
        .join(", "),
    });
    body.appendChild(warning);
  }
  if (errors.length) {
    const failed = document.createElement("div");
    failed.className = "contribute-status error";
    failed.textContent = i18n.t("translationEditor.refreshError", { error: errors.join(", ") });
    body.appendChild(failed);
  }

  const confirm = document.createElement("button");
  confirm.className = "btn btn-primary";
  confirm.textContent = i18n.t("translationEditor.importModal.confirm");
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    for (const [lang, drafts] of Object.entries(acceptedByLang)) {
      for (const [namespace, entries] of Object.entries(drafts)) {
        const file = `${namespace}.json`;
        const existing = (await teLoadDraft(lang, file)) || { entries: {} };
        const merged = { ...(existing.entries || {}) };
        for (const [key, entry] of Object.entries(entries)) {
          const previous = merged[key];
          merged[key] =
            previous && previous.target === entry.target
              ? {
                  ...entry,
                  ...(previous.reconfirmed ? { reconfirmed: true, localOnly: previous.localOnly === true } : {}),
                }
              : entry;
        }
        await teSaveDraft(lang, file, merged);
      }
    }
    modal.remove();
    const activeLang = teState.currentLang || teElements.languageSelect.value;
    if (activeLang && acceptedByLang[activeLang]) {
      await teLoadCurrentFile(true);
    } else {
      await showAlert(i18n.t("translationEditor.exportedDrafts", { count: acceptedCount }));
    }
  });
  const modal = createContentModal(i18n.t("translationEditor.importModal.title"), body, "", [confirm]);
  void teActivateStatusScroll(body);
}

function teBindEvents() {
  if (typeof TomSelect !== "undefined" && !teSortTom) {
    teSortTom = new TomSelect(teElements.sortSelect, teSimpleTomConfig());
  }
  if (typeof TomSelect !== "undefined" && !teDiscCategoryTom && teElements.discCategoryFilter) {
    teDiscCategoryTom = new TomSelect(teElements.discCategoryFilter, {
      ...teSimpleTomConfig(),
      allowEmptyOption: true,
      placeholder: i18n.t("translationEditor.discussions.allCategories"),
    });
  }
  teElements.languageSelect.addEventListener("change", async () => {
    await teCommitPendingSave();
    teFillFileSelect();
    teLoadCurrentFile();
  });
  teElements.fileSelect.addEventListener("change", async () => {
    await teCommitPendingSave();
    teLoadCurrentFile();
  });
  teElements.searchInput.addEventListener("input", () => {
    teState.query = teElements.searchInput.value.trim();
    teElements.searchResetBtn?.classList.toggle("filter-active", !!teState.query);
    clearTimeout(teState.searchTimer);
    teState.searchTimer = setTimeout(teRender, 100);
  });
  teElements.searchResetBtn?.addEventListener("click", () => {
    teElements.searchInput.value = "";
    teState.query = "";
    teElements.searchResetBtn.classList.remove("filter-active");
    clearTimeout(teState.searchTimer);
    teRender();
    teElements.searchInput.focus();
  });
  teElements.sortSelect.addEventListener("change", () => {
    teState.sort = teElements.sortSelect.value;
    teRender();
  });
  teElements.reloadBtn.addEventListener("click", async () => {
    await teCommitPendingSave();
    teLoadCurrentFile(true);
  });
  teElements.nextUntranslatedBtn.addEventListener("click", teGoToNextUntranslated);
  teElements.exportDraftsBtn?.addEventListener("click", async () => {
    try {
      await teExportDrafts();
    } catch (err) {
      await showAlert(i18n.t("translationEditor.loadError", { error: err.message }));
    }
  });
  teElements.importDraftsBtn?.addEventListener("click", () => teElements.importDraftsInput?.click());
  teElements.importDraftsInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await teImportDraftsFromFile(file);
    } catch (err) {
      await showAlert(i18n.t("translationEditor.importModal.invalidFile", { error: err.message }));
    }
  });
  teElements.exportLocaleBtn?.addEventListener("click", async () => {
    try {
      await teExportLocaleFile();
    } catch (err) {
      await showAlert(i18n.t("translationEditor.loadError", { error: err.message }));
    }
  });
  teElements.downloadSourceBtn?.addEventListener("click", async () => {
    try {
      await teDownloadSourceFile();
    } catch (err) {
      await showAlert(i18n.t("translationEditor.loadError", { error: err.message }));
    }
  });
  teElements.importLocaleBtn?.addEventListener("click", () => teElements.importLocaleInput?.click());
  teElements.importLocaleInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await teImportLocaleFile(file);
    } catch (err) {
      await showAlert(i18n.t("translationEditor.importModal.invalidFile", { error: err.message }));
    }
  });
  teElements.submitBtn.addEventListener("click", teOpenSubmitPreview);
  document.getElementById("btnGithubSettings")?.addEventListener("click", teOnGithubSettingsClick);

  teElements.filterTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-filter]");
    if (!tab) return;
    teState.filter = tab.dataset.filter;
    teElements.filterTabs.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("active", button === tab));
    teRender();
  });

  teElements.viewTabs?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-view]");
    if (!tab) return;
    teSwitchView(tab.dataset.view);
  });
  teElements.discCategoryFilter?.addEventListener("change", () => {
    teMainDiscState.categoryId = teElements.discCategoryFilter.value;
    teLoadDiscussionsPage({ reset: true });
  });
  teElements.discNewBtn?.addEventListener("click", () => teRunWhenAuthenticated(teShowNewDiscussionModal));
  // Flush the debounced draft when the page is hidden or closed, otherwise the
  // last 250 ms of typing is lost.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && teState.saveTimer) teCommitPendingSave();
  });
  window.addEventListener("pagehide", () => {
    if (teState.saveTimer) teCommitPendingSave();
  });

  teElements.discRefreshBtn?.addEventListener("click", async () => {
    try {
      await teLoadDiscussionCategories();
    } catch (err) {
      teRenderDiscListContent(teDiscStatusNode(teDiscErrorMessage(err), "error"));
      return;
    }
    await teLoadDiscussionsPage({ reset: true });
  });
}

window.addEventListener("load", async () => {
  await i18n.load("extension");
  applyTranslations();
  initApplyAttrs();
  initStorageListener();
  try {
    await teRefreshGithubAuthBadge();
  } catch (_err) {
    // Auth badge is decorative; locale loading must still proceed.
  }
  applyTsPlugins();
  teBindEvents();
  teElements.searchResetBtn?.appendChild(createSVG(svg_paths.crossIconPaths));
  await activateSimpleBar(teElements.sidebar);
  await activateSimpleBar(teElements.viewport)
    .then(() => teTable.render())
    .catch(() => {});
  try {
    teState.languages = await teLoadGithubLanguages();
  } catch (err) {
    teElements.emptyState.textContent = i18n.t("translationEditor.languagesError", { error: err.message });
    teElements.emptyState.style.display = "";
    return;
  }
  teFillSelects();
  try {
    const lastLang = await teLoadLastLang();
    if (lastLang && teState.languages.some((entry) => entry.lang === lastLang)) {
      if (teLanguageTom) teLanguageTom.setValue(lastLang, true);
      else teElements.languageSelect.value = lastLang;
      teFillFileSelect();
    }
  } catch (_err) {
    // Fall back to the default selection when stored state is unavailable.
  }
  await teLoadCurrentFile();
});
