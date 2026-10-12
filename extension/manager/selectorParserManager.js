class UserParserUI {
  constructor() {
    this.editingId = null;
    this.parsers = [];
    this.enabledState = {};
    this.init();
  }

  async init() {
    if (typeof i18n !== "undefined") {
      await i18n.load("extension");
      if (typeof applyTranslations === "function") applyTranslations();
    }
    if (typeof initApplyAttrs === "function") initApplyAttrs();
    this.bindEvents();
    await this.loadData();
    this.renderList();
    await this.restoreContext();
    initStorageListener();
  }

  bindEvents() {
    document.getElementById("btnNew").addEventListener("click", () => this.showEditor());
    document.getElementById("btnCancel").addEventListener("click", () => this.hideEditor());
    document.getElementById("btnSave").addEventListener("click", () => this.saveParser());

    document.getElementById("btnExport").addEventListener("click", (e) => this.exportMenuClick(e, null));
    document.getElementById("btnImport").addEventListener("click", () => document.getElementById("fileInput").click());
    document.getElementById("fileInput").addEventListener("change", (e) => this.importData(e));

    document.getElementById("inMode").addEventListener("change", () => this.updateWatchAutoDetectVisibility());

    document.getElementById("parserList").addEventListener("click", (e) => this.handleListClick(e));
  }

  // List Actions
  async handleListClick(e) {
    const target = e.target.closest("button");
    if (!target) return;

    const li = target.closest(".parser-item");
    const id = target.getAttribute("data-id");
    const parser = this.parsers.find((p) => p.id === id);
    if (!parser) return;

    if (target.classList.contains("btnToggle")) {
      const stateKey = `enable_${parser.id}`;
      const currentStatus = this.enabledState[stateKey] !== false;

      if (currentStatus) {
        this.enabledState[stateKey] = false;
      } else {
        delete this.enabledState[stateKey];
      }

      await this.saveData();
      this.renderList();
    } else if (target.classList.contains("btnEdit")) {
      this.showEditor(parser, li);
    } else if (target.classList.contains("btnExport")) {
      this.exportMenuClick(e, parser);
    } else if (target.classList.contains("btnDelete")) {
      const confirmed = await showConfirm("", {
        type: "danger",
        heading: i18n.t("parserList.delete.confirm").replace("{site}", parser.title || parser.domain),
        body: "",
      });
      if (confirmed) {
        this.parsers = this.parsers.filter((p) => p.id !== id);
        delete this.enabledState[`enable_${id}`];
        await this.saveData();
        this.renderList();
      }
    }
  }

  // Editor
  showEditor(parser = null, liElement = null) {
    const editor = document.getElementById("editor");
    const list = document.getElementById("parserList");

    const currentSection = parser?.id || "new";
    if (editor.getAttribute("current") === currentSection) {
      editor.setAttribute("current", "0");
      this.hideEditor();
      return;
    }
    editor.setAttribute("current", currentSection);

    this.editingId = parser?.id || null;

    if (liElement) {
      liElement.insertAdjacentElement("afterend", editor);
    } else if (list.firstChild) {
      list.insertBefore(editor, list.firstChild);
    } else {
      list.appendChild(editor);
    }

    editor.hidden = false;

    document.getElementById("inTitle").value = parser?.title || "";
    document.getElementById("inDomain").value = parser?.domain || "";
    document.getElementById("inUrlPatterns").value = (parser?.urlPatterns || [".*"]).join(", ");
    document.getElementById("inMode").value = parser?.selectors?.mode || "listen";
    document.getElementById("inWatchAutoDetect").value = parser?.selectors?.watchAutoDetect || "enable";
    this.updateWatchAutoDetectVisibility();

    const sel = parser?.selectors || {};
    document.getElementById("selTitle").value = sel.title || "";
    document.getElementById("selArtist").value = sel.artist || "";
    document.getElementById("selSource").value = sel.source || "";
    document.getElementById("selImage").value = sel.image || "";
    document.getElementById("selIsPlaying").value = sel.isPlaying || "";
    document.getElementById("selTimePassed").value = sel.timePassed || "";
    document.getElementById("selDuration").value = sel.duration || "";
    document.getElementById("selLink").value = sel.link || "";
    document.getElementById("selButtonLink").value = sel.buttonLink || "";
    document.getElementById("selButtonText").value = sel.buttonText || "";
    document.getElementById("selButtonLink2").value = sel.buttonLink2 || "";
    document.getElementById("selButtonText2").value = sel.buttonText2 || "";
  }

  hideEditor() {
    const editor = document.getElementById("editor");
    editor.hidden = true;
    document.body.appendChild(editor);
    this.editingId = null;
  }

  updateWatchAutoDetectVisibility() {
    const isWatch = document.getElementById("inMode").value === "watch";
    document.querySelector(".container.watchAutoDetect").style.display = isWatch ? "" : "none";
  }

  async loadData() {
    try {
      const data = await browser.storage.local.get(["userParserSelectors", "parserEnabledState"]);
      this.parsers = Array.isArray(data.userParserSelectors) ? data.userParserSelectors : [];
      this.enabledState = data.parserEnabledState && typeof data.parserEnabledState === "object" ? data.parserEnabledState : {};
    } catch {
      this.parsers = [];
      this.enabledState = {};
    }
  }

  async saveData() {
    try {
      await browser.storage.local.set({
        userParserSelectors: this.parsers,
        parserEnabledState: this.enabledState,
      });
    } catch {
      showAlert(i18n.t("common.error"), "Storage write failure.", "danger");
    }
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

  renderList() {
    this.hideEditor();
    const ul = document.getElementById("parserList");

    while (ul.firstChild) ul.removeChild(ul.firstChild);

    if (this.parsers.length === 0) return;

    this.parsers.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    this.parsers.forEach((parser) => {
      const isEnabled = this.enabledState[`enable_${parser.id}`] !== false;

      const li = document.createElement("li");
      li.className = `parser-item${!isEnabled ? " disabled" : ""}`;

      // Info
      const infoDiv = document.createElement("div");
      infoDiv.className = "parser-info";

      const headerWrapper = document.createElement("div");
      headerWrapper.className = "parser-header-wrapper";

      const rawDomain = Array.isArray(parser.domain) ? parser.domain[0] : parser.domain;
      const primaryDomain = (rawDomain || "").replace(/^\*\./, "");

      // FavIcon
      const favIconContainer = document.createElement("div");
      favIconContainer.className = "parser-icon-container spinner";

      const favIcon = document.createElement("img");
      favIcon.className = "parser-icon hidden-visibility";
      favIcon.title = `${i18n.t("selector.preview.open").replace("{source}", parser.title || primaryDomain)}`;
      favIcon.dataset.src = primaryDomain;
      favIcon.loading = "lazy";
      favIcon.decoding = "async";
      favIcon.addEventListener("click", () => {
        window.open(`https://${primaryDomain}`, "_blank", "noopener,noreferrer");
      });
      favIconContainer.appendChild(favIcon);

      // Status badge
      const status = document.createElement("span");
      status.className = "script-status";
      status.classList.toggle("status-active", isEnabled);
      status.classList.toggle("status-inactive", !isEnabled);
      status.textContent = isEnabled ? i18n.t("userscript.status.active") : i18n.t("userscript.status.inactive");

      // Header
      const titleSpan = document.createElement("span");
      titleSpan.className = "parser-title";
      titleSpan.textContent = parser.title || parser.domain;

      const headerDiv = document.createElement("div");
      headerDiv.className = "parser-header";
      headerDiv.appendChild(favIconContainer);
      headerDiv.append(titleSpan, status);

      headerWrapper.appendChild(headerDiv);
      infoDiv.appendChild(headerWrapper);

      // Domain / pattern
      const domainSpan = document.createElement("small");
      domainSpan.className = "parser-domain";
      domainSpan.textContent = `${parser.domain} [${(parser.urlPatterns || [".*"]).join(", ")}]`;
      infoDiv.appendChild(domainSpan);

      // Actions
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "script-actions";

      const { btnToggle, btnEdit, btnExport, btnDelete } = createListActionButtons(parser.id, isEnabled);

      actionsDiv.append(btnToggle, btnEdit, btnExport, btnDelete);

      li.append(infoDiv, actionsDiv);
      ul.appendChild(li);
    });

    const allFavIcons = document.querySelectorAll(".parser-icon");
    if (typeof loadFavIcons === "function") loadFavIcons(allFavIcons);
  }

  cleanDomain = (d) => {
    return d
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .trim();
  };

  async saveParser() {
    const title = document.getElementById("inTitle").value.trim();
    const selTitle = document.getElementById("selTitle").value.trim();
    const urlPatternsStr = document.getElementById("inUrlPatterns").value.trim();

    // Domain Cleanup
    const domainRaw = document.getElementById("inDomain").value.trim();
    const domain = domainRaw.includes(",")
      ? domainRaw
          .split(",")
          .map((d) => this.cleanDomain(d))
          .filter(Boolean)
      : this.cleanDomain(domainRaw);

    const domainEmpty = Array.isArray(domain) ? domain.length === 0 : !domain;

    // Validation
    if (!title) {
      showAlert(i18n.t("userscript.editor.warn.emptyName"), "", "warn");
      return;
    }
    if (domainEmpty) {
      showAlert(i18n.t("userscript.editor.warn.emptyDomain"), "", "warn");
      return;
    }
    if (!selTitle) {
      showAlert(i18n.t("selector.editor.warn.fillTitleField"), "", "warn");
      return;
    }

    const urlPatterns = urlPatternsStr
      ? urlPatternsStr
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      : [".*"];

    const primaryDomain = Array.isArray(domain) ? domain[0] : domain;
    const newId = generateParserKey(primaryDomain, urlPatterns);

    const updatedObj = {
      id: newId,
      domain,
      title,
      urlPatterns,
      userAdd: true,
      selectors: {
        mode: document.getElementById("inMode").value,
        watchAutoDetect: document.getElementById("inWatchAutoDetect").value,
        title: selTitle,
        artist: document.getElementById("selArtist").value.trim() || undefined,
        source: document.getElementById("selSource").value.trim() || undefined,
        image: document.getElementById("selImage").value.trim() || undefined,
        isPlaying: document.getElementById("selIsPlaying").value.trim() || undefined,
        timePassed: document.getElementById("selTimePassed").value.trim() || undefined,
        duration: document.getElementById("selDuration").value.trim() || undefined,
        buttonLink: document.getElementById("selButtonLink").value.trim() || undefined,
        buttonText: document.getElementById("selButtonText").value.trim() || undefined,
        buttonLink2: document.getElementById("selButtonLink2").value.trim() || undefined,
        buttonText2: document.getElementById("selButtonText2").value.trim() || undefined,
      },
    };

    // Undefined cleanup
    Object.keys(updatedObj.selectors).forEach((k) => updatedObj.selectors[k] === undefined && delete updatedObj.selectors[k]);

    // Conflict Check
    const existingIndex = this.parsers.findIndex((p) => p.id === newId);
    const isEditing = this.editingId && this.editingId === newId;

    // New Registration
    if (this.editingId) {
      if (this.editingId !== newId) {
        if (this.enabledState[`enable_${this.editingId}`] !== undefined) {
          this.enabledState[`enable_${newId}`] = this.enabledState[`enable_${this.editingId}`];
          delete this.enabledState[`enable_${this.editingId}`];
        }
        this.parsers = this.parsers.filter((p) => p.id !== this.editingId);
      }
    }

    // Add or update
    const idx = this.parsers.findIndex((p) => p.id === newId);
    if (idx > -1) {
      this.parsers[idx] = updatedObj;
    } else {
      this.parsers.push(updatedObj);
    }

    await this.saveData();
    this.renderList();
    this.hideEditor();
  }

  // Export
  exportMenuClick(e, parser = null) {
    parser ? this.exportSingleParser(parser) : this.exportAllParsers();
  }

  exportSingleParser(parser) {
    const jsContent = `const userParserSelectors = ${JSON.stringify([parser], null, 4)};\n\nexport default userParserSelectors;`;
    this.downloadFile(jsContent, `web-presence-user-parser-${parser.title || parser.domain}-${new Date().toISOString().split("T")[0]}.js`, "application/javascript");
  }

  exportAllParsers() {
    if (this.parsers.length === 0) {
      showAlert(i18n.t("userscript.export.warn.noScripts"), "", "warn");
      return;
    }
    const jsonStr = JSON.stringify(this.parsers, null, 4);
    const jsContent = `const userParserSelectors = ${jsonStr};\n\nexport default userParserSelectors;`;
    this.downloadFile(jsContent, `web-presence-user-parsers-${new Date().toISOString().split("T")[0]}.js`, "application/javascript");
  }

  downloadFile(content, name, mime) {
    downloadBlob(content, name, mime);
  }

  // Import
  async importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let list = null;

      if (file.name.endsWith(".js")) {
        const start = text.indexOf("[");
        const end = text.lastIndexOf("]");
        if (start !== -1 && end !== -1) list = JSON.parse(text.substring(start, end + 1));
      } else {
        list = JSON.parse(text);
      }

      if (!Array.isArray(list)) list = [list];

      const existing = this.parsers;

      const duplicates = list.filter((s) => existing.some((ex) => ex.domain === s.domain && ex.title === s.title));
      const newParsers = list.filter((s) => !existing.some((ex) => ex.domain === s.domain && ex.title === s.title));

      await this.showImportModalSelection(duplicates, newParsers, existing);
      await this.renderList();
    } catch (err) {
      showAlert(i18n.t("userparser.import.title"), err.message || i18n.t("selector.generateError"), "warn");
    } finally {
      e.target.value = "";
    }
  }

  async showImportModalSelection(duplicates, newParsers, existing) {
    return new Promise((resolve) => {
      const { modal, content } = createModal();

      const titleEl = document.createElement("h2");
      titleEl.textContent = i18n.t("userparser.import.title");
      content.appendChild(titleEl);

      const contentWrapper = document.createElement("div");
      contentWrapper.className = "modal-content-wrapper";
      contentWrapper.id = "importModalBody";
      content.appendChild(contentWrapper);

      // Sections
      const sections = [];
      if (duplicates.length) {
        sections.push({
          header: i18n.t("userparser.import.conflict"),
          list: duplicates,
          prefix: "dup",
          options: [
            ["overwrite", i18n.t("userscript.import.conflict.overwrite")],
            ["skip", i18n.t("button.skip")],
          ],
        });
      }
      if (newParsers.length) {
        sections.push({
          header: i18n.t("userparser.import.new"),
          list: newParsers,
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

      if (duplicates.length) {
        content.appendChild(
          this.createGroupButtons([
            { text: i18n.t("userscript.import.conflict.overwrite.text"), list: duplicates, prefix: "dup", value: "overwrite" },
            { text: i18n.t("userscript.import.conflict.skip.text"), list: duplicates, prefix: "dup", value: "skip" },
          ]),
        );
      }
      if (newParsers.length) {
        content.appendChild(
          this.createGroupButtons([
            { text: i18n.t("userparser.import.new.all"), list: newParsers, prefix: "new", value: "add" },
            { text: i18n.t("userparser.import.new.skip"), list: newParsers, prefix: "new", value: "skip" },
          ]),
        );
      }

      let importFinished = true;
      const resultContainer = document.createElement("div");
      resultContainer.className = "result-container";
      content.appendChild(resultContainer);

      const confirmBtn = this.createButton(i18n.t("userscript.import.confirm"), async () => {
        if (!importFinished) return;
        importFinished = false;
        confirmBtn.textContent = i18n.t("common.wait");
        this.saveUserSelection(duplicates, "dup");
        this.saveUserSelection(newParsers, "new");
        const results = await this.processImport([...duplicates, ...newParsers], existing);
        this.showResults(resultContainer, results);
        confirmBtn.textContent = i18n.t("userscript.import.confirm");
        importFinished = true;
        contentWrapper.remove();
      });
      confirmBtn.className = "btn confirm-button";

      const closeBtn = this.createButton(i18n.t("common.close"), () => {
        if (!importFinished) return;
        modal.remove();
        resolve({ duplicates, newParsers });
      });
      closeBtn.className = "btn close-btn";

      const buttonContainer = document.createElement("div");
      buttonContainer.className = "button-group footer-buttons";
      buttonContainer.append(confirmBtn, closeBtn);
      content.appendChild(buttonContainer);
      document.body.appendChild(modal);

      if (typeof activateSimpleBar === "function") activateSimpleBar("importModalBody");

      window.onclick = (ev) => {
        if (importFinished && ev.target === modal) {
          modal.remove();
          resolve({ duplicates, newParsers });
        }
      };
    });
  }

  async processImport(parsers, existing) {
    const results = [];
    for (const p of parsers) {
      if (!p.title || !p.domain) {
        results.push({ ...p, status: "error" });
        continue;
      }
      if (p.choice === "skip") {
        results.push({ ...p, status: "skipped" });
        continue;
      }

      p.userAdd = true;

      // Overwrite: keep the current record's id
      const match = existing.find((ex) => ex.domain === p.domain && ex.title === p.title);
      if (match) p.id = match.id;

      const idx = this.parsers.findIndex((ex) => ex.id === p.id);
      if (idx > -1) {
        this.parsers[idx] = p;
      } else {
        this.parsers.push(p);
        this.enabledState[`enable_${p.id}`] = true;
      }

      try {
        await this.saveData();
        results.push({ ...p, status: "success" });
      } catch {
        results.push({ ...p, status: "error" });
      }
    }
    return results;
  }

  showResults(container, results) {
    document.querySelectorAll(".section, .button-group:not(.footer-buttons), .confirm-button").forEach((el) => el.remove());
    document.querySelector(".modal h2").textContent = i18n.t("common.results");

    const ul = document.createElement("ul");
    ul.id = "importResultList";

    results.forEach((r) => {
      const li = document.createElement("li");
      li.classList.add(r.status);

      const statusEl = document.createElement("div");
      statusEl.className = "status-text";
      statusEl.textContent = i18n.t(`userscript.export.status.${r.status}`);

      const titleEl = document.createElement("div");
      titleEl.className = "script-title";
      titleEl.textContent = r.title || i18n.t("common.empty");

      const domainEl = document.createElement("div");
      domainEl.className = "script-domain";
      domainEl.textContent = ` - ${r.domain || ""}`;

      li.append(statusEl, titleEl, domainEl);
      ul.appendChild(li);
    });

    container.appendChild(ul);
    if (typeof activateSimpleBar === "function") activateSimpleBar("importResultList");
  }

  createSelectItem(parser, index, prefix, options) {
    const wrap = document.createElement("div");
    wrap.className = "import-item";

    const label = document.createElement("span");
    label.className = "import-item-label";
    label.textContent = `${parser.title || i18n.t("common.empty")} (${parser.domain || "unknown"})`;

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
        container.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
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
}

// Motion Preference Check
initMotionPreference();

// Initialize the UI
const userParserUI = new UserParserUI();
