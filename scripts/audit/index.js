const fs = require("fs");
const path = require("path");

const { ROOT, BUILDS_DIR, DEFAULT_TARGETS, LOGGING_API_SOURCES, KNOWN_GLOBALS } = require("./config");
const { parseJs, analyzeAst, SCRIPT } = require("./ast");
const { readManifest, manifestPages, manifestResources } = require("./manifest");
const { buildScopes } = require("./scopes");
const { auditScope } = require("./checks");
const { listFiles } = require("./html");

/**
 * Derives the tracked identifier set from the repository sources that define the logging API.
 *
 * The audit must not rely on a hand-maintained list of names: it reads the actual
 * implementation and tracks every top-level binding it exports.
 */
function discoverTrackedIdentifiers(rootDir, sources) {
  const tracked = new Set();
  const usedSources = [];
  const missingSources = [];

  for (const source of sources) {
    const absolute = path.join(rootDir, source);
    if (!fs.existsSync(absolute)) {
      missingSources.push(source);
      continue;
    }
    try {
      const ast = parseJs(fs.readFileSync(absolute, "utf8"), SCRIPT);
      const state = analyzeAst(ast, SCRIPT);
      for (const name of state.programScope.bindings.keys()) tracked.add(name);
      usedSources.push(source);
    } catch {
      missingSources.push(source);
    }
  }

  return { tracked, usedSources, missingSources };
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

/**
 * Runs the audit for a single build target.
 */
function auditTarget(options) {
  const target = options.target;
  const buildDir = options.buildDir;
  const diagnostics = [];

  const ctx = {
    target,
    buildDir,
    tracked: options.tracked,
    knownGlobals: options.knownGlobals,
    visitedModules: new Set(),
    derivedScopes: [],
    rel: (absolute) => toPosix(path.relative(options.rootDir, absolute)),
  };

  const manifest = readManifest(buildDir);
  if (!manifest) {
    diagnostics.push({
      severity: "error",
      code: "MISSING_FILE",
      scope: `${target}:manifest`,
      target,
      message: "Generated manifest.json not found",
      file: path.join(buildDir, "manifest.json"),
    });
    return { target, buildDir, manifest: null, scopes: [], diagnostics };
  }

  if (manifest.__parseError) {
    diagnostics.push({
      severity: "error",
      code: "PARSE_ERROR",
      scope: `${target}:manifest`,
      target,
      message: `Generated manifest.json is not valid JSON: ${manifest.__parseError}`,
      file: path.join(buildDir, "manifest.json"),
    });
    return { target, buildDir, manifest: null, scopes: [], diagnostics };
  }

  // Every file the manifest points at has to exist in the bundle.
  const manifestDiagnostics = [];

  for (const resource of manifestResources(manifest, buildDir)) {
    if (!resource.path) continue;
    if (resource.reference.includes("*")) {
      const prefix = resource.reference.split("*")[0];
      const directory = path.resolve(buildDir, prefix);
      if (!fs.existsSync(directory)) {
        manifestDiagnostics.push({
          severity: "error",
          code: "MISSING_FILE",
          scope: `${target}:manifest`,
          target,
          message: `Manifest resource pattern has no matching directory: ${resource.reference}`,
          file: toPosix(path.relative(options.rootDir, directory)),
          reference: resource.reference,
        });
      }
      continue;
    }
    if (!fs.existsSync(resource.path)) {
      manifestDiagnostics.push({
        severity: "error",
        code: "MISSING_FILE",
        scope: `${target}:manifest`,
        target,
        message: `Manifest references a file that is not in the bundle: ${resource.reference}`,
        file: toPosix(path.relative(options.rootDir, resource.path)),
        reference: resource.reference,
      });
    }
  }

  for (const page of manifestPages(manifest, buildDir)) {
    if (!page.path) continue;
    if (!fs.existsSync(page.path)) {
      manifestDiagnostics.push({
        severity: "error",
        code: "MISSING_FILE",
        scope: `${target}:manifest`,
        target,
        message: `Manifest page does not exist: ${page.reference} (${page.origin})`,
        file: toPosix(path.relative(options.rootDir, page.path)),
        reference: page.reference,
      });
    }
  }

  const scopes = buildScopes(target, buildDir, manifest);
  const scopeSummaries = [];

  for (const scope of scopes) {
    const scopeDiagnostics = auditScope(scope, ctx);
    diagnostics.push(...scopeDiagnostics);
    scopeSummaries.push({
      id: scope.id,
      kind: scope.kind,
      description: scope.description,
      files: scope.files.map((file) => toPosix(path.relative(options.rootDir, file.path))),
      diagnostics: scopeDiagnostics.length,
    });
  }

  diagnostics.push(...manifestDiagnostics);
  diagnostics.push(...orphanDiagnostics(target, buildDir, scopes, ctx));

  // Module scopes are discovered while the import graph is walked, so they are appended
  // after the entry scopes have been audited.
  for (const derived of ctx.derivedScopes) {
    scopeSummaries.push({
      id: derived.id,
      kind: derived.kind,
      description: derived.description,
      files: derived.files.map((file) => toPosix(path.relative(options.rootDir, file.path))),
      diagnostics: 0,
    });
  }

  return { target, buildDir, manifest, scopes: scopeSummaries, diagnostics: dedupeDiagnostics(diagnostics) };
}

/**
 * Removes findings that describe the same problem twice.
 *
 * A missing file is usually visible both through the manifest and through the scope that
 * loads it; the scope finding carries more context, so it is the one that is kept.
 */
function dedupeDiagnostics(diagnostics) {
  const seen = new Set();
  const result = [];
  for (const item of diagnostics) {
    const key = [item.code, item.file || "", item.name || ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** Files that ship in the bundle but are never loaded by any scope. */
function orphanDiagnostics(target, buildDir, scopes, ctx) {
  const referenced = new Set();
  for (const scope of scopes) {
    for (const file of scope.files) referenced.add(file.path);
  }
  // Modules reached through a static import are loaded as well, they just have no entry scope.
  for (const modulePath of ctx.visitedModules) referenced.add(modulePath);

  const diagnostics = [];
  for (const file of listFiles(buildDir)) {
    if (!file.toLowerCase().endsWith(".js")) continue;
    if (referenced.has(file)) continue;
    if (file.endsWith(".map")) continue;
    diagnostics.push({
      severity: "info",
      code: "ORPHAN_FILE",
      scope: `${target}:bundle`,
      target,
      message: `Script ships in the bundle but no scope loads it: ${ctx.rel(file)}`,
      file: ctx.rel(file),
    });
  }
  return diagnostics;
}

/**
 * Runs the audit for every requested target.
 */
function auditAll(options = {}) {
  const rootDir = options.rootDir || ROOT;
  const buildsDir = options.buildsDir || BUILDS_DIR;
  const targets = options.targets && options.targets.length ? options.targets : DEFAULT_TARGETS;

  const discovered = discoverTrackedIdentifiers(rootDir, options.loggingSources || LOGGING_API_SOURCES);
  const tracked = new Set(options.discoveredTracked === false ? [] : discovered.tracked);
  for (const extra of options.extraTracked || []) tracked.add(extra);
  const runOptions = {
    rootDir,
    tracked,
    knownGlobals: options.knownGlobals || KNOWN_GLOBALS,
  };

  const results = [];
  for (const target of targets) {
    const buildDir = path.join(buildsDir, target);
    if (!fs.existsSync(path.join(buildDir, "manifest.json"))) {
      results.push({ target, buildDir, manifest: null, scopes: [], diagnostics: [], missing: true });
      continue;
    }
    const result = auditTarget({ ...runOptions, target, buildDir });
    if (options.discoveredTracked !== false && discovered.usedSources.length === 0) {
      // The tracked identifier check would silently do nothing; make that visible.
      result.diagnostics.push({
        severity: "warning",
        code: "LOGGING_API_UNAVAILABLE",
        scope: `${target}:bundle`,
        target,
        message: `The logging API sources could not be read, so the unresolved reference check is disabled: ${discovered.missingSources.join(", ")}`,
        file: "",
      });
    }
    results.push(result);
  }

  return { rootDir, targets: results, tracked, discovered };
}

module.exports = { auditAll, auditTarget, discoverTrackedIdentifiers };
