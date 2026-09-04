async function buildThemeMotion(container) {
  // Theme
  const { theme: savedTheme } = await browser.storage.local.get("theme");
  let themeConfig = savedTheme ?? "dark";

  const themeOptions = [
    { value: "dark", text: i18n.t("settings.theme.dark") },
    { value: "light", text: i18n.t("settings.theme.light") },
  ];

  const themeWrap = createSelectRow(
    i18n.t("settings.theme"),
    "theme-wrapper",
    themeOptions,
    themeConfig,
    debounce(async (e) => {
      themeConfig = e.target.value;

      await browser.storage.local.set({ theme: themeConfig });

      document.documentElement.setAttribute("data-theme", themeConfig);
      document.body.setAttribute("data-theme", themeConfig);
      document.body.style = "";

      await browser.storage.local.remove("colorSettings");
      await applyColorSettings();
      await applyBackgroundSettings();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await updateAllSwatchesForTheme();
    }, 300),
  );

  container.appendChild(themeWrap);

  // Motion
  const motionStorage = await browser.storage.local.get(motionKey);
  const motionConfig = motionStorage[motionKey] ?? "always";

  const motionOptions = [
    { value: "system", text: i18n.t("common.system") },
    { value: "always", text: i18n.t("common.enable") },
    { value: "never", text: i18n.t("common.disable") },
  ];

  const motionWrap = createSelectRow(i18n.t("settings.animations"), "motion-wrapper", motionOptions, motionConfig, async (e) => {
    await setMotionPreference(e.target.value);
  });

  container.appendChild(motionWrap);

  // Normalization
  const { normalization: normalizationValue } = await browser.storage.local.get("normalization");
  let normalizationConfig = normalizationValue ?? "cleanTitle";

  const normalizationOptions = [
    { value: "enable", text: i18n.t("common.enable") },
    { value: "cleanTitle", text: i18n.t("settings.normalization.cleanTitle") },
    { value: "stripDashPrefix", text: i18n.t("settings.normalization.stripDashPrefix") },
    { value: "disable", text: i18n.t("common.disable") },
  ];

  const normalizationWrap = createSelectRow(
    i18n.t("settings.normalization"),
    "normalization-wrapper",
    normalizationOptions,
    normalizationConfig,
    debounce(async (e) => {
      normalizationConfig = e.target.value;
      await browser.storage.local.set({ normalization: normalizationConfig });
    }, 300),
  );

  const normalizationTip = document.createElement("span");
  normalizationTip.className = "settings-option-tip";
  normalizationTip.textContent = "i";

  normalizationTip.addEventListener("click", async () => {
    const t1 = `<b>${i18n.t("common.enable")}</b>\n${i18n.t("settings.normalization.tip.enable")}`;
    const t2 = `<b>${i18n.t("settings.normalization.cleanTitle")}</b>\n${i18n.t("settings.normalization.tip.cleanTitle")}`;
    const t3 = `<b>${i18n.t("settings.normalization.stripDashPrefix")}</b>\n${i18n.t("settings.normalization.tip.stripDashPrefix")}`;
    const t4 = `<b>${i18n.t("common.disable")}</b>\n${i18n.t("settings.normalization.tip.disable")}`;
    await showAlert(i18n.t("settings.normalization"), `${t1}\n\n${t2}\n\n${t3}\n\n${t4}`, "tip");
  });

  normalizationWrap.querySelector("label").appendChild(normalizationTip);
  container.appendChild(normalizationWrap);
}
