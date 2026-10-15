
const lintOptions = {
  esversion: 11, // ES2020
  asi: false, // automatic semicolon insertion
  undef: true, // warn undefined variables
  unused: false, // warnings about unused variables
  browser: true, // It recognizes global variables such as window/document.
  devel: true, // Allows console.log and alert
  predef: [
    "setMemo",
    "getMemo",
    "useSetting",
    "getText",
    "getTextAll",
    "getImage",
    "getImageAll",
    "querySelectorDeep",
    "getIframeData",
    "clearActivity",
  ],
};

function applyJsHintFilters(CodeMirror, lintOptions) {
  CodeMirror.registerHelper("lint", "javascript", function (text) {
    const wrapped = "async function __wrapper__() {\n" + text + "\n}";
    JSHINT(wrapped, lintOptions);

    const MODERN_SYNTAX_RE = /(\?\?=|\|\|=|&&=|\?\?|\?\.|\?\[|#[a-zA-Z_]|1_\d|_\d|\d_)/;
    const hasModernSyntax = (line) => MODERN_SYNTAX_RE.test(line || "");

    const MODERN_GLOBALS = new Set([
      "WeakRef", "FinalizationRegistry", "AggregateError", "globalThis",
      "Object",
      "structuredClone", "at",
      "Atomics",
      "queueMicrotask", "reportError",
      "ReadableStream", "WritableStream", "TransformStream",
      "CompressionStream", "DecompressionStream",
      "Blob", "File", "FormData", "Headers", "Request", "Response", "fetch",
      "URL", "URLSearchParams",
      "Worker", "SharedWorker", "ServiceWorker",
      "AbortController", "AbortSignal",
      "IntersectionObserver", "ResizeObserver", "MutationObserver", "PerformanceObserver",
      "crypto", "performance", "navigator", "location", "history",
      "localStorage", "sessionStorage", "indexedDB",
      "requestAnimationFrame", "cancelAnimationFrame",
      "setTimeout", "setInterval", "clearTimeout", "clearInterval",
      "TextEncoder", "TextDecoder",
      "CustomEvent", "EventTarget",
      "Iterator",
      "Temporal",
      "Promise",
    ]);

    const MODERN_METHOD_RE =
      /\b(hasOwn|groupBy|withResolvers|toSorted|toReversed|toSpliced|findLast|findLastIndex|at\b|waitAsync|resize|detached|resolve\b)\b/;

    function isLogicalAssignment(reason, evidence) {
      return (
        (reason.includes("Unexpected '{a}'") ||
          reason.includes("Expected an identifier") ||
          reason.includes("Expected an assignment or function call") ||
          reason.includes("Expected an operator")) &&
        /(\?\?=|\|\|=|&&=)/.test(evidence)
      );
    }

    function isCascadingError(reason, evidence, code) {
      const isCascadeKind =
        reason.includes("Missing semicolon") ||
        reason.includes("Unrecoverable syntax error") ||
        reason.includes("Expected an assignment or function call") ||
        code === "E058" ||
        (code && code.startsWith("E0"));

      return isCascadeKind && hasModernSyntax(evidence);
    }

    function isPrivateClassField(reason, evidence, code) {
      const PRIVATE_FIELD_RE = /#[a-zA-Z_$][a-zA-Z0-9_$]*/;
      return (
        reason.includes("Unexpected '#'") ||
        (PRIVATE_FIELD_RE.test(evidence) &&
          (reason.includes("Unexpected token") ||
            reason.includes("Expected an identifier") ||
            reason.includes("Unexpected '{a}'") ||
            code === "E058"))
      );
    }

    function isOptionalChaining(reason, evidence) {
      return (
        /\?\.|\ ?\?\[/.test(evidence) &&
        (reason.includes("Unexpected '.'") ||
          reason.includes("Unexpected '['") ||
          reason.includes("Unexpected '('") ||
          reason.includes("Unexpected '{a}'"))
      );
    }

    function isNullishCoalescing(reason, evidence) {
      return (
        /\?\?[^=]/.test(evidence) &&
        (reason.includes("Unexpected '?'") ||
          reason.includes("Unexpected token") ||
          reason.includes("Unexpected '{a}'"))
      );
    }

    function isNumericSeparator(reason, evidence) {
      return (
        reason.includes("Unexpected token '_'") ||
        ((reason.includes("Expected an operator") ||
          reason.includes("Unexpected identifier") ||
          reason.includes("Bad numeric escape")) &&
          /\d_\d|_\d/.test(evidence))
      );
    }

    function isClassStaticBlock(reason, evidence) {
      return (
        reason.includes("Unexpected token") &&
        /\bstatic\s*\{/.test(evidence)
      );
    }

    function isTopLevelAwait(reason, code) {
      return (
        (code === "W125" || reason.includes("not inside an async function")) &&
        reason.toLowerCase().includes("await")
      );
    }

    function isImportAssertion(reason, evidence) {
      return (
        /\bassert\s*\{|\bwith\s*\{/.test(evidence) &&
        (reason.includes("Expected an identifier") ||
          reason.includes("Unexpected token") ||
          reason.includes("Unexpected '{a}'"))
      );
    }

    function isHashbang(reason, evidence) {
      return evidence.trimStart().startsWith("#!") || reason.includes("Unexpected '#!'");
    }

    function isRegExpVFlag(reason, evidence) {
      return (
        reason.includes("Bad option") &&
        /\/[^/]*\/v\b/.test(evidence)
      );
    }


    function isModernGlobal(reason, code) {
      if (code !== "W117") return false;
      const match = reason.match(/'([^']+)' is not defined/);
      if (!match) return false;
      const name = match[1];
      return MODERN_GLOBALS.has(name);
    }

    function isModernMethodUse(reason, evidence, code) {
      if (code !== "W117") return false;
      return MODERN_METHOD_RE.test(evidence);
    }

    function isVersionWarning(code, reason) {
      return (
        code === "W104" ||
        (code === "W119" && (
          reason.includes("optional chaining") ||
          reason.includes("logical assignment") ||
          reason.includes("nullish coalescing") ||
          reason.includes("class fields") ||
          reason.includes("numeric separator") ||
          reason.includes("import assertion")
        ))
      );
    }

    const errors = (JSHINT.errors || [])
      .map((err) => {
        if (!err) return null;

        const reason = err.reason || "";
        const code = err.code || "";
        const evidence = err.evidence || "";

        if (
          isLogicalAssignment(reason, evidence) ||
          isCascadingError(reason, evidence, code) ||
          isPrivateClassField(reason, evidence, code) ||
          isOptionalChaining(reason, evidence) ||
          isNullishCoalescing(reason, evidence) ||
          isNumericSeparator(reason, evidence) ||
          isClassStaticBlock(reason, evidence) ||
          isTopLevelAwait(reason, code) ||
          isImportAssertion(reason, evidence) ||
          isHashbang(reason, evidence) ||
          isRegExpVFlag(reason, evidence) ||
          isModernGlobal(reason, code) ||
          isModernMethodUse(reason, evidence, code) ||
          isVersionWarning(code, reason)
        ) {
          return null;
        }

        err.line -= 1;
        return err;
      })
      .filter(Boolean);

    return errors.map((err) => ({
      from: CodeMirror.Pos(err.line - 1, err.character - 1),
      to: CodeMirror.Pos(err.line - 1, err.character),
      message: err.reason,
      severity: err.code?.startsWith("W") ? "warning" : "error",
    }));
  });
}
