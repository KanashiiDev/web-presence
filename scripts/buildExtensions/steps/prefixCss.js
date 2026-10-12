const fs = require("fs-extra");
const path = require("path");
const postcss = require("postcss");
const autoprefixer = require("autoprefixer");

function getCssFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);

  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat && stat.isDirectory()) {
      results = results.concat(getCssFiles(fullPath));
    } else if (fullPath.endsWith(".css")) {
      results.push(fullPath);
    }
  });

  return results;
}

function filterVendorFiles(cssFiles, extensionDir) {
  const vendorPath = path.join(extensionDir, "libs");
  const vendorPathNormalized = vendorPath.split(path.sep).join("/");
  return cssFiles.filter((file) => {
    const normalized = file.split(path.sep).join("/");
    return !normalized.startsWith(vendorPathNormalized);
  });
}

async function prefixCssFiles(extensionDir) {
  const prefixer = autoprefixer({
    overrideBrowserslist: ["last 10 Chrome versions", "last 10 Firefox versions"],
  });
  const cssFiles = filterVendorFiles(getCssFiles(extensionDir), extensionDir);

  for (const file of cssFiles) {
    const css = fs.readFileSync(file, "utf8");
    try {
      const result = await postcss([prefixer]).process(css, { from: file, to: file });
      fs.writeFileSync(file, result.css);
    } catch (err) {
      console.error(`Autoprefixer Error ${file}:`, err);
    }
  }
}

module.exports = { prefixCssFiles, getCssFiles, filterVendorFiles };
