const fs = require("fs");
const os = require("os");
const path = require("path");

const { auditAll } = require("../index");

/**
 * Creates an isolated build fixture on disk.
 *
 * Every test gets its own temporary directory so the tests never touch the real
 * `extensionBuilds/` output and can run in any order.
 */
function createFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp-audit-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

function runAudit(root, options = {}) {
  return auditAll({
    rootDir: root,
    buildsDir: root,
    targets: options.targets || ["chrome"],
    loggingSources: options.loggingSources === undefined ? [] : options.loggingSources,
    discoveredTracked: options.discoveredTracked !== false,
    extraTracked: options.extraTracked || [],
  });
}

function collect(result) {
  return result.targets.flatMap((target) => target.diagnostics);
}

function codes(result, code) {
  return collect(result).filter((item) => item.code === code);
}

function scopesOf(result, target = "chrome") {
  const found = result.targets.find((item) => item.target === target);
  return found ? found.scopes : [];
}

function scopeIds(result, target = "chrome") {
  return scopesOf(result, target).map((scope) => scope.id);
}

function scopeById(result, id, target = "chrome") {
  return scopesOf(result, target).find((scope) => scope.id === id);
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = { createFixture, runAudit, collect, codes, scopesOf, scopeIds, scopeById, cleanup };
