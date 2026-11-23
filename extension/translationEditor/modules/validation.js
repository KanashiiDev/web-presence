// Adapter between pure QA validators (qaValidators.js) and editor i18n messages.

function teQaIssueLabel(issue, omitKey = false) {
  const key = issue.key;
  let labels;
  switch (issue.rule) {
    case "required-keys":
      labels = [i18n.t("translationEditor.validation.missingKey", { key })];
      break;
    case "placeholder-integrity":
      labels = (issue.details.missing || [])
        .map((token) => i18n.t("translationEditor.qa.placeholderMissing", { key, token }))
        .concat((issue.details.extra || []).map((token) => i18n.t("translationEditor.validation.placeholderNotInSource", { key, name: token })));
      break;
    case "special-token-integrity":
      labels = (issue.details.missing || [])
        .map((token) => i18n.t("translationEditor.qa.tokenMissing", { key, token }))
        .concat((issue.details.extra || []).map((token) => i18n.t("translationEditor.qa.tokenExtra", { key, token })));
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
    case "value-too-long":
      labels = [i18n.t("translationEditor.qa.length", { key })];
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
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp(`^${escaped}\\s*:\\s*`);
  return labels.map((label) => label.replace(prefix, ""));
}

function teValidateChanges(sourceFlat, targetFlat, changes, options = {}) {
  const errors = [];
  const warnings = [];
  const issues = [];
  // Only keys actually touched by a submission are hard errors. Completion
  // gaps caused by an English source change are progress, not a broken patch.
  const scope = options.keyScope ? new Set(options.keyScope) : null;
  const sourceKeys = Object.keys(sourceFlat).filter((key) => !scope || scope.has(key));
  const targetKeys = new Set(Object.keys(targetFlat).filter((key) => !scope || scope.has(key)));
  const gapSeverity = scope ? "warning" : "error";

  const seen = new Set();
  const add = (rule, severity, key, message, details = {}) => {
    if (seen.has(`${key}|${rule}`)) return;
    seen.add(`${key}|${rule}`);
    const issue = { rule, severity, key, message, details };
    issues.push(issue);
    const labels = teQaIssueLabel(issue);
    (severity === "error" ? errors : warnings).push(...labels);
  };

  if (!options.skipMissing) {
    sourceKeys.forEach((key) => {
      if (!targetKeys.has(key)) add("required-keys", gapSeverity, key, "Missing required key", { missing: [key] });
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
      const token = entry.message.match(/\{([^}]+)\}/)?.[1] || "";
      add(entry.code, entry.severity, change.key, entry.message, { token });
    }
    teCollectQaIssues(change.source, change.target, change.key, { change }).forEach((issue) => {
      add(issue.rule, issue.severity, issue.key, issue.message, issue.details);
    });
  });

  return { errors, warnings, issues };
}
