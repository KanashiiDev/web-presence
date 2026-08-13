function applySectionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const sectionParam = params.get("section");

  const sections = document.querySelectorAll("[data-section]");
  const activeSection = document.querySelector(`[data-section="${sectionParam}"]`);

  // Update section visibility
  sections.forEach((el) => {
    el.style.display = el === activeSection ? "" : "none";
  });

  if (!activeSection) return null;

  // Title and description updates
  const sectionKey = activeSection.getAttribute("data-section");
  const mainTitle = "Web Presence";
  const sectionTitle = i18n.t(`settings.${sectionKey}.title`);
  const fullTitle = `${mainTitle} - ${sectionTitle}`;

  document.querySelector(".header h3").textContent = fullTitle;
  document.title = fullTitle;
  document.querySelector(".header-desc").textContent = i18n.t(`settings.${sectionKey}.desc`);

  return sectionKey;
}

function startSettings() {
  // General launches
  applyTranslations();
  initMotionPreference();
  initApplyAttrs();
  initStorageListener();

  // Apply the active section and run the modules
  const currentSection = applySectionFromUrl();
  if (currentSection === "filter") {
    initFilter();
    initHistoryModal();
  }
  if (currentSection === "debug") initDebug();
  if (currentSection === "backup") initBackupButtons();
}

window.addEventListener("load", async () => {
  await i18n.load("extension");
  startSettings();
});
