async function buildBackground(container) {
  const { backgroundSettings } = await browser.storage.local.get("backgroundSettings");
  let bgSettings = backgroundSettings ?? {
    image: null,
    blur: 0,
    brightness: 100,
    saturation: 100,
    positionX: 50,
  };

  async function saveBgSettings() {
    await browser.storage.local.set({ backgroundSettings: bgSettings });
    applyBackgroundSettings();
  }

  const bgUrlWrapper = document.createElement("div");
  bgUrlWrapper.className = "settings-option bg-url-wrapper";

  const bgUrlLabel = document.createElement("label");
  bgUrlLabel.textContent = i18n.t("settings.backgroundImage");

  const bgUrlControl = document.createElement("div");
  bgUrlControl.className = "bg-url-control";

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = i18n.t("settings.backgroundImage.url");
  urlInput.className = "bg-url-input input";
  urlInput.value = bgSettings.image ?? "";

  const btnExpand = document.createElement("span");
  btnExpand.appendChild(createSVG(svg_paths.gearIconPaths));
  btnExpand.className = "bg-expand-btn btn";
  btnExpand.title = i18n.t("settings.backgroundImage.toggle");

  bgUrlControl.appendChild(urlInput);
  bgUrlControl.appendChild(btnExpand);
  bgUrlWrapper.appendChild(bgUrlLabel);
  bgUrlWrapper.appendChild(bgUrlControl);

  // Delete button
  const btnDeleteBg = document.createElement("span");
  btnDeleteBg.appendChild(createSVG(svg_paths.crossIconPaths));
  btnDeleteBg.className = "bg-delete-btn btn";
  btnDeleteBg.title = i18n.t("settings.backgroundImage.remove");
  btnDeleteBg.classList.toggle("disabled", !bgSettings.image);

  bgUrlWrapper.appendChild(btnDeleteBg);
  container.appendChild(bgUrlWrapper);

  // Expandable section
  const bgExpandableSection = document.createElement("div");
  bgExpandableSection.className = "bg expandable-section hidden";

  const {
    wrap: blurWrap,
    slider: blurSlider,
    display: blurDisplay,
  } = createSliderSection(i18n.t("settings.backgroundImage.blur"), 0, 40, 1, bgSettings.blur, "px", async (v) => {
    bgSettings.blur = v;
    await saveBgSettings();
  });

  const {
    wrap: brightnessWrap,
    slider: brightnessSlider,
    display: brightnessDisplay,
  } = createSliderSection(i18n.t("settings.backgroundImage.brightness"), 0, 200, 1, bgSettings.brightness, "%", async (v) => {
    bgSettings.brightness = v;
    await saveBgSettings();
  });

  const {
    wrap: saturationWrap,
    slider: saturationSlider,
    display: saturationDisplay,
  } = createSliderSection(i18n.t("settings.backgroundImage.saturation"), 0, 200, 1, bgSettings.saturation, "%", async (v) => {
    bgSettings.saturation = v;
    await saveBgSettings();
  });

  const { wrap: posXWrap } = createSliderSection(i18n.t("settings.backgroundImage.positionX"), 0, 100, 1, bgSettings.positionX ?? 50, "%", async (v) => {
    bgSettings.positionX = v;
    await saveBgSettings();
  });

  bgExpandableSection.append(blurWrap, brightnessWrap, saturationWrap, posXWrap);
  bgUrlWrapper.appendChild(bgExpandableSection);

  // Event listeners
  urlInput.addEventListener(
    "input",
    debounce(async () => {
      const url = urlInput.value.trim();
      bgSettings.image = url || null;
      btnDeleteBg.classList.toggle("disabled", !url);
      await saveBgSettings();
      applyBackgroundSettings();
    }, 500),
  );

  btnDeleteBg.addEventListener("click", async () => {
    bgSettings = { image: null, blur: 0, brightness: 100, saturation: 100, positionX: 50 };
    await saveBgSettings();

    urlInput.value = "";
    btnDeleteBg.classList.add("disabled");

    blurSlider.value = 0;
    blurDisplay.textContent = "0px";
    brightnessSlider.value = 100;
    brightnessDisplay.textContent = "100%";
    saturationSlider.value = 100;
    saturationDisplay.textContent = "100%";
  });

  btnExpand.addEventListener("click", (e) => {
    e.stopPropagation();
    bgExpandableSection.classList.toggle("hidden");
    btnExpand.classList.toggle("expanded");
    closeColorsModal();
  });
}
