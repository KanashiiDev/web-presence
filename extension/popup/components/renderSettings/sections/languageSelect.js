const initLanguageSelect = async (container) => {
  if (!container) return;

  try {
    const url = browser.runtime.getURL("locales/languages.json");
    const response = await fetch(url);
    const data = await response.json();

    const extensionLanguages = Object.fromEntries(Object.entries(data).filter(([key, lang]) => key && lang.extension === true));

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

    Object.entries(extensionLanguages).forEach(([key, value]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = displayNames.of(key) ?? value.label;
      select.appendChild(option);
    });

    if (lang && data[lang]) {
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
