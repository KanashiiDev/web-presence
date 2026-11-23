#!/usr/bin/env node
/**
 * Generate the editor's QA module from the canonical shared source.
 *
 *   node scripts/qa/syncSharedQa.js                  # generate from local copy
 *   LOCALES_REPO_PATH=../web-presence-locales node scripts/qa/syncSharedQa.js
 *
 * The canonical source lives at scripts/qa/shared/qa.js (a byte-identical copy
 * of web-presence-locales/tools/lib/qa.js). When LOCALES_REPO_PATH is set the
 * source is refreshed from that checkout first.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const canonical = path.join(__dirname, "shared/qa.mjs");
const target = path.join(root, "extension/translationEditor/modules/qa.js");

if (process.env.LOCALES_REPO_PATH) {
  const upstream = path.resolve(process.env.LOCALES_REPO_PATH, "tools/lib/qa.js");
  fs.copyFileSync(upstream, canonical);
  console.log(`Refreshed canonical copy from ${upstream}`);
}

function generate(source) {
  // The browser bundle concatenates plain scripts: no import/export allowed.
  const stripped = source
    .split("\n")
    // Extension files disable no-control-regex globally; the directive would
    // be an unused eslint warning in the generated bundle.
    .filter((line) => !line.includes("eslint-disable-next-line no-control-regex"))
    .map((line) => line.replace(/^export\s+/, ""))
    .join("\n");
  return [
    "// GENERATED FILE - do not edit. Run: node scripts/qa/syncSharedQa.js",
    "// Source: scripts/qa/shared/qa.mjs (mirrors web-presence-locales/tools/lib/qa.js)",
    stripped.trimEnd(),
    "",
  ].join("\n");
}

fs.writeFileSync(target, generate(fs.readFileSync(canonical, "utf8")));
console.log(`Wrote ${path.relative(root, target)}`);
