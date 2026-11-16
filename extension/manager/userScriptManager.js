// Small, reusable utility helpers

/**
 * Runtime helper functions injected into userscripts by userScriptWorker.js.
 * Mirrors the JSHint `predef` whitelist in libs/codemirror/libs/jshintFilters.js
 * and is exposed to the editor autocomplete through the CodeMirror 5 "hint"
 * additionalContext option (javascript-hint.js uses additionalContext by default
 * for the standard JavaScript hint helper).
 */
const RUNTIME_HELPERS = {
  t: true,
  setMemo: true,
  getMemo: true,
  useSetting: true,
  getText: true,
  getTextAll: true,
  getImage: true,
  getImageAll: true,
  querySelectorDeep: true,
  getIframeData: true,
  clearActivity: true,
  blockHistorySave: true,
  allowHistorySave: true,
};

// `//#region Name` / `//#endregion` comment markers for collapsible named sections.
const REGION_OPEN_RE = /\/\/#region\b(?!-)/;
const REGION_OPEN_ALL_RE = /\/\/#region\b(?!-)/g;
const REGION_CLOSE_ALL_RE = /\/\/#endregion\b/g;

/**
 * Fixed language list offered in the Translations tab; arbitrary languages
 * cannot be added. Codes are lowercase so they match the sanitized locales
 * data and selectLocaleLang, which compares case-insensitively. "en" is the
 * mandatory base column and is never offered.
 */
const PARSER_LOCALE_LANGS = [
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "pl", name: "Polski" },
  { code: "pt-br", name: "Português (Brasil)" },
  { code: "ru", name: "Русский" },
  { code: "tr", name: "Türkçe" },
  { code: "uk", name: "Українська" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "zh-cn", name: "简体中文" },
  { code: "zh-tw", name: "繁體中文" },
];

/**
 * i18n lookup with an English fallback while a locale key is still missing
 * (i18n.t returns the key itself for unknown keys). `{0}`-style placeholders
 * are filled in the fallback too.
 */
function localeText(key, fallback, args) {
  try {
    const result = args ? i18n.t(key, args) : i18n.t(key);
    if (result && result !== key) return result;
  } catch (_) {}
  return Array.isArray(args) ? fallback.replace(/\{(\d+)\}/g, (m, i) => (i < args.length ? String(args[i]) : m)) : fallback;
}

/**
 * Builds the Translations tree from the code. Every useSetting() whose label is
 * t("key") becomes a node; the t("key") labels of a select's options become its
 * children, so `myList` shows its options underneath. Keys that belong to no
 * setting are plain nodes. Nodes follow the order of the code; keys that the
 * code does not use come last, in table order. Only keys that exist in the
 * table are shown ("Scan Keys from Code" adds the missing ones), and each key
 * appears once, at its first place in the code.
 * @returns {Array<{key: string|null, setting: {key: string, type: string}|null, children: Array<{key: string, value: string}>}>}
 */
function buildLocaleTree(code, tableKeys, settings) {
  const known = new Set(tableKeys);
  const placed = new Set();
  const entries = [];

  for (const s of settings) {
    let labelKey = s.labelCall ? UseSettingEditor.tCallKey(s.labelCall) : null;
    if (labelKey && (!known.has(labelKey) || placed.has(labelKey))) labelKey = null;
    const children = [];
    if (s.type === "select" && s.defaultOk && Array.isArray(s.defaultValue)) {
      for (const opt of s.defaultValue) {
        const key = opt && opt.label && opt.label.__type === "translation" ? opt.label.key : null;
        if (!key || !known.has(key) || placed.has(key) || key === labelKey || children.some((c) => c.key === key)) continue;
        children.push({ key, value: String(opt.value ?? "") });
      }
    }
    if (!labelKey && !children.length) continue;
    if (labelKey) placed.add(labelKey);
    for (const c of children) placed.add(c.key);
    entries.push({ pos: s.from, node: { key: labelKey, setting: { key: s.key, type: s.type }, children } });
  }

  for (const key of tableKeys) {
    if (placed.has(key)) continue;
    const first = findTranslationKeyRanges(code, key)[0];
    entries.push({ pos: first ? first.start : Infinity, node: { key, setting: null, children: [] } });
  }

  // Array.prototype.sort is stable, so equal positions keep their table order.
  return entries.sort((a, b) => a.pos - b.pos).map((e) => e.node);
}

const LINT_FLASH_CLASS = "cm-lint-flash";
const LINT_FLASH_DURATION = 700;
const MAX_DOC_WORDS = 1500;
const MAX_DOC_WORD_LENGTH = 40;
const MAX_HINT_EXTRAS = 80;

/**
 * Fold range finder for `//#region ... //#endregion` comment sections.
 *
 * @param {CodeMirror} cm Editor instance.
 * @param {{line: number, ch: number}} pos Position to fold from (line start).
 * @returns {null|{from: object, to: object}} Fold range or null.
 */
function regionFoldRange(cm, pos) {
  const lineText = cm.getLine(pos.line) || "";
  if (!REGION_OPEN_RE.test(lineText)) return null;

  let depth = 1;
  for (let current = pos.line + 1; current <= cm.lastLine(); current++) {
    const text = (cm.getLine(current) || "").trim();
    if (!text.startsWith("//")) continue;

    const bulkCloses = (text.match(REGION_CLOSE_ALL_RE) || []).length;
    const opens = (text.match(REGION_OPEN_ALL_RE) || []).length;
    if (bulkCloses) {
      depth -= bulkCloses;
      if (depth <= 0 && current > pos.line) {
        return {
          from: CodeMirror.Pos(pos.line, lineText.length),
          to: CodeMirror.Pos(current, cm.getLine(current).length),
        };
      }
    }
    depth += opens;
  }
  return null;
}

/**
 * Registers the region fold helper for JavaScript content (mirrors the
 * comment-fold.js global-helper pattern so the finder participates in
 * CodeMirror.fold.auto lookups).
 */
function registerRegionFoldHelper() {
  CodeMirror.registerGlobalHelper(
    "fold",
    "region",
    function (mode) {
      return mode.name === "javascript" && !mode.jsonMode;
    },
    regionFoldRange,
  );
}
registerRegionFoldHelper();

/**
 * Duplicates the current selection (or the current line when the selection is
 * empty) immediately below it. Multiple cursors are processed bottom-up so
 * earlier insertions do not shift positions that have yet to be copied.
 *
 * @param {CodeMirror} cm Editor instance.
 */
function duplicateLines(cm) {
  cm.operation(function () {
    const sels = cm
      .listSelections()
      .slice()
      .sort((a, b) => Math.min(b.anchor.line, b.head.line) - Math.min(a.anchor.line, a.head.line));
    for (const sel of sels) {
      const from = cmpPosLess(sel.anchor, sel.head);
      const to = cmpPosGreater(sel.anchor, sel.head);
      const endLine = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;

      if (from.line === to.line && from.ch === to.ch) {
        // Empty selection: duplicate the whole line.
        const lineLen = cm.getLine(from.line).length;
        const text = cm.getRange(CodeMirror.Pos(from.line, 0), CodeMirror.Pos(from.line, lineLen)) + "\n";
        cm.replaceRange(text, CodeMirror.Pos(from.line, lineLen));
        cm.setSelection(CodeMirror.Pos(from.line + 1, 0), CodeMirror.Pos(from.line + 1, lineLen));
      } else if (from.line === endLine) {
        // Text selection within one line: duplicate exactly the selected text.
        const text = cm.getRange(from, to);
        cm.replaceRange(text, to);
        cm.setSelection(CodeMirror.Pos(to.line, to.ch), CodeMirror.Pos(to.line, to.ch + text.length));
      } else {
        // Multi-line selection: duplicate the whole block below it.
        const blockEndCh = cm.getLine(endLine).length;
        const span = endLine - from.line + 1;
        const text = cm.getRange(CodeMirror.Pos(from.line, 0), CodeMirror.Pos(endLine, blockEndCh)) + "\n";
        cm.replaceRange(text, CodeMirror.Pos(endLine, blockEndCh));
        cm.setSelection(CodeMirror.Pos(from.line + span, from.ch), CodeMirror.Pos(endLine + span, to.ch));
      }
    }
  });
}

/**
 * Swaps a full-line block with the adjacent line above (`dir < 0`) or below
 * (`dir > 0`). Selections whose swap target line belongs to another selection
 * are skipped to avoid mixing the moving blocks.
 *
 * @param {CodeMirror} cm Editor instance.
 * @param {number} dir -1 to move up, 1 to move down.
 */
function moveLines(cm, dir) {
  const sels = cm.listSelections();
  const spans = sels.map(function (sel) {
    const from = cmpPosLess(sel.anchor, sel.head);
    const to = cmpPosGreater(sel.anchor, sel.head);
    return { start: from.line, end: to.ch === 0 && to.line > from.line ? to.line - 1 : to.line, shift: 0, sel: sel };
  });

  const spanOccupied = function (index, line) {
    return spans.some((other, otherIndex) => otherIndex !== index && line >= other.start && line <= other.end);
  };

  cm.operation(function () {
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const targetLine = dir < 0 ? span.start - 1 : span.end + 1;
      if (targetLine < cm.firstLine() || targetLine > cm.lastLine() || spanOccupied(i, targetLine)) continue;
      swapBlockWithLine(cm, span.start, span.end, targetLine);
      span.shift = dir;
    }
    cm.setSelections(
      spans.map(function (span) {
        const anchor = span.sel.anchor;
        const head = span.sel.head;
        return {
          anchor: span.shift ? cm.clipPos(CodeMirror.Pos(anchor.line + span.shift, anchor.ch)) : anchor,
          head: span.shift ? cm.clipPos(CodeMirror.Pos(head.line + span.shift, head.ch)) : head,
        };
      }),
    );
  });
}

/**
 * Swaps the full-line block `startLine..endLine` with the neighbour line at
 * `targetLine` while keeping the document line count stable.
 */
function swapBlockWithLine(cm, startLine, endLine, targetLine) {
  const blockEndCh = cm.getLine(endLine).length;
  const blockText = cm.getRange(CodeMirror.Pos(startLine, 0), CodeMirror.Pos(endLine, blockEndCh));
  const targetLen = cm.getLine(targetLine).length;
  const targetText = cm.getRange(CodeMirror.Pos(targetLine, 0), CodeMirror.Pos(targetLine, targetLen));

  if (targetLine < startLine) {
    cm.replaceRange(blockText + "\n" + targetText, CodeMirror.Pos(targetLine, 0), CodeMirror.Pos(endLine, blockEndCh));
  } else {
    cm.replaceRange(targetText + "\n" + blockText, CodeMirror.Pos(startLine, 0), CodeMirror.Pos(targetLine, targetLen));
  }
}

function cmpPosLess(a, b) {
  return a.line < b.line || (a.line === b.line && a.ch < b.ch) ? a : b;
}

function cmpPosGreater(a, b) {
  return cmpPosLess(a, b) === a ? b : a;
}

CodeMirror.commands.duplicateLines = duplicateLines;
CodeMirror.commands.moveLinesUp = function (cm) {
  moveLines(cm, -1);
};
CodeMirror.commands.moveLinesDown = function (cm) {
  moveLines(cm, 1);
};

class UserScriptUI {
  constructor() {
    this.editingId = null;
    this.editingScript = null;
    this.activeTab = "my"; // "my" | "repo" | "edited"
    this.searchQuery = "";
    this.lineWrapEnabled = true;
    this.lintAnnotations = [];
    this.lintFlashLine = null;
    this.lintFlashTimer = null;
    this.docWordsCache = [];
    this.statusBarBuilt = false;
    this._dirtyBaseline = null;
    this._savePromise = null;
    this.init();
  }

  async fetchScriptById(id) {
    const paramsFor = (tab) => (tab === "repo" ? { showOnlyStore: true } : tab === "edited" ? { showStoreParsers: true } : {});

    // First check the list of the active tab
    let resp = await sendAction("listUserScripts", paramsFor(this.activeTab));
    let found = (resp?.list || []).find((x) => x.id === id);

    // If not found, search in the other tab
    if (!found) {
      const otherParams = paramsFor(this.activeTab === "repo" ? "my" : "repo");
      resp = await sendAction("listUserScripts", otherParams);
      found = (resp?.list || []).find((x) => x.id === id);
    }

    return found || null;
  }

  async init() {
    await i18n.load("extension");
    applyTranslations();

    const perm = await checkUserScriptsPermission();
    if (!perm) return;

    await this.restoreSidebarWidth();
    this.bindEvents();
    await this.refreshList();
    this.bindCodeEditor();

    const inModeEl = document.querySelector("#inMode");

    this.inModeTom = new TomSelect(inModeEl, {
      create: false,
      allowEmptyOption: false,
      controlInput: null,
      onChange: () => {
        this.updateWatchAutoDetectVisibility();
      },
    });

    initApplyAttrs();
    initStorageListener();

    // GitHub auth badge - show connected state on header button
    this.refreshGithubAuthBadge();

    const tutorial = await browser.storage.local.get("userScriptTutorialDone");
    if (!tutorial.userScriptTutorialDone) {
      await showUserScriptTutorial();
    }
    initNewDots();
  }

  bindEvents() {
    // Main buttons
    document.getElementById("btnNew").addEventListener("click", () => this.showEditor());
    document.getElementById("btnCancel").addEventListener("click", () => this.hideEditor(1));
    document.getElementById("btnSave").addEventListener("click", () => this.saveScript());

    // Import/Export
    document.getElementById("btnImport").addEventListener("click", () => document.getElementById("fileInput").click());
    document.getElementById("fileInput").addEventListener("change", (e) => this.handleImport(e));
    document.getElementById("btnExport").addEventListener("click", (e) => {
      this.exportMenuClick(e);
    });

    // Editor Input Checks
    document.getElementById("inDomain").addEventListener("input", () => this.handlePatternStatus());
    document.getElementById("inUrlPatterns").addEventListener("input", () => this.handlePatternStatus());
    document.getElementById("inDesc")?.addEventListener("input", () => this.syncDescToLocales());

    // Header Tab
    document.getElementById("tabMyScripts")?.addEventListener("click", () => this.switchTab("my"));
    document.getElementById("tabRepoScripts")?.addEventListener("click", () => this.switchTab("repo"));
    document.getElementById("tabEditedScripts")?.addEventListener("click", () => this.switchTab("edited"));

    // List events
    document.getElementById("scriptList").addEventListener("click", (e) => this.handleListClick(e));

    document.querySelectorAll(".usm-tab").forEach((btn) => {
      btn.addEventListener("click", () => this.switchEditorTab(btn.dataset.tab));
    });

    // Translations (locales) editor
    document.getElementById("btnAddLocaleKey")?.addEventListener("click", () => this.addLocaleKey());
    document.getElementById("inLocaleLang")?.addEventListener("change", () => this.handleLocaleLangChange());
    document.getElementById("localesTableContainer")?.addEventListener("input", (e) => this.handleLocaleCellInput(e));
    document.getElementById("localesTableContainer")?.addEventListener("click", (e) => this.handleLocaleCellClick(e));
    document.getElementById("localesTableContainer")?.addEventListener("change", (e) => this.handleLocaleKeyChange(e));
    document.getElementById("btnPruneLocaleKeys")?.addEventListener("click", () => this.pruneUnusedLocaleKeys());
    const localesSearchEl = document.getElementById("localesSearch");
    const localesSearchResetBtn = document.getElementById("localesSearchResetBtn");
    localesSearchEl?.addEventListener("input", () => {
      localesSearchResetBtn?.classList.toggle("filter-active", localesSearchEl.value.length > 0);
      this.applyLocaleFilter();
    });
    localesSearchResetBtn?.appendChild(createSVG(svg_paths.closeIconPaths ?? svg_paths.crossIconPaths));
    localesSearchResetBtn?.addEventListener("click", () => {
      localesSearchEl.value = "";
      localesSearchResetBtn?.classList.remove("filter-active");
      this.applyLocaleFilter();
    });
    document.getElementById("btnShowMissingTranslations")?.addEventListener("click", () => this.toggleShowMissingTranslations());

    document.getElementById("usmListBtn")?.appendChild(createSVG(svg_paths.menuIconPaths));

    document.getElementById("usmBtnListToggle")?.addEventListener("click", () => {
      const sidebar = document.querySelector(".usm-sidebar");
      sidebar?.classList.toggle("collapsed");
      document.querySelectorAll(".script-item").forEach((li) => {
        li.classList.toggle("collapsed", sidebar?.classList.contains("collapsed"));
      });
      this.saveSidebarWidth();
    });

    // Search input - filter list client-side without refetching
    const scriptSearchEl = document.getElementById("scriptSearch");
    const scriptSearchResetBtn = document.getElementById("scriptSearchResetBtn");
    const debouncedRefreshList = debounce(() => this.refreshList(), 300);
    scriptSearchEl.addEventListener("input", (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      scriptSearchResetBtn?.classList.toggle("filter-active", this.searchQuery.length > 0);
      debouncedRefreshList();
    });

    scriptSearchEl.addEventListener("click", async () => {
      this.hideEditor();
    });

    scriptSearchResetBtn?.appendChild(createSVG(svg_paths.closeIconPaths ?? svg_paths.crossIconPaths));
    scriptSearchResetBtn?.addEventListener("click", () => {
      scriptSearchEl.value = "";
      this.searchQuery = "";
      scriptSearchResetBtn?.classList.remove("filter-active");
      this.refreshList();
    });

    // GitHub Contribute settings
    document.getElementById("btnGithubSettings").addEventListener("click", () => this.onGithubSettingsClick());

    // Global Ctrl+S / Cmd+S: save from anywhere while the editor is open
    document.addEventListener("keydown", (e) => {
      const key = e.key ? e.key.toLowerCase() : "";
      if ((e.ctrlKey || e.metaKey) && key === "s") {
        const editor = document.getElementById("editor");
        if (editor && !editor.hidden) {
          e.preventDefault();
          document.getElementById("btnSave").click();
        }
      }
    });

    // Native browser guard when the tab/window closes with unsaved changes
    window.addEventListener("beforeunload", (e) => {
      if (this.isEditorDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".script-item")) this.closeOverflowMenus();
    });

    document.querySelectorAll(".usm-notes-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        // The notes body is a sibling of the status bar.
        const bar = btn.closest(".cm-status-bar");
        const body = bar?.parentElement?.querySelector(":scope > .usm-notes-body");
        activateSimpleBar(body);
        if (body) {
          body.hidden = !body.hidden;
          btn.classList.toggle("active", !body.hidden);
        }
      });
    });

    const resizer = document.querySelector(".usm-resizer");
    const sidebar = document.querySelector(".usm-sidebar");
    if (resizer && sidebar) {
      let startX = 0;
      let startWidth = 0;
      const onMove = (e) => {
        const width = startWidth + (e.clientX - startX);
        sidebar.style.flexBasis = `${Math.round(Math.min(Math.max(width, 220), 520))}px`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        this.saveSidebarWidth();
      };
      resizer.addEventListener("mousedown", (e) => {
        if (sidebar.classList.contains("collapsed")) return;
        e.preventDefault();
        startX = e.clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }
  }

  async saveSidebarWidth() {
    const sidebar = document.querySelector(".usm-sidebar");
    if (!sidebar || sidebar.classList.contains("collapsed")) return;
    const width = sidebar.getBoundingClientRect().width;
    try {
      await browser.storage.local.set({ usmSidebarWidth: width });
    } catch (_) {}
  }

  async restoreSidebarWidth() {
    try {
      const { usmSidebarWidth } = await browser.storage.local.get("usmSidebarWidth");
      const sidebar = document.querySelector(".usm-sidebar");
      if (sidebar && usmSidebarWidth) {
        const clamped = Math.round(Math.min(Math.max(usmSidebarWidth, 220), 520));
        sidebar.style.flexBasis = `${clamped}px`;
        sidebar.style.width = `${clamped}px`;
      }
    } catch (_) {}
  }

  async switchTab(tab) {
    if (this.activeTab === tab) return;
    const editor = document.getElementById("editor");
    // Tab switch closes the open editor; protect unsaved changes first.
    if (editor && !editor.hidden && !(await this.confirmDiscardChanges())) return;
    this.activeTab = tab;
    document.querySelectorAll(".script-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    this.hideEditorCore();
    await this.refreshList();
  }

  // Switch between the editor's tabs (Code / Details / Advanced)
  switchEditorTab(tab) {
    const editor = document.getElementById("editor");
    if (!editor || editor.hidden) return;
    document.querySelectorAll(".usm-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".usm-panel").forEach((panel) => {
      const isActive = panel.dataset.tab === tab;
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
      if (isActive && panel.dataset.tab !== "code") activateSimpleBar(panel);
    });
    if (tab === "advanced") this.useSettingEditor?.refresh();
    if (tab === "translations") {
      // The code may have changed since the last visit: pick up new keys and
      // rebuild the tree from it.
      this.syncLocaleKeysFromCode();
      this.renderLocalesTable();
    }
    if (tab === "code") {
      setTimeout(() => this.codeEditor.refresh(), 0);
    }
  }

  handlePatternStatus() {
    const rawPatterns = document.getElementById("inUrlPatterns").value;
    const { normalizedList, invalidPatterns } = PatternValidator.processPatterns(rawPatterns);
    const patternStatus = document.getElementById("patternStatus");

    // Clear previous content
    clearChildren(patternStatus);

    if (normalizedList.length > 0) {
      normalizedList.forEach((p) => {
        const cont = document.createElement("code");
        cont.textContent = p;
        if (invalidPatterns.includes(p)) {
          cont.classList.add("pattern-invalid");
        }
        patternStatus.append(cont);
      });
    }
  }

  async bindCodeEditor() {
    const stored = await browser.storage.local.get(["theme", "editorLineWrap"]);
    const currentTheme = stored.theme === "light" ? "material-lighter" : "material-darker";
    // Default true keeps the pre-existing always-wrapped editor behaviour.
    this.lineWrapEnabled = stored.editorLineWrap !== false;

    const codeMirrorConfig = {
      theme: currentTheme,
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      autoCloseBrackets: true,
      matchBrackets: true,
      foldGutter: true,
      styleActiveLine: { nonEmpty: true },
      // Official match-highlighter addon: highlights the word under the cursor
      // and text selections throughout the document, scrollbar annotations included.
      highlightSelectionMatches: { showToken: /\w/, annotateScrollbar: true, minChars: 2, delay: 300 },
      gutters: ["CodeMirror-linenumbers", "CodeMirror-lint-markers", "CodeMirror-foldgutter"],
      lineWrapping: this.lineWrapEnabled,
      extraKeys: {
        "Ctrl-/": "toggleComment",
        "Ctrl-G": "findNextAdvanced",
        "Shift-Ctrl-G": "findPrevAdvanced",
        "Ctrl-F": function (cm) {
          cm.execCommand("openSearchAdvanced");
        },
        "Ctrl-Alt-[": "foldAll",
        "Ctrl-Alt-]": "unfoldAll",
        "Alt-Up": "moveLinesUp",
        "Alt-Down": "moveLinesDown",
        "Shift-Alt-Down": "duplicateLines",
        F8: (cm) => this.navigateLint(cm, 1),
        Esc: function (cm) {
          if (cm.state.searchAdvanced && cm.state.searchAdvanced._panel) cm.execCommand("closeSearchAdvanced");
          else cm.execCommand("singleSelection");
        },
      },
    };

    // JsBeautify Config
    const beautifyOptions = {
      indent_size: 2,
      indent_char: " ",
      indent_with_tabs: false,
      end_with_newline: false,
      preserve_newlines: true,
      max_preserve_newlines: 2,
      space_in_paren: false,
      space_in_empty_paren: false,
      jslint_happy: false,
      space_after_anon_function: true,
      brace_style: "collapse,preserve-inline",
      break_chained_methods: false,
      keep_array_indentation: false,
      unescape_strings: false,
      e4x: false,
      comma_first: false,
      operator_position: "before-newline",
      space_before_conditional: true,
      space_after_named_function: false,
      indent_empty_lines: false,
    };

    // Init CodeMirror 5
    // lintOptions spread: add-on only - `onUpdateLinting` is an official
    // lint.js UI option (lint.js defaults), the rest remain JSHint linter options.
    const lintRunConfig = {
      ...lintOptions,
      onUpdateLinting: (annotations) => this.updateLintSummary(annotations),
    };
    this.codeEditor = CodeMirror.fromTextArea(document.getElementById("inCode"), {
      mode: "javascript",
      lint: lintRunConfig,
      hintOptions: { additionalContext: RUNTIME_HELPERS },
      ...codeMirrorConfig,
    });

    // Autocomplete: base JSHint helpers + words from the current document
    // (covers string literals such as CSS selectors typed more than once).
    this.refreshDocWords(this.codeEditor);
    this.codeEditor.on(
      "inputRead",
      function (cm, change) {
        const char = (change.text && change.text[0]) || "";
        if (!char || !/[\w$.-]/.test(char)) return;
        cm.showHint({ completeSingle: false, hint: (cm, options) => this.combinedHint(cm, options) });
      }.bind(this),
    );
    this.codeEditor.on(
      "changes",
      debounce((cm) => {
        this.refreshDocWords(cm);
      }, 800),
    );
    this.codeEditor.on("cursorActivity", () => this.updateStatusBar());
    this.buildEditorStatusBar();

    // Apply JsHint Filters
    applyJsHintFilters(CodeMirror, lintOptions);

    // add js-beautify
    document.getElementById("btnFormat").addEventListener("click", () => {
      const code = this.codeEditor.getValue();
      const formatted = js_beautify(code, beautifyOptions);
      this.codeEditor.setValue(formatted);
    });

    // Iframe Selector CodeMirror
    this.iframeSelectorsEditor = CodeMirror.fromTextArea(document.getElementById("inIframeSelectors"), {
      mode: "application/json",
      ...codeMirrorConfig,
    });

    // Iframe Selector Default Value
    this.iframeSelectorsEditor.setValue(JSON.stringify({ fields: { $video: { type: "video" } } }, null, 2));
    this.iframeSelectorsEditor.clearHistory();

    // Ctrl/Cmd+Click adds additional cursors (core CodeMirror.addSelection API).
    for (const editor of [this.codeEditor, this.iframeSelectorsEditor]) {
      editor.on("mousedown", (cm, event) => this.addMultiCursor(cm, event));
    }

    // Toolbar controls: fold toggle and the line wrap toggle.
    const btnFoldToggle = document.getElementById("btnFoldToggle");
    const btnWrapToggle = document.getElementById("btnWrapToggle");
    const syncWrapButton = () => btnWrapToggle.classList.toggle("active", this.lineWrapEnabled);

    // The label reflects the next action based on the editor's current fold state,
    // keeping manual folds and keyboard shortcuts in sync.
    const hasFoldedRanges = (cm) => cm.findMarks(CodeMirror.Pos(cm.firstLine(), 0), CodeMirror.Pos(cm.lastLine() + 1, 0)).some((mark) => mark.__isFold);
    const syncFoldToggle = (cm = this.codeEditor) => {
      if (!btnFoldToggle) return;
      const folded = hasFoldedRanges(cm);
      btnFoldToggle.textContent = i18n.t(folded ? "userscript.codeEditor.unfoldAll" : "userscript.codeEditor.foldAll");
    };

    btnFoldToggle?.addEventListener("click", () => {
      const cm = this.codeEditor;
      cm.execCommand(hasFoldedRanges(cm) ? "unfoldAll" : "foldAll");
      syncFoldToggle(cm);
    });
    // External fold changes trigger the foldcode addon's fold/unfold signals.
    this.codeEditor.on("fold", () => syncFoldToggle(this.codeEditor));
    this.codeEditor.on("unfold", () => syncFoldToggle(this.codeEditor));

    syncWrapButton();
    btnWrapToggle?.addEventListener("click", async () => {
      this.lineWrapEnabled = !this.lineWrapEnabled;
      this.codeEditor.setOption("lineWrapping", this.lineWrapEnabled);
      this.iframeSelectorsEditor.setOption("lineWrapping", this.lineWrapEnabled);
      syncWrapButton();
      await browser.storage.local.set({ editorLineWrap: this.lineWrapEnabled });
    });

    // Iframe Selector Toggle
    const iframeSelectorsContainer = document.getElementById("iframeSelectorsContainer");
    const iframeSelectorsContainerHeader = document.getElementById("jsonCodeHeader");
    const iframeSelectorsToggle = document.getElementById("btnIframeSelectorsToggle");

    iframeSelectorsToggle.addEventListener("click", () => {
      const isHidden = iframeSelectorsContainer.hidden;
      iframeSelectorsContainer.hidden = !isHidden;
      iframeSelectorsContainerHeader.hidden = !isHidden;

      if (!isHidden) {
        document.getElementById("iframeSelectorsError").textContent = "";
        iframeSelectorsToggle.textContent = i18n.t("userscript.iframeSelectors.configure");
      } else {
        setTimeout(() => this.iframeSelectorsEditor.refresh(), 0);
        iframeSelectorsToggle.textContent = i18n.t("common.close");
      }
    });

    this.iframeSelectorsEditor.on("change", () => {
      const errorEl = document.getElementById("iframeSelectorsError");
      const raw = this.iframeSelectorsEditor.getValue().trim();

      if (!raw) {
        errorEl.textContent = "";
        errorEl.hidden = true;
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        if (!parsed.fields || typeof parsed.fields !== "object") {
          errorEl.textContent = i18n.t("userscript.iframeSelectors.error.missingFields");
          errorEl.hidden = false;
        } else {
          errorEl.textContent = "";
          errorEl.hidden = true;
        }
      } catch (e) {
        errorEl.textContent = i18n.t("userscript.iframeSelectors.error.invalidJson") + ": " + e.message;
        errorEl.hidden = false;
      }
    });

    // add js-beautify
    document.getElementById("btnFormatJson").addEventListener("click", () => {
      const code = this.iframeSelectorsEditor.getValue();
      const formatted = js_beautify(code, beautifyOptions);
      this.iframeSelectorsEditor.setValue(formatted);
    });

    const CATEGORY_OPTIONS = [
      { value: "radio", text: i18n.t("parserFilters.category.radio") },
      { value: "platform", text: i18n.t("parserFilters.category.platform") },
      { value: "aggregator", text: i18n.t("parserFilters.category.aggregator") },
      { value: "video", text: i18n.t("parserFilters.category.video") },
      { value: "game", text: i18n.t("parserFilters.category.game") },
      { value: "other", text: i18n.t("parserFilters.category.other") },
    ];

    this.categorySelect = new TomSelect("#inCategory", {
      options: CATEGORY_OPTIONS,
      items: [],
      maxOptions: CATEGORY_OPTIONS.length,
      create: false,
      plugins: ["remove_button"],
      placeholder: i18n.t("userscript.editor.category.placeholder"),
      onInitialize() {
        this.control_input.setAttribute("readonly", true);
      },
    });

    this.useSettingEditor = new UseSettingEditor(this.codeEditor, document.getElementById("useSettingsContainer"), {
      onJump: (pos) => {
        this.switchEditorTab("code");
        const cm = this.codeEditor;
        setTimeout(() => {
          cm.refresh();
          cm.setCursor(pos);
          cm.scrollIntoView(pos, 120);
          cm.focus();
        }, 0);
      },
      getLocaleData: () => this.getLocalesSaveData() || {},
      onLocalesChange: (key, value, overwrite) => this.addLocaleTranslation(key, value, overwrite),
    });
  }

  updateWatchAutoDetectVisibility() {
    const isWatch = this.inModeTom.getValue() === "watch";
    const container = document.querySelector(".usm-field-watchAutoDetect");
    if (container) container.style.display = isWatch ? "" : "none";
  }

  buildEditorStatusBar() {
    const bar = document.getElementById("cmStatusBar");
    if (!bar) return;
    this.statusBarBuilt = true;
    this.statusPos = document.getElementById("cmStatusPos");
    this.statusSel = document.getElementById("cmStatusSel");

    // Problems panel
    this.problemsPanel = document.getElementById("usmProblemsPanel");
    this.problemsList = document.getElementById("usmProblemsList");
    this.problemsContent = document.getElementById("usmProblemsContent");
    this.problemsCountErrors = document.getElementById("problemsCountErrors");
    this.problemsCountWarnings = document.getElementById("problemsCountWarnings");
    this.btnProblemsToggle = document.getElementById("btnProblemsToggle");
    this.btnProblemsToggle?.addEventListener("click", () => this.toggleProblemsPanel());
    this.renderProblemsPanel();
    this.updateStatusBar();
  }

  updateStatusBar() {
    if (!this.statusBarBuilt) return;
    const cursor = this.codeEditor.getCursor();
    this.statusPos.textContent = `Ln ${cursor.line + 1}, Col ${cursor.ch + 1}`;
    const selectedLength = this.codeEditor.somethingSelected() ? this.codeEditor.getSelection().length : 0;
    this.statusSel.hidden = !selectedLength;
    this.statusSel.textContent = selectedLength ? i18n.t("userscript.codeEditor.status.selection", [selectedLength]) : "";
  }

  updateLintSummary(annotations) {
    this.lintAnnotations = Array.isArray(annotations) ? annotations.filter((ann) => ann && ann.from && ann.severity) : [];
    if (!this.statusBarBuilt) return;
    const errors = this.lintAnnotations.filter((ann) => ann.severity === "error").length;
    const warnings = this.lintAnnotations.filter((ann) => ann.severity === "warning").length;

    // Problems button counts and panel content mirror every lint run.
    if (this.problemsCountErrors) {
      this.problemsCountErrors.hidden = errors === 0;
      this.problemsCountErrors.textContent = String(errors);
    }
    if (this.problemsCountWarnings) {
      this.problemsCountWarnings.hidden = warnings === 0;
      this.problemsCountWarnings.textContent = String(warnings);
    }
    this.renderProblemsPanel();
  }

  toggleProblemsPanel() {
    if (!this.problemsPanel) return;
    const willOpen = this.problemsPanel.hidden;
    this.problemsPanel.hidden = !willOpen;
    this.btnProblemsToggle?.classList.toggle("active", willOpen);
    if (willOpen && this.problemsList) activateSimpleBar(this.problemsList);
    // The panel shares the grid with the editor: re-measure after the row changes.
    setTimeout(() => this.codeEditor.refresh(), 0);
  }

  /**
   * Renders the latest lint annotations in the Problems panel.
   * Called by lint.js's onUpdateLinting hook.
   */
  renderProblemsPanel() {
    if (!this.problemsList) return;

    // Preserve SimpleBar's scroll structure by clearing only the inner content.
    const target = this.problemsContent ?? this.problemsList;
    clearChildren(target);

    if (!this.lintAnnotations.length) {
      const empty = document.createElement("div");
      empty.className = "usm-problems-empty";
      empty.textContent = i18n.t("userscript.codeEditor.problems.empty");
      target.appendChild(empty);
    } else {
      const sorted = this.lintAnnotations.slice().sort((a, b) => a.from.line - b.from.line || a.from.ch - b.from.ch);
      for (const ann of sorted) {
        const severityClass = ann.severity === "error" || ann.severity === "warning" ? ann.severity : "info";
        const item = document.createElement("button");
        item.type = "button";
        item.className = `usm-problem-item severity-${severityClass}`;

        const icon = document.createElement("span");
        icon.className = "problem-icon";
        icon.appendChild(createSVG(svg_paths.PROBLEM_SEVERITY_ICONS[severityClass], { width: 12, height: 12, stroke: "currentColor" }));

        const message = document.createElement("span");
        message.className = "problem-message";
        message.textContent = ann.message;

        const location = document.createElement("span");
        location.className = "problem-location";
        location.textContent = `Ln ${ann.from.line + 1}, Col ${ann.from.ch + 1}`;

        item.append(icon, message, location);
        item.addEventListener("click", () => this.jumpToProblem(ann));
        target.appendChild(item);
      }
    }

    // Keep the SimpleBar scrollbar in sync while the panel is visible
    if (!this.problemsPanel?.hidden) activateSimpleBar(this.problemsList);
  }

  /**
   * Moves the cursor to a clicked diagnostic, mirroring the F8 navigation.
   *
   * @param {{from: {line: number, ch: number}}} ann Lint annotation.
   */
  jumpToProblem(ann) {
    this.codeEditor.setCursor(ann.from);
    this.codeEditor.scrollIntoView(null, 120);
    this.codeEditor.focus();
    this.flashLintLine(this.codeEditor, ann.from.line);
  }

  /**
   * Moves the cursor to the next/previous lint annotation. Iterates the
   * annotation list maintained by the lint.js `onUpdateLinting` hook.
   *
   * @param {CodeMirror} cm Editor instance.
   * @param {number} dir 1 for next, -1 for previous.
   * @param {string|null} [severity] Optional severity filter ("error"|"warning").
   */
  navigateLint(cm, dir, severity = null) {
    const annotations = this.lintAnnotations.filter((ann) => !severity || ann.severity === severity);
    if (!annotations.length) return;
    const sorted = annotations.slice().sort((a, b) => a.from.line - b.from.line || a.from.ch - b.from.ch);
    const cursor = cm.getCursor();
    let target = null;
    if (dir < 0) {
      for (let i = sorted.length - 1; i >= 0; i--) {
        const ann = sorted[i];
        if (ann.from.line < cursor.line || (ann.from.line === cursor.line && ann.from.ch < cursor.ch)) {
          target = ann;
          break;
        }
      }
      if (!target) target = sorted[sorted.length - 1];
    } else {
      for (const ann of sorted) {
        if (ann.from.line > cursor.line || (ann.from.line === cursor.line && ann.from.ch > cursor.ch)) {
          target = ann;
          break;
        }
      }
      if (!target) target = sorted[0];
    }

    cm.setCursor(target.from);
    cm.scrollIntoView(null, 120);
    cm.focus();
    this.flashLintLine(cm, target.from.line);
  }

  flashLintLine(cm, line) {
    clearTimeout(this.lintFlashTimer);
    if (this.lintFlashLine !== null) cm.removeLineClass(this.lintFlashLine, "wrap", LINT_FLASH_CLASS);
    cm.addLineClass(line, "wrap", LINT_FLASH_CLASS);
    this.lintFlashLine = line;
    this.lintFlashTimer = setTimeout(() => {
      cm.removeLineClass(line, "wrap", LINT_FLASH_CLASS);
      this.lintFlashLine = null;
    }, LINT_FLASH_DURATION);
  }

  focusFirstLintError() {
    const errors = this.lintAnnotations.filter((ann) => ann.severity === "error");
    if (!errors.length) return;
    const first = errors.slice().sort((a, b) => a.from.line - b.from.line || a.from.ch - b.from.ch)[0];
    this.codeEditor.setCursor(first.from);
    this.codeEditor.scrollIntoView(null, 120);
    this.flashLintLine(this.codeEditor, first.from.line);
  }

  /**
   * Rebuilds the lowercase-insensitive word vocabulary of the current document
   * (identifiers and string content such as CSS selectors) used to supplement
   * the base JavaScript autocomplete.
   */
  refreshDocWords(cm) {
    const words = new Set();
    const value = cm.getValue() || "";
    const re = /[\w$-]{2,}/g;
    let match;
    while ((match = re.exec(value)) !== null) {
      const word = match[0];
      if (word.length > MAX_DOC_WORD_LENGTH || words.size >= MAX_DOC_WORDS) break;
      if (/^-?\d+(?:[._]\d+)?$/.test(word)) continue;
      words.add(word);
    }
    this.docWordsCache = [...words];
  }

  /**
   * Combines the standard JavaScript hint helper with document vocabulary.
   * Identifier/.property contexts keep the base result untouched; inside
   * string literals the document word list is served instead.
   */
  combinedHint(cm, options) {
    const hintOptions = { ...(options || {}) };
    const base = CodeMirror.hint.javascript ? CodeMirror.hint.javascript(cm, hintOptions) : null;
    const cursor = cm.getCursor();
    const token = cm.getTokenAt(cursor);
    const isString = typeof token.type === "string" && token.type.indexOf("string") !== -1;

    let from;
    let to;
    let prefix;
    if (base) {
      from = base.from;
      to = base.to || cursor;
      prefix = cm.getRange(base.from, to);
    } else if (isString) {
      // `from`/`to` must be CodeMirror positions ({line, ch}), not bare numbers.
      let fromCh = token.start;
      const tokenText = token.string || "";
      if (tokenText && /^["'`]/.test(tokenText.charAt(0))) fromCh += 1;
      if (cursor.ch <= fromCh) return null;
      const content = cm.getRange(CodeMirror.Pos(cursor.line, fromCh), cursor);
      let start = content.length;
      while (start > 0 && /[\w$-]/.test(content.charAt(start - 1))) start--;
      fromCh += start;
      from = CodeMirror.Pos(cursor.line, fromCh);
      prefix = content.slice(start);
      to = cursor;
    } else {
      return null;
    }

    const list = base ? base.list.slice() : [];
    if (prefix.length >= 2) {
      const seen = new Set(list.map((item) => (typeof item === "string" ? item : item && item.text)));
      for (const word of this.docWordsCache) {
        if (list.length >= MAX_HINT_EXTRAS + (base ? base.list.length : 0)) break;
        if (seen.has(word) || word === prefix || !word.startsWith(prefix)) continue;
        seen.add(word);
        list.push(word);
      }
    }
    if (!list.length) return null;
    return { list, from, to };
  }

  /**
   * Ctrl/Cmd+Click adds extra cursors using the core addSelection API.
   * Falls back to the default click behaviour when the click lands on editor
   * chrome (gutters, fold widgets) or uses modifier/shift keys.
   *
   * @param {CodeMirror} cm Editor instance.
   * @param {MouseEvent} event Original mousedown event.
   * @returns {boolean} True when an extra cursor was added.
   */
  addMultiCursor(cm, event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.button !== 0) return false;
    const target = event.target;
    if (target?.closest?.(".CodeMirror-gutters, .CodeMirror-foldmarker, .CodeMirror-lint-markers")) return false;
    const pos = cm.coordsChar({ left: event.clientX, top: event.clientY }, "window");
    cm.addSelection(pos, pos);
    cm.focus();
    event.preventDefault();
    return true;
  }

  async refreshList() {
    const params = this.activeTab === "repo" ? { showOnlyStore: true } : this.activeTab === "edited" ? { showStoreParsers: true } : {};
    const listResp = await sendAction("listUserScripts", params);

    if (!listResp || !listResp.ok) {
      logError("[userScriptManager]: List fetch failed", listResp);
      return;
    }

    let list = listResp.list || [];
    if (this.activeTab === "edited") list = list.filter((script) => script._localEdited);
    const filteredList = this.filterList(list);
    this.renderList(filteredList);
    await this.restoreContext();
  }

  async restoreContext() {
    const { managerContext } = await browser.storage.local.get("managerContext");
    if (!managerContext) return;
    await browser.storage.local.remove("managerContext");
    if (managerContext.target) {
      document.querySelector(`li[data-id="${managerContext.target}"]`)?.click();
    }
  }

  renderList(list) {
    this.hideEditor();
    const editor = document.getElementById("editor");
    const workspace = document.querySelector(".usm-workspace");
    if (workspace && editor.parentElement !== workspace) workspace.appendChild(editor);
    const ul = document.getElementById("scriptList");
    const host = ul.querySelector(".simplebar-content") || ul;
    host.innerHTML = "";

    if (!list.length) {
      const emptyMsg = document.createElement("li");
      emptyMsg.className = "script-empty-message";
      if (this.searchQuery) {
        emptyMsg.textContent = i18n.t("userscript.list.noResults");
      } else {
        emptyMsg.textContent =
          this.activeTab === "repo"
            ? i18n.t("userscript.list.empty.repo")
            : this.activeTab === "edited"
              ? i18n.t("userscript.list.empty.edited")
              : i18n.t("userscript.list.empty.my");
      }
      host.appendChild(emptyMsg);
      this.refreshListScroll();
      return;
    }

    list.sort((a, b) => a.title.localeCompare(b.title));

    list.forEach((script) => {
      const li = document.createElement("li");
      li.dataset.id = script.id;
      li.dataset.title = script.title;
      li.className = "script-item";
      li.classList.toggle("registered", !!script.registered);
      li.classList.toggle("enabled", !!script.enabled);
      li.classList.toggle("disabled", !script.enabled);

      // script-info container
      const info = document.createElement("div");
      info.className = "script-info";

      // script-header
      const header = document.createElement("div");
      header.className = "script-header";

      const title = document.createElement("strong");
      title.className = "script-title";
      title.textContent = script.title || "";

      const rawDomain = Array.isArray(script.domain) ? script.domain[0] : script.domain;
      const primaryDomain = (rawDomain || "").replace(/^\*\./, "");

      // FavIcon
      const favIconContainer = document.createElement("div");
      favIconContainer.className = "parser-icon-container spinner";
      favIconContainer.title = script.title || "";

      const favIcon = document.createElement("img");
      favIcon.className = "script-favicon hidden-visibility";
      favIcon.dataset.src = primaryDomain;
      favIcon.loading = "lazy";
      favIcon.decoding = "async";
      favIconContainer.appendChild(favIcon);

      const handleFavIconClick = (ev) => {
        ev.stopPropagation();
        const url = script.homepage || `https://${primaryDomain}`;
        window.open(url, "_blank", "noopener,noreferrer");
      };
      favIcon.addEventListener("click", handleFavIconClick);
      header.appendChild(favIconContainer);

      const status = document.createElement("span");
      status.className = "script-status badge badge-sm badge-rounded";
      status.classList.toggle("status-active", !!script.registered);
      status.classList.toggle("status-inactive", !script.registered);
      const inactiveStatus =
        !script.registered && !script.enabled ? i18n.t("userscript.status.inactive") : !script.registered ? i18n.t("userscript.status.unregistered") : null;
      status.textContent = inactiveStatus || i18n.t("userscript.status.active");
      status.title = status.textContent;

      header.appendChild(title);
      header.appendChild(status);

      const metaParts = [];
      if (script.authors && Array.isArray(script.authors) && script.authors.length > 0) {
        metaParts.push(`${script.authors.length > 1 ? "Authors" : "Author"}: ${script.authors.join(", ")}`);
      }
      if (script.lastUpdated) metaParts.push(new Date(script.lastUpdated).toLocaleDateString());
      title.title = metaParts.join(" | ");
      info.appendChild(header);

      // script-details
      const details = document.createElement("div");
      details.className = "script-details";

      if (script._localEdited) {
        const editedBadge = document.createElement("span");
        editedBadge.className = "badge badge-sm badge-rounded status-edited";
        editedBadge.title = i18n.t("userscript.status.edited.title");
        editedBadge.textContent = i18n.t("userscript.status.edited");
        details.appendChild(editedBadge);
      }

      info.appendChild(details);

      // script-actions
      const actions = document.createElement("div");
      actions.className = "script-actions";

      const isActivelyRunning = script.enabled && script.registered;
      const btnToggle = createListActionButton(
        isActivelyRunning ? svg_paths.pauseIconPaths : svg_paths.startIconPaths,
        `btnToggle btn ${isActivelyRunning ? "btn-disable" : "btn-enable"}`,
        isActivelyRunning ? i18n.t("common.disable") : i18n.t("common.enable"),
        script.id,
      );
      actions.appendChild(btnToggle);

      const btnMore = document.createElement("button");
      btnMore.type = "button";
      btnMore.className = "btnMore btn";
      btnMore.title = i18n.t("userscript.listControls.moreActions");
      btnMore.appendChild(createSVG(svg_paths.moreIconPaths));
      actions.appendChild(btnMore);

      const menu = document.createElement("div");
      menu.className = "usm-overflow-menu";
      menu.hidden = true;
      const btnExport = createListActionButton(svg_paths.exportIconPaths, "btnExport", i18n.t("userscript.listControls.export"), script.id, { strokeWidth: 1.5 });
      const btnContribute = createListActionButton(svg_paths.githubIconPaths, "btnContribute", i18n.t("userscript.contribute.button"), script.id);
      const btnDelete = createListActionButton(svg_paths.trashIconPaths, "btnDelete", i18n.t("common.delete"), script.id);
      menu.append(btnExport, btnContribute, btnDelete);

      actions.appendChild(menu);

      li.appendChild(info);
      li.appendChild(actions);
      host.appendChild(li);
    });
    // Favicon lazy load
    const allFavIcons = document.querySelectorAll(".script-favicon");
    loadFavIcons(allFavIcons);
    this.refreshListScroll();
  }

  refreshListScroll() {
    const ul = document.getElementById("scriptList");
    if (!ul) return;
    Promise.resolve()
      .then(() => activateSimpleBar("scriptList"))
      .catch(() => {})
      .then(() =>
        requestAnimationFrame(() => {
          try {
            window.SimpleBar?.instances?.get(ul)?.recalculate();
          } catch (_) {}
        }),
      );
  }

  formatPatterns(patterns) {
    if (!patterns || patterns === "*") return ".*";
    if (typeof patterns === "string") patterns = [patterns];
    if (Array.isArray(patterns)) {
      return patterns.map((p) => p.replace(/^\/|\/$/g, "")).join(", ");
    }
    return String(patterns);
  }

  filterList(list) {
    if (!this.searchQuery) return list;
    const query = this.searchQuery;
    return list.filter((script) => {
      const title = (script.title || "").toLowerCase();
      const domain = Array.isArray(script.domain) ? script.domain.join(" ") : script.domain || "";
      // t() descriptors resolve to their English value
      let description = script.description;
      if (isTranslationDescriptor(description)) description = resolveScriptDescription(script);
      description = typeof description === "string" ? description : "";
      return title.includes(query) || domain.toLowerCase().includes(query) || description.toLowerCase().includes(query);
    });
  }

  async handleListClick(e) {
    const button = e.target.closest("button");
    if (button) {
      e.preventDefault();
      e.stopPropagation();

      const li = button.closest("li");
      if (!li) return;
      const { id, title } = li.dataset;

      if (button.classList.contains("btnToggle")) return this.onToggle(id);
      if (button.classList.contains("btnMore")) {
        const menu = li.querySelector(".usm-overflow-menu");
        if (menu && !menu.hidden) {
          menu.hidden = true;
          return;
        }
        this.closeOverflowMenus();
        if (menu) menu.hidden = false;
        return;
      }
      if (button.classList.contains("btnEdit")) return this.onEdit(id);
      if (button.classList.contains("btnRegister")) return this.onRegisterToggle(id);
      if (button.classList.contains("btnExport")) return this.exportMenuClick(e);
      if (button.classList.contains("btnDelete")) return this.onDelete(id, title);
      if (button.classList.contains("btnContribute")) return this.onContribute(id);
      return;
    }

    this.closeOverflowMenus();
    const li = e.target.closest("li.script-item");
    if (!li) return;
    const id = li.dataset.id;
    if (!id) return;
    e.preventDefault();

    const script = await this.fetchScriptById(id);
    if (script) this.showEditor(script);
  }

  closeOverflowMenus() {
    document.querySelectorAll(".usm-overflow-menu").forEach((menu) => {
      menu.hidden = true;
    });
  }

  async showEditor(script = null) {
    const editor = document.getElementById("editor");
    const editorEmpty = document.getElementById("editorEmpty");
    if (!editor || !editorEmpty) return;

    // Data-loss guard: the editor is about to be closed (same-script toggle)
    // or refilled with another script; protect unsaved changes either way.
    if (!editor.hidden && !(await this.confirmDiscardChanges())) return;

    this.editingId = script?.id || null;
    this.editingScript = script || null;

    const currentSection = script?.id || "new";
    if (editor.getAttribute("current") === currentSection) {
      editor.setAttribute("current", "0");
      this.hideEditorCore();
      return;
    } else {
      editor.setAttribute("current", currentSection);
    }

    const authorsInput = document.getElementById("inAuthors");
    const authorsLinksInput = document.getElementById("inAuthorsLinks");
    const githubUser = typeof githubContributeService !== "undefined" ? await githubContributeService.getCachedUser() : null;

    const isRepoScript = !!script?.storeFilePath;

    if (!script && githubUser && githubUser.login) {
      // New script and GitHub login - auto-fill, disabled
      authorsInput.value = githubUser.login;
      authorsLinksInput.value = `https://github.com/${githubUser.login}`;
      authorsInput.disabled = true;
      authorsLinksInput.disabled = true;
    } else if (isRepoScript) {
      // Repo script - always disabled, shows original values
      authorsInput.disabled = true;
      authorsLinksInput.disabled = true;
      authorsInput.value = Array.isArray(script?.authors) ? script.authors.join(", ") : script?.authors || "";
      authorsLinksInput.value = Array.isArray(script?.authorsLinks) ? script.authorsLinks.join(", ") : script?.authorsLinks || "";
    } else {
      // My Scripts - editable
      authorsInput.disabled = false;
      authorsLinksInput.disabled = false;
      authorsInput.value = Array.isArray(script?.authors) ? script.authors.join(", ") : script?.authors || "";
      authorsLinksInput.value = Array.isArray(script?.authorsLinks) ? script.authorsLinks.join(", ") : script?.authorsLinks || "";
    }

    document.getElementById("editorTitle").textContent = script ? `${i18n.t("userscript.editor.editScript")} [${script.title}]` : i18n.t("userscript.editor.newScript");

    const isActivelyRunning = !!(script?.enabled && script?.registered);
    const statusEl = document.getElementById("editorStatus");
    const favEl = document.querySelector(".usm-editor-favicon");
    if (statusEl) {
      statusEl.textContent = isActivelyRunning ? i18n.t("userscript.status.active") : i18n.t("userscript.status.inactive");
      statusEl.className = `usm-editor-status${isActivelyRunning ? " status-active" : " status-inactive"}`;
    }
    if (favEl && script) {
      const rawDomain = Array.isArray(script.domain) ? script.domain[0] : script.domain;
      const primaryDomain = (rawDomain || "").replace(/^\*\./, "");
      favEl.dataset.src = primaryDomain;
      favEl.classList.add("hidden-visibility");
      favEl.src = "";
    } else if (favEl) {
      favEl.dataset.src = "";
      favEl.src = "";
    }
    loadFavIcons([favEl]);

    document.getElementById("inTitle").value = script?.title || "";

    // If the description is stored as a translation descriptor, show the
    // English value from locales for editing; otherwise show the raw string.
    const descRaw = script?.description;
    let descText = "";
    if (descRaw && typeof descRaw === "object" && descRaw.__type === "translation" && descRaw.key) {
      descText = script?.locales?.en?.[descRaw.key] || "";
    } else if (typeof descRaw === "string") {
      descText = descRaw;
    }
    document.getElementById("inDesc").value = descText;

    const [vMaj, vMin, vPat] = (script?.version || "1.0.0").split(".").map((n) => parseInt(n, 10) || 0);
    document.getElementById("inVersionMajor").value = vMaj;
    document.getElementById("inVersionMinor").value = vMin;
    document.getElementById("inVersionPatch").value = vPat;
    document.getElementById("inDomain").value = Array.isArray(script?.domain) ? script.domain.join(", ") : script?.domain || "";
    document.getElementById("inHomepage").value = script?.homepage || "";
    this.inModeTom.setValue(script?.mode || "listen");
    document.getElementById("inWatchAutoDetect").value = script?.watchAutoDetect || "disable";
    const rawCategory = script?.category ?? "";
    const categoryItems = Array.isArray(rawCategory) ? rawCategory : splitAndTrim(rawCategory);

    this.categorySelect.clear(true);
    this.categorySelect.setValue(categoryItems, true);
    document.getElementById("inTags").value = Array.isArray(script?.tags) ? script.tags.join(", ") : script?.tags || "";
    this.updateWatchAutoDetectVisibility();
    document.getElementById("inDebug").checked = script?.debug || false;

    const iframeSelectorsContainer = document.getElementById("iframeSelectorsContainer");
    const iframeSelectorsContainerHeader = document.getElementById("jsonCodeHeader");

    const iframeSelectorsBtn = document.getElementById("btnIframeSelectorsToggle");

    if (script?.iframeSelectors) {
      iframeSelectorsContainer.hidden = false;
      iframeSelectorsContainerHeader.hidden = false;
      iframeSelectorsBtn.classList.add("active");
      iframeSelectorsBtn.textContent = i18n.t("common.close");
      setTimeout(() => {
        this.iframeSelectorsEditor.setValue(JSON.stringify(script.iframeSelectors, null, 2));
        this.iframeSelectorsEditor.clearHistory();
        this.iframeSelectorsEditor.refresh();
      }, 10);
    } else {
      iframeSelectorsContainer.hidden = true;
      iframeSelectorsContainerHeader.hidden = true;
      iframeSelectorsBtn.classList.remove("active");
      iframeSelectorsBtn.textContent = i18n.t("userscript.iframeSelectors.configure");
      this.iframeSelectorsEditor.setValue(JSON.stringify({ fields: { $video: { type: "video" } } }, null, 2));
      this.iframeSelectorsEditor.clearHistory();
    }

    document.getElementById("inUrlPatterns").value = this.formatPatterns(script?.urlPatterns) || ".*";
    document.getElementById("inUrlPatterns").dispatchEvent(new Event("input"));
    this.codeEditor.setValue(
      script?.code ||
        `let title = "";
         let artist = "";
         let image = "";
         let source = "";
         let link = "";
         let timePassed = null;
         let duration = null;
         let buttons = [{link: "", text: ""}, {link: "",text: "",}];
         let isPlaying = false;
         `,
    );
    // The initial fill is the undo baseline, not an edit.
    // Otherwise, the last Ctrl+Z would undo setValue entirely.
    this.codeEditor.clearHistory();

    if (!script?.code) document.getElementById("btnFormat").click();

    document.getElementById("editorMsg").textContent = "";
    document.getElementById("editorMsg").classList = "";
    editor.hidden = false;
    editorEmpty.hidden = true;
    this.syncSelectedItem();
    this.codeEditor.refresh();

    // Render the translations table after the code editor holds the new script's
    // code, so "not in code" badges reflect the current script rather than the
    // previously opened one.
    this.loadLocalesData(script?.locales, typeof script?.description === "string" ? script.description : "");

    this.useSettingEditor.loadFromCode();

    // Capture the clean-state baseline slightly AFTER the delayed
    // iframeSelectorsEditor fill above (10 ms timer) and the auto-format gap.
    setTimeout(() => {
      this._dirtyBaseline = this.snapshotEditorState();
    }, 30);
    this.syncSearchAvailability();
  }

  /**
   * Serializes every persistent form field into a comparable string. Values
   * are the raw current form values, mirroring the parts of the script object
   * that saveScript() sends to the background.
   */
  snapshotEditorState() {
    return JSON.stringify({
      title: document.getElementById("inTitle").value.trim(),
      authors: splitAndTrim(document.getElementById("inAuthors").value).join(","),
      authorsLinks: splitAndTrim(document.getElementById("inAuthorsLinks").value).join(","),
      domain: document.getElementById("inDomain").value,
      homepage: document.getElementById("inHomepage").value.trim(),
      urlPatterns: document.getElementById("inUrlPatterns").value,
      watchAutoDetect: document.getElementById("inWatchAutoDetect").value.trim(),
      debug: document.getElementById("inDebug").checked,
      versionMajor: document.getElementById("inVersionMajor").value,
      versionMinor: document.getElementById("inVersionMinor").value,
      versionPatch: document.getElementById("inVersionPatch").value,
      description: document.getElementById("inDesc").value.trim(),
      mode: this.inModeTom ? this.inModeTom.getValue() : "",
      category: this.categorySelect ? this.categorySelect.getValue().join(",") : "",
      tags: splitAndTrim(document.getElementById("inTags").value).join(","),
      code: this.codeEditor ? this.codeEditor.getValue() : "",
      iframeSelectors: this.iframeSelectorsEditor ? this.iframeSelectorsEditor.getValue() : "",
      locales: JSON.stringify(this.getLocalesSaveData()),
    });
  }

  isEditorDirty() {
    const editor = document.getElementById("editor");
    if (!editor || editor.hidden) return false;
    // _dirtyBaseline becomes null while the editor content is being (re)filled;
    // treat the capture window as clean instead of trust false positives.
    if (this._dirtyBaseline == null) return false;
    return this._dirtyBaseline !== this.snapshotEditorState();
  }

  // ----- Translations (parser locales) editor -----

  /** Loads a script's `locales` metadata into the Translations tab. */
  loadLocalesData(raw, descriptionValue) {
    this.localesData = sanitizeLocales(raw) || {};
    // The description key exists only when the script has a description. If
    // the script still carries a raw description string, use it as the English
    // value so it shows up in the Translations tab automatically.
    const en = (this.localesData.en ||= {});
    if (en.description === undefined && typeof descriptionValue === "string" && descriptionValue.trim()) {
      en.description = descriptionValue;
    }
    if (!en.description || !en.description.trim()) {
      // No usable description: drop any leftover "description" key everywhere
      // so the card stays hidden (legacy saves can carry an empty value).
      for (const lang of Object.keys(this.localesData)) {
        delete this.localesData[lang].description;
        if (!Object.keys(this.localesData[lang]).length) delete this.localesData[lang];
      }
    }
    this.localeViewLang = null;
    this._showMissingTranslations = false;
    this.renderLocalesTable();
  }

  /** Keeps locales.en["description"] in sync with the Description field (#inDesc). */
  syncDescToLocales() {
    const inDesc = document.getElementById("inDesc");
    if (!inDesc) return;
    const locales = (this.localesData ||= {});
    const en = (locales.en ||= {});
    // The description translation exists only while the script has a
    // description; clearing the field removes the key and its card.
    if (inDesc.value.trim()) {
      en.description = inDesc.value;
    } else {
      delete en.description;
      if (!Object.keys(en).length) delete locales.en;
    }
    const row = document.querySelector('#localesTableContainer .usm-loc-card[data-key="description"] .usm-loc-value[data-lang="en"]');
    if (row) {
      row.value = inDesc.value;
      this.autosizeLocaleInput(row);
      this.refreshLocaleLangProgress();
    } else {
      // The card appeared or disappeared with the Description field.
      this.renderLocalesTable();
    }
  }

  /**
   * Sanitized `locales` object for saving. Languages/keys without any non-empty
   * value are dropped entirely so empty editors do not add metadata noise.
   */
  getLocalesSaveData() {
    const raw = this.localesData || {};
    const out = {};
    for (const lang of Object.keys(raw)) {
      const map = {};
      for (const key of Object.keys(raw[lang] || {})) {
        const value = raw[lang][key];
        if (key && typeof value === "string" && value.trim()) map[key] = value;
      }
      if (Object.keys(map).length) out[lang] = map;
    }
    return Object.keys(out).length ? out : null;
  }

  /** Column order: "en" is always the first (mandatory) column. */
  getLocaleLangs() {
    return ["en", ...Object.keys(this.localesData || {}).filter((lang) => lang !== "en")];
  }

  /** Unique key list: union of the keys of every language. */
  getLocaleKeys() {
    const keys = [];
    for (const lang of Object.keys(this.localesData || {})) {
      for (const key of Object.keys(this.localesData[lang])) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    return keys;
  }

  renderLocalesTable() {
    const container = document.getElementById("localesTableContainer");
    if (!container) return;
    clearChildren(container);
    this.refreshLocaleLangOptions();

    // The source column is the English entries, the target column is the selected language only.
    const viewLang = this.getLocaleViewLang();
    const langs = ["en", viewLang];
    const keys = this.getLocaleKeys();

    this.refreshLocaleLangProgress(keys, viewLang);

    if (!keys.length) {
      const empty = document.createElement("div");
      empty.className = "usm-loc-empty";
      empty.textContent = localeText("userscript.translations.empty", "No translation keys yet. Use “Scan Keys from Code” or “+ Key”.");
      container.append(empty);
      this.refreshLocaleUsage();
      return;
    }

    const list = document.createElement("div");
    list.className = "usm-loc-list";

    const code = this.codeEditor?.getValue?.() ?? "";
    const settings = typeof UseSettingParser === "function" ? new UseSettingParser().parse(code) : [];
    const collapsed = (this._locCollapsed ||= new Set());

    for (const node of buildLocaleTree(code, keys, settings)) {
      const settingHint = node.setting ? `${node.setting.type} · ${node.setting.key}` : "";

      if (!node.children.length) {
        list.append(this.buildLocaleCard(node.key, langs, { hint: settingHint }));
        continue;
      }

      const group = document.createElement("section");
      group.className = "usm-loc-group";
      group.dataset.setting = node.setting.key;
      if (collapsed.has(node.setting.key)) group.classList.add("is-collapsed");

      if (node.key) {
        group.append(this.buildLocaleCard(node.key, langs, { hint: settingHint, toggle: true }));
      } else {
        // The label is plain text, only its options are translatable.
        const head = document.createElement("header");
        head.className = "usm-loc-group-head";
        head.append(this.makeLocaleToggle());
        const title = document.createElement("span");
        title.className = "usm-loc-hint";
        title.textContent = settingHint;
        head.append(title);
        group.append(head);
      }

      const children = document.createElement("div");
      children.className = "usm-loc-children";
      for (const child of node.children) {
        children.append(this.buildLocaleCard(child.key, langs, { hint: `value: ${child.value}`, child: true }));
      }
      group.append(children);
      list.append(group);
    }
    container.append(list);
    list.querySelectorAll(".usm-loc-value").forEach((el) => this.autosizeLocaleInput(el));
    this.applyLocaleFilter();
    this.refreshLocaleUsage();
    this.refreshShowMissingButton();
  }

  makeLocaleToggle() {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn usm-loc-toggle";
    toggle.textContent = "▾";
    toggle.setAttribute("aria-expanded", "true");
    return toggle;
  }

  /** One key: editable name, per-language fields, "not in code" badge, remove button. */
  buildLocaleCard(key, langs, { hint = "", toggle = false, child = false } = {}) {
    const card = document.createElement("article");
    card.className = `usm-loc-card${child ? " is-child" : ""}`;
    card.dataset.key = key;

    const head = document.createElement("header");
    head.className = "usm-loc-card-head";
    if (toggle) head.append(this.makeLocaleToggle());

    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "usm-loc-key-input";
    keyInput.value = key;
    keyInput.spellcheck = false;
    keyInput.placeholder = i18n.t("userscript.translations.keyColumn");
    if (key === "description") keyInput.readOnly = true;
    head.append(keyInput);

    if (hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "usm-loc-hint";
      hintEl.textContent = hint;
      head.append(hintEl);
    }

    const unused = document.createElement("span");
    unused.className = "usm-loc-unused";
    unused.hidden = true;
    unused.textContent = localeText("userscript.translations.unused", "Not in code");
    unused.title = localeText(
      "userscript.translations.unusedHint",
      'No literal t("key") call with this key was found in the code. Keys built dynamically cannot be detected.',
    );
    head.append(unused);

    const removeKey = document.createElement("button");
    removeKey.type = "button";
    removeKey.className = "btn usm-loc-remove-key";
    removeKey.appendChild(createSVG(svg_paths.crossIconPaths));
    removeKey.title = i18n.t("userscript.translations.removeKey");
    if (key !== "description") head.append(removeKey);
    card.append(head);

    const grid = document.createElement("div");
    grid.className = "usm-loc-grid";
    for (const lang of langs) {
      const field = document.createElement("label");
      field.className = `usm-loc-field${lang === "en" ? " is-base" : ""}`;

      const tag = document.createElement("span");
      tag.className = "usm-loc-lang";
      // The English field is the translation source; the other is the target.
      tag.textContent = lang;
      field.append(tag);

      const input = document.createElement("textarea");
      input.rows = 1;
      input.className = "usm-loc-value";
      input.dataset.lang = lang;
      input.spellcheck = false;
      const value = this.localesData[lang]?.[key];
      input.value = typeof value === "string" ? value : "";
      if (lang !== "en" && !input.value.trim()) input.classList.add("usm-loc-missing");
      field.append(input);
      grid.append(field);
    }
    card.append(grid);
    return card;
  }

  /** Live completion counter for the current target language. */
  refreshLocaleLangProgress(keys = this.getLocaleKeys(), viewLang = this.getLocaleViewLang()) {
    const el = document.getElementById("localesLangProgress");
    if (!el) return;
    const filled = keys.filter((k) => String(this.localesData?.[viewLang]?.[k] ?? "").trim()).length;
    el.textContent = localeText("userscript.translations.langProgress", "{0}/{1} translated", [filled, keys.length]);
    el.classList.toggle("is-complete", keys.length > 0 && filled === keys.length);
  }

  /** Grows a textarea to fit its content (cards stay compact for short strings). */
  autosizeLocaleInput(el) {
    el.style.height = "auto";
    // Hidden panel (scrollHeight 0): keep CSS min-height, re-measured when the tab opens.
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }

  /**
   * Hides what does not match the search box (key or any translation). A group
   * stays visible when its own key, its setting name or any option matches; when
   * only some options match, only those are shown. Collapsed groups open while
   * a search is active.
   */
  applyLocaleFilter() {
    const container = document.getElementById("localesTableContainer");
    if (!container) return;
    const q = (document.getElementById("localesSearch")?.value || "").trim().toLowerCase();
    const showMissing = this._showMissingTranslations;
    const missingKeys = showMissing ? new Set(this.getMissingTranslations()) : null;
    container.querySelector(".usm-loc-list")?.classList.toggle("is-filtering", !!q || showMissing);

    const matches = (card) => {
      if (showMissing) {
        if (!missingKeys.has(card.dataset.key)) return false;
        if (!q) return true;
        return (card.dataset.key || "").toLowerCase().includes(q) || [...card.querySelectorAll(".usm-loc-value")].some((i) => i.value.toLowerCase().includes(q));
      }
      if (!q) return true;
      return (card.dataset.key || "").toLowerCase().includes(q) || [...card.querySelectorAll(".usm-loc-value")].some((i) => i.value.toLowerCase().includes(q));
    };

    container.querySelectorAll(".usm-loc-list > .usm-loc-card").forEach((card) => card.classList.toggle("is-hidden", !matches(card)));

    container.querySelectorAll(".usm-loc-group").forEach((group) => {
      const parent = group.querySelector(":scope > .usm-loc-card");
      const kids = [...group.querySelectorAll(":scope > .usm-loc-children > .usm-loc-card")];
      const selfHit = showMissing
        ? parent
          ? matches(parent)
          : false
        : !q || (group.dataset.setting || "").toLowerCase().includes(q) || (parent ? matches(parent) : false);
      const kidHits = kids.map(matches);
      group.classList.toggle("is-hidden", !(selfHit || kidHits.some(Boolean)));
      kids.forEach((kid, i) => kid.classList.toggle("is-hidden", !selfHit && !kidHits[i]));
    });
  }

  /** Live cell editing: updates this.localesData and the missing markers. */
  handleLocaleCellInput(event) {
    const target = event.target;
    const row = target.closest(".usm-loc-card[data-key]");
    if (!row) return;
    const oldKey = row.dataset.key;

    if (target.classList.contains("usm-loc-key-input")) {
      // Renames are committed on change/blur (commitLocaleKeyRename), not per
      // keystroke, so intermediate text never collides with other keys or
      // rewrites the code. Typing only validates.
      const problem = this.getLocaleKeyProblem(target.value.trim(), oldKey);
      target.classList.toggle("is-invalid", !!problem);
      target.title = problem || "";
      return;
    }

    if (target.classList.contains("usm-loc-value")) {
      const lang = target.dataset.lang;
      if (!lang) return;
      const locales = (this.localesData[lang] ||= {});
      locales[oldKey] = target.value;
      if (lang === "en" && oldKey === "description") {
        const inDesc = document.getElementById("inDesc");
        if (inDesc) inDesc.value = target.value;
      }
      target.classList.toggle("usm-loc-missing", lang !== "en" && !target.value.trim());
      this.autosizeLocaleInput(target);
      this.refreshLocaleLangProgress();
      this.refreshShowMissingButton();
    }
  }

  async handleLocaleCellClick(event) {
    const toggle = event.target.closest(".usm-loc-toggle");
    if (toggle) {
      const group = toggle.closest(".usm-loc-group");
      if (!group) return;
      const isCollapsed = group.classList.toggle("is-collapsed");
      group.querySelectorAll(":scope > .usm-loc-card .usm-loc-toggle, :scope > .usm-loc-group-head .usm-loc-toggle").forEach((btn) => {
        btn.setAttribute("aria-expanded", String(!isCollapsed));
      });
      const collapsed = (this._locCollapsed ||= new Set());
      if (isCollapsed) collapsed.add(group.dataset.setting);
      else collapsed.delete(group.dataset.setting);
      return;
    }
    const removeKey = event.target.closest(".usm-loc-remove-key");
    if (removeKey) {
      const row = removeKey.closest(".usm-loc-card[data-key]");
      if (!row) return;
      const key = row.dataset.key;
      if (key === "description") return;
      if (
        !(await showConfirm("", {
          heading: i18n.t("userscript.translations.confirmDelete"),
          body: "",
        }))
      )
        return;
      for (const lang of Object.keys(this.localesData)) {
        delete this.localesData[lang][key];
        if (!Object.keys(this.localesData[lang]).length) delete this.localesData[lang];
      }
      this.renderLocalesTable();
    }
  }

  handleLocaleKeyChange(event) {
    if (event.target?.classList?.contains("usm-loc-key-input")) this.commitLocaleKeyRename(event.target);
  }

  /**
   * Commits a key rename: moves the entries in every language, rewrites the
   * literal t("old") calls in the code (one undoable edit in the code editor)
   * and refreshes the badges. An invalid or duplicate name reverts the input to
   * the last committed key.
   */
  commitLocaleKeyRename(input) {
    const row = input.closest(".usm-loc-card[data-key]");
    if (!row) return;
    const oldKey = row.dataset.key;
    const newKey = input.value.trim();
    if (newKey === oldKey) {
      input.value = oldKey;
      return;
    }
    if (this.getLocaleKeyProblem(newKey, oldKey)) {
      // Invalid names were already flagged while typing: go back to the last good key.
      input.value = oldKey;
      input.classList.remove("is-invalid");
      input.title = "";
      return;
    }

    for (const lang of Object.keys(this.localesData)) {
      if (Object.prototype.hasOwnProperty.call(this.localesData[lang], oldKey)) {
        this.localesData[lang][newKey] = this.localesData[lang][oldKey];
        delete this.localesData[lang][oldKey];
      }
    }
    row.dataset.key = newKey;
    input.value = newKey;
    input.classList.remove("is-invalid");
    input.title = "";

    this.renameTranslationKeyInCode(oldKey, newKey);
    this.refreshLocaleLangProgress();
    this.refreshLocaleUsage();
  }

  /** Why `key` can't be the name of this entry, or "" when it is fine. */
  getLocaleKeyProblem(key, currentKey) {
    if (!key) return localeText("userscript.translations.warn.emptyKey", "The key can't be empty.");
    if ((key === "description") !== (currentKey === "description"))
      return localeText("userscript.translations.warn.reservedKey", 'The "description" key is reserved and can\'t be renamed.');
    if (key !== currentKey && this.getLocaleKeys().includes(key)) return localeText("userscript.translations.warn.duplicateKey", "This key already exists.");
    if (!isRenamableTranslationKey(key)) return localeText("userscript.translations.warn.invalidKey", "A key can't contain quotes, backslashes or line breaks.");
    return "";
  }

  /** Rewrites literal t("oldKey") calls to the new key. Returns how many were changed. */
  renameTranslationKeyInCode(oldKey, newKey) {
    const cm = this.codeEditor;
    if (!cm || !oldKey || !isRenamableTranslationKey(newKey)) return 0;
    const ranges = findTranslationKeyRanges(cm.getValue(), oldKey);
    if (!ranges.length) return 0;
    // Back to front, so earlier offsets stay valid while the code changes.
    cm.operation(() => {
      for (let i = ranges.length - 1; i >= 0; i--) {
        const { start, end, quote } = ranges[i];
        cm.replaceRange(`${quote}${newKey}${quote}`, cm.posFromIndex(start), cm.posFromIndex(end));
      }
    });
    return ranges.length;
  }

  /** Commits key edits that are still pending (the input has not fired change yet). */
  flushLocaleKeyEdits() {
    document.querySelectorAll("#localesTableContainer .usm-loc-key-input").forEach((input) => {
      const row = input.closest(".usm-loc-card[data-key]");
      if (row && input.value.trim() !== row.dataset.key) this.commitLocaleKeyRename(input);
    });
  }

  /**
   * Keys without a literal t("key") call in the code. Dynamic calls such as
   * t(variable) are invisible to the scan, so this is a hint, not proof. The
   * "description" key is a system key for the script description and is never
   * referenced via t() in code, so it is excluded.
   */
  getUnusedLocaleKeys() {
    const code = this.codeEditor?.getValue?.() ?? "";
    const used = new Set(scanTranslationKeys(code));
    return this.getLocaleKeys().filter((key) => key.trim() && key !== "description" && !used.has(key));
  }

  /** Updates the "not in code" badges and the remove-unused button. */
  refreshLocaleUsage() {
    const unused = new Set(this.getUnusedLocaleKeys());
    document.querySelectorAll("#localesTableContainer .usm-loc-card").forEach((card) => {
      const isUnused = unused.has(card.dataset.key);
      card.classList.toggle("is-unused", isUnused);
      const badge = card.querySelector(".usm-loc-unused");
      if (badge) badge.hidden = !isUnused;
    });
    const prune = document.getElementById("btnPruneLocaleKeys");
    if (prune) {
      prune.hidden = unused.size === 0;
      prune.textContent = localeText("userscript.translations.pruneUnused", "Remove unused ({0})", [unused.size]);
    }
  }

  /** Keys whose target-language value is empty or missing, including keys
   * that exist only in other languages. */
  getMissingTranslations(viewLang = this.getLocaleViewLang()) {
    if (!viewLang) return [];
    return this.getLocaleKeys().filter((key) => {
      if (!key.trim()) return false;
      const value = this.localesData?.[viewLang]?.[key];
      return typeof value !== "string" || !value.trim();
    });
  }

  /** Disables the "Show Missing Translations" button (all-ok) when no keys are
   * missing a target-language value, and marks it active while the filter is on. */
  refreshShowMissingButton() {
    const btn = document.getElementById("btnShowMissingTranslations");
    if (!btn) return;
    const missing = this.getMissingTranslations();
    btn.classList.toggle("all-ok", missing.length === 0);
    btn.classList.toggle("active", this._showMissingTranslations);
    btn.textContent = missing.length === 0 && this._showMissingTranslations ? i18n.t("header.back") : i18n.t("userscript.translations.showMissing");
  }

  /** Toggles the missing-translations view. When on, cards whose target
   * language value is empty are highlighted and the table is filtered to show
   * only those cards. Persists until the user clicks Save. */
  toggleShowMissingTranslations() {
    this._showMissingTranslations = !this._showMissingTranslations;
    this.refreshShowMissingButton();
    this.applyLocaleFilter();
    this.renderLocalesTable();
  }

  /** Deletes keys that no t() call uses, from every language, after a confirmation. */
  async pruneUnusedLocaleKeys() {
    // An empty code editor would flag every key as unused: never prune then.
    if (!(this.codeEditor?.getValue?.() ?? "").trim()) return;
    this.flushLocaleKeyEdits();
    const unused = this.getUnusedLocaleKeys();
    if (!unused.length) {
      this.refreshLocaleUsage();
      return;
    }
    const preview = unused.slice(0, 8).join(", ") + (unused.length > 8 ? ", …" : "");
    const proceed = await showConfirm(localeText("userscript.translations.pruneHeading", "Remove unused keys?"), {
      type: "warn",
      body: localeText(
        "userscript.translations.pruneBody",
        "These keys are not used by any literal t() call and will be deleted from all languages: {0}. Keys built dynamically, such as t(variable), cannot be detected.",
        [preview],
      ),
      labelOk: localeText("userscript.translations.pruneConfirm", "Remove"),
    });
    if (!proceed) return;
    for (const key of unused) {
      for (const lang of Object.keys(this.localesData)) {
        delete this.localesData[lang][key];
        if (!Object.keys(this.localesData[lang]).length) delete this.localesData[lang];
      }
    }
    this.renderLocalesTable();
  }

  /** Adds an empty key row (reusing the existing empty row when present). */
  addLocaleKey() {
    const locales = (this.localesData ||= {});
    if (!locales.en) locales.en = {};
    const existing = Object.keys(locales.en).find((key) => !key.trim());
    if (existing !== undefined) {
      this.renderLocalesTable();
      this.focusLocaleKeyInput(existing);
      return;
    }
    locales.en[""] = "";
    this.renderLocalesTable();
    this.focusLocaleKeyInput("");
  }

  focusLocaleKeyInput(key) {
    const container = document.getElementById("localesTableContainer");
    const row = container?.querySelector(`.usm-loc-card[data-key="${CSS.escape(key)}"]`);
    row?.querySelector(".usm-loc-key-input")?.focus();
  }

  /**
   * Synchronizes an English translation entry from the useSetting editor:
   * setting creation passes overwrite=false (existing values are never
   * replaced), label edits pass overwrite=true. Other languages are untouched.
   */
  addLocaleTranslation(key, value, overwrite = false) {
    if (!key || typeof value !== "string" || !value.trim()) return;
    const locales = (this.localesData ||= {});
    const en = (locales.en ||= {});
    if (!overwrite && typeof en[key] === "string" && en[key].trim()) return;
    if (en[key] === value) return;
    en[key] = value;
    this.renderLocalesTable();
  }

  /**
   * Populates the target language select: the fixed PARSER_LOCALE_LANGS list
   * plus any legacy language already present in the data (so it stays visible
   * and removable). The selection is the single-language view's target.
   */
  refreshLocaleLangOptions() {
    const select = document.getElementById("inLocaleLang");
    if (!select) return;
    const fixed = PARSER_LOCALE_LANGS.map((l) => l.code);
    const legacy = Object.keys(this.localesData || {}).filter((lang) => lang !== "en" && !fixed.includes(lang));
    const labels = new Map(PARSER_LOCALE_LANGS.map((l) => [l.code, `${l.name} (${l.code})`]));
    const options = [...fixed, ...legacy.sort()];
    select.replaceChildren(
      ...options.map((code) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = labels.get(code) ?? code;
        return opt;
      }),
    );
    select.value = this.getLocaleViewLang();
  }

  /** Selecting a language opens its single-language view; nothing is created until a value is typed. */
  handleLocaleLangChange() {
    const code = document.getElementById("inLocaleLang")?.value;
    if (!code) return;
    this.localeViewLang = code;
    this.renderLocalesTable();
  }

  /** Removes the selected target language from the data and re-renders. */
  async removeLocaleViewLang() {
    const viewLang = this.getLocaleViewLang();
    if (!this.localesData?.[viewLang]) return;
    if (
      !(await showConfirm("", {
        heading: i18n.t("userscript.translations.confirmDelete"),
        body: "",
      }))
    )
      return;
    delete this.localesData[viewLang];
    this.localeViewLang = null;
    this.renderLocalesTable();
  }

  /** The target language of the single-language view, resolved when unset. */
  getLocaleViewLang() {
    const fixed = PARSER_LOCALE_LANGS.map((l) => l.code);
    const view = this.localeViewLang;
    if (view && (fixed.includes(view) || this.localesData?.[view])) return view;
    const existing = Object.keys(this.localesData || {}).find((lang) => lang !== "en");
    return existing || fixed[0];
  }

  /**
   * Adds keys used by literal t("key") calls in the code but missing from the
   * table, as empty English entries. Existing translations are never overwritten
   * and entries are never removed. Returns how many keys were added.
   */
  syncLocaleKeysFromCode() {
    const found = scanTranslationKeys(this.codeEditor?.getValue?.() ?? "");
    if (!found.length) return 0;
    const locales = (this.localesData ||= {});
    const en = (locales.en ||= {});
    const known = new Set(this.getLocaleKeys());
    let added = 0;
    for (const key of found) {
      if (known.has(key)) continue;
      en[key] = "";
      added++;
    }
    return added;
  }

  /**
   * Unsaved-changes confirmation shared by editor close, script switch and page
   * leave paths. Resolves true when the caller may proceed (clean editor, user
   * discarded, or user saved successfully) and false when the user chose to
   * keep editing.
   */
  async confirmDiscardChanges() {
    if (!this.isEditorDirty()) return true;
    const choice = await showConfirm("", {
      type: "warn",
      heading: i18n.t("userscript.editor.unsavedChanges.heading"),
      body: i18n.t("userscript.editor.unsavedChanges.body"),
      labelOk: i18n.t("userscript.editor.unsavedChanges.discard"),
      extraButtons: [{ label: i18n.t("common.save"), cls: "primary", value: "save" }],
    });
    if (choice === "save") {
      // saveScript clears the dirty state when the save succeeds. Falsy return
      // (validation failed) means the user should keep editing.
      return this.saveScript();
    }
    // OK ("discard changes") resolves truthy; cancel and escape resolve false.
    return choice === true;
  }

  /**
   * Public editor close with unsaved-changes protection.
   * @param {number} [btn] Truthy means the caller wants the target URL param removed (browser chrome closes).
   */
  async hideEditor(btn) {
    if (!(await this.confirmDiscardChanges())) return;
    this.hideEditorCore(btn);
  }

  /** Raw close without confirmation - only for callers that already confirmed. */
  hideEditorCore(btn) {
    const editor = document.getElementById("editor");
    const editorEmpty = document.getElementById("editorEmpty");
    editor.hidden = true;
    editor.setAttribute("current", "0");
    if (editorEmpty) editorEmpty.hidden = false;
    document.getElementById("editorMsg").classList = "";
    this.editingId = null;
    this.editingScript = null;
    this.syncSelectedItem();
    this.syncSearchAvailability();
    const params = new URLSearchParams(window.location.search);
    const target = params.get("target");
    if (btn && target) {
      params.delete("target");
      const newUrl = window.location.origin + window.location.pathname + (params.toString() ? "?" + params.toString() : "");
      window.location.replace(newUrl);
    }
  }

  syncSelectedItem() {
    const editor = document.getElementById("editor");
    const openId = editor && !editor.hidden ? this.editingId : null;
    document.querySelectorAll("#scriptList .script-item").forEach((li) => {
      li.classList.toggle("selected", !!openId && li.dataset.id === String(openId));
    });
  }

  /**
   * Keeps the client-side list search (input + reset button) unavailable while
   * the editor is open. Refreshing the list re-renders it and would close the
   * editor, so blocking the trigger while editing is the simplest safe rule.
   */
  syncSearchAvailability() {
    const searchInput = document.getElementById("scriptSearch");
    const searchResetBtn = document.getElementById("scriptSearchResetBtn");
    if (searchInput) {
      searchInput.disabled = false;
      searchInput.title = "";
    }
    if (searchResetBtn) searchResetBtn.disabled = false;
  }

  /**
   * Single-flight save entry point. A second Save trigger while a save is
   * already in flight (fast double click or Ctrl+S) joins the in-flight
   * attempt instead of queuing a parallel write; the button stays disabled
   * so racing requests cannot submit different editor states.
   */
  async saveScript() {
    if (this._savePromise) return this._savePromise;
    const btnSave = document.getElementById("btnSave");
    if (btnSave) btnSave.disabled = true;
    this._savePromise = this.performSave();
    try {
      return await this._savePromise;
    } finally {
      if (btnSave) btnSave.disabled = false;
      this._savePromise = null;
    }
  }

  /** Validation, the lint gate and the actual background save request. */
  async performSave() {
    this.flushLocaleKeyEdits();
    this._showMissingTranslations = false;
    this.syncLocaleKeysFromCode();
    const domainRaw = document.getElementById("inDomain").value.trim();
    const domain = domainRaw.includes(",") ? splitAndTrim(domainRaw).map((d) => this.cleanDomain(d)) : this.cleanDomain(domainRaw);
    const domainEmpty = Array.isArray(domain) ? domain.length === 0 : !domain;
    if (domainEmpty) {
      this.showMessage(i18n.t("userscript.editor.warn.emptyDomain"), "error");
      return;
    }
    const rawPatterns = document.getElementById("inUrlPatterns").value.trim() || ".*";
    const { normalizedList } = PatternValidator.processPatterns(rawPatterns);
    document.getElementById("editor").setAttribute("current", "0");

    // Falls back to the editor's literal parser for arrays/objects the crude
    // JSON fix cannot handle (e.g. t() descriptors inside option labels), and
    // resolves descriptor labels for the settings preview.
    function parseLiteralDefaultValue(src) {
      try {
        const value = new LiteralParser(src).parse();
        if (Array.isArray(value)) {
          return value.map((opt) =>
            opt && typeof opt === "object" && opt.label && typeof opt.label === "object" && opt.label.__type === "translation"
              ? { ...opt, label: resolveTranslation(opt.label.key) }
              : opt,
          );
        }
        return value;
      } catch {
        return src;
      }
    }

    function parseDefaultValue(rawDefaultValue) {
      let defaultValue = "";
      if (rawDefaultValue === undefined) return defaultValue;
      rawDefaultValue = rawDefaultValue.trim();

      // Translation descriptor default: t("key") -> resolved preview string
      const tDefaultMatch = /^t\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)$/.exec(rawDefaultValue);
      if (tDefaultMatch) return resolveTranslation(tDefaultMatch[2]);

      if (rawDefaultValue.startsWith("[{")) {
        const fixed = rawDefaultValue.replace(/(\w+)\s*:/g, '"$1":').replace(/'/g, '"');

        try {
          defaultValue = JSON.parse(fixed);
        } catch {
          defaultValue = parseLiteralDefaultValue(rawDefaultValue);
        }
      }

      // Process defaultValue
      // JSON array/object
      else if (rawDefaultValue.startsWith("[") || rawDefaultValue.startsWith("{")) {
        try {
          defaultValue = JSON.parse(rawDefaultValue);
        } catch {
          defaultValue = parseLiteralDefaultValue(rawDefaultValue);
        }
      }

      // Boolean
      else if (rawDefaultValue === "true") defaultValue = true;
      else if (rawDefaultValue === "false") defaultValue = false;
      // Number
      else if (!isNaN(rawDefaultValue)) defaultValue = Number(rawDefaultValue);
      // String
      else if (/^["'].*["']$/.test(rawDefaultValue)) {
        defaultValue = rawDefaultValue.slice(1, -1);
      } else {
        defaultValue = rawDefaultValue;
      }

      return defaultValue;
    }

    function extractSettingsFromCode(code) {
      // UseSettingParser matches brackets, so nested t() calls inside select
      // option arrays or t() text defaults are captured completely; plain
      // string labels keep the regex-free, lossless path as well.
      const settings = [];
      for (const call of new UseSettingParser().parse(code)) {
        // The label is emitted RAW (t() descriptor) so it survives storage and
        // the popup re-resolves it per `lang`; resolveTranslation stays for the
        // manager-only default-value preview below.
        const labelKey = UseSettingEditor.tCallKey(call.labelCall);
        const label = call.labelCall && labelKey !== null ? { __type: "translation", key: labelKey } : call.label;
        const defaultValue = call.defaultSrc ? parseDefaultValue(call.defaultSrc) : "";
        settings.push({
          key: call.key,
          label,
          type: call.type,
          defaultValue,
          value: defaultValue,
        });
      }
      return settings;
    }

    let iframeSelectors = null;
    const iframeSelectorsContainer = document.getElementById("iframeSelectorsContainer");

    if (!iframeSelectorsContainer.hidden) {
      const raw = this.iframeSelectorsEditor.getValue().trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (!parsed.fields || typeof parsed.fields !== "object") {
            this.showMessage('iframeSelectors: "fields" key is required.', "error");
            return;
          }
          iframeSelectors = parsed;
        } catch (e) {
          this.showMessage("iframeSelectors: Invalid JSON — " + e.message, "error");
          return;
        }
      }
    }

    const authorsData = splitAndTrim(document.getElementById("inAuthors").value);

    // Resolves a t("labelKey") setting label for the Advanced settings preview
    // against the current Translations table (chosen i18n language, en fallback).
    const resolveTranslation = (labelKey) => {
      // Same language selection and fallback chain as the runtime (mainParser.js).
      const locales = this.getLocalesSaveData() || {};
      return resolveTranslationDescriptor({ __type: "translation", key: labelKey }, locales, selectLocaleLang(locales, i18n.lang));
    };

    const script = {
      id: this.editingId || generateParserKey(domain, normalizedList, authorsData),
      title: document.getElementById("inTitle").value.trim(),
      version: `${parseInt(document.getElementById("inVersionMajor").value) || 0}.${parseInt(document.getElementById("inVersionMinor").value) || 0}.${parseInt(document.getElementById("inVersionPatch").value) || 0}`,
      description: document.getElementById("inDesc").value.trim(),
      authors: authorsData,
      authorsLinks: splitAndTrim(document.getElementById("inAuthorsLinks").value),
      domain,
      homepage: document.getElementById("inHomepage").value.trim(),
      urlPatterns: normalizedList,
      lastUpdated: Date.now(),
      runAt: "document_idle",
      code: this.codeEditor.getValue(),
      mode: this.inModeTom.getValue(),
      watchAutoDetect: document.getElementById("inWatchAutoDetect").value.trim(),
      iframeSelectors,
      category: (() => {
        const vals = this.categorySelect.getValue();
        if (!vals.length) return "";
        if (vals.length === 1) return vals[0];
        return vals;
      })(),
      tags: splitAndTrim(document.getElementById("inTags").value),
      debug: document.getElementById("inDebug").checked,
      settings: extractSettingsFromCode(this.codeEditor.getValue()),
    };

    // The description translation exists only when the script has a
    // description. Its English value is stored under locales.en["description"]
    // and script.description becomes a translation descriptor referencing that
    // key. The key is excluded from the "not in code" check since it is a
    // system key, not referenced via t() in code.
    const descRaw = document.getElementById("inDesc").value.trim();
    const en = (this.localesData.en ||= {});
    if (descRaw) {
      en["description"] = descRaw;
      script.description = { __type: "translation", key: "description" };
    } else {
      // No description: keep the plain empty string and drop any stale key.
      delete en["description"];
      if (!Object.keys(en).length) delete this.localesData.en;
    }

    const locales = this.getLocalesSaveData();
    if (locales) script.locales = locales;

    // Preserve store (repo) tracking fields of the script being edited so it
    // stays recognized as a repo script (list filtering, locked authors, sync)
    const originalScript = this.editingScript;
    if (originalScript?.storeFilePath) {
      script.source = originalScript.source ?? "store";
      script.storeSource = originalScript.storeSource;
      script.storeRepoId = originalScript.storeRepoId;
      script.storeRepoUrl = originalScript.storeRepoUrl;
      script.storeScriptId = originalScript.storeScriptId;
      script.storeFilePath = originalScript.storeFilePath;
      // Persisted marker that the user edited this repo script locally; stripped
      // on GitHub contribute (githubContributeService) and lost on repo updates
      script._localEdited = true;
    }

    // Validation
    if (!script.title) {
      this.showMessage(i18n.t("userscript.editor.warn.emptyName"), "error");
      return;
    }

    if (domainEmpty) {
      this.showMessage(i18n.t("userscript.editor.warn.emptyDomain"), "error");
      return;
    }

    if (!script.authors.length) {
      this.showMessage(i18n.t("userscript.editor.warn.emptyAuthors"), "error");
      return;
    }

    if (!script.code) {
      this.showMessage(i18n.t("userscript.editor.warn.emptyCode"), "error");
      return;
    }

    const validation = this.validateScriptCode(script.code);
    if (!validation.ok) {
      this.showMessage(validation.message, "error");
      return;
    }

    // URL Pattern Validation
    const { invalidPatterns } = PatternValidator.processPatterns(script.urlPatterns);
    if (invalidPatterns.length > 0) {
      this.showMessage(i18n.t("userscript.editor.warn.invalidPatterns") + " " + invalidPatterns.join(", "), "error");
      return;
    }

    // Lint gate: error-severity JSHint findings almost always mean the script
    // will not run. Give the user a chance to jump to the first error line
    // (hint: F8) or to save anyway.
    const lintErrorCount = this.lintAnnotations.filter((ann) => ann.severity === "error").length;
    if (lintErrorCount > 0) {
      const body = i18n.t("userscript.editor.warn.lintErrors.body", [lintErrorCount]);
      const proceed = await showConfirm(i18n.t("userscript.editor.warn.lintErrors.heading"), {
        type: "warn",
        body,
        labelOk: i18n.t("common.save"),
      });
      if (!proceed) {
        this.focusFirstLintError();
        this.showMessage(body, "error");
        return;
      }
    }

    this.showMessage(i18n.t("userscript.editor.status.saving"), "info");

    const response = await sendAction("saveUserScript", { script, previousId: this.editingId || null });

    if (response?.ok) {
      // Success refreshes the dirty state so list refresh / editor close paths
      // do not treat the saved content as unsaved changes.
      this._dirtyBaseline = this.snapshotEditorState();
      this.showMessage(i18n.t("userscript.editor.status.saved"), "success");
      await this.refreshList();
      return true;
    }
    this.showMessage(
      `${i18n.t("userscript.editor.warn.saveFailed")} ${response?.error?.startsWith("userscript.editor") ? i18n.t(response.error) : response?.error || "Unknown error"}`,
      "error",
    );
    return false;
  }

  validateScriptCode(code) {
    const requiredVars = ["title"];

    const missing = [];
    const unused = [];

    for (const v of requiredVars) {
      const declPattern = new RegExp(`\\b(const|let|var)\\s+${v}\\b`);

      // Undefined?
      if (!declPattern.test(code)) {
        missing.push(v);
      } else {
        // Defined but not used?
        const valueUsage = new RegExp(`${v}[^\\s=]`);
        if (!valueUsage.test(code)) unused.push(v);
      }
    }

    if (missing.length) {
      return {
        ok: false,
        message: `${i18n.t("userscript.editor.warn.missingVariables")} ${missing.join(", ")}`,
      };
    }

    return { ok: true };
  }

  async onEdit(id) {
    const script = await this.fetchScriptById(id);
    if (!script) return;
    this.showEditor(script);
  }

  async onRegisterToggle(id) {
    const script = await this.fetchScriptById(id);
    if (!script) return;

    const action = script.registered ? "unregister" : "register";
    const result = await sendAction(action, { id });

    if (result?.ok) {
      await this.refreshList();
    } else {
      showAlert(action, result?.error || "Unknown error", "warn");
    }
  }

  async onToggle(id) {
    const script = await this.fetchScriptById(id);
    if (!script) return;

    const newState = !script.registered ? true : !script.enabled;
    const result = await sendAction("toggleUserScript", { id, enabled: newState });

    if (result?.ok) {
      // Registration can fail while the enable state was stored.
      if (result.error) {
        showAlert(i18n.t("common.error"), result.error, "warn");
      }
      await this.refreshList();
    } else {
      showAlert("Toggle Failed", result?.error || "Unknown error", "warn");
    }
  }

  cleanDomain = (d) => {
    return d
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .trim();
  };

  async onDelete(id, title) {
    if (
      !(await showConfirm("", {
        heading: i18n.t("userscript.editor.confirm.delete") + `\n[${title}]`,
        body: "",
      }))
    )
      return;
    const result = await sendAction("deleteUserScript", { id });

    if (result?.ok) {
      await this.refreshList();
    } else {
      showAlert("Delete failed: ", result?.error || "Unknown error", "warn");
    }
  }

  /**
   * Serializes a value into a safe JavaScript double-quoted string literal.
   * JSON.stringify output is valid JS double-quoted string syntax for the
   * characters that matter here (quotes, backslashes, control chars, line
   * terminators). Backticks and ${} are harmless inside double quotes and
   * need no escaping.
   */
  _jsString(value) {
    return JSON.stringify(String(value ?? ""));
  }

  exportToRegisterParser(scripts) {
    return scripts
      .map((script) => {
        const codeIndented = script.code
          .split("\n")
          .map((line) => (line ? "    " + line : ""))
          .join("\n");
        const domains = [script.domain].flat().filter(Boolean);
        const domainStr = domains.length === 1 ? this._jsString(domains[0]) : `[${domains.map((d) => this._jsString(d)).join(", ")}]`;
        const urlPatterns = (script.urlPatterns || []).map((p) => (p.startsWith("/") ? p : `/${p}/`)).join(", ");
        const authors = Array.isArray(script.authors)
          ? script.authors
          : script.authors
            ? String(script.authors)
                .split(",")
                .map((a) => a.trim())
                .filter(Boolean)
            : [];
        const authorsLinks = Array.isArray(script.authorsLinks)
          ? script.authorsLinks
          : script.authorsLinks
            ? String(script.authorsLinks)
                .split(",")
                .map((a) => a.trim())
                .filter(Boolean)
            : [];
        const authorsStr = authors.length ? `\n  authors: [${authors.map((a) => this._jsString(a)).join(", ")}],` : "";
        const authorsLinksStr = authorsLinks.length ? `\n  authorsLinks: [${authorsLinks.map((a) => this._jsString(a)).join(", ")}],` : "";
        const iframeSelectorsStr = script.iframeSelectors ? `\n  iframeSelectors: ${JSON.stringify(script.iframeSelectors, null, 2).split("\n").join("\n  ")},` : "";
        const locales = script.locales && typeof script.locales === "object" ? script.locales : null;
        const localesStr = locales && Object.keys(locales).length ? `\n  locales: ${JSON.stringify(locales, null, 2).split("\n").join("\n  ")},` : "";
        const tags = Array.isArray(script.tags)
          ? script.tags
          : script.tags
            ? String(script.tags)
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : [];
        const tagsStr = tags.length ? `\n  tags: [${tags.map((t) => this._jsString(t)).join(", ")}],` : "";
        const category = Array.isArray(script.category)
          ? script.category
          : script.category
            ? String(script.category)
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean)
            : [];
        const categoryStr = category.length ? `\n  category: [${category.map((c) => this._jsString(c)).join(", ")}],` : "";
        const homepageStr = script.homepage ? `\n  homepage: ${this._jsString(script.homepage)},` : "";

        return `registerParser({
  id: ${this._jsString(script.id)},
  domain: ${domainStr},${authorsStr}${authorsLinksStr}
  title: ${this._jsString(script.title)},
  version: ${this._jsString(script.version || "1.0.0")},
  description: ${this._jsString(resolveScriptDescription(script))},
  lastUpdated: ${this._jsString(script.lastUpdated || "")},
  mode: ${this._jsString(script.mode || "listen")},
  watchAutoDetect: ${this._jsString(script.watchAutoDetect || "disable")},${homepageStr}${categoryStr}${tagsStr}
  urlPatterns: [${urlPatterns}],${iframeSelectorsStr}${localesStr}
  fn: async function () {
${codeIndented}
  },
});`;
      })
      .join("\n\n");
  }

  // registerParser.js -> JSON
  importFromRegisterParser(jsText) {
    const scripts = [];

    let i = 0;
    while (i < jsText.length) {
      const callIdx = jsText.indexOf("registerParser(", i);
      if (callIdx === -1) break;

      const afterCall = callIdx + "registerParser(".length;
      let k = afterCall;
      while (k < jsText.length && (jsText[k] === " " || jsText[k] === "\t" || jsText[k] === "\n" || jsText[k] === "\r")) k++;
      if (jsText[k] !== "{") {
        i = callIdx + 1;
        continue;
      }

      const blockStart = k;
      const blockEnd = matchBalancedBrace(jsText, blockStart);

      if (blockEnd === -1) {
        i = callIdx + 1;
        continue;
      }

      const block = jsText.slice(blockStart + 1, blockEnd);
      i = blockEnd + 1;

      // string field helper
      const extractStr = (key) => new RegExp(`\\b${key}:\\s*["'\`](.*?)["'\`]`).exec(block)?.[1] ?? "";

      // domain: string or array
      let domain;
      const domainArrayMatch = /\bdomain:\s*\[([\s\S]*?)\]/.exec(block);
      const domainStringMatch = /\bdomain:\s*["'`](.*?)["'`]/.exec(block);
      if (domainArrayMatch) {
        const arr = domainArrayMatch[1]
          .split(",")
          .map((d) => d.trim().replace(/^["'`]|["'`]$/g, ""))
          .filter(Boolean)
          .map((d) => this.cleanDomain(d));
        domain = arr.length === 1 ? arr[0] : arr;
      } else if (domainStringMatch) {
        domain = this.cleanDomain(domainStringMatch[1]);
      } else {
        domain = "";
      }

      // urlPatterns
      const urlPatternsRaw = /\burlPatterns:\s*\[([\s\S]*?)\]/.exec(block)?.[1] ?? "";
      const urlPatterns = urlPatternsRaw
        .split(",")
        .map((p) => p.trim().replace(/^\/|\/$/g, ""))
        .filter(Boolean);

      // tags: ["a", "b"] array
      let tags = [];
      const tagsArrayMatch = /\btags:\s*\[([\s\S]*?)\]/.exec(block);
      if (tagsArrayMatch) {
        tags = tagsArrayMatch[1]
          .split(",")
          .map((t) => t.trim().replace(/^["'`]|["'`]$/g, ""))
          .filter(Boolean);
      }

      // category: string or array
      let category = extractStr("category");
      const categoryArrayMatch = /\bcategory:\s*\[([\s\S]*?)\]/i.exec(block);
      if (categoryArrayMatch?.[1] !== undefined) {
        category = categoryArrayMatch[1]
          .split(",")
          .map((c) => c.trim().replace(/^["'`]|["'`]$/g, ""))
          .filter(Boolean);
      } else if (category) {
        category = [category];
      } else {
        category = [];
      }

      // iframeSelectors: balanced brace match
      let iframeSelectors = null;
      const iframeIdx = block.indexOf("iframeSelectors:");
      if (iframeIdx !== -1) {
        let depth2 = 0,
          objStart = -1,
          k = iframeIdx;
        while (k < block.length) {
          if (block[k] === "{") {
            if (objStart === -1) objStart = k;
            depth2++;
          } else if (block[k] === "}") {
            depth2--;
            if (depth2 === 0 && objStart !== -1) {
              try {
                iframeSelectors = JSON.parse(block.slice(objStart, k + 1));
              } catch (_) {}
              break;
            }
          }
          k++;
        }
      }

      // locales: nested { lang: { key: "value" } } (balanced brace match, JSON first)
      let locales = null;
      const localesIdx = block.indexOf("locales:");
      if (localesIdx !== -1) {
        const localesOpen = block.indexOf("{", localesIdx);
        if (localesOpen !== -1) {
          const localesEnd = matchBalancedBrace(block, localesOpen);
          if (localesEnd !== -1) {
            locales = parseLocalesObjectText(block.slice(localesOpen, localesEnd + 1));
          }
        }
      }

      // fn body: quote-aware balanced brace match + 2-space dedent, so braces
      // inside string literals in the code cannot truncate the body.
      let code = "";
      const fnIdx = block.search(/\bfn:\s*(async\s+)?function\s*\(\s*\)/);
      if (fnIdx !== -1) {
        const fnBodyStart = block.indexOf("{", fnIdx);
        const fnBodyEnd = fnBodyStart !== -1 ? matchBalancedBrace(block, fnBodyStart) : -1;
        if (fnBodyEnd !== -1) {
          code = block
            .slice(fnBodyStart + 1, fnBodyEnd)
            .split("\n")
            .map((line) => (line.startsWith("    ") ? line.slice(4) : line))
            .join("\n")
            .trim();
        }
      }

      // authors: string or array
      let authors = extractStr("authors");
      const authorsArrayMatch = /\bauthors:\s*\[([\s\S]*?)\]/i.exec(block);
      if (authorsArrayMatch?.[1] !== undefined) {
        authors = authorsArrayMatch[1]
          .split(",")
          .map((a) => a.trim().replace(/^["'`]|["'`]$/g, ""))
          .filter(Boolean);
      } else if (authors) {
        authors = splitAndTrim(authors);
      } else {
        authors = [];
      }

      // authorsLinks: string or array
      let authorsLinks = extractStr("authorsLinks");
      const authorsLinksArrayMatch = /\bauthorsLinks:\s*\[([\s\S]*?)\]/i.exec(block);
      if (authorsLinksArrayMatch?.[1] !== undefined) {
        authorsLinks = authorsLinksArrayMatch[1]
          .split(",")
          .map((a) => a.trim().replace(/^["'`]|["'`]$/g, ""))
          .filter(Boolean);
      } else if (authorsLinks) {
        authorsLinks = splitAndTrim(authorsLinks);
      } else {
        authorsLinks = [];
      }

      scripts.push({
        title: extractStr("title"),
        description: extractStr("description"),
        domain,
        homepage: extractStr("homepage"),
        authors,
        authorsLinks,
        urlPatterns,
        mode: extractStr("mode") || "listen",
        watchAutoDetect: extractStr("watchAutoDetect") || "disable",
        category,
        tags,
        iframeSelectors,
        ...(locales && { locales }),
        code,
        id: extractStr("id") || generateParserKey(domain, urlPatterns, authors),
        lastUpdated: extractStr("lastUpdated"),
        runAt: "document_idle",
        registered: false,
      });
    }

    return scripts;
  }

  // Import userScript
  async handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const scripts = this.importFromRegisterParser(text);

      if (!Array.isArray(scripts)) throw new Error("Invalid format: expected array");
      if (scripts.length === 0) {
        showAlert("Import failed", i18n.t("userscript.import.noValidBlocks"), "warn");
        return;
      }

      const existingResp = await sendAction("listUserScripts");
      const existing = existingResp?.list || [];

      const duplicates = scripts.filter((s) => existing.some((ex) => ex.id === s.id || (ex.title === s.title && ex.domain?.toString() === s.domain?.toString())));
      const newScripts = scripts.filter((s) => !existing.some((ex) => ex.id === s.id || (ex.title === s.title && ex.domain?.toString() === s.domain?.toString())));

      const { duplicates: dupChoices, newScripts: newChoices } = await this.showImportModalSelection(duplicates, newScripts, existing);

      await this.refreshList?.();
    } catch (err) {
      showAlert("Import failed", err.message || "Unknown error", "warn");
    } finally {
      e.target.value = "";
    }
  }

  async showImportModalSelection(duplicates, newScripts, existing) {
    return new Promise((resolve) => {
      const { modal, content } = createModal();

      const title = document.createElement("h2");
      title.textContent = i18n.t("userscript.import.title");
      content.appendChild(title);

      const contentWrapper = document.createElement("div");
      contentWrapper.className = "modal-content-wrapper";
      contentWrapper.id = "importModalBody";
      content.appendChild(contentWrapper);

      // List Sections
      const sections = [];

      if (duplicates.length) {
        sections.push({
          header: i18n.t("userscript.import.conflict"),
          list: duplicates,
          prefix: "dup",
          options: [
            ["overwrite", i18n.t("userscript.import.conflict.overwrite")],
            ["skip", i18n.t("button.skip")],
          ],
        });
      }

      if (newScripts.length) {
        sections.push({
          header: i18n.t("userscript.import.new"),
          list: newScripts,
          prefix: "new",
          options: [
            ["add", i18n.t("userscript.import.conflict.add")],
            ["skip", i18n.t("button.skip")],
          ],
        });
      }

      sections.forEach((sec) => {
        const div = document.createElement("div");
        div.className = "section";
        const header = document.createElement("h4");
        header.textContent = sec.header;
        div.appendChild(header);
        sec.list.forEach((s, i) => div.appendChild(this.createSelectItem(s, i, sec.prefix, sec.options)));
        contentWrapper.appendChild(div);
      });

      const duplicateButtons = this.createGroupButtons([
        { text: i18n.t("userscript.import.conflict.overwrite.text"), list: duplicates, prefix: "dup", value: "overwrite" },
        { text: i18n.t("userscript.import.conflict.skip.text"), list: duplicates, prefix: "dup", value: "skip" },
      ]);

      const newButtons = this.createGroupButtons([
        { text: i18n.t("userscript.import.new.all"), list: newScripts, prefix: "new", value: "add" },
        { text: i18n.t("userscript.import.new.skip"), list: newScripts, prefix: "new", value: "skip" },
      ]);

      if (duplicates.length) {
        content.appendChild(duplicateButtons);
      }
      if (newScripts.length) {
        content.appendChild(newButtons);
      }

      // Result
      let importFinished = true;
      const resultContainer = document.createElement("div");
      resultContainer.className = "result-container";
      content.appendChild(resultContainer);

      // Confirm & Close
      const confirmBtn = this.createButton(i18n.t("userscript.import.confirm"), async () => {
        if (importFinished) {
          importFinished = false;
          confirmBtn.textContent = i18n.t("common.wait");
          this.saveUserSelection(duplicates, "dup");
          this.saveUserSelection(newScripts, "new");
          const results = await this.processImport([...duplicates, ...newScripts], existing);
          this.showResults(resultContainer, results);
          confirmBtn.textContent = i18n.t("userscript.import.confirm");
          importFinished = true;
          contentWrapper.remove();
        }
      });
      confirmBtn.className = "btn confirm-button";

      const closeBtn = this.createButton(i18n.t("common.close"), async () => {
        if (importFinished) {
          window.removeEventListener("click", onWindowClick);
          modal.remove();
          resolve({ duplicates, newScripts });
        }
      });

      closeBtn.className = "btn close-btn";
      const buttonContainer = document.createElement("div");
      buttonContainer.className = "button-group footer-buttons";
      buttonContainer.append(confirmBtn, closeBtn);
      content.appendChild(buttonContainer);
      document.body.appendChild(modal);
      activateSimpleBar("importModalBody");

      // addEventListener keeps pre-existing window click handlers intact.
      const onWindowClick = (ev) => {
        if (importFinished && ev.target === modal) closeViaOutside();
      };
      const closeViaOutside = () => {
        window.removeEventListener("click", onWindowClick);
        modal.remove();
        resolve({ duplicates, newScripts });
      };
      window.addEventListener("click", onWindowClick);
    });
  }

  async processImport(scripts, existing) {
    const results = [];
    for (const s of scripts) {
      if (!s.title || !s.code) {
        results.push({ ...s, status: "error" });
        continue;
      }
      if (s.choice === "skip") {
        results.push({ ...s, status: "skipped" });
        continue;
      }

      const match = existing.find((ex) => ex.domain === s.domain && ex.title === s.title);
      if (match) s.id = match.id;

      const res = await sendAction("saveUserScript", { script: s, fromImport: true });
      results.push({ ...s, status: res?.ok ? "success" : "error" });
      await scriptManager.registerAllScripts();
    }
    return results;
  }

  showResults(container, results) {
    document.querySelectorAll(".section,.button-group:not(.footer-buttons),.confirm-button").forEach((el) => el.remove());
    document.querySelector(".modal h2").textContent = i18n.t("common.results");
    const ul = document.createElement("ul");
    ul.id = "importResultList";

    results.forEach((r) => {
      const li = document.createElement("li");
      li.classList.add(r.status);
      const status = document.createElement("div");
      status.textContent = `${i18n.t("userscript.export.status." + r.status)}`;
      status.classList.add("status-text");
      const title = document.createElement("div");
      title.textContent = r.title || "(no title)";
      title.classList.add("script-title");
      const domain = document.createElement("div");
      domain.textContent = ` - ${r.domain || ""}`;
      domain.classList.add("script-domain");

      li.append(status, title, domain);
      ul.appendChild(li);
    });
    container.appendChild(ul);
    activateSimpleBar("importResultList");
  }

  createSelectItem(script, index, prefix, options) {
    const wrap = document.createElement("div");
    wrap.className = "import-item";

    const label = document.createElement("span");
    label.className = "import-item-label";
    label.textContent = `${script.title || "(no title)"} (${script.domain || "unknown"})`;

    const select = document.createElement("select");
    select.id = `${prefix}_${index}`;
    options.forEach(([val, text]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = text;
      select.appendChild(opt);
    });

    wrap.append(label, select);
    return wrap;
  }

  saveUserSelection(list, prefix) {
    list.forEach((item, i) => {
      const sel = document.getElementById(`${prefix}_${i}`);
      if (sel) item.choice = sel.value;
    });
  }

  createButton(text, onClick) {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.className = "btn btn-action";
    if (onClick) btn.onclick = onClick;
    return btn;
  }

  createGroupButtons(groups) {
    const container = document.createElement("div");
    container.className = "button-group";
    groups.forEach(({ text, list, prefix, value }) => {
      const btn = this.createButton(text, () => {
        // Update the button's active state
        container.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        // Apply the selection operation
        this.applyChoiceToAll(list, prefix, value);
      });

      container.appendChild(btn);
    });

    return container;
  }

  applyChoiceToAll(list, prefix, value) {
    list.forEach((item, i) => {
      item.choice = value;
      const sel = document.getElementById(`${prefix}_${i}`);
      if (sel) sel.value = value;
    });
  }

  // Export userScript
  async handleExport(options = { type: "all", scriptId: null }) {
    const params = this.activeTab === "repo" ? { showOnlyStore: true } : this.activeTab === "edited" ? { showStoreParsers: true } : {};
    const resp = await sendAction("listUserScripts", params);
    let scripts = resp?.list || [];
    if (this.activeTab === "edited") scripts = scripts.filter((script) => script._localEdited);

    if (!scripts.length) {
      showAlert(i18n.t("userscript.export.warn.noScripts"), "", "warn");
      return;
    }

    // Single export
    if (options.type === "single" && options.scriptId) {
      scripts = scripts.filter((s) => s.id === options.scriptId);
      if (!scripts.length) {
        showAlert(i18n.t("userscript.export.warn.notFound"), "", "warn");
        return;
      }
    }

    let fileName;

    const dataStr = this.exportToRegisterParser(scripts);
    if (options.type === "single") {
      fileName = `web-presence-userScript-${scripts[0].title || "script"}.js`;
    } else {
      fileName = `web-presence-userScripts-${new Date().toISOString().split("T")[0]}.js`;
    }

    downloadBlob(dataStr, fileName, "text/javascript");
    showAlert(i18n.t("backup.export.complete"));
  }

  // Export Menu
  exportMenuClick(e) {
    const li = e.target.closest("li.script-item");
    const scriptId = li?.dataset?.id || null;
    const isSingle = !!scriptId;
    this.handleExport(isSingle ? { type: "single", scriptId } : { type: "all" });
  }

  // GitHub Contribute
  async onContribute(id) {
    const script = await this.fetchScriptById(id);
    if (!script) return;

    let token = await githubContributeService.getToken();
    if (!token) {
      token = await this.showDeviceFlowModal();
      if (!token) return;
    }

    let upstreamInfo = null;
    try {
      upstreamInfo = await githubContributeService.fetchUpstreamScriptInfo(script, token);
    } catch (err) {
      logError("[userScriptManager]: Unable to retrieve upstream information", err);
      this._showUpstreamFetchErrorModal(err);
      return;
    }

    // If upstream information is available, perform a version comparison
    if (upstreamInfo && upstreamInfo.version) {
      const versionCmp = githubContributeService._compareVersions(upstreamInfo.version, script.version || "1.0.0");

      // If the version in the repo is equal to or newer than the local version, block it
      if (versionCmp >= 0) {
        this._showVersionBlockModal(script, upstreamInfo);
        return;
      }
    }

    // Show the confirmation modal
    const confirmResult = await this.showContributeConfirmModal(script, upstreamInfo);
    if (!confirmResult || !confirmResult.confirmed) return;

    // Initiate the PR submission process
    await this.runContributeFlow(script, token, confirmResult.commitMessage);
  }

  _showVersionBlockModal(script, upstreamInfo) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.style.display = "flex";

    const content = document.createElement("div");
    content.className = "modal-content contribute-confirm-content";

    const title = document.createElement("h2");
    title.textContent = i18n.t("userscript.contribute.version.blocked.title");

    const msg = document.createElement("p");
    msg.className = "contribute-status error";
    msg.textContent = i18n.t("userscript.contribute.version.blocked.message", { ver: script.version || "1.0.0", repover: upstreamInfo.version || "?" });

    const hint = document.createElement("p");
    hint.className = "contribute-confirm-desc";
    hint.textContent = i18n.t("userscript.contribute.version.blocked.hint");

    const btnRow = document.createElement("div");
    btnRow.className = "button-group footer-buttons";

    const editBtn = document.createElement("button");
    editBtn.className = "btn confirm-button";
    editBtn.textContent = i18n.t("common.edit");

    const closeBtn = document.createElement("button");
    closeBtn.className = "btn close-btn";
    closeBtn.textContent = i18n.t("common.close");

    editBtn.addEventListener("click", () => {
      modal.remove();
      // Open editor for this script
      this.onEdit(script.id);
    });

    closeBtn.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    btnRow.append(editBtn, closeBtn);
    content.append(title, msg, hint, btnRow);
    modal.appendChild(content);
    document.body.appendChild(modal);
  }

  _showUpstreamFetchErrorModal(err) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.style.display = "flex";
    modal.style.zIndex = "10000";

    const content = document.createElement("div");
    content.className = "modal-content contribute-confirm-content";

    const title = document.createElement("h2");
    title.textContent = i18n.t("userscript.contribute.upstream.error.title");

    const msg = document.createElement("p");
    msg.className = "contribute-status error";
    msg.textContent = i18n.t("userscript.contribute.upstream.error.message");

    const hint = document.createElement("p");
    hint.className = "contribute-confirm-desc";
    hint.textContent = err.message || "";

    const btnRow = document.createElement("div");
    btnRow.className = "button-group footer-buttons";

    const closeBtn = document.createElement("button");
    closeBtn.className = "btn close-btn";
    closeBtn.textContent = i18n.t("common.close");

    closeBtn.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    btnRow.appendChild(closeBtn);
    content.append(title, msg, hint, btnRow);
    modal.appendChild(content);
    document.body.appendChild(modal);
  }

  async showContributeConfirmModal(script, upstreamInfo = null) {
    return new Promise((resolve) => {
      const isUpdate = !!upstreamInfo;
      const isDifferentAuthor = isUpdate && githubContributeService.isDifferentAuthor(script, upstreamInfo);

      const modal = document.createElement("div");
      modal.className = "modal";
      modal.style.display = "flex";

      const content = document.createElement("div");
      content.className = "modal-content contribute-confirm-content";

      const title = document.createElement("h2");
      title.textContent = isUpdate ? i18n.t("userscript.contribute.confirm.titleUpdate") : i18n.t("userscript.contribute.confirm.title");

      const desc = document.createElement("p");
      desc.className = "contribute-confirm-desc";
      desc.textContent = isUpdate ? i18n.t("userscript.contribute.confirm.descriptionUpdate") : i18n.t("userscript.contribute.confirm.description");

      if (isDifferentAuthor) {
        const authorWarn = document.createElement("p");
        authorWarn.className = "contribute-status error contribute-author-warn";
        authorWarn.textContent = i18n.t("userscript.contribute.confirm.differentAuthor", { authors: upstreamInfo.authors.join(", ") });
        content.appendChild(authorWarn);
      }

      if (isUpdate) {
        const filePath = upstreamInfo?.filePath ?? githubContributeService.getFilePath(script);
        const targetUrl = `https://github.com/${GITHUB_CONTRIBUTE.UPSTREAM_OWNER}/${GITHUB_CONTRIBUTE.UPSTREAM_REPO}/blob/main/${filePath}`;
        const compareContainer = document.createElement("div");
        compareContainer.className = "contribute-compare";

        // Header row
        const headerRow = document.createElement("div");
        headerRow.className = "contribute-compare-row contribute-compare-header";
        ["", i18n.t("userscript.contribute.confirm.inRepo"), i18n.t("userscript.contribute.confirm.yours")].forEach((text) => {
          const cell = document.createElement("span");
          cell.className = "contribute-compare-cell";
          cell.textContent = text;
          headerRow.appendChild(cell);
        });
        compareContainer.appendChild(headerRow);

        // Data rows
        const compareRows = [
          [i18n.t("userscript.editor.scriptName.label"), upstreamInfo.title, script.title],
          [i18n.t("userscript.editor.version.label"), upstreamInfo.version, script.version || "1.0.0"],
          [i18n.t("userscript.editor.authors.label"), upstreamInfo.authors.join(", "), [script.authors].flat().join(", ")],
        ];

        compareRows.forEach(([label, repoVal, yourVal]) => {
          const row = document.createElement("div");
          row.className = "contribute-compare-row";

          const labelCell = document.createElement("span");
          labelCell.className = "contribute-compare-cell contribute-compare-label";
          labelCell.textContent = label.replace(/:$/, "");

          const repoCell = document.createElement("span");
          repoCell.className = "contribute-compare-cell";
          repoCell.textContent = repoVal || "—";

          const yoursCell = document.createElement("span");
          yoursCell.className = "contribute-compare-cell";
          yoursCell.textContent = yourVal || "—";
          if (repoVal !== yourVal) yoursCell.classList.add("changed");

          row.append(labelCell, repoCell, yoursCell);
          compareContainer.appendChild(row);
        });

        const targetRow = document.createElement("div");
        targetRow.className = "contribute-compare-row";

        const targetLabel = document.createElement("span");
        targetLabel.className = "contribute-compare-cell contribute-compare-label";
        targetLabel.textContent = i18n.t("userscript.contribute.confirm.filePath");

        const targetLink = document.createElement("a");
        targetLink.href = targetUrl;
        targetLink.textContent = filePath;
        targetLink.target = "_blank";
        targetLink.rel = "noopener noreferrer";
        targetLink.className = "contribute-file-link link";

        const targetCell = document.createElement("span");
        targetCell.className = "contribute-compare-cell contribute-compare-cell--colspan";
        targetCell.appendChild(targetLink);

        targetRow.append(targetLabel, targetCell);
        compareContainer.appendChild(targetRow);

        content.append(title, desc, compareContainer);
      } else {
        const table = document.createElement("table");
        table.className = "contribute-confirm-table";

        const filePath = githubContributeService.getFilePath(script);
        const domains = [script.domain].flat().filter(Boolean).join(", ");
        const authors = [script.authors].flat().filter(Boolean).join(", ");

        const rows = [
          [i18n.t("userscript.editor.scriptName.label"), script.title],
          [i18n.t("userscript.editor.version.label"), script.version || "1.0.0"],
          [i18n.t("userscript.editor.domains.label"), domains],
          [i18n.t("userscript.editor.authors.label"), authors || "—"],
          [i18n.t("userscript.editor.activityMode.label"), script.mode || "listen"],
          [i18n.t("userscript.contribute.confirm.filePath"), filePath],
        ];

        if (script.description) {
          const descText = resolveScriptDescription(script);
          rows.splice(2, 0, [i18n.t("userscript.editor.description.label"), descText]);
        }

        rows.forEach(([label, value]) => {
          const tr = document.createElement("tr");
          const th = document.createElement("th");
          th.textContent = label.replace(/:$/, "");
          const td = document.createElement("td");
          td.textContent = value;
          tr.append(th, td);
          table.appendChild(tr);
        });

        content.append(title, desc, table);
      }

      // Commit Message Input Field
      const defaultCommitMsg = githubContributeService.getDefaultCommitMessage(script, isUpdate);

      const commitGroup = document.createElement("div");
      commitGroup.className = "form-row contribute-commit-group";
      commitGroup.style.margin = "12px 0";

      const commitLabel = document.createElement("label");
      commitLabel.textContent = i18n.t("userscript.contribute.confirm.commitMessage");
      commitLabel.style.display = "block";
      commitLabel.style.marginBottom = "4px";

      const commitInput = document.createElement("input");
      commitInput.type = "text";
      commitInput.className = "input";
      commitInput.value = defaultCommitMsg;
      commitInput.style.width = "100%";

      commitGroup.append(commitLabel, commitInput);
      content.appendChild(commitGroup);

      const btnRow = document.createElement("div");
      btnRow.className = "button-group footer-buttons";

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn close-btn";
      cancelBtn.textContent = i18n.t("common.cancel");

      const submitBtn = document.createElement("button");
      submitBtn.className = "btn confirm-button";
      submitBtn.textContent = isUpdate ? i18n.t("userscript.contribute.confirm.submitUpdate") : i18n.t("userscript.contribute.confirm.submit");

      cancelBtn.addEventListener("click", () => {
        modal.remove();
        resolve(null);
      });
      submitBtn.addEventListener("click", () => {
        const customCommitMsg = commitInput.value.trim() || defaultCommitMsg;
        modal.remove();
        resolve({ confirmed: true, commitMessage: customCommitMsg });
      });
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          modal.remove();
          resolve(null);
        }
      });

      btnRow.append(cancelBtn, submitBtn);
      content.appendChild(btnRow);
      modal.appendChild(content);
      document.body.appendChild(modal);
    });
  }

  async runContributeFlow(script, token, customCommitMessage = null) {
    const modal = this.createContributeModal(script);
    document.body.appendChild(modal);

    const statusEl = modal.querySelector(".contribute-status");
    const prLinkEl = modal.querySelector(".contribute-pr-link");
    const closeBtn = modal.querySelector(".contribute-close");
    const retryBtn = modal.querySelector(".contribute-retry");
    const reAuthBtn = modal.querySelector(".contribute-reauth");

    closeBtn.addEventListener("click", () => modal.remove());

    const STATUS_LABELS = {
      validating: i18n.t("userscript.contribute.status.validating"),
      forking: i18n.t("userscript.contribute.status.forking"),
      syncing: i18n.t("userscript.contribute.status.syncing"),
      branching: i18n.t("userscript.contribute.status.branching"),
      checking: i18n.t("userscript.contribute.status.checking"),
      pushing: i18n.t("userscript.contribute.status.pushing"),
      opening_pr: i18n.t("userscript.contribute.status.opening_pr"),
    };

    const run = async (token) => {
      statusEl.className = "contribute-status loading";
      statusEl.textContent = STATUS_LABELS.validating;
      prLinkEl.hidden = true;
      retryBtn.hidden = true;
      reAuthBtn.hidden = true;

      try {
        const { prUrl, isUpdate, skipped } = await githubContributeService.contribute(
          script,
          token,
          (step) => {
            statusEl.textContent = STATUS_LABELS[step] || step;
          },
          customCommitMessage,
        );

        if (skipped) {
          statusEl.className = "contribute-status warning";
          statusEl.textContent = i18n.t("userscript.contribute.status.noChanges");
          prLinkEl.href = prUrl;
          prLinkEl.hidden = false;
          prLinkEl.textContent = prUrl;
          return;
        }

        statusEl.className = "contribute-status success";
        statusEl.textContent = isUpdate ? i18n.t("userscript.contribute.status.successUpdate") : i18n.t("userscript.contribute.status.success");
        prLinkEl.href = prUrl;
        prLinkEl.hidden = false;
        prLinkEl.textContent = prUrl;
      } catch (err) {
        statusEl.className = "contribute-status error";

        // Auth Errors
        const isAuthError = err.status === 401 || err.message.includes("Bad credentials") || err.message.includes("requires authentication");

        if (isAuthError) {
          statusEl.textContent = i18n.t("userscript.contribute.status.authFailed");
          retryBtn.hidden = false;
          reAuthBtn.hidden = false;
          return;
        }

        // Fork Timeout
        if (err.message.includes("Fork is taking too long")) {
          statusEl.textContent = i18n.t("userscript.contribute.error.forkTimeout");
          retryBtn.hidden = false;
          reAuthBtn.hidden = true;
          return;
        }

        // Rate Limit
        if (err.status === 429 || err.message.includes("rate limit") || err.message.includes("secondary rate")) {
          statusEl.textContent = i18n.t("userscript.contribute.error.rateLimited");
          retryBtn.hidden = false;
          reAuthBtn.hidden = true;
          return;
        }
        // PR Already Exists
        if (err.message.includes("pull request already exists") || (err.message.includes("Validation Failed") && err.message.includes("PullRequest"))) {
          statusEl.className = "contribute-status success";
          statusEl.textContent = i18n.t("userscript.contribute.status.successUpdate");
          retryBtn.hidden = true;
          reAuthBtn.hidden = true;
          return;
        }

        // PR Same Version
        if (err.message === "VERSION_SAME") {
          statusEl.className = "contribute-status error";
          statusEl.textContent = i18n.t("userscript.contribute.status.versionSame", {
            branchVersion: err.branchVersion,
          });
          retryBtn.hidden = true;
          reAuthBtn.hidden = true;
          return;
        }

        // Open PR has a higher version than what we're trying to commit
        if (err.message === "VERSION_OUTDATED") {
          statusEl.className = "contribute-status error";
          statusEl.textContent = i18n.t("userscript.contribute.status.versionOutdated", {
            branchVersion: err.branchVersion,
          });
          retryBtn.hidden = true;
          reAuthBtn.hidden = true;
          return;
        }

        // Already Up To Date
        if (err.message === "ALREADY_UP_TO_DATE") {
          statusEl.className = "contribute-status warning";
          statusEl.textContent = i18n.t("userscript.contribute.status.alreadyUpToDate");
          retryBtn.hidden = true;
          reAuthBtn.hidden = true;
          return;
        }

        // Unchanged Code
        if (err.message === "CODE_UNCHANGED") {
          statusEl.className = "contribute-status warning";
          statusEl.textContent = i18n.t("userscript.contribute.status.codeUnchanged");
          retryBtn.hidden = true;
          reAuthBtn.hidden = true;
          return;
        }

        // Network / Generic
        statusEl.textContent = err.message || i18n.t("userscript.contribute.error.unknown");
        retryBtn.hidden = false;
        reAuthBtn.hidden = true;
      }
    };

    retryBtn.addEventListener("click", () => run(token));
    reAuthBtn.addEventListener("click", async () => {
      modal.remove();
      await githubContributeService.clearToken();
      const newToken = await this.showDeviceFlowModal();
      if (newToken) {
        token = newToken;
        await this.runContributeFlow(script, token);
      }
    });

    await run(token);
  }

  createContributeModal(script) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.style.display = "flex";

    const content = document.createElement("div");
    content.className = "modal-content contribute-modal-content";

    const title = document.createElement("h2");
    title.textContent = i18n.t("userscript.contribute.modal.title");

    const scriptName = document.createElement("p");
    scriptName.className = "contribute-script-name";
    scriptName.textContent = script.title;

    const statusEl = document.createElement("p");
    statusEl.className = "contribute-status loading";
    statusEl.textContent = i18n.t("userscript.contribute.status.starting");

    const prLinkEl = document.createElement("a");
    prLinkEl.className = "contribute-pr-link link";
    prLinkEl.target = "_blank";
    prLinkEl.rel = "noopener noreferrer";
    prLinkEl.hidden = true;

    const btnRow = document.createElement("div");
    btnRow.className = "button-group footer-buttons";

    const retryBtn = document.createElement("button");
    retryBtn.className = "contribute-retry btn";
    retryBtn.textContent = i18n.t("setup.permission.grant.retry");
    retryBtn.hidden = true;

    const reAuthBtn = document.createElement("button");
    reAuthBtn.className = "contribute-reauth btn";
    reAuthBtn.textContent = i18n.t("userscript.contribute.reauth");
    reAuthBtn.hidden = true;

    const closeBtn = document.createElement("button");
    closeBtn.className = "contribute-close btn close-btn";
    closeBtn.textContent = i18n.t("common.close");

    btnRow.append(retryBtn, reAuthBtn, closeBtn);
    content.append(title, scriptName, statusEl, prLinkEl, btnRow);
    modal.appendChild(content);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    return modal;
  }

  async refreshGithubAuthBadge() {
    const btn = document.getElementById("btnGithubSettings");
    if (!btn) return;
    const token = await githubContributeService.getToken();

    btn.classList.toggle("github-connected", !!token);
    btn.title = token ? i18n.t("userscript.contribute.oauth.connectedTitle") : i18n.t("userscript.contribute.oauth.connectTitle");

    // Clear existing avatar if any
    btn.querySelector(".github-avatar")?.remove();
    btn.querySelector("svg")?.remove();

    if (token) {
      const user = await githubContributeService.getCachedUser();
      if (user?.avatar_url) {
        const avatar = document.createElement("img");
        avatar.className = "github-avatar";
        avatar.src = user.avatar_url;
        avatar.alt = user.login || "";
        avatar.width = 20;
        avatar.height = 20;
        btn.appendChild(avatar);
      } else {
        btn.appendChild(createSVG(svg_paths.githubIconPaths));
      }
    } else {
      btn.appendChild(createSVG(svg_paths.githubIconPaths));
    }
  }

  async onGithubSettingsClick() {
    const token = await githubContributeService.getToken();
    if (token) {
      await this.showGithubConnectedModal();
    } else {
      const newToken = await this.showDeviceFlowModal();
      if (newToken) this.refreshGithubAuthBadge();
    }
  }

  showGithubConnectedModal() {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "modal";
      modal.style.display = "flex";

      const content = document.createElement("div");
      content.className = "modal-content github-connected-content";

      const title = document.createElement("h2");
      title.textContent = i18n.t("userscript.contribute.oauth.connectedTitle");

      const userEl = document.createElement("div");
      userEl.className = "github-connected-user";

      const renderUser = (user) => {
        userEl.innerHTML = "";
        if (!user) return;

        const avatar = document.createElement("img");
        avatar.className = "github-avatar";
        avatar.src = user.avatar_url;
        avatar.alt = user.login;
        avatar.width = 36;
        avatar.height = 36;

        const info = document.createElement("div");
        info.className = "github-user-info";

        const nameEl = document.createElement("span");
        nameEl.className = "github-username";
        nameEl.textContent = user.login;

        info.appendChild(nameEl);
        userEl.append(avatar, info);
      };

      // Use cached user - no API call
      githubContributeService.getCachedUser().then((cachedUser) => {
        renderUser(cachedUser);
      });

      const btnRow = document.createElement("div");
      btnRow.className = "button-group footer-buttons";

      const disconnectBtn = document.createElement("button");
      disconnectBtn.className = "btn btn-action github-disconnect-btn";
      disconnectBtn.textContent = i18n.t("userscript.contribute.oauth.disconnect");

      const reloadBtn = document.createElement("button");
      reloadBtn.className = "btn btn-action";
      reloadBtn.appendChild(createSVG(svg_paths.refreshIconPaths));
      const closeBtn = document.createElement("button");
      closeBtn.className = "btn btn-action close-btn";
      closeBtn.textContent = i18n.t("common.close");

      reloadBtn.addEventListener("click", async () => {
        reloadBtn.disabled = true;
        try {
          const user = await githubContributeService.fetchAndCacheUser();
          renderUser(user);
          await this.refreshGithubAuthBadge();
          showAlert(i18n.t("common.ok"), "", "tip", { labelOk: i18n.t("common.close") });
        } catch (_) {}
        reloadBtn.disabled = false;
      });

      disconnectBtn.addEventListener("click", async () => {
        await githubContributeService.clearToken();
        this.refreshGithubAuthBadge();
        modal.remove();
        resolve();
      });

      closeBtn.addEventListener("click", () => {
        modal.remove();
        resolve();
      });
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          modal.remove();
          resolve();
        }
      });

      btnRow.append(disconnectBtn, reloadBtn, closeBtn);
      content.append(title, userEl, btnRow);
      modal.appendChild(content);
      document.body.appendChild(modal);
    });
  }

  showDeviceFlowModal() {
    return new Promise((resolve) => {
      const existing = document.querySelector(".device-flow-modal");
      if (existing) existing.remove();

      const modal = document.createElement("div");
      modal.className = "modal device-flow-modal";
      modal.style.display = "flex";

      const content = document.createElement("div");
      content.className = "modal-content device-flow-content";

      const title = document.createElement("h2");
      title.textContent = i18n.t("userscript.contribute.oauth.title");

      // State: loading → code → success/error
      const stateEl = document.createElement("div");
      stateEl.className = "device-flow-state";

      const loadingEl = document.createElement("p");
      loadingEl.className = "contribute-status loading";
      loadingEl.textContent = i18n.t("userscript.contribute.oauth.requesting");
      stateEl.appendChild(loadingEl);

      const btnRow = document.createElement("div");
      btnRow.className = "button-group footer-buttons";

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn close-btn";
      cancelBtn.textContent = i18n.t("common.cancel");

      const disconnectBtn = document.createElement("button");
      disconnectBtn.className = "btn btn-action github-disconnect-btn";
      disconnectBtn.textContent = i18n.t("userscript.contribute.oauth.disconnect");

      disconnectBtn.addEventListener("click", async () => {
        abortController.abort();
        await githubContributeService.clearToken();
        modal.remove();
        resolve(null);
      });

      btnRow.append(disconnectBtn, cancelBtn);
      content.append(title, stateEl, btnRow);
      modal.appendChild(content);

      const abortController = new AbortController();

      cancelBtn.addEventListener("click", () => {
        abortController.abort();
        modal.remove();
        resolve(null);
      });

      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          abortController.abort();
          modal.remove();
          resolve(null);
        }
      });

      document.body.appendChild(modal);

      // Start Device Flow via IIFE or promise chain safely inside executor
      (async () => {
        try {
          const { device_code, user_code, verification_uri, interval, expires_in } = await githubContributeService.requestDeviceCode();

          // Build code display UI
          stateEl.innerHTML = "";

          const desc = document.createElement("p");
          desc.className = "device-flow-desc";
          desc.textContent = i18n.t("userscript.contribute.oauth.description");
          stateEl.appendChild(desc);

          // Big user code display
          const codeWrap = document.createElement("div");
          codeWrap.className = "device-flow-code-wrap";

          const codeEl = document.createElement("span");
          codeEl.className = "device-flow-code";
          codeEl.textContent = user_code;

          const copyBtn = document.createElement("button");
          copyBtn.className = "device-flow-copy";
          copyBtn.appendChild(createSVG(svg_paths.copyIconPaths));
          copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(user_code).then(() => {
              copyBtn.innerHTML = "";
              copyBtn.appendChild(createSVG(svg_paths.checkIconPaths));
              setTimeout(() => {
                copyBtn.innerHTML = "";
                copyBtn.appendChild(createSVG(svg_paths.copyIconPaths));
              }, 2000);
            });
          });

          codeWrap.append(codeEl, copyBtn);
          stateEl.appendChild(codeWrap);

          // Open GitHub button
          const openBtn = document.createElement("button");
          openBtn.className = "device-flow-open-btn btn confirm-button";
          openBtn.target = "_blank";
          openBtn.rel = "noopener noreferrer";
          openBtn.textContent = i18n.t("userscript.contribute.oauth.openGitHub");
          openBtn.addEventListener("click", () => {
            window.open(verification_uri, "_blank", "noopener,noreferrer");
          });
          stateEl.appendChild(openBtn);

          // Waiting indicator
          const waitingEl = document.createElement("p");
          waitingEl.className = "contribute-status loading device-flow-waiting";
          waitingEl.textContent = i18n.t("userscript.contribute.oauth.waiting");
          stateEl.appendChild(waitingEl);

          // Countdown timer
          const timerEl = document.createElement("small");
          timerEl.className = "device-flow-timer";
          stateEl.appendChild(timerEl);

          let secondsLeft = expires_in;
          const timerInterval = setInterval(() => {
            secondsLeft--;
            const mins = Math.floor(secondsLeft / 60);
            const secs = secondsLeft % 60;
            timerEl.textContent = i18n.t("userscript.contribute.oauth.expires", { count: `${mins}:${String(secs).padStart(2, "0")}` });
            if (secondsLeft <= 0) clearInterval(timerInterval);
          }, 1000);

          // Poll for token
          try {
            const accessToken = await githubContributeService.pollForToken(device_code, interval || 5, abortController.signal, expires_in);

            clearInterval(timerInterval);

            await githubContributeService.saveToken(accessToken);
            await githubContributeService.fetchAndCacheUser();
            this.refreshGithubAuthBadge();

            // Success state
            stateEl.innerHTML = "";
            const successEl = document.createElement("p");
            successEl.className = "contribute-status success";
            successEl.textContent = i18n.t("userscript.contribute.oauth.success");
            stateEl.appendChild(successEl);

            setTimeout(() => {
              modal.remove();
              resolve(accessToken);
            }, 800);
          } catch (pollErr) {
            clearInterval(timerInterval);
            if (pollErr.message === "cancelled") return;

            stateEl.innerHTML = "";
            const errEl = document.createElement("p");
            errEl.className = "contribute-status error";
            errEl.textContent =
              pollErr.message === "expired"
                ? i18n.t("userscript.contribute.oauth.expired")
                : pollErr.message === "denied"
                  ? i18n.t("userscript.contribute.oauth.denied")
                  : pollErr.message;
            stateEl.appendChild(errEl);

            const retryBtn = document.createElement("button");
            retryBtn.className = "btn confirm-button";
            retryBtn.textContent = i18n.t("setup.permission.grant.retry");
            retryBtn.addEventListener("click", () => {
              modal.remove();
              resolve(this.showDeviceFlowModal());
            });
            stateEl.appendChild(retryBtn);
          }
        } catch (initErr) {
          stateEl.innerHTML = "";
          const errEl = document.createElement("p");
          errEl.className = "contribute-status error";
          errEl.textContent = initErr.message;
          stateEl.appendChild(errEl);
        }
      })();
    });
  }

  showMessage(message, type = "info") {
    const msgElement = document.getElementById("editorMsg");
    msgElement.textContent = message;
    msgElement.className = `message ${type}`;
  }
}

// Motion Preference Check
initMotionPreference();

// Initialize the UI when the script loads
const userScriptUI = new UserScriptUI();
