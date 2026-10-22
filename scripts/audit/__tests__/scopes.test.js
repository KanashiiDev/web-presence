const test = require("node:test");
const assert = require("node:assert/strict");

const { createFixture, runAudit, collect, scopeIds, scopeById, cleanup } = require("./helpers");

test("content scripts in the same world share the top frame scope", () => {
  const root = createFixture({
    "chrome/manifest.json": {
      manifest_version: 3,
      content_scripts: [
        { matches: ["<all_urls>"], js: ["first.js"], run_at: "document_idle" },
        { matches: ["<all_urls>"], js: ["second.js"], all_frames: true, run_at: "document_idle" },
      ],
    },
    "chrome/first.js": "const a = 1;\n",
    "chrome/second.js": "const b = 2;\n",
  });

  const result = runAudit(root);
  const ids = scopeIds(result);
  assert.ok(ids.includes("chrome:content[ISOLATED|top-frame]"));
  assert.ok(ids.includes("chrome:content[ISOLATED|sub-frame]"));

  const top = scopeById(result, "chrome:content[ISOLATED|top-frame]");
  const sub = scopeById(result, "chrome:content[ISOLATED|sub-frame]");
  assert.deepEqual(
    top.files.map((file) => file.replace(/\\/g, "/").split("/").pop()),
    ["first.js", "second.js"],
  );
  assert.deepEqual(
    sub.files.map((file) => file.replace(/\\/g, "/").split("/").pop()),
    ["second.js"],
  );

  cleanup(root);
});

test("the MAIN world is a separate scope from the ISOLATED world", () => {
  const root = createFixture({
    "chrome/manifest.json": {
      manifest_version: 3,
      content_scripts: [
        { matches: ["<all_urls>"], js: ["page.js"], world: "MAIN", run_at: "document_start" },
        { matches: ["<all_urls>"], js: ["isolated.js"], run_at: "document_idle" },
      ],
    },
    "chrome/page.js": "const shared = 1;\n",
    "chrome/isolated.js": "const shared = 2;\n",
  });

  const result = runAudit(root);
  const ids = scopeIds(result);
  assert.ok(ids.includes("chrome:content[MAIN|top-frame]"));
  assert.ok(ids.includes("chrome:content[ISOLATED|top-frame]"));

  // The same name in two different worlds is not a conflict.
  const blocking = collect(result).filter((item) => item.code === "DUPLICATE_BLOCKING");
  assert.equal(blocking.length, 0);

  cleanup(root);
});

test("classic page scripts share one scope and module scripts get their own", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, action: { default_popup: "popup.html" } },
    "chrome/popup.html": '<html><body><script src="a.js"></script><script src="b.js"></script><script type="module" src="m.js"></script></body></html>',
    "chrome/a.js": "const shared = 1;\n",
    "chrome/b.js": "const shared = 2;\n",
    "chrome/m.js": "const shared = 3;\n",
  });

  const result = runAudit(root);
  const ids = scopeIds(result);
  assert.ok(ids.includes("chrome:page(popup.html)"));
  assert.ok(ids.includes("chrome:page(popup.html)#module(m.js)"));

  const blocking = collect(result).filter((item) => item.code === "DUPLICATE_BLOCKING");
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].scope, "chrome:page(popup.html)");

  cleanup(root);
});

test("a Chrome service worker is a module scope and a Firefox background script is too", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, background: { service_worker: "background.js", type: "module" } },
    "chrome/background.js": 'import "./side.js";\nconst x = 1;\n',
    "chrome/side.js": "export const y = 2;\n",
    "firefox/manifest.json": { manifest_version: 3, background: { scripts: ["background.js"], type: "module" } },
    "firefox/background.js": 'import "./side.js";\nconst x = 1;\n',
    "firefox/side.js": "export const y = 2;\n",
  });

  const result = runAudit(root, { targets: ["chrome", "firefox"] });
  assert.ok(scopeIds(result, "chrome").includes("chrome:background(service_worker)"));
  assert.ok(scopeIds(result, "firefox").includes("firefox:background(script:background.js)"));

  cleanup(root);
});

test("classic background scripts share one global scope", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, background: { scripts: ["one.js", "two.js"] } },
    "chrome/one.js": "const shared = 1;\n",
    "chrome/two.js": "const shared = 2;\n",
  });

  const result = runAudit(root);
  assert.ok(scopeIds(result).includes("chrome:background(scripts)"));
  const blocking = collect(result).filter((item) => item.code === "DUPLICATE_BLOCKING");
  assert.equal(blocking.length, 1);

  cleanup(root);
});

test("a page only sees the scripts it loads", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3 },
    "chrome/one.html": '<html><body><script src="one.js"></script></body></html>',
    "chrome/two.html": '<html><body><script src="two.js"></script></body></html>',
    "chrome/one.js": "const shared = 1;\n",
    "chrome/two.js": "const shared = 2;\n",
  });

  const result = runAudit(root);
  const blocking = collect(result).filter((item) => item.code === "DUPLICATE_BLOCKING");
  assert.equal(blocking.length, 0);

  cleanup(root);
});

test("missing manifest pages and scripts are reported", () => {
  const root = createFixture({
    "chrome/manifest.json": { manifest_version: 3, action: { default_popup: "missing.html" }, background: { service_worker: "missing-bg.js", type: "module" } },
  });

  const result = runAudit(root);
  const missing = collect(result).filter((item) => item.code === "MISSING_FILE");
  const references = missing.map((item) => item.reference);
  assert.ok(references.includes("missing.html"));
  assert.ok(references.includes("missing-bg.js"));

  cleanup(root);
});
