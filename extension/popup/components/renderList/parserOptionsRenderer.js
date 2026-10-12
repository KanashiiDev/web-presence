async function renderOptions(mode, container, parserOptions, settingKey, addListener) {
  const allDefaultKeys = Object.keys(DEFAULT_PARSER_OPTIONS);

  const sections = [
    {
      title: i18n.t("common.settings"),
      keys: allDefaultKeys.filter((k) => !k.startsWith("custom")),
      prefix: "",
      collapsible: true,
    },
    {
      title: i18n.t("parserOptions.customSettings"),
      keys: allDefaultKeys.filter((k) => k.startsWith("custom")),
      prefix: "custom",
      collapsible: true,
    },
    {
      title: i18n.t("parserOptions.otherSettings"),
      keys: Object.keys(parserOptions).filter((k) => !allDefaultKeys.includes(k)),
      prefix: "user",
      collapsible: true,
    },
  ];

  for (const { title, keys, prefix, collapsible } of sections) {
    if (!keys.length) continue;

    const section = Object.assign(document.createElement("div"), {
      className: `${prefix ? prefix + " " : ""}options-container${collapsible ? " accordion-container" : ""}`,
    });

    const header = Object.assign(document.createElement("h4"), {
      className: `${prefix ? prefix + " " : ""}options-header${collapsible ? " accordion-header" : ""}`,
    });

    const label = Object.assign(document.createElement("label"), {
      className: `${prefix ? prefix + " " : ""}options-header${collapsible ? " accordion-label" : ""}`,
      textContent: title,
    });

    const content = Object.assign(document.createElement("div"), {
      className: `${prefix ? prefix + " " : ""}options-content${collapsible ? " accordion-content close" : ""}`,
    });

    const inner = Object.assign(document.createElement("div"), { className: "accordion-inner" });

    for (const key of keys) {
      if (parserOptions[key] !== undefined) {
        await renderOption(key, mode, parserOptions[key], inner, settingKey, addListener);
      }
    }

    content.appendChild(inner);
    section.append(header, content);
    container.appendChild(section);

    if (collapsible) {
      if (prefix === "user") container.classList.add("userscript");
      header.append(label, createSVG(svg_paths.forwardIconPaths));
      addListener(header, "click", () => toggleSettingAccordion(header, content));
    }
  }
}

async function renderOption(key, mode, data, container, settingKey, addListener) {
  const optionSpan = Object.assign(document.createElement("span"), { className: "parser-option" });
  const defaultMeta = DEFAULT_PARSER_OPTIONS[key];

  const resolvedLabel = await resolveLabel(defaultMeta?.label ?? data.label ?? key);

  const label = Object.assign(document.createElement("label"), {
    textContent: resolvedLabel,
  });

  let input = null;

  if (data.type === "select") {
    optionSpan.classList.add("tom-select-input");
    input = document.createElement("select");
    input.dataset.optionKey = key;
    input.dataset.settingKey = settingKey;

    const values = Array.isArray(data.value) ? data.value : [];
    for (const opt of values) {
      const optEl = Object.assign(document.createElement("option"), {
        value: opt.value,
        textContent: await resolveLabel(opt.label),
      });
      if (opt.selected) optEl.selected = true;
      input.appendChild(optEl);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ts = new TomSelect(input, {
          controlInput: null,
          sortField: false,
          plugins: {
            auto_width: { isExtension: true, maxWidth: 125 },
            simplebar: {
              isExtension: true,
            },
          },
        });
      });

      input.addEventListener("change", async () => {
        const { optionKey: optKey, settingKey: setKey } = input.dataset;
        const selectedValue = input.value;
        const { parserSettings = {} } = await browser.storage.local.get("parserSettings");
        const opts = parserSettings[setKey] ?? {};
        const arr = Array.isArray(opts[optKey]?.value) ? opts[optKey].value : [];
        opts[optKey].value = arr.map((o) => ({ ...o, selected: o.value === selectedValue }));
        await browser.storage.local.set({ parserSettings: { ...parserSettings, [setKey]: opts } });
      });
    });
  } else if (data.type === "checkbox") {
    const switchLabel = Object.assign(document.createElement("label"), { className: "switch-label no-select" });
    const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!data.value });
    cb.dataset.optionKey = key;
    cb.dataset.settingKey = settingKey;
    switchLabel.append(cb, Object.assign(document.createElement("span"), { className: "slider" }));
    input = switchLabel;

    addListener(cb, "change", async (e) => {
      const { optionKey: optKey, settingKey: setKey } = e.target.dataset;
      const { parserSettings = {} } = await browser.storage.local.get("parserSettings");
      const opts = parserSettings[setKey] ?? {};
      opts[optKey].value = e.target.checked;

      const getCheckbox = (name) => container.querySelector(`input[type="checkbox"][data-option-key="${name}"][data-setting-key="${setKey}"]`);

      // At least one of showArtist / showSource must always be enabled
      if (optKey === "showArtist" && !e.target.checked && opts.showSource) {
        opts.showSource.value = true;
        const sibling = getCheckbox("showSource");
        if (sibling) sibling.checked = true;
      } else if (optKey === "showSource" && !e.target.checked && opts.showArtist) {
        opts.showArtist.value = true;
        const sibling = getCheckbox("showArtist");
        if (sibling) sibling.checked = true;
      }

      await browser.storage.local.set({ parserSettings: { ...parserSettings, [setKey]: opts } });
    });
  } else if (data.type === "text") {
    input = Object.assign(document.createElement("input"), { type: "text", value: data.value ?? "" });
    input.dataset.optionKey = key;
    input.dataset.settingKey = settingKey;

    addListener(
      input,
      "input",
      debounce(async (e) => {
        const { optionKey: optKey, settingKey: setKey } = e.target.dataset;
        const { parserSettings = {} } = await browser.storage.local.get("parserSettings");
        const opts = parserSettings[setKey] ?? {};
        opts[optKey].value = e.target.value;
        await browser.storage.local.set({ parserSettings: { ...parserSettings, [setKey]: opts } });
      }, 300),
    );
  }

  if (input) {
    optionSpan.append(label, input);
    container.appendChild(optionSpan);
  }
}
