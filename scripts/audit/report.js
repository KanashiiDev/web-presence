const path = require("path");

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

function summarize(diagnostics) {
  const summary = { errors: 0, warnings: 0, info: 0, byCode: {} };
  for (const item of diagnostics) {
    if (item.severity === "error") summary.errors += 1;
    else if (item.severity === "warning") summary.warnings += 1;
    else summary.info += 1;
    summary.byCode[item.code] = (summary.byCode[item.code] || 0) + 1;
  }
  return summary;
}

function formatLocation(item) {
  if (!item.file) return "";
  const relative = item.file;
  if (!item.line) return relative;
  return item.column ? `${relative}:${item.line}:${item.column}` : `${relative}:${item.line}`;
}

function formatDiagnostic(item) {
  const location = formatLocation(item);
  return `        ${item.severity.toUpperCase().padEnd(7)} ${item.code.padEnd(24)} ${location ? `${location}  ` : ""}${item.message}`;
}

function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0) return severity;
    if (a.scope !== b.scope) return a.scope < b.scope ? -1 : 1;
    if (a.file !== b.file) return String(a.file).localeCompare(String(b.file));
    return (a.line || 0) - (b.line || 0);
  });
}

/**
 * Computes the overall verdict of an audit run.
 *
 * The verdict mirrors the exit code of the CLI:
 * - FAILED when at least one audited target has an error level finding (or a warning,
 *   when the caller asked for strict mode).
 * - INCOMPLETE when nothing failed but at least one requested target had no build
 *   directory, so it could not be audited at all.
 * - PASSED when every requested target was audited and is free of error level findings.
 */
function verdict(result, options = {}) {
  const strict = Boolean(options.strict);
  const failed = [];
  const notBuilt = [];

  for (const target of result.targets) {
    if (target.missing) {
      notBuilt.push(target.target);
      continue;
    }
    const hasErrors = target.diagnostics.some((item) => item.severity === "error");
    const hasWarnings = target.diagnostics.some((item) => item.severity === "warning");
    if (hasErrors || (strict && hasWarnings)) failed.push(target.target);
  }

  if (failed.length > 0) return { state: "FAILED", failed, notBuilt };
  if (notBuilt.length > 0) return { state: "INCOMPLETE", failed, notBuilt };
  return { state: "PASSED", failed, notBuilt };
}

/** Human readable report. */
function renderText(result, options = {}) {
  const lines = [];
  const all = [];

  for (const target of result.targets) {
    if (target.missing) {
      lines.push(`######## ${target.target.toUpperCase()} BUILD ########`);
      lines.push(`NO_BUILD_DIR ${target.target} (${path.relative(result.rootDir || ".", target.buildDir)})`);
      lines.push("");
      continue;
    }

    lines.push(`######## ${target.target.toUpperCase()} BUILD ########`);
    const byScope = new Map();
    for (const item of target.diagnostics) {
      if (!byScope.has(item.scope)) byScope.set(item.scope, []);
      byScope.get(item.scope).push(item);
    }

    for (const scope of target.scopes) {
      const items = sortDiagnostics(byScope.get(scope.id) || []);
      const errors = items.filter((item) => item.severity === "error").length;
      const warnings = items.filter((item) => item.severity === "warning").length;
      const info = items.filter((item) => item.severity === "info").length;
      const status = errors > 0 ? "FAIL" : "OK  ";
      const notes = [];
      if (warnings) notes.push(`${warnings} warning(s)`);
      if (info) notes.push(`${info} info`);
      lines.push(`${status}  ${scope.id}${notes.length ? `  (${notes.join(", ")})` : ""}`);
      for (const item of items) lines.push(formatDiagnostic(item));
      all.push(...items);
    }

    const bundleItems = sortDiagnostics(byScope.get(`${target.target}:bundle`) || []);
    for (const item of bundleItems) lines.push(formatDiagnostic(item));
    all.push(...bundleItems);
    lines.push("");
  }

  const summary = summarize(all);
  const blocking = all.filter((item) => item.code === "DUPLICATE_BLOCKING" || item.code === "PARSE_ERROR").length;
  const unresolved = all.filter((item) => item.code === "UNRESOLVED_REFERENCE").length;
  lines.push(
    `==== SYNTAX ERRORS (blocking): ${blocking} | UNRESOLVED REFERENCES: ${unresolved} | OTHER ERRORS: ${summary.errors - blocking - unresolved} | WARNINGS: ${summary.warnings} | INFO: ${summary.info} ====`,
  );

  const outcome = verdict(result, options);
  if (outcome.state === "FAILED") {
    lines.push(`==== SCOPE AUDIT: FAILED (${outcome.failed.join(", ")}) ====`);
  } else if (outcome.state === "INCOMPLETE") {
    lines.push(`==== SCOPE AUDIT: INCOMPLETE (not built: ${outcome.notBuilt.join(", ")}) ====`);
  } else {
    lines.push("==== SCOPE AUDIT: PASSED ====");
  }

  return { text: lines.join("\n"), summary, diagnostics: all, verdict: outcome };
}

/** Machine readable report. */
function renderJson(result, options = {}) {
  const diagnostics = result.targets.flatMap((target) => target.diagnostics);
  const summary = summarize(diagnostics);
  const outcome = verdict(result, options);
  return {
    version: 1,
    rootDir: result.rootDir,
    verdict: outcome.state,
    failedTargets: outcome.failed,
    notBuiltTargets: outcome.notBuilt,
    trackedIdentifiers: [...result.tracked].sort(),
    loggingApiSources: result.discovered ? result.discovered.usedSources : [],
    targets: result.targets.map((target) => ({
      target: target.target,
      buildDir: target.buildDir,
      missing: Boolean(target.missing),
      scopes: target.scopes,
      diagnostics: sortDiagnostics(target.diagnostics),
    })),
    summary,
  };
}

module.exports = { renderText, renderJson, summarize, sortDiagnostics, verdict };
