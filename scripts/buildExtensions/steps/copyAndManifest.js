const fs = require("fs-extra");
const path = require("path");

const DEFAULT_JS_FILES = [
  "libs/browser-polyfill.js",
  "libs/pako.js",
  "libs/flatpickr.js",
  "libs/tinycolor.js",
  "libs/iro@5.js",
  "rpcStateManager.js",
  "keepAliveManager.js",
  "mainParser.js",
  "popup/selector/selector.js",
  "main.js",
];

const MAIN_WORLD_JS_FILES = ["keepAliveMain.js"];

const IFRAME_JS_FILES = ["libs/browser-polyfill.js", "iframeParser.js"];
const EXCLUDED_DIRS = ["manifests", "parsers", "matches", path.join("libs", "codemirror", "addons")];

function copyExtensionFiles(extensionDir, distDir) {
  fs.copySync(extensionDir, distDir, {
    filter: (src) => {
      return !EXCLUDED_DIRS.some((dir) => src.includes(path.join(extensionDir, dir)));
    },
  });
}

function buildManifest(extensionDir, target, pkgVersion) {
  const manifestPath = path.join(extensionDir, "manifests", `manifest.${target}.json`);
  const manifest = fs.readJsonSync(manifestPath);
  manifest.version = pkgVersion;

  const currentDefaultJs = [...DEFAULT_JS_FILES];
  const currentIframeJs = [...IFRAME_JS_FILES];

  const compiledParsersPath = path.join(extensionDir, "compiledParsers.js");
  if (fs.existsSync(compiledParsersPath)) {
    currentDefaultJs.push("compiledParsers.js");
  }

  const compiledIframeParsersPath = path.join(extensionDir, "compiledIframeParsers.js");
  if (fs.existsSync(compiledIframeParsersPath)) {
    currentIframeJs.push("compiledIframeParsers.js");
  }

  if (!manifest.content_scripts) {
    manifest.content_scripts = [];
  }

  manifest.content_scripts = manifest.content_scripts.map((script) => ({
    ...script,
    matches: ["<all_urls>"],
    js: currentDefaultJs,
  }));

  manifest.content_scripts.unshift({
    matches: ["<all_urls>"],
    js: MAIN_WORLD_JS_FILES,
    world: "MAIN",
    run_at: "document_start",
  });

  // iframe content script
  manifest.content_scripts.push({
    matches: ["<all_urls>"],
    js: currentIframeJs,
    all_frames: true,
    match_about_blank: true,
    run_at: "document_idle",
  });

  return manifest;
}

function writeManifest(distDir, manifest) {
  fs.writeJsonSync(path.join(distDir, "manifest.json"), manifest, { spaces: 2 });
}

function patchFirefoxBackground(distDir) {
  const backgroundPath = path.join(distDir, "background.js");
  if (fs.existsSync(backgroundPath)) {
    let content = fs.readFileSync(backgroundPath, "utf8");
    content = content.replace(/import\s+["']\.\/libs\/browser-polyfill\.js["'];?\s*/g, "");
    content = content.replace(/import\s+["']\.\/libs\/pako\.js["'];?\s*/g, "");
    fs.writeFileSync(backgroundPath, content);
  }
}

module.exports = { copyExtensionFiles, buildManifest, writeManifest, patchFirefoxBackground };
