const fs = require("fs-extra");
const path = require("path");

const { prefixCssFiles } = require("./steps/prefixCss");
const { copyExtensionFiles, buildManifest, writeManifest } = require("./steps/copyAndManifest");
const { createInlineUtils } = require("./steps/inlineUtils");
const { buildPageCommonCss } = require("./steps/buildPageCommonCss");
const registerInlines = require("./inlineConfig");
const { copyLocales } = require("./steps/copyLocales");
const { checkMissingTranslations, generateLanguages } = require("../checkMissingTranslations");
const { auditAll } = require("../audit");
const { renderText } = require("../audit/report");

const ROOT_DIR = path.join(__dirname, "..", "..");
const TARGET = process.env.TARGET || "chrome";
const EXTENSION_DIR = path.join(ROOT_DIR, "extension");
const SHARED_DIR = path.join(ROOT_DIR, "shared");
const LOCALES_DIR = path.join(ROOT_DIR, "locales");
const DIST_DIR = path.join(ROOT_DIR, "extensionBuilds", TARGET);
const DIST_LOCALES_DIR = path.join(DIST_DIR, "locales");
const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8")).version;

(async () => {
  // 1. Clean dist folder
  fs.emptyDirSync(DIST_DIR);

  // 2. Autoprefixer — mutates CSS files in extensionDir
  await prefixCssFiles(EXTENSION_DIR);

  // 3. Copy extension files to dist (excluding manifests, parsers, matches, codemirror addons)
  copyExtensionFiles(EXTENSION_DIR, DIST_DIR);

  // 4. Build and write manifest
  const manifest = buildManifest(EXTENSION_DIR, TARGET, pkgVersion);

  // 5. Inline utilities
  const commonUtilsPath = path.join(DIST_DIR, "common", "utils.js");
  fs.ensureDirSync(path.dirname(commonUtilsPath));
  if (!fs.existsSync(commonUtilsPath)) {
    fs.writeFileSync(commonUtilsPath, "// Auto-generated utils.js");
  }
  const { inlineUtilsFunctions, buildInlineFunctions, concatDirectoryInto } = createInlineUtils(EXTENSION_DIR, DIST_DIR);
  concatDirectoryInto("common/utils.js", "common/utils");
  registerInlines(inlineUtilsFunctions);
  buildInlineFunctions();

  // 6. Shared page CSS
  buildPageCommonCss(SHARED_DIR, DIST_DIR);

  // 7. Copy locales
  checkMissingTranslations(LOCALES_DIR, ["extension"]);
  generateLanguages(LOCALES_DIR);

  fs.mkdirSync(DIST_LOCALES_DIR, { recursive: true });
  copyLocales(LOCALES_DIR, DIST_LOCALES_DIR);

  // 8. Write manifest
  writeManifest(DIST_DIR, manifest);

  console.log(`✅ ${TARGET} build completed: ${DIST_DIR}`);

  // 9. Scope audit of the freshly generated bundle for this target
  const report = renderText(auditAll({ targets: [TARGET] }));
  process.stdout.write(`${report.text}\n`);
  if (report.summary.errors > 0) {
    process.exitCode = 1;
  }
})();
