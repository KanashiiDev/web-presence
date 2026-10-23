// Shared syntax validation for selector-based parser configs. Used by the
// selector editor overlay and the Script Manager's selector parser editor.
// Pure syntax checks; matching elements on the actual page stays the
// caller's responsibility (querySelectorDeep and friends).

const SELECTOR_CSS_FIELDS = ["artist", "source", "image", "link", "isPlaying", "buttonText", "buttonLink", "buttonText2", "buttonLink2", "timePassed", "duration"];

const SELECTOR_LABEL_PATTERN = "selector.editor";

function selectorLabelOf(field) {
  return `${SELECTOR_LABEL_PATTERN}.${field}.label`;
}

function isValidSelectorSyntax(selector) {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch (_) {
    return false;
  }
}

function isValidRegexPattern(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Validates a selector-based parser config before it is persisted.
 *
 * @param {Record<string, string|undefined>} selectors - Selector field values as entered by the user.
 * @param {object} [options]
 * @param {string[]} [options.urlPatterns] - URL regex patterns to validate.
 * @param {boolean} [options.hasDomain] - True when a usable domain is present.
 * @param {(field: string) => string} [options.labelOf] - Display function mapping a field name to a label.
 * @returns {{ ok: boolean, invalidFields: string[] }}
 */
function validateSelectorConfig(selectors, { urlPatterns = [], hasDomain = true, labelOf = selectorLabelOf } = {}) {
  const invalidFields = [];

  if (!selectors?.title) invalidFields.push(labelOf("title"));

  for (const field of SELECTOR_CSS_FIELDS) {
    const value = typeof selectors?.[field] === "string" ? selectors[field].trim() : selectors?.[field];
    if (value && !isValidSelectorSyntax(value)) invalidFields.push(labelOf(field));
  }

  const regexSource = selectors?.regex;
  if (regexSource) {
    const patterns = String(regexSource)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (patterns.length && patterns.some((p) => !isValidRegexPattern(p))) invalidFields.push(labelOf("regex"));
  }

  if (urlPatterns.length && urlPatterns.some((p) => !isValidRegexPattern(p))) invalidFields.push(labelOf("regex"));

  if (!hasDomain) invalidFields.push(labelOf("domain"));

  return { ok: invalidFields.length === 0, invalidFields };
}
