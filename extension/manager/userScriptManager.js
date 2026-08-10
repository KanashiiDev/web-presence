const $ = (id) => document.getElementById(id);

// Small, reusable utility helpers
function clearChildren(el) {
  if (!el) return;
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function splitAndTrim(str = "") {
  return str
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

class UserScriptUI {
  constructor() {
    this.editingId = null;
    this.activeTab = "my"; // "my" | "repo"
    this.init();
  }

  async fetchScriptById(id) {
    // First check the list of the active tab
    const activeParams = this.activeTab === "repo" ? { showOnlyStore: true } : {};
    let resp = await sendAction("listUserScripts", activeParams);
    let found = (resp?.list || []).find((x) => x.id === id);

    // If not found, search in the other tab
    if (!found) {
      const otherParams = this.activeTab === "repo" ? {} : { showOnlyStore: true };
      resp = await sendAction("listUserScripts", otherParams);
      found = (resp?.list || []).find((x) => x.id === id);
    }

    return found || null;
  }

  async init() {
    await i18n.load("extension");
    applyTranslations();
    this.bindEvents();
    this.refreshList();
    this.bindCodeEditor();

    this.iframeSelectorsEditor = CodeMirror.fromTextArea(document.getElementById("inIframeSelectors"), {
      mode: "application/json",
      theme: "material-darker",
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      autoCloseBrackets: true,
      matchBrackets: true,
      lineWrapping: true,
      extraKeys: {
        "Ctrl-S": function (cm) {
          document.getElementById("btnSave").click();
        },
      },
    });

    this.iframeSelectorsEditor.setValue(JSON.stringify({ fields: { $video: { type: "video" } } }, null, 2));

    const iframeSelectorsContainer = document.getElementById("iframeSelectorsContainer");
    const iframeSelectorsToggle = document.getElementById("btnIframeSelectorsToggle");
    iframeSelectorsToggle.addEventListener("click", () => {
      const isHidden = iframeSelectorsContainer.hidden;
      iframeSelectorsContainer.hidden = !isHidden;

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
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        if (!parsed.fields || typeof parsed.fields !== "object") {
          errorEl.textContent = i18n.t("userscript.iframeSelectors.error.missingFields");
        } else {
          errorEl.textContent = "";
        }
      } catch (e) {
        errorEl.textContent = i18n.t("userscript.iframeSelectors.error.invalidJson") + ": " + e.message;
      }
    });

    const inModeEl = document.querySelector("#inMode");

    this.inModeTom = new TomSelect(inModeEl, {
      create: false,
      allowEmptyOption: false,
      controlInput: null,
      onChange: () => {
        this.updateWatchAutoDetectVisibility();
      },
    });

    checkUserScriptsPermission();
    initApplyAttrs();
    initStorageListener();

    // GitHub auth badge - show connected state on header button
    this.refreshGithubAuthBadge();
  }

  bindEvents() {
    // Main buttons
    $("btnNew").addEventListener("click", () => this.showEditor());
    $("btnCancel").addEventListener("click", () => this.hideEditor(1));
    $("btnSave").addEventListener("click", () => this.saveScript());

    // Import/Export
    $("btnImport").addEventListener("click", () => $("fileInput").click());
    $("fileInput").addEventListener("change", (e) => this.handleImport(e));
    $("btnExport").addEventListener("click", (e) => {
      this.exportMenuClick(e);
    });

    // Editor Input Checks
    $("inDomain").addEventListener("input", () => this.handlePatternStatus());
    $("inUrlPatterns").addEventListener("input", () => this.handlePatternStatus());

    // Header Tab
    $("tabMyScripts")?.addEventListener("click", () => this.switchTab("my"));
    $("tabRepoScripts")?.addEventListener("click", () => this.switchTab("repo"));

    // List events
    $("scriptList").addEventListener("click", (e) => this.handleListClick(e));

    // GitHub Contribute settings
    $("btnGithubSettings").addEventListener("click", () => this.onGithubSettingsClick());
  }

  async switchTab(tab) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    document.querySelectorAll(".script-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    this.hideEditor();
    await this.refreshList();
  }

  handlePatternStatus() {
    const domainRaw = $("inDomain").value.trim();
    const domains = splitAndTrim(domainRaw);

    // Userscript Matches
    const matches = domains.flatMap((d) => {
      const cleanDomain = d.replace(/^(\*\.|www\.)/, "");
      if (d.startsWith("*.")) {
        return [`${cleanDomain}/*`, `*.${cleanDomain}/*`];
      } else {
        return [`${cleanDomain}/*`];
      }
    });

    // Process the raw patterns
    const rawPatterns = $("inUrlPatterns").value;
    const { normalizedList } = PatternValidator.processPatterns(rawPatterns);
    const patternStatus = $("patternStatus");

    // Clear previous content
    clearChildren(patternStatus);

    if (normalizedList.length > 0) {
      normalizedList.forEach((p) => {
        const cont = document.createElement("code");
        cont.textContent = p;
        patternStatus.append(cont);
      });
    }
  }

  bindCodeEditor() {
    const lintOptions = {
      esversion: 11, // ES2020
      asi: false, // automatic semicolon insertion
      undef: true, // warn undefined variables
      unused: false, // warnings about unused variables
      browser: true, // It recognizes global variables such as window/document.
      devel: true, // Allows console.log and alert
      predef: [
        "useSetting",
        "getText",
        "getTextAll",
        "getImage",
        "getImageAll",
        "querySelectorDeep",
        "getIframeData",
        "AbortController",
        "fetch",
        "URL",
        "URLSearchParams",
        "crypto",
        "IntersectionObserver",
        "ResizeObserver",
      ], // recognizes the helper functions
    };

    // Init CodeMirror 5
    this.codeEditor = CodeMirror.fromTextArea(document.getElementById("inCode"), {
      mode: "javascript",
      theme: "material-darker",
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      autoCloseBrackets: true,
      matchBrackets: true,
      foldGutter: true,
      styleActiveLine: { nonEmpty: true },
      gutters: ["CodeMirror-linenumbers", "CodeMirror-lint-markers", "CodeMirror-foldgutter"],
      lint: lintOptions,
      lineWrapping: true,
      extraKeys: {
        "Ctrl-/": "toggleComment",
        "Ctrl-F": function (cm) {
          cm.execCommand("openSearchAdvanced");
        },
        Esc: function (cm) {
          cm.execCommand("closeSearchAdvanced");
        },
        "Ctrl-S": function (cm) {
          document.getElementById("btnSave").click();
          cm.preventDefault && cm.preventDefault();
        },
      },
    });

    // Auto-complete
    this.codeEditor.on("inputRead", function (cm, change) {
      if (change.text[0].match(/[a-zA-Z_.]/)) {
        cm.showHint({ completeSingle: false });
      }
    });

    this.codeEditor.on(
      "change",
      function (cm) {
        const isMatch = this.checkSettings(cm);
        if (isMatch && container.getAttribute("activeMode") === "edit") {
          clearChildren(container);
          this.useSettingEditor.loadFromCode();
        }
      }.bind(this),
    );

    // Async Wrapper
    CodeMirror.registerHelper("lint", "javascript", function (text) {
      const wrapped = "async function __wrapper__() {\n" + text + "\n}";
      const result = JSHINT(wrapped, lintOptions);

      const errors = JSHINT.errors
        .map((err) => {
          if (!err) return null;
          err.line -= 1;
          return err;
        })
        .filter(Boolean);

      return errors.map((err) => ({
        from: CodeMirror.Pos(err.line - 1, err.character - 1),
        to: CodeMirror.Pos(err.line - 1, err.character),
        message: err.reason,
      }));
    });

    // js-beautify Options
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

    // add js-beautify
    document.getElementById("btnFormat").addEventListener("click", () => {
      const code = this.codeEditor.getValue();
      const formatted = js_beautify(code, beautifyOptions);
      this.codeEditor.setValue(formatted);
    });

    const CATEGORY_OPTIONS = [
      { value: "radio", text: i18n.t("parserFilters.category.radio") },
      { value: "platform", text: i18n.t("parserFilters.category.platform") },
      { value: "aggregator", text: i18n.t("parserFilters.category.aggregator") },
      { value: "video", text: i18n.t("parserFilters.category.video") },
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

    this.useSettingEditor = new UseSettingEditor(this.codeEditor, document.getElementById("useSettingsContainer"));
    const editBtn = document.getElementById("editSettingsBtn");
    const createBtn = document.getElementById("createSettingsBtn");
    const container = document.getElementById("useSettingsContainer");

    editBtn.addEventListener("click", () => {
      if (container.getAttribute("activeMode") === "edit") {
        clearChildren(container);
        container.removeAttribute("activeMode");
        editBtn.classList.remove("active");
      } else {
        clearChildren(container);
        container.setAttribute("activeMode", "edit");
        editBtn.classList.add("active");
        createBtn.classList.remove("active");
        this.useSettingEditor.loadFromCode();
      }
    });

    createBtn.addEventListener("click", () => {
      if (container.getAttribute("activeMode") === "create") {
        clearChildren(container);
        container.removeAttribute("activeMode");
        createBtn.classList.remove("active");
      } else {
        clearChildren(container);
        container.setAttribute("activeMode", "create");
        createBtn.classList.add("active");
        editBtn.classList.remove("active");
        this.useSettingEditor.createGeneratorUI(container);
      }
    });
  }

  // Show/Hide Edit Settings Button
  checkSettings(cm) {
    const useSetRegex = /useSetting\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)"(?:\s*,\s*([\s\S]*?))?\s*\)/g;
    const code = cm.getValue();
    const match = useSetRegex.exec(code);
    if (match === null) {
      document.getElementById("editSettingsBtn").hidden = true;
    } else {
      document.getElementById("editSettingsBtn").hidden = false;
    }
    return match;
  }

  updateWatchAutoDetectVisibility() {
    const isWatch = this.inModeTom.getValue() === "watch";
    document.querySelector(".container.watchAutoDetect").style.display = isWatch ? "" : "none";
  }

  async refreshList() {
    const params = this.activeTab === "repo" ? { showOnlyStore: true } : {};
    const listResp = await sendAction("listUserScripts", params);

    if (!listResp || !listResp.ok) {
      logError("[userScriptManager]: List fetch failed", listResp);
      return;
    }

    this.renderList(listResp.list || []);
    await this.restoreContext();
  }

  async restoreContext() {
    const { managerContext } = await browser.storage.local.get("managerContext");
    if (!managerContext) return;
    const { target } = managerContext;
    if (target) {
      const el = document.querySelector(`.btnEdit[data-id="${target}"]`);
      el?.click();
    }
    // remove managerContext after restoring
    await browser.storage.local.remove("managerContext");
  }

  renderList(list) {
    this.hideEditor();
    const editor = $("editor");
    document.body.appendChild(editor);
    const ul = $("scriptList");
    ul.innerHTML = "";

    if (!list.length) {
      const emptyMsg = document.createElement("li");
      emptyMsg.className = "script-empty-message";
      emptyMsg.textContent = this.activeTab === "repo" ? i18n.t("userscript.list.empty.repo") : i18n.t("userscript.list.empty.my");
      ul.appendChild(emptyMsg);
      return;
    }

    list.sort((a, b) => a.title.localeCompare(b.title));

    list.forEach((script) => {
      const li = document.createElement("li");
      li.dataset.id = script.id;
      li.dataset.title = script.title;
      li.classList.add("script-item");
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

      const favIcon = document.createElement("img");
      favIcon.className = "parser-icon hidden-visibility";
      favIcon.dataset.src = primaryDomain;
      favIcon.loading = "lazy";
      favIcon.decoding = "async";
      favIconContainer.appendChild(favIcon);

      // Favicon click
      const handleFavIconClick = () => {
        const url = script.homepage || `https://${primaryDomain}`;
        window.open(url, "_blank", "noopener,noreferrer");
      };
      const listeners = [];
      const addListener = (el, event, handler, options = {}) => {
        if (!el) return;
        el.addEventListener(event, handler, options);
        listeners.push({ el, event, handler, options });
      };
      addListener(favIcon, "click", handleFavIconClick);
      header.prepend(favIconContainer);

      const status = document.createElement("span");
      status.className = "script-status";
      status.classList.toggle("status-active", !!script.registered);
      status.classList.toggle("status-inactive", !script.registered);
      const inactiveStatus =
        !script.registered && !script.enabled ? i18n.t("userscript.status.inactive") : !script.registered ? i18n.t("userscript.status.unregistered") : null;
      status.textContent = inactiveStatus || i18n.t("userscript.status.active");

      header.append(title, status);

      // script-details
      const details = document.createElement("div");
      details.className = "script-details";

      const description = document.createElement("p");
      description.className = "script-description";
      description.textContent = script.description || "";
      details.appendChild(description);

      const domain = document.createElement("small");
      domain.className = "script-domain";
      domain.textContent = `${Array.isArray(script.domain) ? script.domain.join(", ") : script.domain} [${this.formatPatterns(script.urlPatterns)}]`;
      details.appendChild(domain);

      // script-meta
      const authors =
        script.authors && Array.isArray(script.authors) && script.authors.length > 0
          ? `${script.authors.length > 1 ? "Authors" : "Author"}: ${script.authors.join(", ")}`
          : "";
      const updated = script.lastUpdated ? `${new Date(script.lastUpdated).toLocaleDateString()}` : "";
      const meta = `${authors}\n${updated}`.trim();
      title.title = meta;
      info.append(header, details);

      // script-actions
      const actions = document.createElement("div");
      actions.className = "script-actions";

      const btnToggle = document.createElement("button");
      btnToggle.classList.add("btnToggle");
      const isActivelyRunning = script.enabled && script.registered;
      btnToggle.classList.add(isActivelyRunning ? "btn-disable" : "btn-enable");
      btnToggle.title = isActivelyRunning ? i18n.t("common.disable") : i18n.t("common.enable");
      isActivelyRunning ? btnToggle.appendChild(createSVG(svg_paths.pauseIconPaths)) : btnToggle.appendChild(createSVG(svg_paths.startIconPaths));

      const btnEdit = document.createElement("button");
      btnEdit.className = "btnEdit";
      btnEdit.title = i18n.t("common.edit");
      btnEdit.setAttribute("data-id", script.id);
      btnEdit.appendChild(createSVG(svg_paths.penIconPaths));

      const btnExport = document.createElement("button");
      btnExport.className = "btnExport";
      btnExport.title = i18n.t("userscript.listControls.export");
      btnExport.setAttribute("data-id", script.id);
      btnExport.appendChild(createSVG(svg_paths.exportIconPaths, { strokeWidth: 1.5 }));

      const btnContribute = document.createElement("button");
      btnContribute.className = "btnContribute";
      btnContribute.title = i18n.t("userscript.contribute.button");
      btnContribute.setAttribute("data-id", script.id);
      btnContribute.appendChild(createSVG(svg_paths.githubIconPaths));

      const btnRegister = document.createElement("button");
      btnRegister.className = "btnRegister";
      btnRegister.title = script.registered ? i18n.t("userscript.unregister") : i18n.t("userscript.register");
      btnRegister.textContent = script.registered ? i18n.t("userscript.unregister") : i18n.t("userscript.register");

      const btnDelete = document.createElement("button");
      btnDelete.className = "btnDelete";
      btnDelete.title = i18n.t("common.delete");
      btnDelete.appendChild(createSVG(svg_paths.trashIconPaths));

      actions.append(btnToggle, btnEdit, btnExport, btnContribute, btnDelete);

      li.append(info, actions);
      ul.appendChild(li);
    });
    // Favicon lazy load
    const allFavIcons = document.querySelectorAll(".parser-icon");
    loadFavIcons(allFavIcons);
  }

  formatPatterns(patterns) {
    if (!patterns || patterns === "*") return ".*";
    if (typeof patterns === "string") patterns = [patterns];
    if (Array.isArray(patterns)) {
      return patterns.map((p) => p.replace(/^\/|\/$/g, "")).join(", ");
    }
    return String(patterns);
  }

  handleListClick(e) {
    const button = e.target.closest("button");
    if (!button) return;

    e.preventDefault();
    e.stopPropagation();

    const li = button.closest("li");
    if (!li) return;

    const { id, title } = li.dataset;

    if (button.classList.contains("btnEdit")) return this.onEdit(id);
    if (button.classList.contains("btnRegister")) return this.onRegisterToggle(id);
    if (button.classList.contains("btnExport")) return this.exportMenuClick(e);
    if (button.classList.contains("btnDelete")) return this.onDelete(id, title);
    if (button.classList.contains("btnToggle")) return this.onToggle(id);
    if (button.classList.contains("btnContribute")) return this.onContribute(id);
  }

  async showEditor(script = null, insertAfterEl = null) {
    this.editingId = script?.id || null;
    const editor = $("editor");
    const listContainer = $("scriptList");
    if (!editor || !listContainer) return;

    const currentSection = script?.id || "new";
    if (editor.getAttribute("current") === currentSection) {
      editor.setAttribute("current", "0");
      this.hideEditor();
      return;
    } else {
      editor.setAttribute("current", currentSection);
    }

    // If insertAfterEl exists -> place it below it
    if (insertAfterEl) {
      insertAfterEl.insertAdjacentElement("afterend", editor);
    } else {
      listContainer.prepend(editor);
    }

    const authorsInput = $("inAuthors");
    const authorsLinksInput = $("inAuthorsLinks");
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

    $("editorTitle").textContent = script ? `${i18n.t("userscript.editor.editScript")} [${script.title}]` : i18n.t("userscript.editor.newScript");
    $("inTitle").value = script?.title || "";

    const [vMaj, vMin, vPat] = (script?.version || "1.0.0").split(".").map((n) => parseInt(n, 10) || 0);
    $("inVersionMajor").value = vMaj;
    $("inVersionMinor").value = vMin;
    $("inVersionPatch").value = vPat;
    $("inDesc").value = script?.description || "";

    $("inDomain").value = Array.isArray(script?.domain) ? script.domain.join(", ") : script?.domain || "";
    $("inHomepage").value = script?.homepage || "";
    this.inModeTom.setValue(script?.mode || "listen");
    $("inWatchAutoDetect").value = script?.watchAutoDetect || "disable";
    const rawCategory = script?.category ?? "";
    const categoryItems = Array.isArray(rawCategory) ? rawCategory : splitAndTrim(rawCategory);

    this.categorySelect.clear(true);
    this.categorySelect.setValue(categoryItems, true);
    $("inTags").value = Array.isArray(script?.tags) ? script.tags.join(", ") : script?.tags || "";
    this.updateWatchAutoDetectVisibility();
    $("inDebug").checked = script?.debug || false;

    const iframeSelectorsContainer = document.getElementById("iframeSelectorsContainer");
    const iframeSelectorsBtn = document.getElementById("btnIframeSelectorsToggle");

    if (script?.iframeSelectors) {
      iframeSelectorsContainer.hidden = false;
      iframeSelectorsBtn.classList.add("active");
      setTimeout(() => {
        this.iframeSelectorsEditor.setValue(JSON.stringify(script.iframeSelectors, null, 2));
        this.iframeSelectorsEditor.refresh();
      }, 0);
    } else {
      iframeSelectorsContainer.hidden = true;
      iframeSelectorsBtn.classList.remove("active");
      this.iframeSelectorsEditor.setValue(JSON.stringify({ fields: { $video: { type: "video" } } }, null, 2));
    }

    $("inUrlPatterns").value = this.formatPatterns(script?.urlPatterns) || ".*";
    $("inUrlPatterns").dispatchEvent(new Event("input"));
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

    this.checkSettings(this.codeEditor);
    if (!script?.code) document.getElementById("btnFormat").click();

    $("editorMsg").textContent = "";
    $("editorMsg").classList = "";
    $("editor").hidden = false;
    this.codeEditor.refresh();

    // Reset useSettings Container
    const container = document.getElementById("useSettingsContainer");
    container.removeAttribute("activeMode");
    clearChildren(container);

    const activeContainer = document.querySelector("div.code-notes.useSettings .active");
    if (activeContainer) activeContainer.className = "";
  }

  hideEditor(btn) {
    $("editor").hidden = true;
    $("editorMsg").classList = "";
    this.editingId = null;
    const params = new URLSearchParams(window.location.search);
    const target = params.get("target");
    if (btn && target) {
      params.delete("target");
      const newUrl = window.location.origin + window.location.pathname + (params.toString() ? "?" + params.toString() : "");
      window.location.replace(newUrl);
    }
  }

  async saveScript() {
    const domainRaw = $("inDomain").value.trim();
    const domain = domainRaw.includes(",") ? splitAndTrim(domainRaw).map((d) => this.cleanDomain(d)) : this.cleanDomain(domainRaw);
    const domainEmpty = Array.isArray(domain) ? domain.length === 0 : !domain;
    if (domainEmpty) {
      this.showMessage(i18n.t("userscript.editor.warn.emptyDomain"), "error");
      return;
    }
    const rawPatterns = $("inUrlPatterns").value.trim() || ".*";
    const { normalizedList } = PatternValidator.processPatterns(rawPatterns);
    $("editor").setAttribute("current", "0");

    function extractSettingsFromCode(code) {
      const regex = /useSetting\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)"(?:\s*,\s*([\s\S]*?))?\s*\)/g;
      const settings = [];
      let match;

      while ((match = regex.exec(code)) !== null) {
        // eslint-disable-next-line prefer-const
        let [, key, label, type, rawDefaultValue] = match;
        let defaultValue = "";

        if (rawDefaultValue !== undefined) {
          rawDefaultValue = rawDefaultValue.trim();

          if (rawDefaultValue.startsWith("[{")) {
            const fixed = rawDefaultValue.replace(/(\w+)\s*:/g, '"$1":').replace(/'/g, '"');

            try {
              defaultValue = JSON.parse(fixed);
            } catch {
              defaultValue = fixed;
            }
          }

          // Process defaultValue
          // JSON array/object
          else if (rawDefaultValue.startsWith("[") || rawDefaultValue.startsWith("{")) {
            try {
              defaultValue = JSON.parse(rawDefaultValue);
            } catch {
              defaultValue = rawDefaultValue;
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
        }

        settings.push({
          key,
          label,
          type,
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

    const authorsData = splitAndTrim($("inAuthors").value);

    const script = {
      id: this.editingId || generateParserKey(domain, normalizedList, authorsData),
      title: $("inTitle").value.trim(),
      version: `${parseInt($("inVersionMajor").value) || 0}.${parseInt($("inVersionMinor").value) || 0}.${parseInt($("inVersionPatch").value) || 0}`,
      description: $("inDesc").value.trim(),
      authors: authorsData,
      authorsLinks: splitAndTrim($("inAuthorsLinks").value),
      domain,
      homepage: $("inHomepage").value.trim(),
      urlPatterns: normalizedList,
      lastUpdated: Date.now(),
      runAt: "document_idle",
      code: this.codeEditor.getValue(),
      mode: this.inModeTom.getValue(),
      watchAutoDetect: $("inWatchAutoDetect").value.trim(),
      iframeSelectors,
      category: (() => {
        const vals = this.categorySelect.getValue();
        if (!vals.length) return "";
        if (vals.length === 1) return vals[0];
        return vals;
      })(),
      tags: splitAndTrim($("inTags").value),
      debug: $("inDebug").checked,
      settings: extractSettingsFromCode(this.codeEditor.getValue()),
    };

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
    try {
      PatternValidator.normalizePatterns(script.urlPatterns);
    } catch (error) {
      this.showMessage(i18n.t("userscript.editor.warn.invalidPatterns") + " " + error.message, "error");
      return;
    }

    this.showMessage("Saving script...", "info");

    const response = await browser.runtime.sendMessage({
      action: "saveUserScript",
      script,
      previousId: this.editingId || null,
    });

    if (response?.ok) {
      this.showMessage("Script saved and registered successfully.", "success");
      await this.refreshList();
    } else {
      this.showMessage(
        `${i18n.t("userscript.editor.warn.saveFailed")} ${
          response?.error?.startsWith("userscript.editor") ? i18n.t(response.error) : response?.error || "Unknown error"
        }`,
        "error",
      );
    }
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

    const li = document.querySelector(`li[data-id="${id}"]`);
    if (li) {
      this.showEditor(script, li);
      const offset = 10;
      const rect = li.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      window.scrollTo({
        top: rect.top + scrollTop - offset,
        behavior: "smooth",
      });
    }
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

  exportToRegisterParser(scripts) {
    return scripts
      .map((script) => {
        const codeIndented = script.code
          .split("\n")
          .map((line) => "    " + line)
          .join("\n");
        const domains = [script.domain].flat().filter(Boolean);
        const domainStr = domains.length === 1 ? `"${domains[0]}"` : `["${domains.join('", "')}"]`;
        const urlPatterns = (script.urlPatterns || []).map((p) => (p.startsWith("/") ? p : `/${p}/`)).join(", ");
        const authorsStr = [script.authors].flat().filter(Boolean).join(",");
        const authorsLinksStr = [script.authorsLinks].flat().filter(Boolean).join(",");
        const iframeSelectorsStr = script.iframeSelectors ? `\n  iframeSelectors: ${JSON.stringify(script.iframeSelectors, null, 2).split("\n").join("\n  ")},` : "";
        const tagsStr = Array.isArray(script.tags) && script.tags.length ? `\n  tags: ["${script.tags.join('", "')}"],` : "";
        const categoryStr = script.category ? `\n  category: "${script.category}",` : "";

        return `registerParser({
  id: "${script.id}",
  domain: ${domainStr},
  authors: "${authorsStr}",
  authorsLinks: "${authorsLinksStr}",
  title: "${script.title}",
  version: "${script.version || "1.0.0"}",
  description: "${script.description || ""}",
  lastUpdated: "${script.lastUpdated || ""}",
  mode: "${script.mode || "listen"}",
  watchAutoDetect: "${script.watchAutoDetect || "disable"}",
  homepage: "${script.homepage || ""}",${categoryStr}${tagsStr}
  urlPatterns: [${urlPatterns}],${iframeSelectorsStr}
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

      let depth = 0;
      let blockStart = -1;
      let blockEnd = -1;
      let j = callIdx + "registerParser(".length;

      while (j < jsText.length) {
        if (jsText[j] === "{") {
          if (blockStart === -1) blockStart = j;
          depth++;
        } else if (jsText[j] === "}") {
          depth--;
          if (depth === 0) {
            blockEnd = j;
            break;
          }
        }
        j++;
      }

      if (blockStart === -1 || blockEnd === -1) {
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

      // category: string
      const category = extractStr("category");

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

      // fn body: balanced brace + 2-space dedent
      let code = "";
      const fnIdx = block.search(/\bfn:\s*(async\s+)?function\s*\(\s*\)/);
      if (fnIdx !== -1) {
        let depth3 = 0,
          fnBodyStart = -1,
          m = fnIdx;
        while (m < block.length) {
          if (block[m] === "{") {
            if (fnBodyStart === -1) fnBodyStart = m;
            depth3++;
          } else if (block[m] === "}") {
            depth3--;
            if (depth3 === 0 && fnBodyStart !== -1) {
              code = block
                .slice(fnBodyStart + 1, m)
                .split("\n")
                .map((line) => (line.startsWith("    ") ? line.slice(4) : line))
                .join("\n")
                .trim();
              break;
            }
          }
          m++;
        }
      }

      const authors = extractStr("authors");
      const authorsLinks = extractStr("authorsLinks");

      const authorsStr = splitAndTrim(authors);
      const authorsLinksStr = splitAndTrim(authorsLinks);

      scripts.push({
        title: extractStr("title"),
        description: extractStr("description"),
        domain,
        homepage: extractStr("homepage"),
        authors: authorsStr,
        authorsLinks: authorsLinksStr,
        urlPatterns,
        mode: extractStr("mode") || "listen",
        watchAutoDetect: extractStr("watchAutoDetect") || "disable",
        category,
        tags,
        iframeSelectors,
        code,
        id: extractStr("id") || generateParserKey(domain, urlPatterns, authorsStr),
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
      const scripts = file.name.endsWith(".js") ? this.importFromRegisterParser(text) : JSON.parse(text);

      if (!Array.isArray(scripts)) throw new Error("Invalid format: expected array");

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
      // Modal
      const modal = document.createElement("div");
      modal.className = "modal";
      modal.style.display = "flex";

      const content = document.createElement("div");
      content.className = "modal-content";
      modal.appendChild(content);

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
      confirmBtn.className = "confirm-button";

      const closeBtn = this.createButton(i18n.t("common.close"), async () => {
        if (importFinished) {
          modal.remove();
          resolve({ duplicates, newScripts });
        }
      });

      closeBtn.className = "close-button";
      const buttonContainer = document.createElement("div");
      buttonContainer.className = "button-group footer-buttons";
      buttonContainer.append(confirmBtn, closeBtn);
      content.appendChild(buttonContainer);
      document.body.appendChild(modal);
      activateSimpleBar("importModalBody");

      // Close when clicking outside the modal
      window.onclick = (ev) => {
        if (importFinished && ev.target === modal) {
          modal.remove();
          resolve({ duplicates, newScripts });
        }
      };
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
    btn.className = "button";
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
    const resp = await sendAction("listUserScripts");
    let scripts = resp?.list || [];

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
    const blob = new Blob([dataStr], { type: "text/javascript" });
    if (options.type === "single") {
      fileName = `web-presence-userScript-${scripts[0].title || "script"}.js`;
    } else {
      fileName = `web-presence-userScripts-${new Date().toISOString().split("T")[0]}.js`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
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

    const upstreamInfo = await githubContributeService.fetchUpstreamScriptInfo(script, token);

    if (upstreamInfo) {
      const versionCmp = githubContributeService._compareVersions(upstreamInfo.version, script.version);

      // Block the upstream version if it is the same as or newer than the local script version.
      if (versionCmp >= 0) {
        this._showVersionBlockModal(script, upstreamInfo);
        return;
      }
    }

    const confirmResult = await this.showContributeConfirmModal(script, upstreamInfo);
    if (!confirmResult || !confirmResult.confirmed) return;

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
    editBtn.className = "confirm-button";
    editBtn.textContent = i18n.t("common.edit");

    const closeBtn = document.createElement("button");
    closeBtn.className = "close-button";
    closeBtn.textContent = i18n.t("common.close");

    editBtn.addEventListener("click", () => {
      modal.remove();
      // Open editor for this script
      const li = document.querySelector(`li[data-id="${script.id}"]`);
      const btnEdit = li?.querySelector(".btnEdit");
      btnEdit?.click();
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
          rows.splice(2, 0, [i18n.t("userscript.editor.description.label"), script.description]);
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
      commitInput.className = "input-text";
      commitInput.value = defaultCommitMsg;
      commitInput.style.width = "100%";

      commitGroup.append(commitLabel, commitInput);
      content.appendChild(commitGroup);

      const btnRow = document.createElement("div");
      btnRow.className = "button-group footer-buttons";

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "close-button";
      cancelBtn.textContent = i18n.t("common.cancel");

      const submitBtn = document.createElement("button");
      submitBtn.className = "confirm-button";
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

    const run = async (t) => {
      statusEl.className = "contribute-status loading";
      statusEl.textContent = STATUS_LABELS.validating;
      prLinkEl.hidden = true;
      retryBtn.hidden = true;
      reAuthBtn.hidden = true;

      try {
        const fileContent = this.exportToRegisterParser([script]);
        const { prUrl, isUpdate, skipped } = await githubContributeService.contribute(
          script,
          fileContent,
          t,
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
    retryBtn.className = "contribute-retry button";
    retryBtn.textContent = i18n.t("setup.permission.grant.retry");
    retryBtn.hidden = true;

    const reAuthBtn = document.createElement("button");
    reAuthBtn.className = "contribute-reauth button";
    reAuthBtn.textContent = i18n.t("userscript.contribute.reauth");
    reAuthBtn.hidden = true;

    const closeBtn = document.createElement("button");
    closeBtn.className = "contribute-close close-button";
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
    const btn = $("btnGithubSettings");
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
      disconnectBtn.className = "button github-disconnect-btn";
      disconnectBtn.textContent = i18n.t("userscript.contribute.oauth.disconnect");

      const reloadBtn = document.createElement("button");
      reloadBtn.className = "button";
      reloadBtn.appendChild(createSVG(svg_paths.refreshIconPaths));
      const closeBtn = document.createElement("button");
      closeBtn.className = "close-button";
      closeBtn.textContent = i18n.t("common.close");

      reloadBtn.addEventListener("click", async () => {
        reloadBtn.disabled = true;
        try {
          const user = await githubContributeService.fetchAndCacheUser();
          renderUser(user);
          this.refreshGithubAuthBadge();
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
      cancelBtn.className = "close-button";
      cancelBtn.textContent = i18n.t("common.cancel");

      const disconnectBtn = document.createElement("button");
      disconnectBtn.className = "button github-disconnect-btn";
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
          openBtn.className = "device-flow-open-btn confirm-button";
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
            const accessToken = await githubContributeService.pollForToken(device_code, interval || 5, abortController.signal);

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
            retryBtn.className = "confirm-button";
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
    const msgElement = $("editorMsg");
    msgElement.textContent = message;
    msgElement.className = `message ${type}`;
  }
}

// Motion Preference Check
initMotionPreference();

// Initialize the UI when the script loads
const userScriptUI = new UserScriptUI();
