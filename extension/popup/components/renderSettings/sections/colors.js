async function buildColors(container) {
  const COLOR_SETTINGS = getColorSettings();
  const { colorSettings } = await browser.storage.local.get("colorSettings");
  const colorConfig = colorSettings ?? {};

  function buildColorRow(item) {
    const wrap = document.createElement("div");
    wrap.className = "settings-option color-wrapper";

    const lbl = document.createElement("label");
    lbl.dataset.i18n = item.i18n;

    const control = document.createElement("div");
    control.className = "color-control";

    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.background = colorConfig[item.key] ?? item.default;

    const btnDelete = document.createElement("span");
    btnDelete.appendChild(createSVG(svg_paths.crossIconPaths));
    btnDelete.className = "color-delete-btn btn";
    btnDelete.title = "Revert";

    const isDefault = !colorConfig[item.key] || colorConfig[item.key] === item.default;
    btnDelete.classList.toggle("disabled", isDefault);

    btnDelete.addEventListener("click", async (e) => {
      document.body.style.transition = "none";
      e.stopPropagation();

      const { colorSettings: latest } = await browser.storage.local.get("colorSettings");
      const config = latest ?? {};
      delete config[item.key];
      if (item.key === "foregroundColor") delete config["applyFgBlur"];
      await browser.storage.local.set({ colorSettings: config });

      const def = getDefaultCSSValue(item);
      swatch.style.background = def;

      await applyColorSettings();
      await applyBackgroundSettings();
      closePicker();

      btnDelete.classList.toggle("disabled", !def || def === item.default);

      setTimeout(() => {
        document.body.style.transition = "";
      }, 50);

      const deleteColorsBtn = document.querySelector(".all-colors-delete-btn");
      deleteColorsBtn.classList.toggle("disabled", Object.keys(config).length === 0);
    });

    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      openPickerForSwatch(item, swatch, btnDelete);
    });

    control.appendChild(swatch);
    wrap.appendChild(lbl);
    wrap.appendChild(control);
    wrap.appendChild(btnDelete);

    return wrap;
  }

  // Wrapper
  const colorSectionWrapper = document.createElement("div");
  colorSectionWrapper.className = "settings-option color-section-wrapper";

  // Label and Toggle
  const colorSectionLabel = document.createElement("label");
  colorSectionLabel.textContent = i18n.t("settings.color");

  const toggleSpan = document.createElement("span");
  toggleSpan.className = "color-expand-btn btn";
  toggleSpan.title = i18n.t("settings.color.edit");
  toggleSpan.appendChild(createSVG(svg_paths.gearIconPaths));

  // Delete Button
  const btnDeleteColors = document.createElement("span");
  btnDeleteColors.appendChild(createSVG(svg_paths.crossIconPaths));
  btnDeleteColors.className = "all-colors-delete-btn btn";
  btnDeleteColors.title = i18n.t("settings.color.remove");
  btnDeleteColors.classList.toggle("disabled", Object.keys(colorConfig).length === 0);

  btnDeleteColors.addEventListener("click", async (e) => {
    await browser.storage.local.set({ colorSettings: {} });
    await applyColorSettings();
    await applyBackgroundSettings();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    btnDeleteColors.classList.toggle("disabled", Object.keys(colorConfig).length === 0);
    await updateAllSwatchesForTheme();
  });

  colorSectionWrapper.appendChild(colorSectionLabel);
  colorSectionWrapper.appendChild(toggleSpan);
  colorSectionWrapper.appendChild(btnDeleteColors);

  // Modal
  const colorModal = document.createElement("div");
  colorModal.className = "color expandable-section hidden";
  colorModal.id = "colorExpandableSection";

  for (const item of COLOR_SETTINGS) {
    colorModal.appendChild(buildColorRow(item));
  }

  colorSectionWrapper.appendChild(colorModal);
  container.appendChild(colorSectionWrapper);

  // Modal Toggle
  toggleSpan.addEventListener("click", async (e) => {
    e.stopPropagation();
    const isHidden = colorModal.classList.toggle("hidden");
    toggleSpan.classList.toggle("expanded", !isHidden);
    await activateSimpleBar(colorModal);
  });
}

// Close Color Settings
function closeColorsModal() {
  const btnColorEl = document.querySelector(".color-expand-btn");
  const colorExpandableSectionEl = document.querySelector(".color.expandable-section");
  if (btnColorEl && colorExpandableSectionEl) {
    colorExpandableSectionEl.classList.add("hidden");
    btnColorEl.classList.remove("expanded");
  }
}
