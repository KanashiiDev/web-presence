// Translation descriptor engine for user parsers (the `locales` parser metadata
// and the sandbox `t()` helper). All actual resolution happens in the main
// context (mainParser.js); the sandbox only creates and transports descriptors.
//
// Descriptor shape (plain, serializable, structured-clone safe):
//   { __type: "translation", key: "state-playing", args: [title] }
// `args` is either an array (positional {0}, {1}) or a flat object (named {name}).

// Strict marker check: only objects with the exact descriptor shape are
// treated as translation descriptors, so ordinary data objects pass through.
function isTranslationDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.__type !== "translation") return false;
  if (typeof value.key !== "string" || value.key.length === 0) return false;
  if (value.args !== undefined && !Array.isArray(value.args) && (typeof value.args !== "object" || value.args === null)) return false;
  return true;
}

// Cheap deep check so mainParser only pays for language detection when a
// descriptor is actually present in the data. Objects are walked broadly
// (DOM-like objects expose no own enumerable keys) with a cycle guard.
function containsTranslationDescriptor(value, seen) {
  if (isTranslationDescriptor(value)) return true;
  if (!value || typeof value !== "object") return false;
  seen = seen || new WeakSet();
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsTranslationDescriptor(item, seen)) return true;
    }
    return false;
  }
  for (const key of Object.keys(value)) {
    if (containsTranslationDescriptor(value[key], seen)) return true;
  }
  return false;
}

// Language/interpolation logic is shared with the UI i18n system (i18n.js is
// inlined into every context script), so parser texts and UI texts can never
// disagree on the language or on placeholder semantics.
function requireI18nHelpers() {
  const lib = typeof globalThis !== "undefined" ? globalThis.I18n : undefined;
  if (!lib || typeof lib.interpolate !== "function" || typeof lib.getLangCandidates !== "function") {
    throw new Error("parser-locales: i18n.js (I18n.interpolate / I18n.getLangCandidates) is not loaded in this context.");
  }
  return lib;
}

// {0}, {1} for arrays and {name} for flat objects; exactly I18n.interpolate().
function interpolateTranslationParams(str, params) {
  return requireI18nHelpers().interpolate(str, params);
}

function getTranslationEntry(locales, lang, key) {
  if (!locales || typeof locales !== "object") return null;
  const map = locales[lang];
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const value = map[key];
  // Empty strings count as missing so the fallback chain still works.
  return typeof value === "string" && value ? value : null;
}

// Value of `key` in language `lang`, falling back to "en"; null when neither has it.
function lookupTranslation(locales, lang, key) {
  const str = getTranslationEntry(locales, lang, key);
  return str != null ? str : getTranslationEntry(locales, "en", key);
}

// Resolve one descriptor to a plain string.
// Fallback order: selected language -> en -> the key itself.
function resolveTranslationDescriptor(descriptor, locales, lang) {
  const str = lookupTranslation(locales, lang, descriptor.key);
  return interpolateTranslationParams(str != null ? str : descriptor.key, descriptor.args);
}

// Plain-text description of a script. Saved scripts keep it as a t() descriptor
// ({ __type: "translation", key: "description" }) whose English text lives in
// locales; legacy scripts keep a plain string. Anything unresolvable is "".
function resolveScriptDescription(script) {
  const description = script && script.description;
  if (typeof description === "string") return description;
  if (!isTranslationDescriptor(description)) return "";
  return lookupTranslation(script.locales, selectLocaleLang(script.locales, "en"), description.key) ?? "";
}

// Picks the best available language from the parser's `locales` table.
// The requested tag is expanded with I18n.getLangCandidates (exact tag, script
// variant, base language, Chinese cross-variant) and matched case-insensitively
// ("_" == "-") against the table's keys; the table's own key is returned so
// even a hand-written { zh_TW: {...} } resolves. Then: en -> first entry.
function selectLocaleLang(locales, lang) {
  const byNormalized = new Map();
  if (locales && typeof locales === "object") {
    for (const k of Object.keys(locales)) {
      if (locales[k] && typeof locales[k] === "object" && !Array.isArray(locales[k])) byNormalized.set(k.toLowerCase().replace(/_/g, "-"), k);
    }
  }
  if (!byNormalized.size) return null;
  if (lang && typeof lang === "string") {
    for (const candidate of requireI18nHelpers().getLangCandidates(lang.replace(/_/g, "-"))) {
      const hit = byNormalized.get(candidate.toLowerCase());
      if (hit !== undefined) return hit;
    }
  }
  return byNormalized.get("en") ?? byNormalized.values().next().value;
}

// Deep-resolves every descriptor inside a value (activity payload). Ordinary
// strings, numbers, booleans and non-descriptor objects are preserved. The
// input is treated as read-only; a new structure is returned when something
// changed, otherwise the original reference.
function resolveTranslationDescriptors(value, locales, lang, seen) {
  if (isTranslationDescriptor(value)) return resolveTranslationDescriptor(value, locales, lang);
  if (!value || typeof value !== "object") return value;
  seen = seen || new WeakSet();
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const resolved = resolveTranslationDescriptors(item, locales, lang, seen);
      if (resolved !== item) changed = true;
      return resolved;
    });
    return changed ? out : value;
  }
  let changed = false;
  const out = {};
  for (const key of Object.keys(value)) {
    const resolved = resolveTranslationDescriptors(value[key], locales, lang, seen);
    if (resolved !== value[key]) changed = true;
    out[key] = resolved;
  }
  return changed ? out : value;
}

// Normalizes parser `locales` metadata: lowercase language codes ("_" becomes
// "-", so "zh_TW" and "zh-tw" are the same language and are merged) and
// string-only values, empty entries dropped. Returns null when nothing usable
// remains, so callers can omit the field entirely.
function sanitizeLocales(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const rawLang of Object.keys(raw)) {
    if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(rawLang)) continue;
    const lang = rawLang.toLowerCase().replace(/_/g, "-");
    const entries = raw[rawLang];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    const map = {};
    for (const key of Object.keys(entries)) {
      if (typeof key !== "string" || !key.trim()) continue;
      const value = entries[key];
      if (typeof value !== "string" || !value.trim()) continue;
      map[key] = value;
    }
    if (Object.keys(map).length) out[lang] = { ...(out[lang] || {}), ...map };
  }
  return Object.keys(out).length ? out : null;
}

// Walks parser code and calls callback(match, index) for every literal
// t("key") / t('key') call that is real code: comments, string literals and
// regex literals are skipped, template literals are searched only inside their
// ${...} parts. Dynamic key expressions such as t(variable) and member calls
// like obj.t("key") are ignored. `match[2]` is the key; the match ends with the
// closing quote.
//
// Regex literals are told apart from division by the previous significant
// token (the usual heuristic): after an operator, "(", ",", "=", ":", "[", "{",
// ";" or a keyword such as `return` a "/" starts a regex; after an operand, ")"
// or "]" it is division. Known limit: `if (x) /re/.test(s)` reads as division.
// A wrongly guessed regex that has no closing "/" on its line is treated as
// division, so a misjudgement can never swallow more than one line.
const REGEX_PRECEDING_KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

function forEachTranslationCall(code, callback) {
  if (typeof code !== "string") return;
  const callRe = /t\s*\(\s*(['"])([^'"\r\n\\]+)\1(?=\s*[,)])/y;
  const n = code.length;
  const braces = []; // brace depth of each open ${ ... } template expression
  // Last significant token: a punctuation char, an identifier/number word, or
  // "a" after any literal. Decides whether "/" starts a regex.
  let prev = "";
  const regexAllowed = () => prev === "" || /^[(,=:\[!&|?{};+\-*%<>~^]$/.test(prev) || REGEX_PRECEDING_KEYWORDS.has(prev);
  const skipQuoted = (from, quote) => {
    let j = from + 1;
    while (j < n && code[j] !== quote && code[j] !== "\n") {
      if (code[j] === "\\") j++;
      j++;
    }
    return Math.min(j + 1, n);
  };
  // Returns the index after a regex literal starting at `from`, or -1 when no
  // terminating "/" exists on the same line (then it was division after all).
  const skipRegex = (from) => {
    let j = from + 1;
    let inClass = false;
    while (j < n && code[j] !== "\n") {
      const ch = code[j];
      if (ch === "\\") j++;
      else if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) {
        j++;
        while (j < n && /[A-Za-z]/.test(code[j])) j++; // flags
        return j;
      }
      j++;
    }
    return -1;
  };
  // Scans template text from `from`; returns where code scanning resumes.
  const scanTemplate = (from) => {
    let j = from;
    while (j < n) {
      if (code[j] === "\\") j += 2;
      else if (code[j] === "`") {
        prev = "a";
        return j + 1;
      } else if (code[j] === "$" && code[j + 1] === "{") {
        braces.push(0);
        prev = "{";
        return j + 2;
      } else j++;
    }
    return n;
  };
  let i = 0;
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && d === "/") {
      const e = code.indexOf("\n", i);
      i = e === -1 ? n : e;
      continue;
    }
    if (c === "/" && d === "*") {
      const e = code.indexOf("*/", i + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipQuoted(i, c);
      prev = "a";
      continue;
    }
    if (c === "`") {
      i = scanTemplate(i + 1);
      continue;
    }
    if (c === "/" && regexAllowed()) {
      const e = skipRegex(i);
      if (e !== -1) {
        i = e;
        prev = "a";
        continue;
      }
    }
    if (braces.length) {
      if (c === "{") braces[braces.length - 1]++;
      else if (c === "}") {
        if (braces[braces.length - 1] === 0) {
          braces.pop();
          i = scanTemplate(i + 1);
          continue;
        }
        braces[braces.length - 1]--;
      }
    }
    if (/[\w$]/.test(c)) {
      if (c === "t" && !/[\w$.]/.test(code[i - 1] || "")) {
        callRe.lastIndex = i;
        const match = callRe.exec(code);
        if (match) {
          callback(match, i);
          i += match[0].length;
          prev = "a";
          continue;
        }
      }
      // Consume the whole word so "sett(" or "a$t(" are never mistaken for t(.
      let j = i + 1;
      while (j < n && /[\w$]/.test(code[j])) j++;
      prev = code.slice(i, j);
      i = j;
      continue;
    }
    if ((c === "+" || c === "-") && d === c) {
      // "a++ / 2": treat ++/-- as postfix so the following "/" is division.
      prev = "a";
      i += 2;
      continue;
    }
    prev = c;
    i++;
  }
}

// Unique literal t("key") keys of parser code, in order of first appearance.
function scanTranslationKeys(code) {
  const keys = [];
  forEachTranslationCall(code, (match) => {
    if (!keys.includes(match[2])) keys.push(match[2]);
  });
  return keys;
}

// Keys that can be written inside a t("...") literal without escaping.
function isRenamableTranslationKey(key) {
  return typeof key === "string" && key.trim().length > 0 && !/['"\r\n\\]/.test(key);
}

// Source ranges of every literal t("key") / t('key') call that uses `key`.
// Each range covers the quoted key literal only (quotes included) and carries
// the quote character, so a caller can replace it in place. Uses the same
// walker as scanTranslationKeys, so what is scanned is also what is renamed.
function findTranslationKeyRanges(code, key) {
  const ranges = [];
  if (typeof key !== "string" || !key) return ranges;
  forEachTranslationCall(code, (match, index) => {
    if (match[2] !== key) return;
    const end = index + match[0].length;
    ranges.push({ start: end - key.length - 2, end, quote: match[1] });
  });
  return ranges;
}

// Letters that NFD does not decompose, mapped to their usual ASCII form. Without
// this the Turkish dotless "ı" would be dropped and split words ("Şarkı Adı"
// would become "sarkAd").
const SETTING_KEY_TRANSLITERATIONS = { ı: "i", İ: "i", ł: "l", Ł: "l", ø: "o", Ø: "o", đ: "d", Đ: "d", ß: "ss", æ: "ae", Æ: "ae", œ: "oe", Œ: "oe" };

// Generates a camelCase setting/translation key from an English label.
// Accented letters are transliterated via NFD ("Ş" -> "s"; "ı", "ł", "ß" etc.
// via a small table), any remaining non-ASCII characters are dropped, and a "setting" prefix is used when
// nothing usable remains or the result would start with a digit. When
// existingKeys is provided (setting keys and locale keys), a numeric suffix
// ("showArtist2") makes the result unique without overwriting anything.
function generateSettingKey(label, existingKeys) {
  const transliterated = String(label ?? "")
    .replace(/[ıİłŁøØđĐßæÆœŒ]/g, (ch) => SETTING_KEY_TRANSLITERATIONS[ch])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tokens = transliterated.toLowerCase().match(/[a-z0-9]+/g) || [];
  let base = tokens.reduce((acc, token, index) => acc + (index ? token[0].toUpperCase() + token.slice(1) : token), "");
  if (!base || /^[0-9]/.test(base)) base = "setting" + (base ? base[0].toUpperCase() + base.slice(1) : "");
  if (!existingKeys || typeof existingKeys.has !== "function" || !existingKeys.has(base)) return base;
  let suffix = 2;
  while (existingKeys.has(base + suffix)) suffix++;
  return base + suffix;
}

// Removes // and /* */ comments while leaving string contents untouched.
// Line breaks of line comments are kept so positions stay roughly readable.
function stripJsComments(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === "\\" && i + 1 < text.length) out += text[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      if (i < text.length) out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      i = e === -1 ? text.length : e + 1;
      out += " ";
    } else out += c;
  }
  return out;
}

// Is the "/" at idx the start of a regex literal (vs. a division operator)?
function slashStartsRegex(text, idx) {
  let j = idx - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0) return true;
  const p = text[j];
  if (/[A-Za-z0-9_$]/.test(p)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(text[k])) k--;
    return REGEX_PRECEDING_KEYWORDS.has(text.slice(k + 1, j + 1));
  }
  if (p === ")" || p === "]") return false; // a / b, (a + b) / 2, arr[0] / 2
  return true; // operators, "(", ",", "=", ":", "{", "}", ";" ...
}

// Returns the index just past a regex literal starting at idx, or -1 if it isn't one.
function skipRegexLiteral(text, idx) {
  let inClass = false;
  for (let i = idx + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === "\r") return -1;
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "/") {
      let k = i + 1;
      while (k < text.length && /[a-z]/i.test(text[k])) k++; // flags
      return k;
    }
  }
  return -1;
}

// Returns the index of the closing quote of a "..." or '...' string starting at idx, or -1.
function skipQuotedString(text, idx) {
  const q = text[idx];
  for (let i = idx + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === q) return i;
    if (c === "\n") return -1;
  }
  return -1;
}

// Returns the index of the closing backtick of a template literal starting at idx, or -1.
// Handles nested ${ ... } expressions (which may contain strings, regexes, templates, braces).
function skipTemplateLiteral(text, idx) {
  for (let i = idx + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`") return i;
    if (c === "$" && text[i + 1] === "{") {
      const e = matchBalancedBrace(text, i + 1);
      if (e === -1) return -1;
      i = e;
    }
  }
  return -1;
}

// Returns the index of the "}" matching the "{" at openIdx, or -1 when unbalanced.
// Aware of comments, "/'-strings, template literals (incl. nested ${}) and regex literals,
// so braces/quotes inside them are not counted.
function matchBalancedBrace(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (c === "/" && n === "/") {
      const e = text.indexOf("\n", i);
      if (e === -1) return -1;
      i = e;
      continue;
    }
    if (c === "/" && n === "*") {
      const e = text.indexOf("*/", i + 2);
      if (e === -1) return -1;
      i = e + 1;
      continue;
    }
    if (c === "/" && slashStartsRegex(text, i)) {
      const e = skipRegexLiteral(text, i);
      if (e !== -1) {
        i = e - 1;
        continue;
      }
      continue; // not a valid regex after all: treat as a plain character
    }
    if (c === '"' || c === "'") {
      const e = skipQuotedString(text, i);
      if (e === -1) return -1;
      i = e;
      continue;
    }
    if (c === "`") {
      const e = skipTemplateLiteral(text, i);
      if (e === -1) return -1;
      i = e;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Parses the source text of a `locales: {...}` object. The canonical export
// format is JSON; the fallback tolerantly reads unquoted keys for hand-written
// registerParser blocks. Returns a sanitized locales object or null.
function parseLocalesObjectText(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return sanitizeLocales(parsed);
  } catch (_) {}
  text = stripJsComments(text);
  const out = {};
  const langRe = /(?:^|[,{]\s*)(["']?)([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?)\1\s*:\s*\{/g;
  let langMatch;
  while ((langMatch = langRe.exec(text)) !== null) {
    const lang = langMatch[2].toLowerCase();
    const openIdx = langMatch.index + langMatch[0].length - 1;
    const end = matchBalancedBrace(text, openIdx);
    if (end === -1) continue;
    const body = text.slice(openIdx + 1, end).trim();
    const map = {};
    const pairRe = /(?:^|[,{]\s*)(["']?)([A-Za-z0-9_.$@-]+)\1\s*:\s*(["'])((?:[^\\]|\\.)*?)\3/g;
    let pairMatch;
    while ((pairMatch = pairRe.exec(body)) !== null) {
      const raw = pairMatch[4];
      let value = raw;
      try {
        value = JSON.parse(`"${raw}"`);
      } catch (_) {
        value = raw.replace(/\\(.)/g, "$1");
      }
      map[pairMatch[2]] = value;
    }
    if (Object.keys(map).length) out[lang] = map;
  }
  return Object.keys(out).length ? sanitizeLocales(out) : null;
}
