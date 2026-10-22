const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");

const { createFixture, cleanup } = require("./helpers");

const CLI = path.join(__dirname, "..", "..", "auditScopes.js");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
  });
}

test("the CLI exits with 0 and prints help for --help", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node scripts\/auditScopes\.js/);
});

test("the CLI exits with 2 for an unknown argument", () => {
  const result = runCli(["--nope"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown argument/);
});

test("the CLI exits with 0 for a clean bundle", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, content_scripts: [{ matches: ["<all_urls>"], js: ["a.js"], run_at: "document_idle" }] },
    "chrome/a.js": "const x = 1;\n",
  });

  const result = runCli(["--target", "chrome"], { env: { WP_AUDIT_ROOT_DIR: root, WP_AUDIT_BUILDS_DIR: root } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /SYNTAX ERRORS \(blocking\): 0/);

  cleanup(root);
});

test("the CLI exits with 1 when an error level finding exists", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, content_scripts: [{ matches: ["<all_urls>"], js: ["a.js", "b.js"], run_at: "document_idle" }] },
    "chrome/a.js": "const shared = 1;\n",
    "chrome/b.js": "const shared = 2;\n",
  });

  const result = runCli(["--target", "chrome"], { env: { WP_AUDIT_ROOT_DIR: root, WP_AUDIT_BUILDS_DIR: root } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /DUPLICATE_BLOCKING/);

  cleanup(root);
});

test("the CLI prints a PASSED verdict for a clean bundle", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, content_scripts: [{ matches: ["<all_urls>"], js: ["a.js"], run_at: "document_idle" }] },
    "chrome/a.js": "const x = 1;\n",
  });

  const result = runCli(["--target", "chrome"], { env: { WP_AUDIT_ROOT_DIR: root, WP_AUDIT_BUILDS_DIR: root } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /==== SCOPE AUDIT: PASSED ====/);

  cleanup(root);
});

test("the CLI prints a FAILED verdict when an error level finding exists", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, content_scripts: [{ matches: ["<all_urls>"], js: ["a.js", "b.js"], run_at: "document_idle" }] },
    "chrome/a.js": "const shared = 1;\n",
    "chrome/b.js": "const shared = 2;\n",
  });

  const result = runCli(["--target", "chrome"], { env: { WP_AUDIT_ROOT_DIR: root, WP_AUDIT_BUILDS_DIR: root } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /==== SCOPE AUDIT: FAILED \(chrome\) ====/);

  cleanup(root);
});

test("the CLI prints an INCOMPLETE verdict when a target has no build", () => {
  const root = createFixture({ "placeholder.txt": "x" });

  const result = runCli(["--target", "chrome"], { env: { WP_AUDIT_ROOT_DIR: root, WP_AUDIT_BUILDS_DIR: root } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /==== SCOPE AUDIT: INCOMPLETE \(not built: chrome\) ====/);

  cleanup(root);
});

test("the CLI reports the verdict in the JSON report", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, content_scripts: [{ matches: ["<all_urls>"], js: ["a.js"], run_at: "document_idle" }] },
    "chrome/a.js": "const x = 1;\n",
  });

  const result = runCli(["--target", "chrome", "--json"], { env: { WP_AUDIT_ROOT_DIR: root, WP_AUDIT_BUILDS_DIR: root } });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.verdict, "PASSED");

  cleanup(root);
});

test("the CLI emits a machine readable JSON report", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, content_scripts: [{ matches: ["<all_urls>"], js: ["a.js"], run_at: "document_idle" }] },
    "chrome/a.js": "const x = 1;\n",
  });

  const result = runCli(["--target", "chrome", "--json"], { env: { WP_AUDIT_ROOT_DIR: root, WP_AUDIT_BUILDS_DIR: root } });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.version, 1);
  assert.equal(payload.targets.length, 1);
  assert.equal(payload.targets[0].target, "chrome");
  assert.equal(payload.summary.errors, 0);
  assert.ok(Array.isArray(payload.trackedIdentifiers));

  cleanup(root);
});

test("the CLI reports a missing build directory instead of crashing", () => {
  const root = createFixture({ "placeholder.txt": "x" });

  const result = runCli(["--target", "chrome"], { env: { WP_AUDIT_ROOT_DIR: root, WP_AUDIT_BUILDS_DIR: root } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /NO_BUILD_DIR chrome/);

  cleanup(root);
});

test("the CLI can track extra identifiers", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, content_scripts: [{ matches: ["<all_urls>"], js: ["a.js"], run_at: "document_idle" }] },
    "chrome/a.js": "customHelper();\n",
  });

  const result = runCli(["--target", "chrome", "--watch", "customHelper"], { env: { WP_AUDIT_ROOT_DIR: root, WP_AUDIT_BUILDS_DIR: root } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /UNRESOLVED_REFERENCE/);

  cleanup(root);
});
