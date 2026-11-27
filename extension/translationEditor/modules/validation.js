// Adapter between pure QA validators (qaValidators.js) and editor i18n messages.

const teOmitKeyPrefixes = new Map();

function teQaTokenListLabels(issue, missingKey, extraKey, extraParam = "token") {
  const key = issue.key;
  return (issue.details.missing || [])
    .map((token) => i18n.t(missingKey, { key, token }))
    .concat((issue.details.extra || []).map((token) => i18n.t(extraKey, { key, [extraParam]: token })));
}

function teQaIssueLabel(issue, omitKey = false) {
  const key = issue.key;
  let labels;
  switch (issue.rule) {
    case "required-keys":
      labels = [i18n.t("translationEditor.validation.missingKey", { key })];
      break;
    case "placeholder-integrity":
      labels = teQaTokenListLabels(issue, "translationEditor.qa.placeholderMissing", "translationEditor.validation.placeholderNotInSource", "name");
      break;
    case "special-token-integrity":
      labels = teQaTokenListLabels(issue, "translationEditor.qa.tokenMissing", "translationEditor.qa.tokenExtra");
      break;
    case "whitespace-integrity":
      labels = [i18n.t("translationEditor.qa.whitespace", { key })];
      break;
    case "double-space":
      labels = [i18n.t("translationEditor.qa.doubleSpace", { key })];
      break;
    case "capitalization":
      labels = [i18n.t("translationEditor.qa.capitalization", { key })];
      break;
    case "ending-punctuation":
      labels = [i18n.t("translationEditor.qa.endingPunctuation", { key })];
      break;
    case "length":
    case "value-too-long":
      labels = [i18n.t("translationEditor.qa.length", { key })];
      break;
    case "plural-structure":
      labels = [i18n.t("translationEditor.qa.plural", { key })];
      break;
    case "duplicate-key":
      labels = [i18n.t("translationEditor.qa.duplicateKey", { key })];
      break;
    case "locale-syntax":
      labels = [i18n.t("translationEditor.qa.invalidJson", { error: issue.details.error || "" })];
      break;
    case "source-freshness":
      labels = [i18n.t("translationEditor.qa.sourceFreshness", { key })];
      break;
    case "empty-value":
      labels = [i18n.t("translationEditor.validation.emptyTranslation", { key })];
      break;
    case "control-character":
      labels = [i18n.t("translationEditor.validation.controlCharacter", { key })];
      break;
    case "unsafe-value":
      labels = [i18n.t("translationEditor.validation.unsafeValue", { key })];
      break;
    case "non-string":
      labels = [i18n.t("translationEditor.validation.nonString", { key })];
      break;
    case "unsafe-key":
      labels = [i18n.t("translationEditor.validation.unsafeKey", { key })];
      break;
    case "missing-placeholder":
      labels = [i18n.t("translationEditor.qa.placeholderMissing", { key, token: issue.details.token || "" })];
      break;
    case "extra-placeholder":
      labels = [i18n.t("translationEditor.validation.placeholderNotInSource", { key, name: issue.details.token || "" })];
      break;
    case "same-as-source":
      labels = [i18n.t("translationEditor.validation.sameAsSource", { key })];
      break;
    default:
      labels = [issue.message];
  }

  if (!omitKey || !key) return labels;
  let prefix = teOmitKeyPrefixes.get(key);
  if (!prefix) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    prefix = new RegExp(`^${escaped}\\s*:\\s*`);
    teOmitKeyPrefixes.set(key, prefix);
  }
  return labels.map((label) => label.replace(prefix, ""));
}

// Severity and the subject keep distinct findings for the same key from collapsing into one issue.
function teQaIssueIdentity(key, rule, severity, details) {
  const token = typeof details?.token === "string" ? details.token : "";
  const kind = typeof details?.kind === "string" ? details.kind : "";
  const missing = Array.isArray(details?.missing) ? details.missing.join(",") : "";
  const extra = Array.isArray(details?.extra) ? details.extra.join(",") : "";
  return `${key}|${rule}|${severity}|${token}|${kind}|${missing}|${extra}`;
}

function teValidateChanges(sourceFlat, targetFlat, changes, options = {}) {
  const errors = [];
  const warnings = [];
  const issues = [];
  // Completion gaps are progress, not a broken patch: missing keys are
  // warnings. Only keys actually touched by a submission are checked here.
  const scope = options.keyScope ? new Set(options.keyScope) : null;
  const sourceKeys = Object.keys(sourceFlat).filter((key) => !scope || scope.has(key));
  const targetKeys = new Set(Object.keys(targetFlat).filter((key) => !scope || scope.has(key)));

  const seen = new Set();
  const seenLabels = new Set();
  const add = (rule, severity, key, message, details = {}) => {
    const identity = teQaIssueIdentity(key, rule, severity, details);
    if (seen.has(identity)) return;
    seen.add(identity);
    const issue = { rule, severity, key, message, details };
    issues.push(issue);
    // Distinct issues can share one user-facing label (two unsafe-value
    // causes). Keep every issue, but do not repeat the same label in the UI.
    const labels = teQaIssueLabel(issue).filter((label) => {
      const labelIdentity = `${severity}|${label}`;
      if (seenLabels.has(labelIdentity)) return false;
      seenLabels.add(labelIdentity);
      return true;
    });
    (severity === "error" ? errors : warnings).push(...labels);
  };

  if (!options.skipMissing) {
    sourceKeys.forEach((key) => {
      if (!targetKeys.has(key)) add("required-keys", "warning", key, "Missing required key", { missing: [key] });
    });
    teValidatePluralStructure(sourceKeys, [...targetKeys]).forEach((issue) => {
      add(issue.rule, issue.severity, issue.key, issue.message, issue.details);
    });
  }

  changes.forEach((change) => {
    // Canonical per-key QA runs first so the editor and the processor apply
    // exactly the same severity rules. Editor-only linguistic checks follow.
    const verdict = teValidateKey({ key: change.key, source: change.source, value: change.target });
    for (const entry of [...verdict.errors, ...verdict.warnings]) {
      add(entry.code, entry.severity, change.key, entry.message, entry.details || {});
    }
    // Canonical rules already cover these codes. Editor-only variants still
    // run for badges, but must not be reported twice in submit validation.
    const canonicalCodes = new Set([...verdict.errors, ...verdict.warnings].map((entry) => entry.code));
    teCollectQaIssues(change.source, change.target, change.key, { change }).forEach((issue) => {
      if (canonicalCodes.has(issue.rule)) return;
      add(issue.rule, issue.severity, issue.key, issue.message, issue.details);
    });
  });

  return { errors, warnings, issues };
}
