const path = require("path");

const { backgroundModel, contentScriptRegistrations } = require("./manifest");
const { findPages, readPageScripts } = require("./html");
const { SCRIPT, MODULE } = require("./ast");

/**
 * Builds the execution scope graph of a generated extension bundle.
 *
 * The important distinction the previous implementation missed:
 *
 *   - Files that are part of the same build are not necessarily related.
 *   - Files loaded by the same page are not necessarily in the same global environment.
 *   - Classic scripts loaded by the same page share one global environment.
 *   - Each ES module has its own module scope; module bindings never leak sideways.
 *   - Content scripts share an isolated world per frame, so the *top frame* scope is the
 *     union of every registration, while a *sub frame* only sees the `all_frames` ones.
 */
function buildScopes(target, buildDir, manifest) {
  const scopes = [];
  const seenSignatures = new Set();

  const pushScope = (scope) => {
    const signature = scope.files.map((file) => file.path).join("|");
    if (!signature) return null;
    if (seenSignatures.has(signature)) return null;
    seenSignatures.add(signature);
    scopes.push(scope);
    return scope;
  };

  /* ---------------- background ---------------- */
  const background = backgroundModel(manifest);
  if (background.kind === "service-worker") {
    // A module service worker is a single ES module: its own scope, imports are separate modules.
    pushScope({
      id: `${target}:background(service_worker)`,
      target,
      kind: "background",
      shared: false,
      module: true,
      world: null,
      frame: null,
      description: "background service worker (ES module)",
      files: background.files.map((file, index) => ({
        path: path.resolve(buildDir, file),
        sourceType: background.module ? MODULE : SCRIPT,
        label: file,
        index,
      })),
    });
  } else if (background.kind === "scripts") {
    if (background.module) {
      // Each entry of `background.scripts` is loaded as its own ES module.
      for (const file of background.files) {
        pushScope({
          id: `${target}:background(script:${file})`,
          target,
          kind: "background",
          shared: false,
          module: true,
          world: null,
          frame: null,
          description: `background script (ES module): ${file}`,
          files: [{ path: path.resolve(buildDir, file), sourceType: MODULE, label: file, index: 0 }],
        });
      }
    } else {
      pushScope({
        id: `${target}:background(scripts)`,
        target,
        kind: "background",
        shared: true,
        module: false,
        world: null,
        frame: null,
        description: "background scripts (classic, shared global)",
        files: background.files.map((file, index) => ({ path: path.resolve(buildDir, file), sourceType: SCRIPT, label: file, index })),
      });
    }
  }

  /* ---------------- content scripts ---------------- */
  const registrations = contentScriptRegistrations(manifest);
  const byWorld = new Map();
  for (const registration of registrations) {
    if (!byWorld.has(registration.world)) byWorld.set(registration.world, []);
    byWorld.get(registration.world).push(registration);
  }

  for (const [world, worldRegistrations] of byWorld) {
    const flatten = (list) => {
      const files = [];
      let index = 0;
      for (const registration of list) {
        for (const file of registration.files) {
          files.push({ path: path.resolve(buildDir, file), sourceType: SCRIPT, label: file, index: index++ });
        }
      }
      return files;
    };

    const topFrame = flatten(worldRegistrations);
    const subFrame = flatten(worldRegistrations.filter((registration) => registration.allFrames));

    if (topFrame.length) {
      pushScope({
        id: `${target}:content[${world}|top-frame]`,
        target,
        kind: "content-script",
        shared: true,
        module: false,
        world,
        frame: "top",
        description: `content scripts in the ${world} world, top frame`,
        files: topFrame,
      });
    }

    if (subFrame.length) {
      pushScope({
        id: `${target}:content[${world}|sub-frame]`,
        target,
        kind: "content-script",
        shared: true,
        module: false,
        world,
        frame: "sub",
        description: `content scripts in the ${world} world, sub frames`,
        files: subFrame,
      });
    }
  }

  /* ---------------- extension pages ---------------- */
  for (const page of findPages(buildDir)) {
    const scripts = readPageScripts(page);
    const classic = scripts.filter((script) => !script.module);
    const modules = scripts.filter((script) => script.module);

    if (classic.length) {
      pushScope({
        id: `${target}:page(${relative(buildDir, page)})`,
        target,
        kind: "page",
        shared: true,
        module: false,
        world: null,
        frame: null,
        description: `extension page: ${relative(buildDir, page)}`,
        files: classic.map((script, index) => ({
          path: script.path,
          sourceType: SCRIPT,
          label: script.src,
          index,
          inline: false,
        })),
      });
    }

    for (const script of modules) {
      pushScope({
        id: `${target}:page(${relative(buildDir, page)})#module(${script.src})`,
        target,
        kind: "module",
        shared: false,
        module: true,
        world: null,
        frame: null,
        description: `extension page module: ${script.src}`,
        files: [{ path: script.path, sourceType: MODULE, label: script.src, index: 0 }],
      });
    }
  }

  return scopes;
}

function relative(buildDir, target) {
  return path.relative(buildDir, target).split(path.sep).join("/");
}

module.exports = { buildScopes };
