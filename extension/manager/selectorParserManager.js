class UserParserUI {
  constructor() {
    this.editingId = null;
    this.parsers = [];
    this.enabledState = {};
    this.searchQuery = "";
    this.init();
  }

  async init() {
    if (typeof i18n !== "undefined") {
      await i18n.load("extension");
      if (typeof applyTranslations === "function") applyTranslations();
    }
    if (typeof initApplyAttrs === "function") initApplyAttrs();
    await this.restoreSidebarWidth();
    this.bindEvents();
    await this.loadData();
    this.renderList();
    await this.restoreContext();
    initStorageListener();
    initNewDots();
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

    document.getElementById("usmListBtn")?.appendChild(createSVG(svg_paths.menuIconPaths));

    document.getElementById("usmBtnListToggle")?.addEventListener("click", () => {
      const sidebar = document.querySelector(".usm-sidebar");
      sidebar?.classList.toggle("collapsed");
      document.querySelectorAll(".script-item, .parser-item").forEach((li) => {
        li.classList.toggle("collapsed", sidebar?.classList.contains("collapsed"));
      });
      this.saveSidebarWidth();
    });

    // Search input - filter list client-side without refetching
    const scriptSearchEl = document.getElementById("scriptSearch");
    const scriptSearchResetBtn = document.getElementById("scriptSearchResetBtn");
    const debouncedRefreshList = debounce(() => this.renderList(), 300);
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
      this.renderList();
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".parser-item")) this.closeOverflowMenus();
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
      }
    } catch (_) {}
  }

  // List Actions
  async handleListClick(e) {
    const button = e.target.closest("button");
    if (button) {
      e.preventDefault();
      e.stopPropagation();

      const li = button.closest("li");
      if (!li) return;
      const id = li.dataset.id;
      const parser = this.parsers.find((p) => p.id === id);
      if (!parser) return;

      if (button.classList.contains("btnToggle")) {
        const stateKey = `enable_${parser.id}`;
        const currentStatus = this.enabledState[stateKey] !== false;

        if (currentStatus) {
          this.enabledState[stateKey] = false;
        } else {
          delete this.enabledState[stateKey];
        }

        await this.saveData();
        this.renderList();
        return;
      }
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
      if (button.classList.contains("btnEdit")) return this.showEditor(parser);
      if (button.classList.contains("btnExport")) return this.exportMenuClick(e, parser);
      if (button.classList.contains("btnDelete")) {
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
        return;
      }
      return;
    }

    this.closeOverflowMenus();
    const li = e.target.closest("li.parser-item");
    if (!li) return;
    const id = li.dataset.id;
    if (!id) return;
    e.preventDefault();

    const parser = this.parsers.find((p) => p.id === id);
    if (parser) this.showEditor(parser);
  }

  closeOverflowMenus() {
    document.querySelectorAll(".usm-overflow-menu").forEach((menu) => {
      menu.hidden = true;
    });
  }

  // Editor
  showEditor(parser = null) {
    const editor = document.getElementById("editor");
    const editorEmpty = document.getElementById("editorEmpty");

    const currentSection = parser?.id || "new";
    if (editor.getAttribute("current") === currentSection) {
      editor.setAttribute("current", "0");
      this.hideEditor();
      return;
    }
    editor.setAttribute("current", currentSection);

    this.editingId = parser?.id || null;

    document.getElementById("editorTitle").textContent = parser ? `${i18n.t("userparser.editor.editParser")} [${parser.title}]` : i18n.t("userparser.editor.newParser");

    const isEnabled = parser ? this.enabledState[`enable_${parser.id}`] !== false : false;
    const statusEl = document.getElementById("editorStatus");
    const favEl = document.querySelector(".usm-editor-favicon");
    if (statusEl) {
      statusEl.textContent = isEnabled ? i18n.t("userscript.status.active") : i18n.t("userscript.status.inactive");
      statusEl.className = `usm-editor-status${isEnabled ? " status-active" : " status-inactive"}`;
    }
    if (favEl && parser) {
      const rawDomain = Array.isArray(parser.domain) ? parser.domain[0] : parser.domain;
      const primaryDomain = (rawDomain || "").replace(/^\*\./, "");
      favEl.dataset.src = primaryDomain;
      favEl.classList.add("hidden-visibility");
      favEl.src = "";
    } else if (favEl) {
      favEl.dataset.src = "";
      favEl.src = "";
    }
    loadFavIcons([favEl]);

    editor.hidden = false;
    if (editorEmpty) editorEmpty.hidden = true;

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

    this.syncSelectedItem();
  }

  hideEditor() {
    const editor = document.getElementById("editor");
    const editorEmpty = document.getElementById("editorEmpty");
    editor.hidden = true;
    editor.setAttribute("current", "0");
    if (editorEmpty) editorEmpty.hidden = false;
    this.editingId = null;
    this.syncSelectedItem();
  }

  syncSelectedItem() {
    const editor = document.getElementById("editor");
    const openId = editor && !editor.hidden ? this.editingId : null;
    document.querySelectorAll("#parserList .parser-item").forEach((li) => {
      li.classList.toggle("selected", !!openId && li.dataset.id === String(openId));
    });
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
      document.querySelector(`#parserList li[data-id="${target}"]`)?.click();
    }
    // remove managerContext after restoring
    await browser.storage.local.remove("managerContext");
  }

  renderList() {
    this.hideEditor();
    const ul = document.getElementById("parserList");

    const host = ul.querySelector(".simplebar-content") || ul;

    while (host.firstChild) host.removeChild(host.firstChild);

    const filteredList = this.filterList(this.parsers);

    if (filteredList.length === 0) {
      if (this.searchQuery) {
        const emptyMsg = document.createElement("li");
        emptyMsg.className = "script-empty-message";
        emptyMsg.textContent = i18n.t("userparser.list.noResults");
        host.appendChild(emptyMsg);
        this.refreshListScroll();
      }
      return;
    }

    filteredList.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    filteredList.forEach((parser) => {
      const isEnabled = this.enabledState[`enable_${parser.id}`] !== false;

      const li = document.createElement("li");
      li.dataset.id = parser.id;
      li.dataset.title = parser.title;
      li.className = `parser-item${!isEnabled ? " disabled" : ""}`;

      // Info
      const infoDiv = document.createElement("div");
      infoDiv.className = "parser-info";

      const headerDiv = document.createElement("div");
      headerDiv.className = "parser-header";

      const rawDomain = Array.isArray(parser.domain) ? parser.domain[0] : parser.domain;
      const primaryDomain = (rawDomain || "").replace(/^\*\./, "");

      // FavIcon
      const favIconContainer = document.createElement("div");
      favIconContainer.className = "parser-icon-container spinner";
      favIconContainer.title = parser.title || parser.domain;

      const favIcon = document.createElement("img");
      favIcon.className = "parser-icon hidden-visibility";
      favIcon.title = `${i18n.t("selector.preview.open").replace("{source}", parser.title || primaryDomain)}`;
      favIcon.dataset.src = primaryDomain;
      favIcon.loading = "lazy";
      favIcon.decoding = "async";
      favIcon.addEventListener("click", (ev) => {
        ev.stopPropagation();
        window.open(`https://${primaryDomain}`, "_blank", "noopener,noreferrer");
      });
      favIconContainer.appendChild(favIcon);
      headerDiv.appendChild(favIconContainer);

      const titleSpan = document.createElement("span");
      titleSpan.className = "parser-title";
      titleSpan.textContent = parser.title || parser.domain;
      headerDiv.appendChild(titleSpan);

      // Status badge
      const status = document.createElement("span");
      status.className = "script-status badge badge-sm badge-rounded";
      status.classList.toggle("status-active", isEnabled);
      status.classList.toggle("status-inactive", !isEnabled);
      status.textContent = isEnabled ? i18n.t("userscript.status.active") : i18n.t("userscript.status.inactive");
      status.title = status.textContent;
      headerDiv.appendChild(status);

      infoDiv.appendChild(headerDiv);

      // Actions
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "script-actions";

      const btnToggle = createListActionButton(
        isEnabled ? svg_paths.pauseIconPaths : svg_paths.startIconPaths,
        `btnToggle btn ${isEnabled ? "btn-disable" : "btn-enable"}`,
        isEnabled ? i18n.t("common.disable") : i18n.t("common.enable"),
        parser.id,
      );
      actionsDiv.appendChild(btnToggle);

      const btnMore = document.createElement("button");
      btnMore.type = "button";
      btnMore.className = "btnMore btn";
      btnMore.title = i18n.t("userscript.listControls.moreActions");
      btnMore.appendChild(createSVG(svg_paths.moreIconPaths));
      actionsDiv.appendChild(btnMore);

      const menu = document.createElement("div");
      menu.className = "usm-overflow-menu";
      menu.hidden = true;
      const btnExport = createListActionButton(svg_paths.exportIconPaths, "btnExport", i18n.t("userscript.listControls.export"), parser.id, { strokeWidth: 1.5 });
      const btnDelete = createListActionButton(svg_paths.trashIconPaths, "btnDelete", i18n.t("common.delete"), parser.id);
      menu.append(btnExport, btnDelete);

      actionsDiv.appendChild(menu);

      li.append(infoDiv, actionsDiv);
      host.appendChild(li);
    });

    const allFavIcons = document.querySelectorAll(".parser-icon");
    if (typeof loadFavIcons === "function") loadFavIcons(allFavIcons);
    this.refreshListScroll();
  }

  filterList(list) {
    if (!this.searchQuery) return list;
    const query = this.searchQuery;
    return list.filter((parser) => {
      const title = (parser.title || "").toLowerCase();
      const domain = Array.isArray(parser.domain) ? parser.domain.join(" ") : parser.domain || "";
      const urlPatterns = (parser.urlPatterns || []).join(" ");
      return title.includes(query) || domain.toLowerCase().includes(query) || urlPatterns.toLowerCase().includes(query);
    });
  }

  refreshListScroll() {
    const ul = document.getElementById("parserList");
    if (!ul || typeof activateSimpleBar !== "function") return;
    Promise.resolve()
      .then(() => activateSimpleBar("parserList"))
      .catch(() => {})
      .then(() =>
        requestAnimationFrame(() => {
          try {
            window.SimpleBar?.instances?.get(ul)?.recalculate();
          } catch (_) {}
        }),
      );
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

    // Validate selector syntax for every filled field before persisting
    const draftSelectors = {
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
    };

    const sharedValidation = validateSelectorConfig(draftSelectors, { urlPatterns });
    if (!sharedValidation.ok) {
      showAlert(i18n.t("selector.editor.warn.invalidFields"), sharedValidation.invalidFields.map((labelKey) => i18n.t(labelKey)).join(", "), "warn");
      return;
    }

    const primaryDomain = Array.isArray(domain) ? domain[0] : domain;
    let newId;
    try {
      newId = generateParserKey(primaryDomain, urlPatterns);
    } catch (err) {
      logError("[selectorParserManager]: Failed to generate parser id:", err);
      showAlert(i18n.t("common.error"), "", "error");
      return;
    }

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
        window.removeEventListener("click", onWindowClick);
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

      // addEventListener keeps pre-existing window click handlers intact.
      const onWindowClick = (ev) => {
        if (importFinished && ev.target === modal) closeViaOutside();
      };
      const closeViaOutside = () => {
        window.removeEventListener("click", onWindowClick);
        modal.remove();
        resolve({ duplicates, newParsers });
      };
      window.addEventListener("click", onWindowClick);
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
