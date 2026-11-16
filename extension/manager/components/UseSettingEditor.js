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
    // Translation descriptor call: t("key"). Only plain string keys are
    // accepted; the descriptor is resolved in the main context at runtime.
    const tm = /^t(?![\w$.])(\s*)\(/.exec(rest);
    if (tm) {
      this.i += tm[0].length;
      this.ws();
      const q = this.s[this.i];
      if (q !== '"' && q !== "'") throw new Error("t() expects a string key");
      const key = this.string();
      this.ws();
      if (this.s[this.i] !== ")") throw new Error("Expected )");
      this.i++;
      return { __type: "translation", key };
    }
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
    if (key === null || type === null) return null;

    // The label may also be a translation key call: t("labelKey"). Keep the
    // original source so editing stays lossless.
    let labelValue = label;
    let labelCall = null;
    if (labelValue === null) {
      const labelSrc = code.slice(args[1][0], args[1][1]).trim();
      const callMatch = /^t\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)$/.exec(labelSrc);
      if (!callMatch) return null;
      labelCall = labelSrc;
      labelValue = callMatch[2];
    }

    const defaultSrc = args[3] ? code.slice(args[3][0], args[3][1]).trim() : "";
    let defaultValue;
    let defaultOk = true;
    // A text default may also be a translation key call: t("defaultKey").
    // The call stays lossless in the code; the editor shows it as a custom value.
    let defaultTCall = null;
    let defaultTKey = null;
    if (defaultSrc) {
      const tDefaultMatch = /^t\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)$/.exec(defaultSrc);
      if (tDefaultMatch) {
        defaultTCall = defaultSrc;
        defaultTKey = tDefaultMatch[2];
      } else {
        try {
          defaultValue = new LiteralParser(defaultSrc).parse();
        } catch (_) {
          defaultOk = false;
        }
      }
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
      label: labelValue,
      labelCall,
      type,
      defaultValue,
      defaultSrc,
      defaultTCall,
      defaultTKey,
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
    /** Optional callback returning the parser's `locales` table for t() label previews. */
    this.getLocaleData = options.getLocaleData || null;
    /**
     * Optional callback (key, englishValue, overwrite) for locale synchronization:
     * setting creation adds `locales.en[key]` (never overwriting), and editing an
     * existing t() label updates `locales.en[key]`.
     */
    this.onLocalesChange = options.onLocalesChange || null;
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

  /** Chosen i18n language -> en lookup for a translation key; null when missing. */
  lookupLocaleValue(key) {
    if (!key) return null;
    const locales = this.getLocaleData ? this.getLocaleData() : null;
    if (!locales) return null;
    return lookupTranslation(locales, selectLocaleLang(locales, i18n.lang), key);
  }

  /** The canonical English value of a translation key; null when missing. */
  lookupEnValue(key) {
    if (!key) return null;
    const locales = this.getLocaleData ? this.getLocaleData() : null;
    const value = locales?.en?.[key];
    return typeof value === "string" && value.trim() ? value : null;
  }

  /** Resolves a translation key for display, falling back to the key itself. */
  resolveLocaleKey(key) {
    return this.lookupLocaleValue(key) ?? key;
  }

  /**
   * Resolves a t("labelKey") label against the parser's locale table (device
   * language, en fallback) for display in the settings editor.
   */
  resolveLocaleLabel(labelCall, key) {
    const match = /^t\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)$/.exec(labelCall || "");
    const labelKey = match ? match[2] : key;
    if (!labelKey) return labelKey;
    return this.resolveLocaleKey(labelKey);
  }

  /** Extracts the key from a t("labelKey") call, or null when not a t() call. */
  static tCallKey(labelCall) {
    const match = /^t\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)$/.exec(labelCall || "");
    return match ? match[2] : null;
  }

  /** Union of translation keys across every language of the parser locales. */
  localeKeySet() {
    const locales = this.getLocaleData ? this.getLocaleData() : null;
    const keys = new Set();
    if (locales && typeof locales === "object") {
      for (const lang of Object.keys(locales)) {
        const map = locales[lang];
        if (map && typeof map === "object") for (const key of Object.keys(map)) keys.add(key);
      }
    }
    return keys;
  }

  buildRow(s, i) {
    const supported = Object.values(SETTING_TYPES).includes(s.type);
    const row = _el("div", `us-row us-type-${supported ? s.type : "custom"}`);

    const top = _el("div", "us-row-top");
    top.append(_el("span", "us-type", _t("userscript.useSettingEditor.type." + s.type, s.type)));

    const label = document.createElement("input");
    label.type = "text";
    label.className = "us-label";
    // English is the canonical editing language; fall back to the device
    // language display only when locales.en has no entry yet.
    const tKey = s.labelCall ? UseSettingEditor.tCallKey(s.labelCall) : null;
    const labelShown = s.labelCall ? (tKey && this.lookupEnValue(tKey)) || this.resolveLocaleLabel(s.labelCall, s.label) : s.label;
    label.value = labelShown;
    if (s.labelCall) {
      label.title = `${s.labelCall} - ${labelShown}`;
    }
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

      // t() labels keep their call form in the code. Unmodified labels rewrite
      // nothing; an edit updates locales.en[<t-key>] instead of replacing the
      // call with a hardcoded string.
      let labelArg = lab;
      if (cur.labelCall) {
        labelArg = cur.labelCall;
        const tKey = UseSettingEditor.tCallKey(cur.labelCall);
        // Only an explicit label edit rewrites locales.en[<t-key>]; the input
        // shows the English value, which is the canonical text.
        if (tKey && labelDirty && lab !== this.lookupEnValue(tKey)) this.onLocalesChange?.(tKey, lab, true);
      }
      // Select option rows may carry their own locale writes: labels edited in
      // the row editor get auto-generated keys written to locales.en.
      if (Array.isArray(r.localeWrites)) {
        for (const w of r.localeWrites) this.onLocalesChange?.(w.key, w.value, w.overwrite);
      }
      const defaultCode = ctl.editable ? this.literal(r.value, cur.indent) : cur.defaultSrc;
      const call = this.buildCall(cur.key, labelArg, cur.type, defaultCode);
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
    }, 1000);

    let labelDirty = false;
    label.addEventListener("input", () => {
      labelDirty = true;
      commit(false);
    });
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

    // Plain text default. A t() default is left to the custom-value UI below
    // so the call stays lossless in the code.
    if (type === SETTING_TYPES.TEXT && editable && (typeof value === "string" || value === undefined) && !setting?.defaultTKey) {
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

  /**
   * Builds the select option editor: one row per option with a value input and
   * a label input. Editing a label automatically generates a translation key
   * from the English text (locales.en entry written at commit); labels the
   * user never touches stay plain. Option values are never localized.
   */
  buildSelectControl(options, onChange) {
    const wrap = _el("div", "us-ctl us-select");

    // Row state: { value, label, tKey, startEn, dirty }. `tKey` marks a
    // localized label; `startEn` is the label text when the key was assigned,
    // used to detect explicit edits (overwrite) versus untouched entries.
    const rows = options
      .filter((o) => o && typeof o === "object")
      .map((o) => {
        const key = o.label && typeof o.label === "object" && o.label.__type === "translation" ? o.label.key : null;
        return {
          value: String(o.value ?? ""),
          label: key ? (this.lookupEnValue(key) ?? "") : String(o.label ?? ""),
          tKey: key,
          startEn: key ? (this.lookupEnValue(key) ?? "") : null,
          dirty: false,
        };
      });

    const listEl = _el("div", "us-options-list");
    const takenKeys = () => new Set([...this.settings.map((s) => s.key), ...this.localeKeySet()]);

    // Assigns a translation key to every edited plain row, before commit.
    const ensureKeys = () => {
      for (const row of rows) {
        if (row.tKey || !row.dirty || !row.label.trim()) continue;
        row.tKey = generateSettingKey(row.label, takenKeys());
        row.startEn = row.label;
      }
    };

    const rerender = () => {
      listEl.textContent = "";
      rows.forEach((row) => listEl.append(this.buildOptionRow(row, rows, onChange, rerender, takenKeys, syncDefault)));
    };

    const help = _el(
      "small",
      "us-help",
      _t("userscript.useSettingEditor.optionsHelp", "Each option needs a value and a label. Edited labels automatically get a translation key."),
    );

    const defRow = _el("label", "us-default-row");
    defRow.append(_el("span", "us-caption", _t("userscript.useSettingEditor.defaultOption", "Default option")));
    const sel = document.createElement("select");
    defRow.append(sel);

    let selectedValue = (options.find((o) => o && o.selected) || options[0] || {}).value;
    const syncDefault = () => {
      sel.textContent = "";
      rows.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.tKey ? this.resolveLocaleKey(o.tKey) : o.label;
        sel.append(opt);
      });
      if (rows.some((o) => o.value === selectedValue)) sel.value = selectedValue;
      else selectedValue = sel.value = rows[0]?.value ?? "";
    };
    rerender();
    syncDefault();

    sel.addEventListener("change", () => {
      selectedValue = sel.value;
      onChange(true);
    });

    const addBtn = this.makeButton(
      "+ " + _t("userscript.useSettingEditor.addOption", "Option"),
      () => {
        rows.push({ value: "", label: "", tKey: null, startEn: null, dirty: false });
        rerender();
        syncDefault();
        onChange(true);
      },
      { className: "us-add-option" },
    );

    wrap.append(listEl, addBtn, help, defRow);

    return {
      el: wrap,
      editable: true,
      read: () => {
        ensureKeys();
        if (rows.length < 2) return { ok: false, error: _t("userscript.useSettingEditor.warn.selectOptions", "Add at least two options.") };
        if (rows.some((o) => !o.value.trim() || !o.label.trim()))
          return { ok: false, error: _t("userscript.useSettingEditor.warn.emptyLabelorOptions", "Every option needs a value and a label.") };
        if (new Set(rows.map((o) => o.value.trim())).size !== rows.length)
          return { ok: false, error: _t("userscript.useSettingEditor.warn.duplicateOption", "Option values must be unique.") };
        const chosen = rows.some((o) => o.value === selectedValue) ? selectedValue : rows[0].value;
        return {
          ok: true,
          value: rows.map((o) => ({
            value: o.value.trim(),
            label: o.tKey ? { __type: "translation", key: o.tKey } : o.label.trim(),
            selected: o.value === chosen,
          })),
          localeWrites: rows.filter((o) => o.tKey).map((o) => ({ key: o.tKey, value: o.label.trim(), overwrite: o.label !== o.startEn })),
        };
      },
    };
  }

  /** Builds one editable option row for buildSelectControl(). */
  buildOptionRow(row, rows, onChange, rerender, takenKeys, syncDefault) {
    const rowEl = _el("div", "us-opt-row");

    const value = document.createElement("input");
    value.type = "text";
    value.className = "us-opt-value";
    value.value = row.value;
    value.spellcheck = false;
    value.placeholder = _t("userscript.useSettingEditor.optionValue", "value");
    value.setAttribute("aria-label", value.placeholder);
    value.addEventListener("input", () => {
      row.value = value.value;
      onChange(false);
    });

    const label = document.createElement("input");
    label.type = "text";
    label.className = "us-opt-label";
    label.value = row.label;
    if (row.tKey) label.title = `t(${JSON.stringify(row.tKey)})`;
    label.placeholder = _t("userscript.useSettingEditor.optionLabel", "Label");
    label.setAttribute("aria-label", label.placeholder);
    label.addEventListener("input", () => {
      row.label = label.value;
      row.dirty = true;
      onChange(false);
    });
    // Editing a plain label assigns it a translation key automatically.
    label.addEventListener("blur", () => {
      if (!row.tKey && row.label.trim()) {
        row.tKey = generateSettingKey(row.label, takenKeys());
        row.startEn = row.label;
        label.title = `t(${JSON.stringify(row.tKey)})`;
      }
      onChange(true);
    });

    const delBtn = this.makeIconButton(
      typeof svg_paths !== "undefined" ? svg_paths.crossIconPaths : null,
      () => {
        rows.splice(rows.indexOf(row), 1);
        rerender();
        syncDefault();
        onChange(true);
      },
      _t("common.delete", "Delete"),
      "us-opt-del",
    );

    rowEl.append(value, label, delBtn);
    return rowEl;
  }

  /* ---------- code generation / writing ---------- */

  /** Serializes a value; translation descriptors become t("key") calls. */
  encodeValue(value) {
    if (value && typeof value === "object" && !Array.isArray(value) && value.__type === "translation" && typeof value.key === "string") {
      return `t(${JSON.stringify(value.key)})`;
    }
    return JSON.stringify(value);
  }

  literal(value, indent = "") {
    if (value === undefined) return "null";
    if (Array.isArray(value) && value.length && value.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
      const obj = (o) =>
        "{ " +
        Object.entries(o)
          .map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${this.encodeValue(v)}`)
          .join(", ") +
        " }";
      return "[\n" + value.map((o) => `${indent}  ${obj(o)},`).join("\n") + `\n${indent}]`;
    }
    if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value, null, 2).replace(/\n/g, "\n" + indent);
    return JSON.stringify(value);
  }

  buildCall(key, label, type, defaultCode) {
    // t("key") label calls are kept verbatim instead of being stringified.
    const labelArg = /^t\s*\(\s*(['"])[^'"]+\1\s*\)$/.test(label) ? label : JSON.stringify(label);
    return `useSetting(${JSON.stringify(key)}, ${labelArg}, ${JSON.stringify(type)}, ${defaultCode})`;
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
    keyIn.className = "us-draft-key is-auto";
    keyIn.placeholder = _t("userscript.useSettingEditor.placeholder.variableName", "Variable name");
    keyIn.spellcheck = false;
    const labIn = document.createElement("input");
    labIn.type = "text";
    labIn.className = "us-label";
    labIn.placeholder = _t("userscript.useSettingEditor.placeholder.englishLabel", "English label (required)");
    labIn.setAttribute("aria-label", labIn.placeholder);

    // The key is generated from the English label until the user edits it by
    // hand (any input event on keyIn counts as a manual edit).
    let keyAuto = true;
    const hint = _el(
      "small",
      "us-draft-hint",
      _t("userscript.useSettingEditor.keyGeneratedHint", "The key is generated automatically from the English label. You can edit it."),
    );
    const takenKeys = () => new Set([...this.settings.map((s) => s.key), ...this.localeKeySet()]);
    keyIn.addEventListener("input", () => {
      if (!keyAuto) return;
      keyAuto = false;
      keyIn.classList.remove("is-auto");
      hint.hidden = true;
    });
    labIn.addEventListener("input", () => {
      if (keyAuto && labIn.value.trim()) keyIn.value = generateSettingKey(labIn.value, takenKeys());
    });

    const fields = _el("div", "us-draft-fields");
    fields.append(keyIn, labIn, hint);

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
        if (!label) return say(_t("userscript.useSettingEditor.warn.emptyLabel", "The label can't be empty."));
        if (!this.isValidVariable(key)) return say(_t("userscript.useSettingEditor.warn.validVariableName", "Enter a valid variable name."));
        // The key doubles as the translation key, so it must not collide with
        // an existing setting or locale entry (never overwrite either).
        if (this.settings.some((s) => s.key === key) || this.localeKeySet().has(key)) {
          return say(_t("userscript.useSettingEditor.warn.duplicateKey", "A setting with this name already exists."));
        }
        const r = ctl.read();
        if (!r.ok) return say(r.error);
        this.insertSetting(key, `t(${JSON.stringify(key)})`, type, r.value);
        // Register the English translation; other languages stay untouched.
        this.onLocalesChange?.(key, label, false);
        // Select rows may already carry auto-generated option keys.
        if (Array.isArray(r.localeWrites)) {
          for (const w of r.localeWrites) this.onLocalesChange?.(w.key, w.value, w.overwrite);
        }
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
