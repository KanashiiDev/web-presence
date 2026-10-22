const { auditAll } = require("./index");
const { renderText, renderJson } = require("./report");
const { DEFAULT_TARGETS } = require("./config");

const USAGE = `Usage: node scripts/auditScopes.js [options]

Scope-aware audit of the generated extension bundles.

Options:
  --target <name>      Audit a single target (${DEFAULT_TARGETS.join(", ")}). Repeatable.
  --json              Emit a machine readable JSON report instead of text.
  --strict            Treat warnings as errors when computing the exit code.
  --watch <a,b,c>     Additional identifiers that must resolve in every scope.
  --no-watch          Disable the tracked identifier (logging API) check.
  --help              Show this message.

Output:
  The report ends with a verdict line: "==== SCOPE AUDIT: PASSED ====",
  "==== SCOPE AUDIT: FAILED (<targets>) ====" when an error level finding was
  reported, or "==== SCOPE AUDIT: INCOMPLETE (not built: <targets>) ====" when a
  requested target had no build directory and could not be audited.

Environment:
  WP_AUDIT_ROOT_DIR     Repository root used for relative paths (default: repository root).
  WP_AUDIT_BUILDS_DIR   Directory that holds the generated targets (default: extensionBuilds).

Exit codes:
  0  No error level finding.
  1  At least one error level finding (or a warning with --strict).
  2  Usage error.
`;

function parseArgs(argv) {
  const options = { targets: [], json: false, strict: false, watch: [], noWatch: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--strict") {
      options.strict = true;
    } else if (argument === "--no-watch") {
      options.noWatch = true;
    } else if (argument === "--watch") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--watch requires a comma separated list of identifiers");
      options.watch.push(
        ...value
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      );
      index += 1;
    } else if (argument.startsWith("--watch=")) {
      options.watch.push(
        ...argument
          .slice("--watch=".length)
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      );
    } else if (argument === "--target") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--target requires a target name");
      options.targets.push(value);
      index += 1;
    } else if (argument.startsWith("--target=")) {
      options.targets.push(argument.slice("--target=".length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const result = auditAll({
    targets: options.targets,
    discoveredTracked: !options.noWatch,
    extraTracked: options.watch,
    rootDir: process.env.WP_AUDIT_ROOT_DIR || undefined,
    buildsDir: process.env.WP_AUDIT_BUILDS_DIR || undefined,
  });

  if (options.json) {
    const payload = renderJson(result, { strict: options.strict });
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    const failing = payload.summary.errors > 0 || (options.strict && payload.summary.warnings > 0);
    return failing ? 1 : 0;
  }

  const rendered = renderText(result, { strict: options.strict });
  process.stdout.write(`${rendered.text}\n`);

  if (rendered.summary.errors > 0) return 1;
  if (options.strict && rendered.summary.warnings > 0) return 1;
  return 0;
}

module.exports = { main, parseArgs, USAGE };
