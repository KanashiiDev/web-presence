const fs = require("fs");
const path = require("path");

const { parseJs, analyzeAst, MODULE, LEXICAL_KINDS, VAR_KINDS, isImmediatelyExecuted, createScope } = require("./ast");

function diagnostic(severity, code, scope, message, extra = {}) {
  return { severity, code, scope: scope.id, target: scope.target, message, ...extra };
}

function location(ctx, entry, line, column) {
  return { file: ctx.rel(entry.path), line, column, label: entry.label };
}

/**
 * Audits one execution scope.
 *
 * `ctx.tracked` holds the identifiers that must resolve (the logging API by default).
 * `ctx.visitedModules` breaks import cycles.
 */
function auditScope(scope, ctx) {
  const diagnostics = [];
  const analyses = [];
  const seenPaths = new Set();

  for (const entry of scope.files) {
    if (!fs.existsSync(entry.path)) {
      diagnostics.push(
        diagnostic("error", "MISSING_FILE", scope, `Referenced script does not exist: ${entry.label}`, {
          ...location(ctx, entry, 0, 0),
          reference: entry.label,
        }),
      );
      continue;
    }

    if (seenPaths.has(entry.path)) {
      diagnostics.push(
        diagnostic("warning", "DUPLICATE_FILE_IN_SCOPE", scope, `Script is loaded more than once in the same scope: ${entry.label}`, {
          ...location(ctx, entry, 0, 0),
          reference: entry.label,
        }),
      );
      continue;
    }
    seenPaths.add(entry.path);

    const code = fs.readFileSync(entry.path, "utf8");
    let ast;
    try {
      ast = parseJs(code, entry.sourceType);
    } catch (error) {
      const at = error.loc || { line: 0, column: 0 };
      diagnostics.push(
        diagnostic("error", "PARSE_ERROR", scope, `Cannot parse as ${entry.sourceType}: ${error.message}`, {
          ...location(ctx, entry, at.line, at.column),
          sourceType: entry.sourceType,
        }),
      );
      continue;
    }

    analyses.push({ entry, state: analyzeAst(ast, entry.sourceType) });
  }

  const merged = mergeProgramScopes(analyses, scope.module);

  diagnostics.push(...duplicateDiagnostics(scope, merged));
  diagnostics.push(...referenceDiagnostics(scope, analyses, merged, ctx));
  diagnostics.push(...temporalOrderDiagnostics(scope, analyses, merged, ctx));

  if (scope.module) {
    diagnostics.push(...moduleImportDiagnostics(scope, analyses, ctx));
  }

  return diagnostics;
}

/**
 * Merges the top-level declarations of every file of a scope into a single environment.
 *
 * For a classic scope the files share one global environment, so their declarations collide.
 * For a module scope the environment belongs to the module itself and every duplicate binding
 * is a SyntaxError, because module scopes are strict and have a single declarative record.
 */
function mergeProgramScopes(analyses, isModule = false) {
  const merged = createScope(isModule ? "module" : "program", null);
  for (const { entry, state } of analyses) {
    for (const [name, binding] of state.programScope.bindings) {
      let target = merged.bindings.get(name);
      if (!target) {
        target = { name, kind: binding.kind, decls: [] };
        merged.bindings.set(name, target);
      }
      for (const decl of binding.decls) {
        target.decls.push({ ...decl, file: entry.path, label: entry.label, fileIndex: entry.index });
      }
    }
  }
  return merged;
}

function describeDecls(decls) {
  return decls.map((decl) => `${decl.label}:${decl.line} (${decl.kind})`).join(", ");
}

/**
 * Classifies conflicting top-level declarations.
 *
 * ECMAScript global declaration instantiation puts `var` and function declarations on the
 * global object but keeps `let`, `const` and `class` in the global lexical environment. A
 * lexical name that also exists as a var/function name, or that is declared twice as a
 * lexical name, is a SyntaxError. Two function declarations are legal: the last one wins.
 */
function duplicateDiagnostics(scope, merged) {
  const diagnostics = [];
  for (const [name, binding] of merged.bindings) {
    const decls = binding.decls;
    if (decls.length < 2) continue;

    const lexical = decls.filter((decl) => LEXICAL_KINDS.has(decl.kind));
    const varish = decls.filter((decl) => VAR_KINDS.has(decl.kind));

    let severity = null;
    let code = null;
    let reason = "";

    if (scope.module) {
      severity = "error";
      code = "DUPLICATE_BLOCKING";
      reason = "ES module scope redeclares the binding";
    } else if (lexical.length >= 2) {
      severity = "error";
      code = "DUPLICATE_BLOCKING";
      reason = "lexical declaration (let/const/class) redeclared in the same global scope";
    } else if (lexical.length >= 1 && varish.length >= 1) {
      severity = "error";
      code = "DUPLICATE_BLOCKING";
      reason = "lexical declaration (let/const/class) conflicts with a var/function declaration in the same global scope";
    } else if (varish.length >= 2) {
      const functions = varish.filter((decl) => decl.kind === "function");
      if (functions.length >= 2) {
        severity = "warning";
        code = "DUPLICATE_SHADOW";
        reason = "function redeclared in the same global scope (the last declaration wins)";
      } else {
        severity = "info";
        code = "DUPLICATE_VAR";
        reason = "var declared more than once in the same global scope";
      }
    }

    if (!severity) continue;

    diagnostics.push(
      diagnostic(severity, code, scope, `'${name}' ${reason}: ${describeDecls(decls)}`, {
        name,
        declarations: decls.map((decl) => ({ file: decl.file, line: decl.line, column: decl.column, kind: decl.kind, label: decl.label })),
      }),
    );
  }
  return diagnostics;
}

/**
 * Resolves a reference against its own file first and then against the shared scope.
 */
function resolveReference(ref, scope, merged) {
  if (ref.binding) return { binding: ref.binding, crossFile: false };
  if (!scope.shared) return { binding: null, crossFile: false };
  const binding = merged.bindings.get(ref.name) || null;
  return { binding, crossFile: Boolean(binding) };
}

/** Reports tracked identifiers that have no binding in the scope that uses them. */
function referenceDiagnostics(scope, analyses, merged, ctx) {
  const diagnostics = [];
  for (const { entry, state } of analyses) {
    for (const ref of state.refs) {
      if (!ctx.tracked.has(ref.name)) continue;
      const { binding } = resolveReference(ref, scope, merged);
      if (binding) continue;
      if (ref.guarded) continue;
      if (ctx.knownGlobals.has(ref.name)) continue;
      diagnostics.push(
        diagnostic("error", "UNRESOLVED_REFERENCE", scope, `'${ref.name}' is used but never declared in this scope`, {
          ...location(ctx, entry, ref.line, ref.column),
          name: ref.name,
          guarded: false,
        }),
      );
    }
  }
  return diagnostics;
}

/**
 * Reports references that run before the declaration they depend on exists.
 *
 * Across classic scripts a `var` or function declaration only becomes reachable when its own
 * script runs, so an earlier script that uses it hits a ReferenceError. Inside a single
 * script `var` and function declarations are hoisted, but `let`, `const` and `class` stay in
 * the temporal dead zone until their declaration is evaluated.
 */
function temporalOrderDiagnostics(scope, analyses, merged, ctx) {
  const diagnostics = [];
  for (const { entry, state } of analyses) {
    for (const ref of state.refs) {
      if (ref.guarded) continue;
      const { binding, crossFile } = resolveReference(ref, scope, merged);
      if (!binding || binding.decls.length === 0) continue;
      if (!isImmediatelyExecuted(ref)) continue;

      // A redeclared name is already reported as a duplicate; the ordering finding would only
      // repeat the same root cause.
      const scopeBinding = merged.bindings.get(ref.name);
      if (scopeBinding && scopeBinding.decls.length > 1) continue;

      if (crossFile) {
        const earliest = binding.decls.reduce((min, decl) => (decl.fileIndex < min.fileIndex ? decl : min), binding.decls[0]);
        if (earliest.fileIndex <= entry.index) continue;
        diagnostics.push(
          diagnostic("error", "USE_BEFORE_DECLARE", scope, `'${ref.name}' is used before the script that declares it (${earliest.label}) runs`, {
            ...location(ctx, entry, ref.line, ref.column),
            name: ref.name,
            declaredIn: ctx.rel(earliest.file),
            declaredAt: earliest.line,
          }),
        );
        continue;
      }

      const earliest = binding.decls[0];
      if (!LEXICAL_KINDS.has(earliest.kind)) continue;
      if (earliest.start <= ref.start) continue;
      diagnostics.push(
        diagnostic("error", "USE_BEFORE_DECLARE", scope, `'${ref.name}' is used before its declaration is evaluated`, {
          ...location(ctx, entry, ref.line, ref.column),
          name: ref.name,
          declaredIn: ctx.rel(entry.path),
          declaredAt: earliest.line,
        }),
      );
    }
  }
  return diagnostics;
}

/** Resolves the static imports of a module scope and audits the imported modules. */
function moduleImportDiagnostics(scope, analyses, ctx) {
  const diagnostics = [];
  for (const { entry, state } of analyses) {
    for (const imported of state.imports) {
      const resolved = resolveImportPath(imported.source, entry.path, ctx.buildDir);
      if (!resolved) continue;
      if (!fs.existsSync(resolved)) {
        diagnostics.push(
          diagnostic("error", "MISSING_IMPORT", scope, `Imported module does not exist: ${imported.source}`, {
            ...location(ctx, entry, imported.line, imported.column),
            reference: imported.source,
          }),
        );
        continue;
      }
      if (ctx.visitedModules.has(resolved)) continue;
      ctx.visitedModules.add(resolved);

      const moduleScope = {
        id: `${scope.target}:module(${ctx.rel(resolved)})`,
        target: scope.target,
        kind: "module",
        shared: false,
        module: true,
        world: null,
        frame: null,
        description: `imported module: ${ctx.rel(resolved)}`,
        files: [{ path: resolved, sourceType: MODULE, label: ctx.rel(resolved), index: 0 }],
      };
      ctx.derivedScopes.push(moduleScope);
      diagnostics.push(...auditScope(moduleScope, ctx));
    }
  }
  return diagnostics;
}

/**
 * Resolves an import specifier to an absolute path inside the build.
 *
 * Bare specifiers are external packages and are not resolvable from the bundle, so they are
 * ignored. Root relative specifiers resolve against the extension root.
 */
function resolveImportPath(specifier, importerPath, buildDir) {
  const value = String(specifier || "");
  if (!value) return null;
  if (!value.startsWith(".") && !value.startsWith("/")) return null;
  const base = value.startsWith("/") ? buildDir : path.dirname(importerPath);
  return path.resolve(base, value.replace(/^\//, ""));
}

module.exports = { auditScope, mergeProgramScopes, duplicateDiagnostics, resolveImportPath };
