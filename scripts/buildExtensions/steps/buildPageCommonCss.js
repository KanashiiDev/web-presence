const fs = require("fs-extra");
const path = require("path");

// Bundles the shared page styles into one central CSS file that every
// extension page includes with a single <link>, replacing per-file inlining.
const SHARED_CSS_FILES = ["css-config.css", "css-global.css", "css-components.css"];

function buildPageCommonCss(sharedDir, distDir) {
  const content = SHARED_CSS_FILES.map((file) => fs.readFileSync(path.join(sharedDir, file), "utf8")).join("\n");

  const outPath = path.join(distDir, "shared", "page-common.css");
  fs.ensureDirSync(path.dirname(outPath));
  fs.writeFileSync(outPath, content, "utf8");
}

module.exports = { buildPageCommonCss };
