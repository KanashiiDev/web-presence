// Pure, UI-independent localization QA validators.
// Results use: { rule, severity, key, message, details }
//
// Locale values contain only plain text and {placeholders} (no HTML).

// Escaped sequences, URLs (without trailing sentence punctuation), real newline/tab.
const TE_QA_SPECIAL_PATTERN = /\\n|\\t|\\\\|\\"|https?:\/\/[^\s"'<>]*[^\s"'<>.,;:!?)]|\n|\t/g;

// Opening quotes/brackets and inverted marks ignored when looking for the first letter.
const TE_QA_LEADING_PATTERN = /^(?:\s|["'\p{Pi}(\[\u00BF\u00A1\u300C\u300E\uFF08])+/u;

const TE_QA_LENGTH_MIN_SOURCE = 10;
const TE_QA_LENGTH_RATIO = 3;

function teQaEmptyObject() {
  return Object.create(null);
}

function teCountQaTokens(text, pattern, normalize) {
  const counts = teQaEmptyObject();
  const matches = String(text ?? "").match(pattern) || [];
  matches.forEach((token) => {
    const value = normalize ? normalize(token) : token;
    counts[value] = (counts[value] || 0) + 1;
  });
  return counts;
}

function teQaCompareCounts(expected, actual) {
  const missing = [];
  const extra = [];
  Object.keys(expected).forEach((token) => {
    const count = actual[token] || 0;
    for (let index = count; index < expected[token]; index++) missing.push(token);
  });
  Object.keys(actual).forEach((token) => {
    const count = expected[token] || 0;
    for (let index = count; index < actual[token]; index++) extra.push(token);
  });
  return { missing, extra, expected, actual };
}

function teQaResult(rule, severity, key, message, details) {
  return { rule, severity, key, message, details: details || {} };
}

function teNormalizeSpecialToken(token) {
  if (token === "\n") return "\\n";
  if (token === "\t") return "\\t";
  return token;
}

function teValidateSpecialTokens(source, target, key) {
  const expected = teCountQaTokens(source, TE_QA_SPECIAL_PATTERN, teNormalizeSpecialToken);
  const actual = teCountQaTokens(target, TE_QA_SPECIAL_PATTERN, teNormalizeSpecialToken);
  const diff = teQaCompareCounts(expected, actual);
  if (!diff.missing.length && !diff.extra.length) return null;
  return teQaResult("special-token-integrity", "warning", key, "Special token mismatch", diff);
}

function teValidateWhitespace(source, target, key) {
  const s = String(source ?? "");
  const t = String(target ?? "");
  const expected = { leading: /^\s/.test(s), trailing: /\s$/.test(s) };
  const actual = { leading: /^\s/.test(t), trailing: /\s$/.test(t) };
  if (expected.leading === actual.leading && expected.trailing === actual.trailing) return null;
  return teQaResult("whitespace-integrity", "warning", key, "Whitespace mismatch", { expected, actual });
}

// Consecutive spaces inside the text that the source does not have.
function teValidateDoubleSpace(source, target, key) {
  const pattern = /\S[ \t]{2,}\S/;
  const expected = pattern.test(String(source ?? ""));
  const actual = pattern.test(String(target ?? ""));
  if (expected || !actual) return null;
  return teQaResult("double-space", "warning", key, "Double space", { expected, actual });
}

// Returns one of ". ! ? : ; …" or null when the text has no ending punctuation.
// Ignores trailing whitespace and closing quotes/brackets; treats "..." and "…" as equal.
function teEndingPunctuation(text) {
  return teQaEnding(text);
}

function teInitialCase(text) {
  const first = String(text ?? "").replace(TE_QA_LEADING_PATTERN, "")[0];
  if (!first) return null;
  if (/\p{Lu}/u.test(first)) return "upper";
  if (/\p{Ll}/u.test(first)) return "lower";
  return null;
}

function teValidateCapitalization(source, target, key) {
  const expected = teInitialCase(source);
  if (!expected) return null;
  const actual = teInitialCase(target);
  if (!actual || actual === expected) return null;
  return teQaResult("capitalization", "warning", key, "Initial capitalization mismatch", { expected, actual });
}

// Flags both directions: source ends with punctuation but target does not (missing),
// source has none but target does (extra), or both have different punctuation (different).
function teValidateEndingPunctuation(source, target, key) {
  const expected = teEndingPunctuation(source);
  const actual = teEndingPunctuation(target);
  if (expected === actual) return null;
  const type = !actual ? "missing" : !expected ? "extra" : "different";
  return teQaResult("ending-punctuation", "warning", key, "Ending punctuation mismatch", { expected, actual, type });
}

// Only the "too long" direction is checked: CJK languages are naturally much shorter.
function teValidateLength(source, target, key) {
  const sourceLength = String(source ?? "").trim().length;
  const targetLength = String(target ?? "").trim().length;
  if (sourceLength < TE_QA_LENGTH_MIN_SOURCE) return null;
  const limit = sourceLength * TE_QA_LENGTH_RATIO;
  if (targetLength <= limit) return null;
  return teQaResult("length", "warning", key, "Translation is much longer than source", { sourceLength, targetLength, limit });
}

function teValidatePluralStructure(sourceKeys, targetKeys = []) {
  const source = new Set(sourceKeys);
  const target = new Set(targetKeys);
  const results = [];
  sourceKeys.forEach((key) => {
    const counterpart = /\.one$/.test(key) ? key.replace(/\.one$/, ".other") : /\.other$/.test(key) ? key.replace(/\.other$/, ".one") : null;
    // An incomplete plural group in the source is a source defect, not a
    // translation error. Only require the counterpart when the source has it.
    if (!counterpart || !source.has(counterpart)) return;
    if (!target.has(counterpart)) {
      results.push(teQaResult("plural-structure", "error", key, "Missing plural counterpart", { missing: [counterpart] }));
    }
  });
  return results;
}

// Finds keys that appear twice inside the same JSON object.
// Each object gets its own scope, so the same key name in different objects is fine.
function teFindDuplicateKeys(rawText) {
  const text = String(rawText ?? "");
  const scopes = [];
  const duplicates = [];
  let inString = false;
  let escaped = false;
  let token = "";

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        token += char;
      } else if (char === "\\") {
        escaped = true;
        token += char;
      } else if (char === '"') {
        inString = false;
        let next = index + 1;
        while (/\s/.test(text[next] || "")) next++;
        const scope = scopes[scopes.length - 1];
        if (scope && text[next] === ":") {
          if (scope.has(token) && !duplicates.includes(token)) duplicates.push(token);
          scope.add(token);
        }
        token = "";
      } else {
        token += char;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      token = "";
    } else if (char === "{") {
      scopes.push(new Set());
    } else if (char === "}") {
      scopes.pop();
    }
  }
  return duplicates;
}

function teValidateLocaleSyntax(rawText) {
  const results = [];
  try {
    JSON.parse(rawText);
  } catch (err) {
    results.push(teQaResult("locale-syntax", "error", "", "Invalid JSON", { error: err.message }));
  }
  teFindDuplicateKeys(rawText).forEach((key) => {
    results.push(teQaResult("duplicate-key", "error", key, "Duplicate key", { key }));
  });
  return results;
}

// Values are rendered as plain UI text and auto-merged by the locales
// processor. Reject markup, executable URLs and invisible bidi/zero-width
// characters here so the editor cannot create a submission that will be
// rejected (or worse, shipped) downstream.
function teValidateUnsafeValue(target, key) {
  if (!teValueIsUnsafe(target)) return null;
  return teQaResult("unsafe-value", "error", key, "Unsafe characters in translation", {});
}

function teValidateSourceFreshness(change) {
  if (!change || typeof change.sourceHash !== "string" || typeof change.currentSourceHash !== "string") return null;
  if (change.sourceHash === change.currentSourceHash) return null;
  return teQaResult("source-freshness", "warning", change.key, "Source changed since it was edited", {
    expected: { sourceHash: change.sourceHash },
    actual: { sourceHash: change.currentSourceHash },
  });
}

function teCollectQaIssues(source, target, key, options = {}) {
  const issues = [];
  // Freshness is a property of the change, not of the target value: a cleared
  // translation can still be based on an outdated English source.
  if (options.change) {
    const freshness = teValidateSourceFreshness(options.change);
    if (freshness) issues.push(freshness);
  }
  if (!target || source === target) return issues;
  const push = (result) => {
    if (Array.isArray(result)) issues.push(...result);
    else if (result) issues.push(result);
  };
  push(teValidateUnsafeValue(target, key));
  push(teValidateSpecialTokens(source, target, key));
  push(teValidateWhitespace(source, target, key));
  push(teValidateDoubleSpace(source, target, key));
  push(teValidateCapitalization(source, target, key));
  push(teValidateEndingPunctuation(source, target, key));
  push(teValidateLength(source, target, key));
  return issues;
}
