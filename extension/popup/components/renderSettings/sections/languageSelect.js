const initLanguageSelect = async (container) => {
  if (!container) return;

  try {
    // The locales repository owns the language catalog. Its snapshot-pinned
    // copy is cached by the background; fall back to the packaged list only
    // while the first refresh is still running.
    let catalog = null;
    let publishedCodes = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const stored = await browser.storage.local.get("translationLocaleCache");
      const cache = stored?.translationLocaleCache;
      if (cache?.schemaVersion === 2 && cache.metadata?.content) {
        catalog = cache.metadata.content;
        publishedCodes = cache.manifest?.content?.languages || null;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!catalog) {
      const response = await fetch(browser.runtime.getURL("locales/languages.json"));
      catalog = await response.json();
    }
    const data = catalog;

    // The manifest is the authority for publication: it contains the languages
    // that crossed the coverage threshold (and keeps them after a drop). When
    // no manifest is cached yet, show the full catalog as before.
    const extensionLanguages = Object.fromEntries(
      Object.entries(data).filter(([key, lang]) => {
        if (!key || lang.extension !== true) return false;
        if (lang.published === false) return false;
        // English is the source language and is not published in the manifest.
        if (key === "en") return true;
        if (publishedCodes && !Object.prototype.hasOwnProperty.call(publishedCodes, key)) return false;
        return true;
      }),
    );

    // Ensure the source language exists, even in incomplete catalogs.
    if (!extensionLanguages.en) extensionLanguages.en = { label: "English", extension: true };
    const orderedLanguages = {
      en: extensionLanguages.en,
      ...Object.fromEntries(Object.entries(extensionLanguages).filter(([key]) => key !== "en")),
    };

    const { lang } = (await browser.storage.local.get("lang")) || {};
    const locales = [lang, navigator.languages?.[0] || navigator.language, "en"].filter(Boolean);
    const displayNames = new Intl.DisplayNames(locales, { type: "language" });

    const wrapper = document.createElement("div");
    wrapper.className = "settings-option";

    const label = document.createElement("label");
    label.className = "setting-label";
    label.textContent = "Language";
    label.dataset.i18n = "common.language";

    const select = document.createElement("select");
    select.id = "languageSelect";

    Object.entries(orderedLanguages).forEach(([key, value]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = displayNames.of(key) ?? value.label;
      select.appendChild(option);
    });

    if (lang && orderedLanguages[lang]) {
      select.value = lang;
    }

    wrapper.append(label, select);

    container.appendChild(wrapper);

    new TomSelect(select, {
      controlInput: null,
      sortField: false,
      plugins: {
        auto_width: { isExtension: true, maxWidth: 125 },
        simplebar: {
          isExtension: true,
        },
      },
      onChange: async () => {
        await browser.storage.local.set({ lang: select.value });
        window.location.reload();
      },
    });
  } catch (err) {
    console.log("Error loading languages.json:", err);
  }
};
