const SETTING_TYPES = {
  TEXT: "text",
  CHECKBOX: "checkbox",
  SELECT: "select",
};

class UseSettingParser {
  constructor() {
    this.regex = /useSetting\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3\s*,\s*(['"])([^'"]+)\5\s*,\s*([\s\S]*?)\)\s*;/g;
  }

  parse(code) {
    const settings = [];
    let match;
    while ((match = this.regex.exec(code)) !== null) {
      const key = match[2];
      const label = match[4];
      const type = match[6];
      const raw = (match[7] || "").trim();
      const defaultValue = this.parseDefaultValue(raw);
      settings.push({ key, label, type, defaultValue, raw });
    }
    return settings;
  }

  // defaultValue parsing
  parseDefaultValue(raw) {
    if (!raw) return "";
    const val = raw.trim();

    if (val === "true") return true;
    if (val === "false") return false;

    // Strings wrapped in quotes
    if (/^(['"]).*\1$/.test(val)) {
      return val.slice(1, -1);
    }

    // If it looks like JSON (array/object) attempt to normalize and parse
    if (/^[[]{]/.test(val)) {
      // Normalize unquoted object keys like {a: 1} => {"a":1}
      const safe = val.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
      try {
        return JSON.parse(safe);
      } catch (err) {
        // If parse fails, return raw but log for debugging
        console.warn("parseDefaultValue JSON.parse failed:", err, val);
        return val;
      }
    }

    // Try to parse number
    if (!Number.isNaN(Number(val))) return Number(val);

    return val;
  }

  // Utility to stringify default values back into code.
  // For select arrays, format with pretty JSON; for booleans & numbers keep raw.
  stringifyDefault(value) {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return JSON.stringify(value);
    // objects / arrays
    return JSON.stringify(value, null, 2);
  }
}

/* UseSettingEditor: UI */
class UseSettingEditor {
  constructor(codeEditor, container) {
    this.codeEditor = codeEditor;
    this.container = container;
    this.parser = new UseSettingParser();
    this.settings = [];
  }

  setCodeEditorValue(value) {
    const cm = this.codeEditor;
    const scrollInfo = cm.getScrollInfo();
    const cursor = cm.getCursor();

    cm.operation(() => {
      cm.setValue(value);
      cm.setCursor(cursor);
      cm.scrollTo(scrollInfo.left, scrollInfo.top);
    });
  }

  // Loading & state
  loadFromCode() {
    const code = this.codeEditor.getValue();
    this.settings = this.parser.parse(code);
    this.renderUI();
  }

  // UI helpers
  createRow(labelText, inputEl) {
    const row = document.createElement("div");
    row.className = "form-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    row.append(label, inputEl);
    return row;
  }

  createInput({ id = "", placeholder = "", type = "text", value = "" } = {}) {
    const input = document.createElement("input");
    if (id) input.id = id;
    input.type = type;
    input.placeholder = placeholder;
    if (value !== undefined) input.value = value;
    return input;
  }

  makeButton(text, onClick, attrs = {}) {
    const btn = document.createElement("button");
    btn.type = attrs.type || "button";
    btn.textContent = text;
    for (const [key, value] of Object.entries(attrs)) {
      if (key !== "type" && key !== "className") {
        btn.setAttribute(key, value);
      }
    }
    btn.addEventListener("click", onClick);
    return btn;
  }

  makeCopyButton(outputDiv) {
    return this.makeButton(
      i18n.t("userscript.useSettingEditor.copy"),
      async (e) => {
        try {
          await navigator.clipboard.writeText(outputDiv.textContent);
          e.target.textContent = i18n.t("userscript.useSettingEditor.copied");
          setTimeout(() => (e.target.textContent = i18n.t("userscript.useSettingEditor.copy")), 1500);
        } catch (err) {
          e.target.textContent = i18n.t("userscript.export.status.error") + ": " + err;
        }
      },
      { id: "copyCodeBtn" },
    );
  }

  createSwitch({ checked = false, onChange = null } = {}) {
    const label = document.createElement("label");
    label.className = "switch-label";
    const input = this.createInput({ type: "checkbox" });
    input.checked = !!checked;
    if (typeof onChange === "function") input.addEventListener("change", onChange);
    const slider = document.createElement("span");
    slider.className = "slider";
    label.append(input, slider);
    return label;
  }

  // Rendering
  renderUI() {
    this.container.innerHTML = "";
    if (!this.settings.length) {
      const p = document.createElement("p");
      p.textContent = i18n.t("userscript.useSettingEditor.warn.noSettings");
      this.container.append(p);
      return;
    }

    const frag = document.createDocumentFragment();

    this.settings.forEach((s, i) => {
      const wrap = document.createElement("div");
      wrap.className = `useSetting-item ${s.type}`;

      const title = document.createElement("h4");
      title.textContent = `${i + 1} — ${s.key} (${i18n.t("userscript.useSettingEditor.type." + s.type)})`;

      // Label edit
      const labelInput = this.createInput({ placeholder: i18n.t("userscript.useSettingEditor.label"), value: s.label });
      labelInput.className = "edit-label";

      // Value editor depends on type
      const valueEditor = this.createSettingEditorInput(s);

      // Save button
      const footer = document.createElement("div");
      footer.className = "footer";
      const infoMessage = document.createElement("div");
      const infoMessageIndicator = document.createElement("div");
      infoMessageIndicator.className = "info-message-indicator";
      let infoMessageTimeout = null;

      const saveBtn = this.makeButton(i18n.t("userscript.useSettingEditor.buttons.change"), () => {
        infoMessage.textContent = "";
        infoMessage.className = "info-message";
        infoMessage.style.animation = "none";
        infoMessage.offsetHeight;
        infoMessage.style.animation = null;
        clearTimeout(infoMessageTimeout);
        labelInput.value = labelInput.value.trim();
        if (s.type === "select") {
          let missingValue = false;
          let checkedStatus = false;
          let items = valueEditor.querySelectorAll(".select-item");
          items.forEach((line) => {
            const inputs = line.querySelectorAll("input");
            const val = inputs[0]?.value.trim();
            const lab = inputs[1]?.value.trim();
            if (!val && !lab) {
              line.removeBtn?.click?.();
              if (line.isConnected) line.remove();
            } else if (!val || !lab) {
              missingValue = true;
            }
            if (inputs[2]?.checked) checkedStatus = true;
          });
          // Re-Check
          items = valueEditor.querySelectorAll(".select-item");
          if (items.length < 2) {
            infoMessage.textContent = i18n.t("userscript.useSettingEditor.warn.selectOptions");
            infoMessage.className = "info-message error";
            return;
          } else if (missingValue) {
            infoMessage.textContent = i18n.t("userscript.useSettingEditor.warn.emptyLabelorOptions");
            infoMessage.className = "info-message error";
            return;
          } else if (!checkedStatus) {
            infoMessage.textContent = i18n.t("userscript.useSettingEditor.warn.activateOption");
            infoMessage.className = "info-message error";
            return;
          }
        }
        if (labelInput.value.length < 3) {
          infoMessage.textContent = i18n.t("userscript.useSettingEditor.warn.minLetter");
          infoMessage.className = "info-message error";
          return;
        }

        // Success Message
        infoMessage.textContent = i18n.t("userscript.useSettingEditor.success");
        infoMessage.className = "info-message success";
        infoMessage.appendChild(infoMessageIndicator);
        infoMessageIndicator.style.display = "none";
        void infoMessageIndicator.offsetWidth;
        infoMessageIndicator.style.display = "block";
        infoMessageTimeout = setTimeout(() => {
          infoMessage.textContent = "";
          infoMessage.className = "";
          infoMessageIndicator.style.display = "none";
        }, 3000);

        // Update Code
        this.updateCode(i, valueEditor, labelInput);
      });

      // Layout
      const contentWrap = document.createElement("div");
      contentWrap.className = "content";
      contentWrap.append(
        this.createRow(i18n.t("userscript.useSettingEditor.label"), labelInput),
        this.createRow(i18n.t("userscript.useSettingEditor.value"), valueEditor),
      );
      footer.append(infoMessage, saveBtn);
      wrap.append(title, contentWrap, footer);
      frag.append(wrap);
    });
    this.container.append(frag);
  }

  createSettingEditorInput(setting) {
    if (setting.type === SETTING_TYPES.CHECKBOX) {
      // createSwitch expects an object with checked and onChange optional
      return this.createSwitch({ checked: !!setting.defaultValue });
    }

    if (setting.type === SETTING_TYPES.SELECT) {
      return this.renderSelectList(setting.defaultValue);
    }

    // Default: text
    const inp = this.createInput({ placeholder: i18n.t("userscript.useSettingEditor.textValue"), value: setting.defaultValue || "" });
    return inp;
  }

  renderSelectList(values = []) {
    const wrapper = document.createElement("div");
    wrapper.className = "select-list-editor";

    const listWrap = document.createElement("div");
    listWrap.className = "select-list";

    const renderOption = (opt = { value: "", label: "", selected: false }) => {
      const line = document.createElement("div");
      line.className = "select-item";

      const val = this.createInput({ placeholder: i18n.t("userscript.useSettingEditor.value"), value: opt.value || "" });
      const lab = this.createInput({ placeholder: i18n.t("userscript.useSettingEditor.label"), value: opt.label || "" });

      const switchLabel = this.createSwitch({ checked: !!opt.selected });
      const checkbox = switchLabel.querySelector("input[type='checkbox']");

      // Ensure only one selected
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          listWrap.querySelectorAll("input[type='checkbox']").forEach((other) => {
            if (other !== checkbox) other.checked = false;
          });
        }
      });

      const removeBtn = this.makeButton(
        "",
        () => {
          line.remove();
          updateRemoveButtons();
        },
        { className: "remove-btn" },
      );
      removeBtn.appendChild(createSVG(svg_paths.crossIconPaths));

      line.removeBtn = removeBtn;
      line.append(val, lab, switchLabel, removeBtn);
      listWrap.append(line);
    };

    const updateRemoveButtons = () => {
      const items = listWrap.querySelectorAll(".select-item");
      const disable = items.length <= 2;
      items.forEach((line) => {
        const btn = line.querySelector("button.remove-btn");
        if (btn) btn.disabled = disable;
      });
    };

    // Populate initial
    if (Array.isArray(values) && values.length) {
      // Only keep first selected true
      const firstSelected = values.findIndex((v) => v && v.selected);
      values.forEach((v, idx) => renderOption({ ...v, selected: idx === firstSelected }));
    } else {
      // If none provided, create two empty options
      renderOption({ value: "", label: "", selected: true });
      renderOption({ value: "", label: "", selected: false });
    }

    // Add button
    const addBtn = this.makeButton(i18n.t("userscript.useSettingEditor.addOption"), () => {
      renderOption({ value: "", label: "", selected: false });
      updateRemoveButtons();
    });

    wrapper.append(listWrap, addBtn);
    updateRemoveButtons();
    return wrapper;
  }

  // Update code (write back to editor)
  updateCode(index, inputEl, labelEl) {
    const code = this.codeEditor.getValue();
    const setting = this.settings[index];
    const newLabel = labelEl.value.trim() || setting.label;

    let newValueCode;
    if (setting.type === SETTING_TYPES.CHECKBOX) {
      const checked = !!inputEl.querySelector("input[type='checkbox']").checked;
      newValueCode = checked ? "true" : "false";
    } else if (setting.type === SETTING_TYPES.SELECT) {
      const lines = inputEl.querySelectorAll(".select-item");
      const options = Array.from(lines).map((line) => {
        const inputs = line.querySelectorAll("input");
        return {
          value: inputs[0].value,
          label: inputs[1].value,
          selected: inputs[2].checked,
        };
      });
      newValueCode = JSON.stringify(options, null, 2);
    } else {
      // text
      const val = inputEl.value;
      newValueCode = JSON.stringify(val);
    }

    // Replace the matching useSetting(...) with updated one.
    const replaceRegex = new RegExp(`useSetting\\s*\\(\\s*(['"])${this.escapeForRegex(setting.key)}\\1\\s*,[\\s\\S]*?\\)\\s*;`, "s");

    const newCall = `useSetting("${setting.key}", "${this.escapeForRegexForCode(newLabel)}", "${setting.type}", ${newValueCode});`;
    const newCode = code.replace(replaceRegex, newCall);

    this.setCodeEditorValue(newCode);
  }

  escapeForRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  escapeForRegexForCode(str) {
    // only escape double quotes and backslashes for embedding into code string
    return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  reservedKeywords = new Set([
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
  ]);

  isValidVariable(name) {
    // should not be empty and must be a string
    if (typeof name !== "string" || name.trim() === "") return false;

    // RegEx check
    if (!/^[$A-Z_a-z][0-9A-Z_a-z$]*$/.test(name)) return false;

    // Keyword check
    if (this.reservedKeywords.has(name)) return false;

    return true;
  }

  // create generator UI
  createGeneratorUI(builderContainer) {
    builderContainer.innerHTML = "";

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "build-content text";

    const varInput = this.createInput({ id: "varName", placeholder: i18n.t("userscript.useSettingEditor.placeholder.variableName") });
    const labelInput = this.createInput({ id: "label", placeholder: i18n.t("userscript.useSettingEditor.placeholder.label") });

    const typeSelect = document.createElement("select");
    [SETTING_TYPES.TEXT, SETTING_TYPES.CHECKBOX, SETTING_TYPES.SELECT].forEach((t) => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = i18n.t("userscript.useSettingEditor.type." + t);
      typeSelect.append(o);
    });

    const defaultContainer = document.createElement("div");
    defaultContainer.className = "default-value-container";

    const infoDiv = document.createElement("div");
    infoDiv.className = "info-message";

    const generateBtn = this.makeButton(i18n.t("userscript.useSettingEditor.createSetting"), () => {
      infoDiv.style.animation = "none";
      infoDiv.offsetHeight;
      infoDiv.style.animation = null;
      varInput.value = varInput.value.trim();
      labelInput.value = labelInput.value.trim();

      const variable = varInput.value;
      const label = labelInput.value;
      const type = typeSelect.value;

      // Variable Name Check
      if (!this.isValidVariable(variable)) {
        infoDiv.textContent = i18n.t("userscript.useSettingEditor.warn.validVariableName");
        infoDiv.className = "info-message error";
        return;
      }

      // Label Check
      if (!label) {
        infoDiv.textContent = i18n.t("userscript.useSettingEditor.warn.emptyLabel");
        infoDiv.className = "info-message error";
        return;
      }

      // Clear empty select options
      if (type === SETTING_TYPES.SELECT) {
        let options = defaultContainer.querySelectorAll(".select-option");
        let missingValue = false;
        let checkedStatus = false;
        options.forEach((opt) => {
          const inputs = opt.querySelectorAll("input");
          const val = inputs[0]?.value.trim();
          const lab = inputs[1]?.value.trim();
          if (!val && !lab) {
            opt.removeBtn.disabled = false;
            opt.removeBtn?.click();
          } else if (!val || !lab) {
            missingValue = "val";
          }

          if (inputs[2]?.checked) checkedStatus = true;
        });
        options = defaultContainer.querySelectorAll(".select-option");
        if (options.length < 2) {
          infoDiv.textContent = i18n.t("userscript.useSettingEditor.warn.selectOptions");
          infoDiv.className = "info-message error";
          return;
        } else if (missingValue) {
          infoDiv.textContent = i18n.t("userscript.useSettingEditor.warn.emptyLabelorOptions");
          infoDiv.className = "info-message error";
          return;
        } else if (!checkedStatus) {
          infoDiv.textContent = i18n.t("userscript.useSettingEditor.warn.activateOption");
          infoDiv.className = "info-message error";
          return;
        }
      }
      infoDiv.textContent = "";
      infoDiv.className = "info-message";

      // code generation
      let defaultValueCode = "null";
      if (type === SETTING_TYPES.TEXT) {
        const txt = defaultContainer.querySelector("#defaultText")?.value || "";
        defaultValueCode = JSON.stringify(txt);
      } else if (type === SETTING_TYPES.CHECKBOX) {
        const checked = !!defaultContainer.querySelector("input[type='checkbox']")?.checked;
        defaultValueCode = checked ? "true" : "false";
      } else if (type === SETTING_TYPES.SELECT) {
        const opts = Array.from(defaultContainer.querySelectorAll(".select-option")).map((el) => {
          const inputs = el.querySelectorAll("input");
          return {
            value: inputs[0].value,
            label: inputs[1].value,
            selected: !!inputs[2].checked,
          };
        });
        defaultValueCode = JSON.stringify(opts, null, 2);
      }

      const code = `const ${variable} = await useSetting("${variable}", "${label}", "${type}", ${defaultValueCode});`;

      let outputDiv = builderContainer.querySelector("#output");
      if (!outputDiv) {
        outputDiv = document.createElement("pre");
        outputDiv.id = "output";
        builderContainer.append(outputDiv, this.makeCopyButton(outputDiv));
      }
      outputDiv.textContent = code;
    });

    generateBtn.id = "btnGenerate";

    // Default render function
    const renderDefault = (type) => {
      defaultContainer.innerHTML = "";
      if (type === SETTING_TYPES.TEXT) {
        const ti = this.createInput({ id: "defaultText", placeholder: i18n.t("userscript.useSettingEditor.defaultText") });
        defaultContainer.append(this.createRow(i18n.t("userscript.useSettingEditor.defaultText"), ti));
      } else if (type === SETTING_TYPES.CHECKBOX) {
        const sw = this.createSwitch({ checked: true });
        defaultContainer.append(this.createRow(i18n.t("common.enabled"), sw));
      } else if (type === SETTING_TYPES.SELECT) {
        const updateRemoveButtons = () => {
          const btns = optContainer.querySelectorAll(".select-option button");
          const disable = optContainer.querySelectorAll(".select-option").length <= 2;
          btns.forEach((b) => (b.disabled = disable));
        };

        const label = document.createElement("label");
        label.textContent = i18n.t("userscript.useSettingEditor.selectOptions");
        const optContainer = document.createElement("div");
        optContainer.className = "selectOptions";

        const addOption = (opt = { value: "", label: "", selected: false }) => {
          const wrap = document.createElement("div");
          wrap.className = "select-option";
          const v = this.createInput({ placeholder: i18n.t("userscript.useSettingEditor.value"), value: opt.value });
          const l = this.createInput({ placeholder: i18n.t("userscript.useSettingEditor.label"), value: opt.label });
          const s = this.createSwitch({ checked: !!opt.selected });

          s.querySelector("input").addEventListener("change", (e) => {
            if (e.target.checked) {
              optContainer.querySelectorAll(".select-option .switch-label input").forEach((sw) => {
                if (sw !== e.target) sw.checked = false;
              });
            }
          });

          // Remove Button
          const remove = this.makeButton(
            "",
            () => {
              wrap.remove();
              updateRemoveButtons();
            },
            { className: "remove-btn" },
          );
          remove.appendChild(createSVG(svg_paths.crossIconPaths));

          wrap.append(v, l, s, remove);
          wrap.removeBtn = remove;
          optContainer.append(wrap);

          const btns = optContainer.querySelectorAll(".select-option button");
          const disable = optContainer.querySelectorAll(".select-option").length <= 2;
          btns.forEach((b) => (b.disabled = disable));
        };
        updateRemoveButtons();
        addOption({ value: "example1", label: "Example 1", selected: true });
        addOption({ value: "example2", label: "Example 2", selected: false });

        const addBtn = this.makeButton(i18n.t("userscript.useSettingEditor.addOption"), () => addOption({}));
        defaultContainer.append(label, optContainer, addBtn);
      }
    };

    // Type change events
    typeSelect.addEventListener("change", () => {
      renderDefault(typeSelect.value);
      contentWrapper.className = `build-content ${typeSelect.value}`;
    });

    renderDefault(typeSelect.value);
    contentWrapper.append(
      this.createRow(i18n.t("userscript.useSettingEditor.variableName"), varInput),
      this.createRow(i18n.t("userscript.useSettingEditor.label"), labelInput),
      this.createRow(i18n.t("userscript.useSettingEditor.type"), typeSelect),
      defaultContainer,
    );
    builderContainer.append(contentWrapper, generateBtn, infoDiv);
  }
}
