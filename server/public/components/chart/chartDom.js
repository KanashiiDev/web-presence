// mode: "listen" | "watch"
export function renderChartContainer(containerId, mode = "listen") {
  const section = document.getElementById(containerId);
  if (!section) return;

  while (section.firstChild) section.removeChild(section.firstChild);

  const isWatch = mode === "watch";
  const p = isWatch ? "watch_" : "";

  const heading = document.createElement("h2");
  heading.id = `${p}chartHeader`;
  heading.dataset.i18n = isWatch ? "chart.title.watch" : "chart.title";
  heading.textContent = isWatch ? i18n.t("chart.title.watch") : i18n.t("chart.title");

  const controls = document.createElement("div");
  controls.className = "chart-controls";
  controls.appendChild(_buildRangeToggle(p, isWatch));
  controls.appendChild(_buildPeriodNav(p));
  controls.appendChild(_buildModeToggle(p, isWatch));

  const container = document.createElement("div");
  container.className = "chart-container";
  container.appendChild(controls);
  container.appendChild(_buildCanvasWrap(p));
  container.appendChild(_buildDetails(p));

  section.appendChild(heading);
  section.appendChild(container);
}

function _buildRangeToggle(p) {
  const group = document.createElement("div");
  group.id = `${p}chartRangeToggle`;
  group.className = "btn-group";
  group.setAttribute("role", "group");

  const ranges = [
    { range: "week", label: "Week" },
    { range: "month", label: "Month", active: true },
    { range: "year", label: "Year" },
    { range: "alltime", label: "All Time", summaryOnly: true },
  ];

  for (const { range, label, active, summaryOnly } of ranges) {
    const btn = document.createElement("button");
    btn.className = active ? "chart-range-btn active" : "chart-range-btn";
    btn.dataset.range = range;
    btn.type = "button";
    btn.dataset.i18n = `chart.range.${range}`;
    btn.textContent = label;
    if (summaryOnly) {
      btn.dataset.summaryOnly = "true";
      btn.style.display = "none";
    }
    group.appendChild(btn);
  }

  return group;
}

function _buildPeriodNav(p) {
  const nav = document.createElement("div");
  nav.className = `chart-period-nav`;
  nav.id = `${p}chartPeriodNav`;

  const prev = document.createElement("button");
  prev.id = `${p}chartPeriodPrev`;
  prev.className = "chart-period-nav-btn";

  const label = document.createElement("span");
  label.id = `${p}chartPeriodLabel`;
  label.className = "chart-period-nav-label";

  const next = document.createElement("button");
  next.id = `${p}chartPeriodNext`;
  next.className = "chart-period-nav-btn";

  nav.append(prev, label, next);
  return nav;
}

function _buildModeToggle(p, isWatch) {
  const group = document.createElement("div");
  group.id = `${p}chartModeToggle`;
  group.className = "btn-group";
  group.setAttribute("role", "group");

  const summaryBtn = document.createElement("button");
  summaryBtn.id = `${p}chartSummaryToggle`;
  summaryBtn.className = "chart-mode-btn";
  summaryBtn.dataset.mode = "summary";
  summaryBtn.type = "button";
  summaryBtn.dataset.i18n = "chart.tab.summary";
  summaryBtn.textContent = "Summary";
  summaryBtn.style.visibility = isWatch ? "hidden" : "";
  group.appendChild(summaryBtn);

  const minutesBtn = document.createElement("button");
  minutesBtn.className = "chart-mode-btn active";
  minutesBtn.dataset.mode = !isWatch ? "minutes" : "minutes_watch";
  minutesBtn.type = "button";
  minutesBtn.dataset.i18n = "chart.tab.time";
  minutesBtn.textContent = "Time";
  group.appendChild(minutesBtn);

  const activitiesBtn = document.createElement("button");
  activitiesBtn.className = "chart-mode-btn";
  activitiesBtn.dataset.mode = !isWatch ? "songs" : "videos";
  activitiesBtn.type = "button";
  activitiesBtn.dataset.i18n = !isWatch ? "chart.tab.songs" : "chart.tab.videos";
  activitiesBtn.textContent = !isWatch ? "Songs" : "Videos";
  group.appendChild(activitiesBtn);

  return group;
}

function _buildCanvasWrap(p) {
  const wrap = document.createElement("div");
  wrap.className = "chart-canvas-wrap";

  const loading = document.createElement("div");
  loading.id = `${p}historyChartLoading`;
  loading.className = `chart-data-status`;
  loading.dataset.i18n = "chart.loading";
  loading.textContent = "Loading stats...";

  const canvas = document.createElement("canvas");
  canvas.id = `${p}listeningWaveform`;
  canvas.setAttribute("role", "img");

  wrap.append(loading, canvas);
  return wrap;
}

function _buildDetails(p) {
  const details = document.createElement("div");
  details.id = `${p}chartDetails`;
  details.className = "chart-details hidden";

  const header = document.createElement("div");
  header.className = "chart-details-header";

  const title = document.createElement("span");
  title.id = `${p}chartDetailsTitle`;
  title.className = "chart-details-date";

  const total = document.createElement("span");
  total.id = `${p}chartDetailsTotal`;
  total.className = "chart-details-total";

  header.append(title, total);

  const platforms = document.createElement("div");
  platforms.id = `${p}chartDetailsPlatforms`;
  platforms.className = "chart-details-platforms";

  details.append(header, platforms);
  return details;
}
