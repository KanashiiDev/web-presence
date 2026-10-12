let statsTomSelect = null;

const statsOptions = [
  { value: "day", label: "Today", i18n: "stats.today" },
  { value: "yesterday", label: "Yesterday", i18n: "stats.yesterday" },
  { value: "week", label: "This Week", i18n: "stats.week" },
  { value: "month", label: "This Month", i18n: "stats.month" },
  { value: "year", label: "This Year", i18n: "stats.year" },
  { value: "all", label: "All Time", i18n: "stats.all" },
  { value: "custom", label: "Custom", i18n: "stats.custom" },
];

function initStatsDropdown() {
  const historyPanel = document.getElementById("historyStatsPanel");
  const datePicker = document.querySelector(".date-range-picker");
  const select = document.getElementById("dropdownToggle");
  select.replaceChildren();

  statsOptions.forEach(({ value, label, i18n }) => {
    const option = document.createElement("option");

    option.value = value;
    option.textContent = label;

    option.dataset.i18n = i18n;

    select.appendChild(option);
  });

  applyTranslations();

  if (statsTomSelect) {
    statsTomSelect.destroy();
    statsTomSelect = null;
  }

  if (select._statsChangeListener) {
    select.removeEventListener("change", select._statsChangeListener);
    select._statsChangeListener = null;
  }

  statsTomSelect = new TomSelect(select, {
    controlInput: null,
    sortField: false,
  });

  select._statsChangeListener = async (e) => {
    const range = e.target.value;

    historyPanel.classList.remove("custom");
    datePicker.style.display = "none";
    statsModule.currentCustomStart = null;
    statsModule.currentCustomEnd = null;

    if (range === "custom") {
      datePicker.style.display = "block";
      await activateSimpleBar("historyStatsPanel");
      return;
    }

    const container = document.getElementById("statsEntries");
    container.replaceChildren();
    const spinner = createSpinner();
    container.appendChild(spinner);

    await renderTopStats(historyState.fullHistory, range);
    spinner.remove();

    clearFlatpickr();
    await activateSimpleBar("historyStatsPanel");
  };

  select.addEventListener("change", select._statsChangeListener);
}

function resetStatsDropdown() {
  if (statsTomSelect) {
    statsTomSelect.setValue("day");
  }
}
