/**
 * Canonical per-key QA module.
 *
 * Single source of truth for QA severity rules, shared by the processor and
 * the browser editor.
 *
 * Severity decisions (approved):
 *   error   - blocks that key only: non-string, unsafe-key, control-character,
 *             extra-placeholder, value-too-long, missing-placeholder, unsafe-value
 *   warning - badge/progress only: empty-value, missing-key, outdated,
 *             unverified, same-as-source, ending-punctuation
 */

const TE_QA_MAX_VALUE_LENGTH = 20000;
const TE_QA_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/;
const TE_QA_UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];
// eslint-disable-next-line no-control-regex
const TE_QA_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
const TE_QA_HTML_TAG_RE = /<\s*\/?\s*[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\s*\/?>/;
const TE_QA_JAVASCRIPT_URL_RE = /javascript\s*:/i;
const TE_QA_BIDI_ZERO_WIDTH_RE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/u;
const TE_QA_PLACEHOLDER_RE = /\{([A-Za-z0-9_.]+)\}/g;
const TE_SHARED_QA_ENDING_PUNCTUATION = {
  ".": ".",
  "。": ".",
  "．": ".",
  "｡": ".",
  "।": ".",
  "۔": ".",
  "!": "!",
  "！": "!",
  "?": "?",
  "？": "?",
  "؟": "?",
  ":": ":",
  "：": ":",
  ";": ";",
  "；": ";",
  "…": "…",
};

function teQaPlaceholders(text) {
  const out = new Set();
  const value = typeof text === "string" ? text : "";
  for (const match of value.matchAll(TE_QA_PLACEHOLDER_RE)) out.add(match[1]);
  return out;
}

function teQaEnding(text) {
  const trimmed = String(text ?? "").replace(/(?:\s|["'\p{Pf})\]\u300D\u300F\uFF09])+$/u, "");
  if (!trimmed) return null;
  if (/(?:\.{3}|\u2026)$/.test(trimmed)) return "…";
  return TE_SHARED_QA_ENDING_PUNCTUATION[trimmed[trimmed.length - 1]] || null;
}

function teQaUnsafeKey(key) {
  if (typeof key !== "string" || !TE_QA_KEY_RE.test(key)) return true;
  return TE_QA_UNSAFE_KEYS.includes(key) || key.includes("__proto__") || key.includes("/") || key.includes("\\") || key.includes("\0");
}

/**
 * Validate one translation key against its English source.
 * @returns {{errors: Array<{code,severity,key,message}>, warnings: Array<{code,severity,key,message}>}}
 */
export function teValidateKey({ key, source, value }) {
  const errors = [];
  const warnings = [];
  const add = (severity, code, message) => (severity === "error" ? errors : warnings).push({ code, severity, key, message });

  if (typeof value !== "string") {
    add("error", "non-string", "Translation value must be a string");
    return { errors, warnings };
  }
  if (teQaUnsafeKey(key)) add("error", "unsafe-key", "Unsafe translation key");
  if (TE_QA_CONTROL_RE.test(value)) add("error", "control-character", "Translation contains an invalid control character");
  if (value.length > TE_QA_MAX_VALUE_LENGTH) add("error", "value-too-long", "Translation value is too long");
  if (TE_QA_HTML_TAG_RE.test(value)) add("warning", "unsafe-value", "Translation contains HTML-like markup");
  if (TE_QA_JAVASCRIPT_URL_RE.test(value)) add("error", "unsafe-value", "Translation contains a javascript: URL");
  if (TE_QA_BIDI_ZERO_WIDTH_RE.test(value)) add("error", "unsafe-value", "Translation contains a bidi or zero-width character");

  if (value.trim() !== "") {
    const sourcePlaceholders = teQaPlaceholders(source);
    const targetPlaceholders = teQaPlaceholders(value);
    for (const placeholder of sourcePlaceholders) {
      if (!targetPlaceholders.has(placeholder)) add("error", "missing-placeholder", `Missing placeholder {${placeholder}}`);
    }
    for (const placeholder of targetPlaceholders) {
      if (!sourcePlaceholders.has(placeholder)) add("error", "extra-placeholder", `Unknown placeholder {${placeholder}}`);
    }
  }

  if (value.trim() === "" && String(source ?? "").trim() !== "") add("warning", "empty-value", "Empty translation; English fallback is used");
  if (value === source && String(source ?? "").length > 0) add("warning", "same-as-source", "Translation is identical to the source");
  if (teQaEnding(value) !== teQaEnding(source)) add("warning", "ending-punctuation", "Ending punctuation differs from the source");

  return { errors, warnings };
}

export const validateKey = teValidateKey;
