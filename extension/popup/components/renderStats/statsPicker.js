const flatpickrInstances = { start: null, end: null };
function clearFlatpickr() {
  flatpickrInstances.start?.clear();
  flatpickrInstances.end?.clear();
}

const handleApplyCustomRange = async () => {
  if (!statsModule.currentCustomStart) return showAlert(i18n.t("stats.alert.emptyDate") || "Unknown error", "", "warn");
  statsModule.currentCustomEnd ??= Date.now();

  const container = document.getElementById("statsEntries");
  container.replaceChildren();
  const spinner = createSpinner();
  container.appendChild(spinner);

  await renderTopStats(historyState.fullHistory, "custom", 5, statsModule.currentCustomStart, statsModule.currentCustomEnd);

  spinner.remove();
  await activateSimpleBar("historyStatsPanel");
};

const handleClearCustomRange = async () => {
  const datePicker = document.querySelector(".date-range-picker");

  clearFlatpickr();
  statsModule.currentCustomStart = null;
  statsModule.currentCustomEnd = null;
  datePicker.style.display = "none";
  await activateSimpleBar("historyStatsPanel");
};
