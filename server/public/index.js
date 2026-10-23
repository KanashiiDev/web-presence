import { AppState } from "./core/state.js";
import { handleCollapsible } from "./utils.js";
import { simpleBars } from "./core/dom.js";
import { initTheme, handleThemeToggle } from "./components/theme/theme.js";
import { initSettingsUI } from "./components/settings/settings.js";
import { initializeHistory } from "./components/history/history.js";
import { initializeLogs } from "./components/logs/logs.js";
import { initDashboard } from "./components/dashboard/dashboard.js";
import { initactivityCard } from "./components/activityCard/activityCard.js";
import { FetchManager } from "./core/fetchManager.js";
import { ChartRenderer } from "./components/chart/chartRenderer.js";
import { initVisibilityRefresh } from "./utils.js";

// EVENT DELEGATION
function initEventListeners() {
  if (AppState.isInitialized) return;

  document.addEventListener("click", (e) => {
    const header = e.target.closest("h2.collapsible");
    if (header && !["SELECT", "INPUT", "OPTION"].includes(e.target.tagName)) {
      handleCollapsible(header, AppState, simpleBars);
      return;
    }

    if (e.target.closest("#toggleContainer")) {
      handleThemeToggle();
      return;
    }
  });

  AppState.isInitialized = true;
}

// LIFECYCLE CONTROLS
export function startAutoUpdate() {
  stopAutoUpdate();
  FetchManager.startAll();
}

export function stopAutoUpdate() {
  FetchManager.stopAll();
}

window.onload = async () => {
  await i18n.load("server");
  applyTranslations();
  applyTsPlugins();
  initTheme();
  initEventListeners();
  initVisibilityRefresh();
  initSettingsUI();
  await initDashboard();
  initactivityCard();
  await Promise.allSettled([initializeHistory("listen").catch(console.error), initializeHistory("watch").catch(console.error), initializeLogs().catch(console.error)]);

  await ChartRenderer.listen.init();
  await ChartRenderer.watch.init();
  await applyTranslations();
  startAutoUpdate();
};
