// FORM CONTROLLER - Manages filter creation/editing form
const FormController = {
  toggle() {
    if (FilterState.form.isOpen && !FilterState.form.editingFilterId) {
      this.close();
    } else {
      this.open();
    }
  },

  // Open "new filter" form - Pass "preseed" to skip state reset (caller has already set form/parser state).
  open(preseed = false) {
    const form = document.getElementById("formContainer");
    const btn = document.getElementById("toggleFormBtn");

    this.exitEdit(false);

    FilterState.form.isOpen = true;
    FilterState.form.editingFilterId = null;
    FilterState.form.replaceAction = "update";

    if (!preseed) {
      FilterState.form.mode = "filter";
      FilterState.form.entries = [{ artist: "", title: "", replaceArtist: "", replaceTitle: "" }];
      ParserController.reset();
    }

    this._renderForm(form, { isNew: true });

    form.classList.add("active");
    btn.textContent = i18n.t("common.cancel");
    btn.classList.add("cancel-mode");

    document.querySelectorAll(".filter-item").forEach((el) => el.classList.add("dimmed"));
  },

  // Close "new filter" form
  close() {
    const form = document.getElementById("formContainer");
    const btn = document.getElementById("toggleFormBtn");

    form.classList.remove("active");
    btn.textContent = i18n.t("filter.addNew");
    btn.classList.remove("cancel-mode");

    this.exitEdit(false);

    FilterState.form.isOpen = false;
    FilterState.form.editingFilterId = null;
  },

  // Reset state
  reset() {
    FilterState.form.editingFilterId = null;
    FilterState.form.mode = "filter";
    FilterState.form.entries = [{ artist: "", title: "", replaceArtist: "", replaceTitle: "" }];
    FilterState.form.replaceAction = "update";
    ParserController.reset();
  },

  // Start editing an existing filter inline inside its card
  async startEdit(filter, scrollToIndex = null, appendEntry = null) {
    if (FilterState.form.editingFilterId === filter.id && FilterState.form.isOpen) {
      this.exitEdit();
      return;
    }

    // Close new-filter form if open
    if (FilterState.form.isOpen && !FilterState.form.editingFilterId) {
      const form = document.getElementById("formContainer");
      const btn = document.getElementById("toggleFormBtn");
      if (form) form.classList.remove("active");
      if (btn) {
        btn.textContent = i18n.t("filter.addNew");
        btn.classList.remove("cancel-mode");
      }
    }
    this.exitEdit(false);

    // Dim all other cards
    document.querySelectorAll(".filter-item").forEach((el) => el.classList.add("dimmed"));

    const filterItem = document.querySelector(`[data-filter-id="${filter.id}"]`);
    if (!filterItem) return;

    filterItem.classList.remove("dimmed");
    filterItem.classList.add("editing");

    // Swap edit icon with close icon
    const editBtn = filterItem.querySelector(".icon-btn");
    if (editBtn) {
      editBtn.innerHTML = "";
      editBtn.appendChild(createSVG(svg_paths.crossIconPaths));
      editBtn.title = i18n.t("common.close");
    }

    // Load state
    FilterState.form.editingFilterId = filter.id;
    FilterState.form.mode = FilterUtils.isReplaceFilter(filter) ? "replace" : "filter";
    FilterState.form.entries = JSON.parse(JSON.stringify(filter.entries)).map((e) => ({
      artist: e.artist || "",
      title: e.title || "",
      replaceArtist: e.replaceArtist || "",
      replaceTitle: e.replaceTitle || "",
    }));
    ParserController.loadFromFilter(filter);

    // Append an extra pre-filled entry if requested
    if (appendEntry) {
      FilterState.form.entries.push({
        artist: appendEntry.artist || "",
        title: appendEntry.title || "",
        replaceArtist: appendEntry.replaceArtist || "",
        replaceTitle: appendEntry.replaceTitle || "",
      });
      scrollToIndex = FilterState.form.entries.length - 1;
    }
    FilterState.form.isOpen = true;

    const editorSlot = filterItem.querySelector(".filter-inline-editor");
    if (editorSlot) {
      this._renderForm(editorSlot, { isNew: false });
    }

    // Scroll to a specific entry row if requested
    if (scrollToIndex !== null && scrollToIndex >= 0) {
      await new Promise((r) => setTimeout(r, 50));
      const rows = editorSlot?.querySelectorAll(".inline-entry-row");
      const target = rows?.[scrollToIndex];
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("highlight-entry");
        setTimeout(() => target.classList.remove("highlight-entry"), 2000);
      }
    }
  },

  // Exit inline edit mode, restore card to collapsed state
  exitEdit(resetState = true) {
    document.querySelectorAll(".filter-item.editing").forEach((item) => {
      item.classList.remove("editing");

      const editBtn = item.querySelector(".icon-btn");
      if (editBtn) {
        editBtn.innerHTML = "";
        editBtn.appendChild(createSVG(svg_paths.penIconPaths));
        editBtn.title = i18n.t("common.edit");
      }

      const slot = item.querySelector(".filter-inline-editor");
      if (slot) {
        FilterEvents.removeFrom(slot);
        slot.innerHTML = "";
      }
    });

    document.querySelectorAll(".filter-item.dimmed").forEach((el) => el.classList.remove("dimmed"));

    if (resetState) {
      FilterState.form.isOpen = false;
      FilterState.form.editingFilterId = null;
    }
  },

  // Add new entry
  addEntry() {
    FilterState.form.entries.push({ artist: "", title: "", replaceArtist: "", replaceTitle: "" });
  },

  // Remove entry
  async removeEntry(index) {
    const entry = FilterState.form.entries[index];
    const isReplaceMode = FilterState.form.mode === "replace";
    const hasReplace = isReplaceMode && (entry.replaceArtist.trim() || entry.replaceTitle.trim());

    // Ask about reverting if editing replace filter
    if (hasReplace && FilterState.form.editingFilterId) {
      const shouldRevert = await showConfirm("", {
        type: "info",
        heading: i18n.t("filter.confirm.restore"),
        labelCancel: i18n.t("common.close"),
      });

      if (shouldRevert) {
        const filter = FilterState.parserFilters.find((f) => f.id === FilterState.form.editingFilterId);
        if (filter) {
          await sendAction("filterHistoryReplace", {
            mode: "revert",
            entries: [{ artist: entry.artist || "", title: entry.title || "", replaceArtist: entry.replaceArtist || "", replaceTitle: entry.replaceTitle || "" }],
            parsers: filter.parsers,
            parserList: FilterState.parserList,
          });
        }
      }
    }

    FilterState.form.entries.splice(index, 1);
  },

  // Validate form data before saving
  validate() {
    const { entries, mode } = FilterState.form;
    const isReplace = mode === "replace";
    const validEntries = entries.filter((e) => e.artist.trim() || e.title.trim());

    if (validEntries.length === 0) {
      showAlert(i18n.t("filter.warn.empty"), "", "warn");
      return null;
    }

    // Check replace mode has replacement values
    if (isReplace) {
      const missing = validEntries.some((e) => (e.artist.trim() || e.title.trim()) && !e.replaceArtist.trim() && !e.replaceTitle.trim());
      if (missing) {
        showAlert(i18n.t("filter.warn.emptyReplace"), "", "warn");
        return null;
      }
    }

    if (!ParserController.validate()) return null;
    return validEntries;
  },

  // Save filter
  async save() {
    const validEntries = this.validate();
    if (!validEntries) return;

    const { editingFilterId, mode } = FilterState.form;
    const isReplace = mode === "replace";
    const selectedParsers = ParserController.getSelection();

    // Find existing filter with same parsers and mode
    const existingFilterIndex = FilterState.parserFilters.findIndex((f) => {
      if (editingFilterId && f.id === editingFilterId) return false;
      if (f.parsers.length !== selectedParsers.length) return false;

      const parsersMatch = [...f.parsers].sort().every((v, i) => v === [...selectedParsers].sort()[i]);
      if (!parsersMatch) return false;
      return FilterUtils.isReplaceFilter(f) === isReplace;
    });

    let entriesToProcess = [];
    let parsersToProcess = [];

    if (existingFilterIndex !== -1 && !editingFilterId) {
      const existingFilter = FilterState.parserFilters[existingFilterIndex];
      const newUnique = validEntries.filter(
        (entry) => !existingFilter.entries.some((ex) => FilterUtils.createEntryKey(entry, isReplace) === FilterUtils.createEntryKey(ex, isReplace)),
      );

      if (newUnique.length === 0) {
        showAlert(i18n.t("filter.warn.exists"), "", "warn");
        return;
      }

      existingFilter.entries.push(...newUnique);
      existingFilter.updatedAt = new Date().toISOString();

      if (isReplace) {
        entriesToProcess = newUnique;
        parsersToProcess = existingFilter.parsers;
      }
    } else {
      // Create new or update existing filter
      const uniqueEntries = FilterUtils.removeDuplicates(validEntries, isReplace);
      const filterData = {
        entries: uniqueEntries.map((entry) => {
          const clean = { artist: entry.artist, title: entry.title };
          if (isReplace) {
            clean.replaceArtist = entry.replaceArtist || "";
            clean.replaceTitle = entry.replaceTitle || "";
          }
          return clean;
        }),
        parsers: selectedParsers,
      };

      if (editingFilterId) {
        const idx = FilterState.parserFilters.findIndex((f) => f.id === editingFilterId);
        if (idx === -1) {
          showAlert(i18n.t("filter.notFound"), "", "warn");
          return;
        }
        FilterState.parserFilters[idx] = { ...FilterState.parserFilters[idx], ...filterData, updatedAt: new Date().toISOString() };
      } else {
        FilterState.parserFilters.push({ id: FilterUtils.generateId(), createdAt: new Date().toISOString(), ...filterData });
      }

      if (isReplace) {
        entriesToProcess = filterData.entries;
        parsersToProcess = selectedParsers;
      }
    }

    await FilterStorage.saveFilters();

    // Process filter for replace mode
    if (isReplace && entriesToProcess.length > 0) {
      await sendAction("filterHistoryReplace", {
        mode: FilterState.form.replaceAction,
        entries: entriesToProcess,
        parsers: parsersToProcess,
        parserList: FilterState.parserList,
      });
    }

    FilterTabsController.render();
    FilterListController.render();
    this.exitEdit(false);
    this.close();
  },

  /**
   * Renders the complete form UI into `container`.
   *
   * @param {HTMLElement} container
   * @param {{ isNew: boolean }} options
   *   isNew = true  → new filter: show mode toggle header + fill-current button
   *   isNew = false → edit filter: mode is fixed, no header, no fill button
   */
  _renderForm(container, { isNew }) {
    FilterEvents.removeFrom(container);
    container.innerHTML = "";

    // HEADER - mode toggle (new filter only)
    if (isNew) {
      const header = document.createElement("div");
      header.className = "new-filter-header";

      const modeToggle = document.createElement("div");
      modeToggle.className = "mode-options segmented-toggle";

      const renderModeToggle = () => {
        modeToggle.innerHTML = "";
        [
          { value: "filter", label: i18n.t("common.block") },
          { value: "replace", label: i18n.t("common.replace") },
        ].forEach((m) => {
          const btn = document.createElement("button");
          btn.className = `mode-option segmented-option${FilterState.form.mode === m.value ? " active" : ""}`;
          btn.textContent = m.label;
          FilterEvents.add(btn, "click", () => {
            FilterState.form.mode = m.value;
            renderModeToggle();
            renderEntries();
          });
          modeToggle.appendChild(btn);
        });
      };

      // Expose so renderEntries can trigger first paint via closure
      header._renderModeToggle = renderModeToggle;
      header.append(modeToggle);
      container.appendChild(header);
    }

    // ENTRIES
    const entriesSection = document.createElement("div");
    entriesSection.className = "inline-entries-section";

    const entriesList = document.createElement("div");
    entriesList.className = "inline-entries-list";
    entriesSection.appendChild(entriesList);

    const renderEntries = () => {
      const isReplace = FilterState.form.mode === "replace";
      FilterEvents.removeFrom(entriesList);
      entriesList.innerHTML = "";

      FilterState.form.entries.forEach((entry, index) => {
        const row = document.createElement("div");
        row.className = `inline-entry-row${isReplace ? " replace-mode" : ""}`;

        const num = document.createElement("span");
        num.className = "entry-num";
        num.textContent = index + 1;

        // Original inputs
        const originalGroup = document.createElement("div");
        originalGroup.className = "inline-input-group";
        originalGroup.append(
          this._input(
            isReplace ? i18n.t("filter.artist.original") : i18n.t("filter.artist"),
            entry.artist,
            (e) => {
              FilterState.form.entries[index].artist = e.target.value;
            },
            "input-original",
          ),
          this._input(
            isReplace ? i18n.t("filter.title.original") : i18n.t("filter.title"),
            entry.title,
            (e) => {
              FilterState.form.entries[index].title = e.target.value;
            },
            "input-original",
          ),
        );
        row.append(num, originalGroup);

        // Replace inputs
        if (isReplace) {
          const arrow = document.createElement("span");
          arrow.className = "entry-replace-arrow";
          arrow.appendChild(createSVG(svg_paths.forwardIconPaths));
          row.appendChild(arrow);

          const replaceGroup = document.createElement("div");
          replaceGroup.className = "inline-input-group";
          replaceGroup.append(
            this._input(
              i18n.t("filter.artist.new"),
              entry.replaceArtist,
              (e) => {
                FilterState.form.entries[index].replaceArtist = e.target.value;
              },
              "input-replace",
            ),
            this._input(
              i18n.t("filter.title.new"),
              entry.replaceTitle,
              (e) => {
                FilterState.form.entries[index].replaceTitle = e.target.value;
              },
              "input-replace",
            ),
          );
          row.appendChild(replaceGroup);
        }

        // Remove button
        if (FilterState.form.entries.length > 1) {
          const removeBtn = document.createElement("button");
          removeBtn.className = "icon-btn icon-btn-danger inline-remove";
          removeBtn.appendChild(createSVG(svg_paths.crossIconPaths));
          FilterEvents.add(removeBtn, "click", () => {
            this.removeEntry(index).then(() => renderEntries());
          });
          row.appendChild(removeBtn);
        }

        entriesList.appendChild(row);
      });
    };

    const fillAddWrapper = document.createElement("div");
    fillAddWrapper.className = "fill-add-wrapper";

    const fillBtn = document.createElement("button");
    fillBtn.className = "btn btn-sm fill";
    fillBtn.textContent = i18n.t("filter.fillWithCurrent");
    FilterEvents.add(fillBtn, "click", () => QuickActions.fillCurrent(renderEntries, fillBtn));
    fillAddWrapper.appendChild(fillBtn);

    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-sm add";
    addBtn.textContent = i18n.t("filter.add");
    FilterEvents.add(addBtn, "click", () => {
      FilterState.form.entries.push({ artist: "", title: "", replaceArtist: "", replaceTitle: "" });
      renderEntries();
    });
    fillAddWrapper.appendChild(addBtn);
    entriesSection.appendChild(fillAddWrapper);
    container.appendChild(entriesSection);

    // Parser Chips
    const parserSection = document.createElement("div");
    parserSection.className = "inline-parser-section";

    const parserLabel = document.createElement("div");
    parserLabel.className = "inline-section-label";
    parserLabel.textContent = i18n.t("filter.websites");

    // Select All Parsers
    const allLabel = document.createElement("label");
    allLabel.className = "switch-label parser-all-label";

    // text
    const allText = document.createElement("span");
    allText.className = "parser-all-text";
    allText.textContent = i18n.t("common.selectAll");

    // checkbox
    const allCheckbox = document.createElement("input");
    allCheckbox.spellcheck = false;
    allCheckbox.autocomplete = "off";
    allCheckbox.type = "checkbox";
    allCheckbox.checked = FilterState.parsers.allSelected;
    allCheckbox.className = "parser-all-checkbox";

    // slider
    const slider = document.createElement("span");
    slider.className = "slider";

    // append
    allLabel.append(allText, allCheckbox, slider);

    const parserHeader = document.createElement("div");
    parserHeader.className = "inline-parser-header";
    parserHeader.append(parserLabel, allLabel);
    parserSection.appendChild(parserHeader);

    const renderParsers = () => {
      const existing = parserSection.querySelector(".inline-parser-chips");
      if (existing) existing.remove();

      const { allSelected, selectedIds } = FilterState.parsers;
      allCheckbox.checked = allSelected;

      const chips = document.createElement("div");
      chips.className = "inline-parser-chips";

      if (allSelected) {
        chips.appendChild(
          this._chip(i18n.t("filter.websites.all"), "selected", () => {
            ParserController.toggleAll(false);
            renderParsers();
          }),
        );
      } else {
        selectedIds.forEach((id) => {
          const parser = FilterState.parserList.find((p) => p.id === id);

          if (!parser) {
            // Orphaned ID - site no longer exists in parserList
            chips.appendChild(
              this._chip("Unknown site", "orphaned", () => {
                ParserController.toggle(id, false);
                renderParsers();
              }),
            );
            return;
          }

          chips.appendChild(
            this._chip(parser.title || parser.domain, "selected", () => {
              ParserController.toggle(id, false);
              renderParsers();
            }),
          );
        });

        FilterState.parserList
          .filter((p) => !selectedIds.includes(p.id))
          .sort((a, b) => {
            const aKey = (a.title || a.domain || "").toLowerCase();
            const bKey = (b.title || b.domain || "").toLowerCase();
            return aKey.localeCompare(bKey);
          })
          .forEach((parser) => {
            const chip = document.createElement("span");
            chip.className = "parser-chip available";
            chip.textContent = parser.title || parser.domain;

            FilterEvents.add(chip, "click", () => {
              ParserController.toggle(parser.id, true);
              renderParsers();
            });

            chips.appendChild(chip);
          });
      }

      parserSection.appendChild(chips);
    };

    FilterEvents.add(allCheckbox, "change", (e) => {
      ParserController.toggleAll(e.target.checked);
      renderParsers();
    });

    container.appendChild(parserSection);

    // FOOTER
    const footer = document.createElement("div");
    footer.className = isNew ? "inline-editor-footer new-filter-footer" : "inline-editor-footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary btn-sm";
    cancelBtn.textContent = i18n.t("common.cancel");
    FilterEvents.add(cancelBtn, "click", () => (isNew ? this.close() : this.exitEdit()));

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-sm";
    saveBtn.textContent = i18n.t("common.save");
    FilterEvents.add(saveBtn, "click", () => this.save());

    footer.append(saveBtn, cancelBtn);
    container.appendChild(footer);

    // INITIAL PAINT
    if (isNew) {
      const header = container.querySelector(".new-filter-header");
      if (header?._renderModeToggle) header._renderModeToggle();
    }
    renderEntries();
    renderParsers();
  },

  // HELPERS
  _input(placeholder, value, onInput, className = "") {
    const input = document.createElement("input");
    input.spellcheck = false;
    input.autocomplete = "off";
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value || "";
    if (className) input.className = `input ${className}`;
    FilterEvents.add(input, "input", onInput);
    return input;
  },

  _chip(label, type, onRemove) {
    const chip = document.createElement("span");
    chip.className = `parser-chip ${type}`;
    chip.textContent = label;
    const x = document.createElement("span");
    x.className = "chip-remove";
    x.textContent = "✕";
    FilterEvents.add(x, "click", onRemove);
    chip.appendChild(x);
    return chip;
  },

  // Stubs - kept so filter.js initFilter() doesn't break if called
  renderMode() {},
  renderEntries() {},

  // Legacy alias
  createInput(placeholder, value, onInput, className = "") {
    return this._input(placeholder, value, onInput, className);
  },
};
