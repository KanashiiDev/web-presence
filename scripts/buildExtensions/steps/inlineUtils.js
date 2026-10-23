const fs = require("fs-extra");
const path = require("path");
const acorn = require("acorn");

// Operators minifiers prepend to parenthesized IIFEs so they keep their expression-statement shape.
const UNARY_IIFE_OPERATORS = ["!", "void", "+", "-", "~"];

/**
 * Creates the inline utils system bound to specific extensionDir and distDir.
 * Returns { inlineUtilsFunctions, buildInlineFunctions }
 */
function createInlineUtils(extensionDir, distDir) {
  const pendingInlines = {};

  // Finds all .js files in the specified directory (including subfolders)
  function getJsFilesInDirectory(dir, base = "") {
    const files = fs.readdirSync(dir);
    let results = [];

    files.forEach((file) => {
      const fullPath = path.join(dir, file);
      const relPath = path.join(base, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        results = results.concat(getJsFilesInDirectory(fullPath, relPath));
      } else if (file.endsWith(".js")) {
        results.push(relPath);
      }
    });

    return results;
  }

  function concatDirectoryInto(targetRel, dirRel) {
    const dirPath = path.join(distDir, dirRel);
    const targetPath = path.join(distDir, targetRel);

    const files = getJsFilesInDirectory(dirPath, dirRel)
      .map((f) => f.split(path.sep).join("/"))
      .sort();

    const combined = files
      .map((rel) => {
        const code = fs.readFileSync(path.join(distDir, rel), "utf8");
        return `// === BEGIN (${rel}) ===\n${code}\n// === END (${rel}) ===`;
      })
      .join("\n\n");

    const original = fs.readFileSync(targetPath, "utf8");
    fs.writeFileSync(targetPath, combined + "\n\n" + original, "utf8");

    fs.removeSync(dirPath);
  }

  function extractFunctionsFromFile(sourceFilePath, namesToInclude, inlineTargets = "targets") {
    const code = fs.readFileSync(sourceFilePath, "utf8");

    const ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
    });

    const extracted = [];
    const includeAll = !Array.isArray(namesToInclude) || namesToInclude.length === 0;

    function shouldInclude(name) {
      return includeAll || (name && namesToInclude.includes(name));
    }

    // Minified bundles usually wrap IIFEs in a unary operator (i.e. !function(){}()); accept both shapes.
    function getIifeCall(expression) {
      if (expression.type === "CallExpression") {
        return expression.callee.type === "FunctionExpression" ? expression : null;
      }
      if (expression.type === "UnaryExpression" && UNARY_IIFE_OPERATORS.includes(expression.operator) && expression.argument.type === "CallExpression") {
        return expression.argument.callee.type === "FunctionExpression" ? expression.argument : null;
      }
      return null;
    }

    function isRequireCall(expression) {
      return expression.type === "CallExpression" && expression.callee.type === "Identifier" && expression.callee.name === "require";
    }

    for (const node of ast.body) {
      // Function declarations
      if (node.type === "FunctionDeclaration" && shouldInclude(node.id?.name)) {
        extracted.push(code.slice(node.start, node.end));
        continue;
      }

      // Variable declarations
      if (node.type === "VariableDeclaration") {
        const declarations = node.declarations.filter((d) => shouldInclude(d.id?.name));
        if (declarations.length > 0 || includeAll) {
          extracted.push(code.slice(node.start, node.end));
        }
        continue;
      }

      // Export named declarations
      if (node.type === "ExportNamedDeclaration") {
        const decl = node.declaration;
        if (!decl) continue;

        if (decl.type === "FunctionDeclaration" && shouldInclude(decl.id?.name)) {
          extracted.push(code.slice(decl.start, decl.end));
        }

        if (decl.type === "VariableDeclaration") {
          const declarations = decl.declarations.filter((d) => shouldInclude(d.id?.name));
          if (declarations.length > 0 || includeAll) {
            extracted.push(code.slice(decl.start, decl.end));
          }
        }
        continue;
      }

      // CommonJS exports
      if (node.type === "ExpressionStatement" && node.expression.type === "AssignmentExpression") {
        const left = node.expression.left;
        const right = node.expression.right;

        if (left.type === "MemberExpression" && left.object.name === "module" && left.property.name === "exports" && right.type === "ObjectExpression") {
          for (const prop of right.properties) {
            const keyName = prop.key?.name || prop.key?.value;
            if (shouldInclude(keyName) || includeAll) {
              extracted.push(code.slice(prop.start, prop.end));
            }
          }
        }
      }

      // Class declarations
      if (node.type === "ClassDeclaration" && shouldInclude(node.id?.name)) {
        extracted.push(code.slice(node.start, node.end));
        continue;
      }

      // IIFE and anonymous functions (direct or unary-wrapped, as minifiers emit)
      if (node.type === "ExpressionStatement") {
        const iifeCall = getIifeCall(node.expression);
        if (iifeCall) {
          if (includeAll || shouldInclude(iifeCall.callee.id?.name)) {
            extracted.push(code.slice(node.start, node.end));
          }
          continue;
        }

        // includeAll keeps any other effectful top level statement as well; minified bundles
        // commonly open with sequence expressions doing polyfill and init work. Only CommonJS
        // plumbing (imports to the module system) stays out.
        if (includeAll && node.expression.type !== "AssignmentExpression" && !isRequireCall(node.expression)) {
          extracted.push(code.slice(node.start, node.end));
          continue;
        }
      }
    }

    // Guard: statements that are neither kept by the extraction rules above nor dropped by
    // design (CommonJS plumbing) are silently lost; make that loud.
    for (const node of ast.body) {
      if (node.type === "ExpressionStatement") {
        // Assignments and require() calls are dropped by design (module system plumbing).
        continue;
      }
      const covered =
        node.type === "FunctionDeclaration" ||
        node.type === "VariableDeclaration" ||
        node.type === "ClassDeclaration" ||
        (node.type === "ExportNamedDeclaration" && node.declaration);
      if (!covered) {
        const statement = code.slice(node.start, node.end).replace(/\s+/g, " ").slice(0, 80);
        console.warn(
          `[build] inlineUtils: "${sourceFilePath.replace(/\\/g, "/")}" is inlined into ${inlineTargets}, ` +
            `but its top level statement is not a declaration and will be DROPPED: ${statement}`,
        );
      }
    }

    return extracted;
  }

  /**
   * Register utility functions from one or more source files to be inlined into one or more target files.
   *
   * @param {string|string[]} targetFiles
   * @param {string|string[]} sourceFiles
   * @param {string[]|[]} functionsToInclude - Pass empty array to include all.
   * @param {"start"|"end"|string} [position="start"] - "start" or "end" for top/bottom injection.
   *   Any other string is treated as a placeholder (e.g. "_INLINE_UTILS") — the first matching
   *   line in the target file is replaced with the inlined code. Falls back to "start" if not found.
   * @param {boolean} [shouldDelete=false]
   * @param {boolean|{ shallow?: boolean, dir?: string }} [inlineAllSiblings=false]
   */
  function inlineUtilsFunctions(targetFiles, sourceFiles, functionsToInclude, position = "start", shouldDelete = false, inlineAllSiblings = false) {
    if (!Array.isArray(targetFiles)) targetFiles = [targetFiles];
    if (!Array.isArray(sourceFiles)) sourceFiles = [sourceFiles];

    let siblingsOpts = null;
    if (inlineAllSiblings === true) {
      siblingsOpts = {};
    } else if (inlineAllSiblings && typeof inlineAllSiblings === "object") {
      siblingsOpts = inlineAllSiblings;
    }

    if (siblingsOpts !== null) {
      targetFiles.forEach((target) => {
        const scanDir = siblingsOpts.dir ? path.join(extensionDir, siblingsOpts.dir) : path.join(extensionDir, path.dirname(target));
        const baseDir = siblingsOpts.dir || path.dirname(target);

        const siblingFiles = siblingsOpts.shallow
          ? fs
              .readdirSync(scanDir)
              .filter((f) => f.endsWith(".js"))
              .map((f) => path.join(baseDir, f))
          : getJsFilesInDirectory(scanDir, baseDir);

        siblingFiles.forEach((siblingRelPath) => {
          const normalizedSibling = siblingRelPath.split(path.sep).join("/");
          const normalizedTarget = target.split(path.sep).join("/");
          const alreadyIncluded = sourceFiles.some((s) => s.split(path.sep).join("/") === normalizedSibling);

          if (normalizedSibling !== normalizedTarget && !alreadyIncluded) {
            sourceFiles.push(siblingRelPath);
          }
        });
      });
    }

    const expandedSources = [];
    sourceFiles.forEach((src) => {
      const fullPath = path.join(extensionDir, src);
      if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
        expandedSources.push(...getJsFilesInDirectory(fullPath, src));
      } else {
        expandedSources.push(src);
      }
    });

    targetFiles.forEach((target) => {
      if (!pendingInlines[target]) pendingInlines[target] = [];
      expandedSources.forEach((sourceFile) => {
        pendingInlines[target].push({ sourceFile, functionsToInclude, position, shouldDelete });
      });
    });
  }

  function buildInlineFunctions() {
    const filesToDelete = new Set();

    // Dependency order: targets used as source should be processed first
    const targetFiles = Object.keys(pendingInlines);
    const sorted = [...targetFiles].sort((a, b) => {
      const normalizeSlash = (p) => p.split(path.sep).join("/");
      const aNorm = normalizeSlash(a);
      const bNorm = normalizeSlash(b);

      const aUsedAsSource = Object.values(pendingInlines).some((inlines) => inlines.some(({ sourceFile }) => normalizeSlash(sourceFile) === aNorm));
      const bUsedAsSource = Object.values(pendingInlines).some((inlines) => inlines.some(({ sourceFile }) => normalizeSlash(sourceFile) === bNorm));

      if (aUsedAsSource && !bUsedAsSource) return -1;
      if (!aUsedAsSource && bUsedAsSource) return 1;
      return 0;
    });

    for (const targetFile of sorted) {
      const inlines = pendingInlines[targetFile];
      const targetPath = path.join(distDir, targetFile);
      let targetContent = fs.readFileSync(targetPath, "utf8");
      let startInlinedCode = "";
      let endInlinedCode = "";

      for (const { sourceFile, functionsToInclude, position, shouldDelete } of inlines) {
        // If there is a processed version in dist, use that; otherwise, read it from extensionDir
        const sourcePath = fs.existsSync(path.join(distDir, sourceFile)) ? path.join(distDir, sourceFile) : path.join(extensionDir, sourceFile);

        const extractedFunctions = extractFunctionsFromFile(sourcePath, functionsToInclude, targetFile);
        let joinedFunctions = extractedFunctions.join("\n\n");

        // If the position is not 'start' or 'end', it is a special placeholder (e.g., _INLINE_UTILS).
        const isPlaceholderMode = typeof position === "string" && position !== "start" && position !== "end";

        if (isPlaceholderMode) {
          // Since it will be embedded into a code string, we automatically double the backslashes (including in regex).
          joinedFunctions = joinedFunctions.replace(/\\/g, "\\\\");
        }

        const inlineTag = `// === BEGIN INLINE UTILS (${sourceFile}) ===`;
        const inlinedCode = `${inlineTag}\n${joinedFunctions}\n// === END INLINE UTILS (${sourceFile}) ===\n\n`;

        if (isPlaceholderMode) {
          const escapedPlaceholder = position.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const placeholderRegex = new RegExp(`[^\n]*${escapedPlaceholder}[^\n]*\n?`);

          if (placeholderRegex.test(targetContent)) {
            targetContent = targetContent.replace(placeholderRegex, inlinedCode);
            if (shouldDelete) filesToDelete.add(path.join(distDir, sourceFile));
            continue;
          }
        }

        if (position === "end") {
          endInlinedCode += inlinedCode;
        } else {
          startInlinedCode += inlinedCode;
        }

        if (shouldDelete) {
          filesToDelete.add(path.join(distDir, sourceFile));
        }
      }

      // If only start/end modes were used, add the content to the beginning/end
      if (startInlinedCode || endInlinedCode) {
        targetContent = startInlinedCode + "\n" + targetContent + "\n" + endInlinedCode;
      }

      fs.writeFileSync(targetPath, targetContent, "utf8");
    }

    filesToDelete.forEach((filePath) => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  }

  return { inlineUtilsFunctions, buildInlineFunctions, concatDirectoryInto };
}

module.exports = { createInlineUtils };
