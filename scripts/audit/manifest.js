const fs = require("fs");
const path = require("path");

const { resolveLocalSrc } = require("./html");

/**
 * Reads the generated manifest and extracts every reference the audit has to validate.
 *
 * The generated manifest is the primary evidence for how the extension actually loads, so the
 * audit never guesses: background model, content script worlds, extension pages and resources
 * all come from here.
 */
function readManifest(buildDir) {
  const manifestPath = path.join(buildDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { __parseError: error.message };
  }
  return manifest;
}

function backgroundModel(manifest) {
  const background = manifest && manifest.background ? manifest.background : null;
  if (!background) return { kind: "none", files: [], module: false };
  const module = String(background.type || "").toLowerCase() === "module";
  if (background.service_worker) {
    return { kind: "service-worker", files: [background.service_worker], module };
  }
  if (Array.isArray(background.scripts) && background.scripts.length) {
    return { kind: "scripts", files: background.scripts.slice(), module };
  }
  return { kind: "none", files: [], module };
}

function contentScriptRegistrations(manifest) {
  const registrations = manifest && Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  return registrations.map((registration, index) => ({
    index,
    world: String(registration.world || "ISOLATED").toUpperCase(),
    allFrames: registration.all_frames === true,
    matchAboutBlank: registration.match_about_blank === true,
    runAt: registration.run_at || "document_idle",
    files: Array.isArray(registration.js) ? registration.js.slice() : [],
  }));
}

/** Extension pages that the manifest points at. */
function manifestPages(manifest, buildDir) {
  const pages = [];
  const push = (relative, origin) => {
    if (!relative) return;
    const resolved = resolveLocalSrc(buildDir, relative);
    pages.push({ origin, reference: relative, path: resolved });
  };

  if (!manifest) return pages;

  if (manifest.action && manifest.action.default_popup) push(manifest.action.default_popup, "action.default_popup");
  if (manifest.options_ui && manifest.options_ui.page) push(manifest.options_ui.page, "options_ui.page");
  if (manifest.options_page) push(manifest.options_page, "options_page");
  if (manifest.side_panel && manifest.side_panel.default_path) push(manifest.side_panel.default_path, "side_panel.default_path");
  if (manifest.devtools_page) push(manifest.devtools_page, "devtools_page");
  if (manifest.chrome_url_overrides) {
    for (const [key, value] of Object.entries(manifest.chrome_url_overrides)) {
      push(value, `chrome_url_overrides.${key}`);
    }
  }
  if (manifest.sandbox && Array.isArray(manifest.sandbox.pages)) {
    for (const page of manifest.sandbox.pages) push(page, "sandbox.pages");
  }
  return pages;
}

/** Every file the manifest references directly (scripts, icons, web accessible resources). */
function manifestResources(manifest, buildDir) {
  const resources = [];
  const push = (reference, origin, kind) => {
    if (!reference || typeof reference !== "string") return;
    resources.push({ origin, kind, reference, path: resolveLocalSrc(buildDir, reference) });
  };

  if (!manifest) return resources;

  const background = backgroundModel(manifest);
  for (const file of background.files) push(file, "background", "script");

  for (const registration of contentScriptRegistrations(manifest)) {
    for (const file of registration.files) push(file, `content_scripts[${registration.index}]`, "script");
  }

  if (manifest.action) {
    const icon = manifest.action.default_icon;
    if (typeof icon === "string") push(icon, "action.default_icon", "icon");
    else if (icon && typeof icon === "object") {
      for (const [size, value] of Object.entries(icon)) push(value, `action.default_icon[${size}]`, "icon");
    }
  }

  if (manifest.icons && typeof manifest.icons === "object") {
    for (const [size, value] of Object.entries(manifest.icons)) push(value, `icons[${size}]`, "icon");
  }

  if (Array.isArray(manifest.web_accessible_resources)) {
    manifest.web_accessible_resources.forEach((entry, index) => {
      const list = Array.isArray(entry.resources) ? entry.resources : [];
      for (const reference of list) push(reference, `web_accessible_resources[${index}]`, "resource");
    });
  }

  return resources;
}

module.exports = { readManifest, backgroundModel, contentScriptRegistrations, manifestPages, manifestResources };
