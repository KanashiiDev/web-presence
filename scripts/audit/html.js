const fs = require("fs");
const path = require("path");

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(raw) {
  const attributes = {};
  if (!raw) return attributes;
  ATTRIBUTE.lastIndex = 0;
  let match = ATTRIBUTE.exec(raw);
  while (match) {
    const name = match[1].toLowerCase();
    const value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : "";
    if (!(name in attributes)) attributes[name] = value;
    match = ATTRIBUTE.exec(raw);
  }
  return attributes;
}

/**
 * Extracts the scripts of an extension page.
 *
 * The audit needs three things per script: the resolved file, whether it is an ES module
 * (`type="module"` gives it its own module scope) and whether it is inline (no `src`).
 * The order of the tags is the execution order for classic scripts, so it is preserved.
 */
function parsePageScripts(html, pagePath) {
  const scripts = [];
  const baseDir = path.dirname(pagePath);
  let index = 0;
  SCRIPT_TAG.lastIndex = 0;
  let match = SCRIPT_TAG.exec(html);
  while (match) {
    const attributes = parseAttributes(match[1]);
    const isModule = String(attributes.type || "").toLowerCase() === "module";
    const src = attributes.src;
    if (src) {
      scripts.push({
        index: index++,
        inline: false,
        module: isModule,
        src,
        path: resolveLocalSrc(baseDir, src),
      });
    } else if (match[2] && match[2].trim()) {
      scripts.push({
        index: index++,
        inline: true,
        module: isModule,
        code: match[2],
        path: `${pagePath}#inline-${index}`,
      });
    }
    match = SCRIPT_TAG.exec(html);
  }
  return scripts;
}

/**
 * Resolves a `src`/`href` attribute to an absolute path.
 *
 * Returns null for external references (http, https, protocol relative, data URIs) and for
 * root relative paths, which resolve against the extension origin rather than the build
 * directory.
 */
function resolveLocalSrc(baseDir, src) {
  const value = String(src || "").trim();
  if (!value) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;
  if (value.startsWith("//")) return null;
  if (value.startsWith("/")) return null;
  if (value.startsWith("#")) return null;
  return path.resolve(baseDir, value.split(/[?#]/)[0]);
}

/** Recursively lists every file below a directory. */
function listFiles(dir) {
  const files = [];
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dir);
  return files;
}

/** Finds every HTML page inside a build directory. */
function findPages(dir) {
  return listFiles(dir).filter((file) => file.toLowerCase().endsWith(".html"));
}

function readPageScripts(pagePath) {
  const html = fs.readFileSync(pagePath, "utf8");
  return parsePageScripts(html, pagePath);
}

module.exports = { parsePageScripts, parseAttributes, resolveLocalSrc, listFiles, findPages, readPageScripts };
