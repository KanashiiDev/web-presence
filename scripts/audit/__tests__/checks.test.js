const test = require("node:test");
const assert = require("node:assert/strict");

const { createFixture, runAudit, collect, codes, cleanup } = require("./helpers");

function contentScriptManifest(files) {
  return {
    manifest_version: 3,
    content_scripts: [{ matches: ["<all_urls>"], js: files, run_at: "document_idle" }],
  };
}

test("a lexical declaration redeclared in the same global scope is blocking", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js", "b.js"]),
    "chrome/a.js": "const shared = 1;\n",
    "chrome/b.js": "const shared = 2;\n",
  });

  const result = runAudit(root);
  const blocking = codes(result, "DUPLICATE_BLOCKING");
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].severity, "error");
  assert.equal(blocking[0].name, "shared");

  cleanup(root);
});

test("a lexical declaration conflicting with a function declaration is blocking", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js", "b.js"]),
    "chrome/a.js": "const shared = 1;\n",
    "chrome/b.js": "function shared() {}\n",
  });

  const result = runAudit(root);
  const blocking = codes(result, "DUPLICATE_BLOCKING");
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].severity, "error");

  cleanup(root);
});

test("two function declarations in the same global scope are a legal shadow", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js", "b.js"]),
    "chrome/a.js": "function shared() {}\n",
    "chrome/b.js": "function shared() {}\n",
  });

  const result = runAudit(root);
  assert.equal(codes(result, "DUPLICATE_BLOCKING").length, 0);
  const shadow = codes(result, "DUPLICATE_SHADOW");
  assert.equal(shadow.length, 1);
  assert.equal(shadow[0].severity, "warning");

  cleanup(root);
});

test("the same name in two different scopes is not a conflict", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3 },
    "chrome/one.html": '<html><body><script src="one.js"></script></body></html>',
    "chrome/two.html": '<html><body><script src="two.js"></script></body></html>',
    "chrome/one.js": "const shared = 1;\n",
    "chrome/two.js": "const shared = 2;\n",
  });

  const result = runAudit(root);
  assert.equal(codes(result, "DUPLICATE_BLOCKING").length, 0);

  cleanup(root);
});

test("a nested block declaration does not conflict with a top level declaration", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "const shared = 1;\nfunction f() {\n  const shared = 2;\n  return shared;\n}\n",
  });

  const result = runAudit(root);
  assert.equal(codes(result, "DUPLICATE_BLOCKING").length, 0);

  cleanup(root);
});

test("duplicate module level declarations are rejected as a parse error", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, background: { service_worker: "background.js", type: "module" } },
    "chrome/background.js": "function shared() {}\nfunction shared() {}\n",
  });

  const result = runAudit(root);
  // Module scopes are strict, so a redeclared module level binding is a SyntaxError.
  const parseErrors = codes(result, "PARSE_ERROR");
  assert.equal(parseErrors.length, 1);
  assert.equal(parseErrors[0].severity, "error");
  assert.equal(parseErrors[0].sourceType, "module");

  cleanup(root);
});

test("a var declared twice is reported as informational only", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "var shared = 1;\nvar shared = 2;\n",
  });

  const result = runAudit(root);
  assert.equal(codes(result, "DUPLICATE_BLOCKING").length, 0);
  const informational = codes(result, "DUPLICATE_VAR");
  assert.equal(informational.length, 1);
  assert.equal(informational[0].severity, "info");

  cleanup(root);
});

test("an undeclared tracked identifier is reported", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "logInfo('hello');\n",
  });

  const result = runAudit(root, { extraTracked: ["logInfo"] });
  const unresolved = codes(result, "UNRESOLVED_REFERENCE");
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].name, "logInfo");
  assert.equal(unresolved[0].severity, "error");

  cleanup(root);
});

test("a tracked identifier declared in a sibling file of the same scope resolves", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js", "b.js"]),
    "chrome/a.js": "const logInfo = () => {};\n",
    "chrome/b.js": "logInfo('hello');\n",
  });

  const result = runAudit(root, { extraTracked: ["logInfo"] });
  assert.equal(codes(result, "UNRESOLVED_REFERENCE").length, 0);

  cleanup(root);
});

test("a tracked identifier declared in another scope does not resolve", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3 },
    "chrome/one.html": '<html><body><script src="one.js"></script></body></html>',
    "chrome/two.html": '<html><body><script src="two.js"></script></body></html>',
    "chrome/one.js": "const logInfo = () => {};\n",
    "chrome/two.js": "logInfo('hello');\n",
  });

  const result = runAudit(root, { extraTracked: ["logInfo"] });
  assert.equal(codes(result, "UNRESOLVED_REFERENCE").length, 1);

  cleanup(root);
});

test("guarded, property and object key usages are not reported", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": [
      'if (typeof logInfo === "function") { /* guarded use only */ }',
      "const holder = { logInfo: 1 };",
      "holder.logInfo;",
      "// logInfo in a comment",
      'const text = "logInfo in a string";',
      "",
    ].join("\n"),
  });

  const result = runAudit(root, { extraTracked: ["logInfo"] });
  assert.equal(codes(result, "UNRESOLVED_REFERENCE").length, 0);

  cleanup(root);
});

test("an unguarded call of a tracked identifier is reported even next to a guarded use", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": 'if (typeof logInfo === "function") { logInfo("x"); }\n',
  });

  const result = runAudit(root, { extraTracked: ["logInfo"] });
  assert.equal(codes(result, "UNRESOLVED_REFERENCE").length, 1);

  cleanup(root);
});

test("a tracked identifier used inside a function body of the same file resolves", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "function run() {\n  const logInfo = () => {};\n  logInfo('x');\n}\n",
  });

  const result = runAudit(root, { extraTracked: ["logInfo"] });
  assert.equal(codes(result, "UNRESOLVED_REFERENCE").length, 0);

  cleanup(root);
});

test("a classic script that uses module syntax is a parse error", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": 'import "./other.js";\n',
    "chrome/other.js": "export const x = 1;\n",
  });

  const result = runAudit(root);
  const parseErrors = codes(result, "PARSE_ERROR");
  assert.equal(parseErrors.length, 1);
  assert.equal(parseErrors[0].severity, "error");
  assert.equal(parseErrors[0].sourceType, "script");

  cleanup(root);
});

test("a module script with a top level return is a parse error", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, background: { service_worker: "background.js", type: "module" } },
    "chrome/background.js": "return 1;\n",
  });

  const result = runAudit(root);
  assert.equal(codes(result, "PARSE_ERROR").length, 1);

  cleanup(root);
});

test("a missing static import is reported", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, background: { service_worker: "background.js", type: "module" } },
    "chrome/background.js": 'import "./nope.js";\n',
  });

  const result = runAudit(root);
  const missing = codes(result, "MISSING_IMPORT");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].severity, "error");

  cleanup(root);
});

test("an imported module is audited in its own module scope", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, background: { service_worker: "background.js", type: "module" } },
    "chrome/background.js": 'import "./side.js";\n',
    "chrome/side.js": "const shared = 1;\nconst shared = 2;\n",
  });

  const result = runAudit(root);
  const parseErrors = codes(result, "PARSE_ERROR");
  assert.equal(parseErrors.length, 1);
  assert.ok(parseErrors[0].scope.includes("module("));
  assert.ok(parseErrors[0].file.includes("side.js"));

  cleanup(root);
});

test("using a declaration from a script that runs later is reported", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js", "b.js"]),
    "chrome/a.js": "later();\n",
    "chrome/b.js": "function later() {}\n",
  });

  const result = runAudit(root);
  const order = codes(result, "USE_BEFORE_DECLARE");
  assert.equal(order.length, 1);
  assert.equal(order[0].severity, "error");
  assert.equal(order[0].name, "later");

  cleanup(root);
});

test("a lexical declaration used before its own statement is reported", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "console.log(value);\nconst value = 1;\n",
  });

  const result = runAudit(root);
  const order = codes(result, "USE_BEFORE_DECLARE");
  assert.equal(order.length, 1);
  assert.equal(order[0].name, "value");

  cleanup(root);
});

test("a function declaration used before its own statement is not reported", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "run();\nfunction run() {}\n",
  });

  const result = runAudit(root);
  assert.equal(codes(result, "USE_BEFORE_DECLARE").length, 0);

  cleanup(root);
});

test("a reference inside a function body is not a temporal dead zone error", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "function run() {\n  return value;\n}\nconst value = 1;\n",
  });

  const result = runAudit(root);
  assert.equal(codes(result, "USE_BEFORE_DECLARE").length, 0);

  cleanup(root);
});

test("the same script loaded twice in one scope is reported", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js", "b.js", "a.js"]),
    "chrome/a.js": "const x = 1;\n",
    "chrome/b.js": "const y = 2;\n",
  });

  const result = runAudit(root);
  const duplicates = codes(result, "DUPLICATE_FILE_IN_SCOPE");
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].severity, "warning");

  cleanup(root);
});

test("a script that ships but is never loaded is reported as informational", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "const x = 1;\n",
    "chrome/unused.js": "const y = 2;\n",
  });

  const result = runAudit(root);
  const orphans = codes(result, "ORPHAN_FILE");
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].severity, "info");

  cleanup(root);
});

test("a missing script referenced by the manifest is reported", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js", "gone.js"]),
    "chrome/a.js": "const x = 1;\n",
  });

  const result = runAudit(root);
  const missing = codes(result, "MISSING_FILE");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].reference, "gone.js");

  cleanup(root);
});

test("the tracked identifier check reports that it is disabled when the sources are missing", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "logInfo('x');\n",
  });

  const result = runAudit(root, { loggingSources: ["missing/logging.js"] });
  const unavailable = codes(result, "LOGGING_API_UNAVAILABLE");
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].severity, "warning");

  cleanup(root);
});

test("a redeclared name is not reported twice as an ordering problem", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js", "b.js"]),
    "chrome/a.js": "const shared = 1;\n",
    "chrome/b.js": "shared;\nconst shared = 2;\n",
  });

  const result = runAudit(root);
  assert.equal(codes(result, "DUPLICATE_BLOCKING").length, 1);
  assert.equal(codes(result, "USE_BEFORE_DECLARE").length, 0);

  cleanup(root);
});

test("a script that is missing is reported once even when several scopes load it", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3 },
    "chrome/one.html": '<html><body><script src="../shared/gone.js"></script></body></html>',
    "chrome/two.html": '<html><body><script src="../shared/gone.js"></script></body></html>',
  });

  const result = runAudit(root);
  const missing = codes(result, "MISSING_FILE");
  assert.equal(missing.length, 1);

  cleanup(root);
});

test("the tracked identifier set is derived from the repository sources", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "customLogger('x');\n",
    "logging-api.js": "const customLogger = () => {};\nconst otherName = 1;\n",
  });

  const result = runAudit(root, { loggingSources: ["logging-api.js"] });
  const unresolved = codes(result, "UNRESOLVED_REFERENCE");
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].name, "customLogger");

  cleanup(root);
});

test("identifiers that are not tracked are never reported as unresolved", () => {
  const root = createFixture({
    "chrome/manifest.json": contentScriptManifest(["a.js"]),
    "chrome/a.js": "someRandomHelper('x');\n",
  });

  const result = runAudit(root, { extraTracked: ["logInfo"] });
  assert.equal(collect(result).filter((item) => item.code === "UNRESOLVED_REFERENCE").length, 0);

  cleanup(root);
});
