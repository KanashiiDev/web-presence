// Get Fresh Parser List
async function getFreshParserList(force = false) {
  try {
    const response = await browser.runtime.sendMessage({
      type: "REQUEST_FRESH_PARSER_LIST",
      force,
    });

    return response?.data ?? [];
  } catch (error) {
    logError("[parserList]: getFreshParserList error:", error);
    return [];
  }
}

// Init Storage Listener
function initStorageListener() {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.colorSettings) {
      const applyFgBlur = changes.colorSettings.newValue?.applyFgBlur;
      document.body.classList.toggle("fg-blur", !!applyFgBlur);
    }

    if (changes.styleAttrs) {
      const styleString = changes.styleAttrs.newValue ?? "";
      document.body.setAttribute("style", styleString);
    }

    if (changes.theme) {
      document.body.dataset.theme = changes.theme.newValue ?? "dark";
    }
  });
}

// Apply Attrs
async function initApplyAttrs() {
  const { styleAttrs } = await browser.storage.local.get("styleAttrs");
  document.body.setAttribute("style", styleAttrs ?? "");

  const { colorSettings } = await browser.storage.local.get("colorSettings");
  document.body.classList.toggle("fg-blur", !!colorSettings?.applyFgBlur);

  const { theme } = await browser.storage.local.get("theme");
  document.body.dataset.theme = theme ?? "dark";
}
