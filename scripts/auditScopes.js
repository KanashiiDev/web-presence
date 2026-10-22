#!/usr/bin/env node
/*
 * Scope-aware audit of the generated extension bundles.
 *
 * Derives the real execution scopes (background worker, content script worlds, extension
 * pages, ES modules) from the generated manifest and HTML pages, then checks every scope for
 * problems that would break the bundle at parse time or at runtime:
 *
 *   DUPLICATE_BLOCKING   : conflicting top-level declarations in one global environment
 *   DUPLICATE_SHADOW     : function redeclared in one global environment (last one wins)
 *   DUPLICATE_VAR        : var declared more than once (informational)
 *   UNRESOLVED_REFERENCE : a tracked identifier used without a declaration in its scope
 *   USE_BEFORE_DECLARE   : a declaration used before the script that declares it runs
 *   PARSE_ERROR          : a script cannot be parsed with the syntax its context requires
 *   MISSING_FILE         : a referenced script, page or resource is not in the bundle
 *   MISSING_IMPORT       : a static import points at a file that is not in the bundle
 *   DUPLICATE_FILE_IN_SCOPE : the same script is loaded twice into one scope
 *   ORPHAN_FILE          : a script ships in the bundle but no scope loads it
 *
 * The implementation lives in scripts/audit/. Run `node scripts/auditScopes.js --help` for
 * the available options. The exit code is 1 when an error level finding is present.
 */
const { main } = require("./audit/cli");

process.exitCode = main(process.argv.slice(2));
