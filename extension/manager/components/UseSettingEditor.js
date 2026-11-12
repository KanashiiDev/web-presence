const SETTING_TYPES = {
  TEXT: "text",
  CHECKBOX: "checkbox",
  SELECT: "select",
};

/** i18n lookup that falls back to an English string while a key is still missing. */
const _t = (key, fallback) => {
  try {
    const r = typeof i18n !== "undefined" ? i18n.t(key) : null;
    return r && r !== key ? r : fallback;
  } catch (_) {
    return fallback;
  }
};

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const JsScan = {
  isIdent(ch) {
    return !!ch && /[\w$]/.test(ch);
  },

  /** If a string / template / comment starts at i, returns the index right after it; otherwise i. */
  skipNonCode(src, i) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const e = src.indexOf("\n", i);
      return e === -1 ? src.length : e;
    }
    if (c === "/" && n === "*") {
      const e = src.indexOf("*/", i + 2);
      return e === -1 ? src.length : e + 2;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        j++;
      }
      return Math.min(j + 1, src.length);
    }
    if (c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "\\") j++;
        j++;
      }
      return Math.min(j + 1, src.length);
    }
    return i;
  },

  /** Index of the bracket that closes the one at `open`, or -1. */
  matchBracket(src, open) {
    let depth = 0;
    let i = open;
    while (i < src.length) {
      const j = this.skipNonCode(src, i);
      if (j !== i) {
        i = j;
        continue;
      }
      const ch = src[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
    return -1;
  },

  /** Top-level argument ranges [start, end) between the parentheses at (open, close). */
  splitArgs(src, open, close) {
    const ranges = [];
    let depth = 0;
    let start = open + 1;
    let i = open + 1;
    while (i < close) {
      const j = this.skipNonCode(src, i);
      if (j !== i) {
        i = j;
        continue;
      }
      const ch = src[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 0) {
        ranges.push([start, i]);
        start = i + 1;
      }
      i++;
    }
    if (src.slice(start, close).trim() !== "") ranges.push([start, close]);
    return ranges;
  },

  /** Decodes a single- or double-quoted string literal. Returns null if `src` is not exactly one. */
  decodeString(src) {
    const s = src.trim();
    const q = s[0];
    if ((q !== '"' && q !== "'") || s.length < 2 || s[s.length - 1] !== q) return null;
    let out = "";
    for (let i = 1; i < s.length - 1; i++) {
      const c = s[i];
      if (c === "\\") {
        const n = s[++i];
        if (n === "n") out += "\n";
        else if (n === "t") out += "\t";
        else if (n === "r") out += "\r";
        else if (n === "b") out += "\b";
        else if (n === "f") out += "\f";
        else if (n === "v") out += "\v";
        else if (n === "0") out += "\0";
        else if (n === "x") {
          out += String.fromCharCode(parseInt(s.substr(i + 1, 2), 16));
          i += 2;
        } else if (n === "u") {
          if (s[i + 1] === "{") {
            const e = s.indexOf("}", i);
            out += String.fromCodePoint(parseInt(s.slice(i + 2, e), 16));
            i = e;
          } else {
            out += String.fromCharCode(parseInt(s.substr(i + 1, 4), 16));
            i += 4;
          }
        } else if (n === "\n") {
          // line continuation: backslash-newline is dropped
        } else out += n;
      } else if (c === q) {
        return null;
      } else out += c;
    }
    return out;
  },
};

/** Parses a JS literal (strings, numbers, booleans, null, arrays, objects with loose keys / trailing commas). */
class LiteralParser {
  constructor(src) {
    this.s = src;
    this.i = 0;
  }

  parse() {
    const v = this.value();
    this.ws();
    if (this.i !== this.s.length) throw new Error("Unexpected token");
    return v;
  }

  ws() {
    for (;;) {
      while (/\s/.test(this.s[this.i] || "")) this.i++;
      const j = JsScan.skipNonCode(this.s, this.i);
      if (j !== this.i && (this.s[this.i] === "/" || false)) this.i = j;
      else return;
    }
  }

  string() {
    const start = this.i;
    const j = JsScan.skipNonCode(this.s, this.i);
    const lit = JsScan.decodeString(this.s.slice(start, j));
    if (lit === null) throw new Error("Bad string");
    this.i = j;
    return lit;
  }

  value() {
    this.ws();
    const c = this.s[this.i];
    if (c === '"' || c === "'") return this.string();
    if (c === "[") {
      this.i++;
      const arr = [];
      for (;;) {
        this.ws();
        if (this.s[this.i] === "]") {
          this.i++;
          return arr;
        }
        arr.push(this.value());
        this.ws();
        if (this.s[this.i] === ",") this.i++;
        else if (this.s[this.i] !== "]") throw new Error("Expected , or ]");
      }
    }
    if (c === "{") {
      this.i++;
      const obj = {};
      for (;;) {
        this.ws();
        if (this.s[this.i] === "}") {
          this.i++;
          return obj;
        }
        let key;
        const k = this.s[this.i];
        if (k === '"' || k === "'") key = this.string();
        else {
          const m = /^[A-Za-z_$][\w$]*|^\d+/.exec(this.s.slice(this.i));
          if (!m) throw new Error("Bad key");
          key = m[0];
          this.i += key.length;
        }
        this.ws();
        if (this.s[this.i] !== ":") throw new Error("Expected :");
        this.i++;
        obj[key] = this.value();
        this.ws();
        if (this.s[this.i] === ",") this.i++;
        else if (this.s[this.i] !== "}") throw new Error("Expected , or }");
      }
    }
    const rest = this.s.slice(this.i);
    let m = /^(true|false|null)(?![\w$])/.exec(rest);
    if (m) {
      this.i += m[0].length;
      return m[1] === "true" ? true : m[1] === "false" ? false : null;
    }
    m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (m) {
      this.i += m[0].length;
      return Number(m[0]);
    }
    throw new Error("Unsupported value");
  }
}

class UseSettingParser {
  /**
   * Finds every `useSetting("key", "label", "type", default)` call whose first three
   * arguments are plain string literals. Each result carries the exact source range of the
   * call (`from`/`to`) so it can be replaced in place, plus the range of its statement when
   * the call is the whole statement (`removable`).
   */
  parse(code) {
    const out = [];
    let i = 0;
    while (i < code.length) {
      const j = JsScan.skipNonCode(code, i);
      if (j !== i) {
        i = j;
        continue;
      }
      if (code.startsWith("useSetting", i) && !JsScan.isIdent(code[i - 1]) && code[i - 1] !== "." && !JsScan.isIdent(code[i + 10])) {
        let k = i + 10;
        while (/\s/.test(code[k] || "")) k++;
        if (code[k] === "(") {
          const close = JsScan.matchBracket(code, k);
          if (close > 0) {
            const setting = this.readCall(code, i, k, close);
            if (setting) out.push(setting);
            i = close + 1;
            continue;
          }
        }
      }
      i++;
    }
    return out;
  }

  readCall(code, from, open, close) {
    const args = JsScan.splitArgs(code, open, close);
    if (args.length < 3 || args.length > 4) return null;
    const [key, label, type] = args.slice(0, 3).map(([a, b]) => JsScan.decodeString(code.slice(a, b)));
    if (key === null || label === null || type === null) return null;

    const defaultSrc = args[3] ? code.slice(args[3][0], args[3][1]).trim() : "";
    let defaultValue;
    let defaultOk = true;
    try {
      defaultValue = defaultSrc ? new LiteralParser(defaultSrc).parse() : undefined;
    } catch (_) {
      defaultOk = false;
    }

    const to = close + 1;
    const lineStart = code.lastIndexOf("\n", from - 1) + 1;
    let lineEnd = code.indexOf("\n", to);
    if (lineEnd === -1) lineEnd = code.length;
    const before = code.slice(lineStart, from);
    const after = code.slice(to, lineEnd);
    const removable = /^\s*(?:(?:const|let|var)\s+[$A-Za-z_][\w$]*\s*=\s*)?(?:await\s+)?$/.test(before) && /^\s*;?\s*(?:\/\/.*)?$/.test(after);

    return {
      key,
      label,
      type,
      defaultValue,
      defaultSrc,
      defaultOk,
      from,
      to,
      indent: (/^\s*/.exec(before) || [""])[0],
      removable,
      stmtFrom: lineStart,
      stmtTo: Math.min(lineEnd + 1, code.length),
    };
  }
}

class UseSettingEditor {
  /**
   * @param {CodeMirror.Editor} codeEditor
   * @param {HTMLElement} container
   * @param {{ onJump?: (pos: {line:number, ch:number}) => void }} [options]
   */
  constructor(codeEditor, container, options = {}) {
    this.codeEditor = codeEditor;
    this.container = container;
    this.onJump = options.onJump || null;
    this.parser = new UseSettingParser();
    this.settings = [];
    this.dirty = true;
    this._writing = false;
    this._refreshTimer = null;
    this.draftEl = null;

    codeEditor.on("change", () => {
      if (this._writing) return;
      this.dirty = true;
      if (this.isVisible()) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refresh(), 250);
      }
    });
  }

  isVisible() {
    return !!this.container && this.container.offsetParent !== null;
  }

  /** Full reload from the current code (used when another script is opened). */
  loadFromCode() {
    this.dirty = true;
    this.refresh();
  }

  /** Re-reads the code and re-renders, but only if the code changed since the last render. */
  refresh() {
    if (!this.dirty) return;
    this.dirty = false;
    this.settings = this.parser.parse(this.codeEditor.getValue());
    this.render();
  }

  /* ---------- small UI helpers ---------- */

  createSwitch({ checked = false, onChange = null } = {}) {
    const label = _el("label", "switch-label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    if (typeof onChange === "function") input.addEventListener("change", onChange);
    label.append(input, _el("span", "slider"));
    return label;
  }

  makeButton(text, onClick, { title = "", className = "" } = {}) {
    const b = _el("button", `btn ${className}`.trim(), text);
    b.type = "button";
    if (title) {
      b.title = title;
      b.setAttribute("aria-label", title);
    }
    b.addEventListener("click", onClick);
    return b;
  }

  makeIconButton(paths, onClick, title, className) {
    const b = this.makeButton("", onClick, { title, className });
    if (paths && typeof createSVG === "function") b.appendChild(createSVG(paths));
    return b;
  }

  debounce(fn, ms) {
    let t;
    return (immediate) => {
      clearTimeout(t);
      if (immediate) fn();
      else t = setTimeout(fn, ms);
    };
  }

  /* ---------- rendering ---------- */

  render() {
    this.draftEl = null;
    this.container.textContent = "";

    const list = _el("div", "us-list");
    this.listEl = list;
    if (!this.settings.length) {
      list.append(_el("p", "us-empty", _t("userscript.useSettingEditor.warn.noSettings", "No settings found in the code yet.")));
    }
    this.settings.forEach((s, i) => list.append(this.buildRow(s, i)));

    const footer = _el("div", "us-footer");
    this.addBtn = this.makeButton("+ " + _t("userscript.useSettingEditor.addSetting", "Add setting"), () => this.openDraft(), { className: "us-add" });
    footer.append(this.addBtn);

    this.container.append(list, footer);
  }

  buildRow(s, i) {
    const supported = Object.values(SETTING_TYPES).includes(s.type);
    const row = _el("div", `us-row us-type-${supported ? s.type : "custom"}`);

    const top = _el("div", "us-row-top");
    top.append(_el("span", "us-type", _t("userscript.useSettingEditor.type." + s.type, s.type)));

    const label = document.createElement("input");
    label.type = "text";
    label.className = "us-label";
    label.value = s.label;
    label.placeholder = _t("userscript.useSettingEditor.label", "Label");
    label.setAttribute("aria-label", label.placeholder);
    top.append(label);

    const actions = _el("div", "us-row-actions");
    const jumpBtn = this.makeIconButton(
      typeof svg_paths !== "undefined" ? svg_paths.redirectIconPaths : null,
      () => this.jump(i),
      _t("userscript.useSettingEditor.jumpToCode", "Show in code"),
      "us-jump",
    );
    if (!jumpBtn.firstChild) jumpBtn.textContent = "↗";
    const delBtn = this.makeIconButton(typeof svg_paths !== "undefined" ? svg_paths.trashIconPaths : null, () => {}, _t("common.delete", "Delete"), "us-del");
    if (!delBtn.firstChild) delBtn.textContent = "✕";
    this.bindDelete(delBtn, i, s);
    actions.append(jumpBtn, delBtn);
    top.append(actions);

    const meta = _el("div", "us-row-meta");
    meta.append(_el("code", "us-key", s.key));

    const msg = _el("div", "us-msg");
    msg.setAttribute("role", "status");
    let msgTimer = null;
    const say = (text, kind) => {
      clearTimeout(msgTimer);
      msg.textContent = text || "";
      msg.className = "us-msg" + (kind ? ` is-${kind}` : "");
      row.classList.toggle("is-invalid", kind === "error");
      if (kind === "ok") msgTimer = setTimeout(() => say("", ""), 1500);
    };

    const commit = this.debounce(() => {
      const cur = this.settings[i];
      if (!cur) return;
      const lab = label.value.trim();
      if (!lab) return say(_t("userscript.useSettingEditor.warn.emptyLabel", "The label can't be empty."), "error");
      const r = ctl.read();
      if (!r.ok) return say(r.error, "error");

      const defaultCode = ctl.editable ? this.literal(r.value, cur.indent) : cur.defaultSrc;
      const call = this.buildCall(cur.key, lab, cur.type, defaultCode);
      const code = this.codeEditor.getValue();
      if (code.slice(cur.from, cur.to) !== call) {
        this.write(cur.from, cur.to, call);
        this.settings = this.parser.parse(this.codeEditor.getValue());
        if (this.settings.length !== this.listEl.querySelectorAll(".us-row:not(.us-draft)").length) {
          this.dirty = true;
          return this.refresh();
        }
      }
      say(_t("userscript.useSettingEditor.success", "Saved"), "ok");
    }, 450);

    label.addEventListener("input", () => commit(false));
    label.addEventListener("blur", () => commit(true));

    const ctl = this.buildControl(supported ? s.type : "custom", s, (immediate) => commit(immediate));
    const body = _el("div", "us-body");
    body.append(ctl.el);

    row.append(top, meta, body, msg);
    return row;
  }

  /**
   * Builds the editor for a default value.
   * @returns {{el: HTMLElement, editable: boolean, read: () => ({ok:true,value:any}|{ok:false,error:string})}}
   */
  buildControl(type, setting, onChange) {
    const value = setting ? setting.defaultValue : undefined;
    const editable = !setting || setting.defaultOk;

    if (type === SETTING_TYPES.CHECKBOX && editable && (typeof value === "boolean" || value === undefined)) {
      const wrap = _el("div", "us-ctl us-switch-line");
      const sw = this.createSwitch({ checked: !!value, onChange: () => onChange(true) });
      const input = sw.querySelector("input");
      const caption = _el("span", "us-caption", _t("userscript.useSettingEditor.defaultValue", "Default value"));
      caption.addEventListener("click", () => input.click());
      wrap.append(sw, caption);
      return { el: wrap, editable: true, read: () => ({ ok: true, value: input.checked }) };
    }

    if (type === SETTING_TYPES.TEXT && editable && (typeof value === "string" || value === undefined)) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = value || "";
      input.placeholder = _t("userscript.useSettingEditor.textValue", "Default text");
      input.setAttribute("aria-label", input.placeholder);
      input.addEventListener("input", () => onChange(false));
      input.addEventListener("blur", () => onChange(true));
      const wrap = _el("div", "us-ctl");
      wrap.append(input);
      return { el: wrap, editable: true, read: () => ({ ok: true, value: input.value }) };
    }

    if (type === SETTING_TYPES.SELECT && editable && (value === undefined || Array.isArray(value))) {
      return this.buildSelectControl(Array.isArray(value) ? value : [], onChange);
    }

    const wrap = _el("div", "us-ctl us-custom");
    wrap.append(_el("span", "us-caption", _t("userscript.useSettingEditor.customValue", "Custom value, edit it in the code.")));
    if (setting && setting.defaultSrc) {
      const preview = setting.defaultSrc.replace(/\s+/g, " ");
      wrap.append(_el("code", "us-preview", preview.length > 80 ? preview.slice(0, 80) + "…" : preview));
    }
    return { el: wrap, editable: false, read: () => ({ ok: true, value: undefined }) };
  }

  buildSelectControl(options, onChange) {
    const wrap = _el("div", "us-ctl us-select");

    const ta = document.createElement("textarea");
    ta.className = "us-options";
    ta.spellcheck = false;
    ta.placeholder = "value | Label";
    ta.value = options
      .filter((o) => o && typeof o === "object")
      .map((o) => {
        const v = String(o.value ?? "");
        const l = String(o.label ?? v);
        return l === v ? v : `${v} | ${l}`;
      })
      .join("\n");
    ta.rows = Math.max(3, Math.min(8, options.length + 1));

    const help = _el("small", "us-help", _t("userscript.useSettingEditor.optionsHelp", "One option per line: value | Label"));

    const defRow = _el("label", "us-default-row");
    defRow.append(_el("span", "us-caption", _t("userscript.useSettingEditor.defaultOption", "Default option")));
    const sel = document.createElement("select");
    defRow.append(sel);

    const parse = () => {
      const seen = [];
      ta.value.split("\n").forEach((raw) => {
        if (!raw.trim()) return;
        const p = raw.indexOf("|");
        const value = (p === -1 ? raw : raw.slice(0, p)).trim();
        const label = p === -1 ? value : raw.slice(p + 1).trim() || value;
        seen.push({ value, label });
      });
      return seen;
    };

    let selectedValue = (options.find((o) => o && o.selected) || options[0] || {}).value;
    const syncDefault = () => {
      const opts = parse();
      sel.textContent = "";
      opts.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        sel.append(opt);
      });
      if (opts.some((o) => o.value === selectedValue)) sel.value = selectedValue;
      else selectedValue = sel.value = opts[0]?.value ?? "";
    };
    syncDefault();

    ta.addEventListener("input", () => {
      syncDefault();
      onChange(false);
    });
    ta.addEventListener("blur", () => onChange(true));
    sel.addEventListener("change", () => {
      selectedValue = sel.value;
      onChange(true);
    });

    wrap.append(ta, help, defRow);

    return {
      el: wrap,
      editable: true,
      read: () => {
        const opts = parse();
        if (opts.length < 2) return { ok: false, error: _t("userscript.useSettingEditor.warn.selectOptions", "Add at least two options.") };
        if (opts.some((o) => !o.value))
          return { ok: false, error: _t("userscript.useSettingEditor.warn.emptyLabelorOptions", "Every option needs a value and a label.") };
        if (new Set(opts.map((o) => o.value)).size !== opts.length)
          return { ok: false, error: _t("userscript.useSettingEditor.warn.duplicateOption", "Option values must be unique.") };
        const chosen = opts.some((o) => o.value === sel.value) ? sel.value : opts[0].value;
        return { ok: true, value: opts.map((o) => ({ value: o.value, label: o.label, selected: o.value === chosen })) };
      },
    };
  }

  /* ---------- code generation / writing ---------- */

  literal(value, indent = "") {
    if (value === undefined) return "null";
    if (Array.isArray(value) && value.length && value.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
      const obj = (o) =>
        "{ " +
        Object.entries(o)
          .map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`)
          .join(", ") +
        " }";
      return "[\n" + value.map((o) => `${indent}  ${obj(o)},`).join("\n") + `\n${indent}]`;
    }
    if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value, null, 2).replace(/\n/g, "\n" + indent);
    return JSON.stringify(value);
  }

  buildCall(key, label, type, defaultCode) {
    return `useSetting(${JSON.stringify(key)}, ${JSON.stringify(label)}, ${JSON.stringify(type)}, ${defaultCode})`;
  }

  write(from, to, text) {
    const cm = this.codeEditor;
    this._writing = true;
    try {
      cm.operation(() => cm.replaceRange(text, cm.posFromIndex(from), cm.posFromIndex(to)));
    } finally {
      this._writing = false;
    }
  }

  jump(i) {
    const s = this.settings[i];
    if (!s) return;
    const pos = this.codeEditor.posFromIndex(s.from);
    if (this.onJump) this.onJump(pos);
    else {
      this.codeEditor.setCursor(pos);
      this.codeEditor.focus();
    }
  }

  /** Two-step delete: first click arms the button, second click removes the whole statement. */
  bindDelete(btn, i, s) {
    if (!s.removable) {
      btn.disabled = true;
      btn.title = _t("userscript.useSettingEditor.deleteInCode", "Used inside another expression: remove it in the code.");
      return;
    }
    let timer = null;
    const original = btn.title;
    btn.addEventListener("click", () => {
      if (!btn.classList.contains("is-confirm")) {
        btn.classList.add("is-confirm");
        btn.title = _t("userscript.useSettingEditor.confirmDelete", "Click again to delete");
        timer = setTimeout(() => {
          btn.classList.remove("is-confirm");
          btn.title = original;
        }, 3000);
        return;
      }
      clearTimeout(timer);
      const cur = this.settings[i];
      if (!cur) return;
      this.write(cur.stmtFrom, cur.stmtTo, "");
      this.dirty = true;
      this.refresh();
    });
  }

  /* ---------- adding a setting ---------- */

  openDraft() {
    if (this.draftEl) {
      this.draftEl.querySelector(".us-draft-key")?.focus();
      return;
    }
    const defaults = {
      [SETTING_TYPES.TEXT]: { defaultValue: "", defaultOk: true },
      [SETTING_TYPES.CHECKBOX]: { defaultValue: true, defaultOk: true },
      [SETTING_TYPES.SELECT]: {
        defaultValue: [
          { value: "option1", label: "Option 1", selected: true },
          { value: "option2", label: "Option 2", selected: false },
        ],
        defaultOk: true,
      },
    };

    const row = _el("div", "us-row us-draft");
    this.draftEl = row;
    let type = SETTING_TYPES.TEXT;
    let ctl = null;

    const seg = _el("div", "us-seg");
    seg.setAttribute("role", "group");
    const body = _el("div", "us-body");
    const msg = _el("div", "us-msg");
    msg.setAttribute("role", "status");
    const say = (t) => {
      msg.textContent = t || "";
      msg.className = "us-msg" + (t ? " is-error" : "");
    };

    const renderBody = () => {
      body.textContent = "";
      ctl = this.buildControl(type, defaults[type], () => {});
      body.append(ctl.el);
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
    };

    Object.values(SETTING_TYPES).forEach((t) => {
      const b = this.makeButton(_t("userscript.useSettingEditor.type." + t, t), () => {
        type = t;
        renderBody();
      });
      b.dataset.type = t;
      seg.append(b);
    });

    const keyIn = document.createElement("input");
    keyIn.type = "text";
    keyIn.className = "us-draft-key";
    keyIn.placeholder = _t("userscript.useSettingEditor.placeholder.variableName", "Variable name");
    keyIn.spellcheck = false;
    const labIn = document.createElement("input");
    labIn.type = "text";
    labIn.className = "us-label";
    labIn.placeholder = _t("userscript.useSettingEditor.placeholder.label", "Label");

    const fields = _el("div", "us-draft-fields");
    fields.append(keyIn, labIn);

    const actions = _el("div", "us-draft-actions");
    const cancel = this.makeButton(_t("common.cancel", "Cancel"), () => {
      row.remove();
      this.draftEl = null;
      this.addBtn.disabled = false;
    });
    const create = this.makeButton(
      _t("userscript.useSettingEditor.createSetting", "Create setting"),
      () => {
        const key = keyIn.value.trim();
        const label = labIn.value.trim();
        if (!this.isValidVariable(key)) return say(_t("userscript.useSettingEditor.warn.validVariableName", "Enter a valid variable name."));
        if (this.settings.some((s) => s.key === key)) return say(_t("userscript.useSettingEditor.warn.duplicateKey", "A setting with this name already exists."));
        if (!label) return say(_t("userscript.useSettingEditor.warn.emptyLabel", "The label can't be empty."));
        const r = ctl.read();
        if (!r.ok) return say(r.error);
        this.insertSetting(key, label, type, r.value);
      },
      { className: "btn-primary" },
    );
    actions.append(cancel, create);

    row.append(seg, fields, body, msg, actions);
    this.listEl.append(row);
    this.addBtn.disabled = true;
    renderBody();
    keyIn.focus();
    row.scrollIntoView({ block: "nearest" });
  }

  insertSetting(key, label, type, value) {
    const cm = this.codeEditor;
    const code = cm.getValue();
    const last = this.settings[this.settings.length - 1];

    let at;
    let text;
    if (last) {
      let end = code.indexOf("\n", last.to);
      if (end === -1) end = code.length;
      at = end;
      text = "\n" + last.indent + this.statement(key, label, type, value, last.indent);
    } else {
      const line = cm.getCursor().line;
      const indent = (/^\s*/.exec(cm.getLine(line)) || [""])[0];
      at = cm.indexFromPos({ line, ch: 0 });
      text = indent + this.statement(key, label, type, value, indent) + "\n";
    }

    this.write(at, at, text);
    this.dirty = true;
    this.refresh();
    const rows = this.listEl.querySelectorAll(".us-row");
    const idx = this.settings.findIndex((s) => s.key === key);
    const added = rows[idx];
    if (added) {
      added.classList.add("is-new");
      added.scrollIntoView({ block: "nearest" });
      setTimeout(() => added.classList.remove("is-new"), 1200);
    }
  }

  statement(key, label, type, value, indent) {
    return `const ${key} = await ${this.buildCall(key, label, type, this.literal(value, indent))};`;
  }

  /* ---------- validation ---------- */

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
    "await",
    "enum",
    "null",
    "true",
    "false",
  ]);

  isValidVariable(name) {
    if (typeof name !== "string" || name.trim() === "") return false;
    if (!/^[$A-Z_a-z][0-9A-Z_a-z$]*$/.test(name)) return false;
    return !this.reservedKeywords.has(name);
  }
}
