import { HC_RANGES } from "../chart.js";
import { createSVG, svg_paths } from "../../../utils.js";
import { buildSummaryData } from "./summaryData.js";
import { buildMinutesView, buildRankedList, buildArtistDrillDown } from "./summaryBuilder.js";
import { captureSummaryPanel, initCaptureMenu, toggleCaptureMenu, closeCaptureMenu } from "./summaryCapture.js";

export function createSummaryController(p = "", historyMode = "listen", chartState, parentRenderer) {
  let _visible = false;
  let _renderAc = null;

  function _id(name) {
    return p ? `${p}${name}` : name;
  }

  const containerId = historyMode === "watch" ? "watchChartContainer" : "listenChartContainer";
  const CHART_SELECTORS = [`#${_id("listeningWaveform")}`, `#${_id("historyChartLoading")}`, `#${_id("chartDetails")}`, `#${containerId} .chart-canvas-wrap`];

  function hideChartElements() {
    for (const sel of CHART_SELECTORS) {
      const node = document.querySelector(sel);
      if (!node) continue;
      node.dataset.summaryDisplay ??= node.style.display || "";
      node.style.maxHeight = "0px";
    }
  }

  function showChartElements() {
    for (const sel of CHART_SELECTORS) {
      const node = document.querySelector(sel);
      if (!node) continue;
      node.style.display = node.dataset.summaryDisplay ?? "";
      delete node.dataset.summaryDisplay;
      node.style.maxHeight = "";
    }
  }

  function renderPanel(range) {
    const panel = document.getElementById(_id("chartSummaryPanel"));
    if (!panel) return;

    const data = buildSummaryData(range, chartState, historyMode);

    const content = panel.querySelector(".summary-content");
    if (!content) return;

    content.replaceChildren();
    _renderAc?.abort();
    _renderAc = new AbortController();
    const { signal } = _renderAc;

    content.addEventListener(
      "summary:artistClick",
      (e) => {
        buildArtistDrillDown(e.detail.artist, data, panel);
      },
      { signal },
    );

    panel.addEventListener("summary:back", () => renderPanel(chartState.range), { signal });

    const periodLabel = panel.querySelector(".summary-period-label");
    if (periodLabel) periodLabel.textContent = HC_RANGES[range].getLabel(chartState.offset);

    const layout = document.createElement("div");
    layout.className = "summary-two-column-layout";

    const leftCol = document.createElement("div");
    leftCol.className = "summary-column summary-column-left";
    const lHeader = document.createElement("div");
    lHeader.className = "summary-column-header";
    lHeader.textContent = "Top Songs";
    lHeader.dataset.i18n = "chart.summary.topSongs";

    leftCol.append(lHeader, buildRankedList(data.topSongs, "songs"));

    const rightCol = document.createElement("div");
    rightCol.className = "summary-column summary-column-right";
    const rHeader = document.createElement("div");
    rHeader.className = "summary-column-header";
    rHeader.textContent = "Top Artists";
    rHeader.dataset.i18n = "common.topArtists";
    rightCol.append(rHeader, buildRankedList(data.topArtists, "artists"));

    layout.append(leftCol, rightCol);

    const bottomCenter = document.createElement("div");
    bottomCenter.className = "summary-bottom-center";
    bottomCenter.appendChild(buildMinutesView(data));

    content.append(layout, bottomCenter);
    if (typeof applyTranslations === "function") applyTranslations();
  }

  function createPanel() {
    const existing = document.getElementById(_id("chartSummaryPanel"));
    if (existing) return existing;

    const panel = document.createElement("div");
    panel.className = "summary-panel";
    panel.id = _id("chartSummaryPanel");

    const header = document.createElement("div");
    header.className = "summary-header";

    const periodLabel = document.createElement("span");
    periodLabel.className = "summary-period-label";

    const captureBtn = document.createElement("span");
    captureBtn.className = "summary-capture";

    const captureBtnIcon = document.createElement("span");
    captureBtnIcon.className = "summary-capture-icon";

    captureBtnIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCaptureMenu(captureBtn, chartState);
    });

    captureBtnIcon.appendChild(createSVG(svg_paths.camera));
    captureBtn.appendChild(captureBtnIcon);

    header.append(periodLabel, captureBtn);

    const content = document.createElement("div");
    content.className = "summary-content";

    panel.append(header, content);

    initCaptureMenu({
      onCapture: async ({ layout, preset }) => {
        panel.classList.add("disable-motion");
        captureBtnIcon.classList.add("spinner");
        await captureSummaryPanel(panel, { layout, preset });
        panel.classList.remove("disable-motion");
        captureBtnIcon.classList.remove("spinner");
      },
      onRowCountChange: () => renderPanel(chartState.range),
    });

    return panel;
  }

  function showSummary() {
    const panel = createPanel();
    const container = document.getElementById(containerId) || document.querySelector(".container");

    if (!panel.parentElement) {
      const canvas = document.getElementById(_id("listeningWaveform"));
      const canvasParent = canvas?.closest(".chart-canvas-wrap") ?? canvas?.parentElement;
      const target = canvasParent ?? document.querySelector(`#${_id("chartDetails")}`)?.parentElement;

      if (target) target.insertAdjacentElement("beforebegin", panel);
      else container.appendChild(panel);
    }

    hideChartElements();
    parentRenderer.showSummaryRangeBtn();
    _visible = true;
    requestAnimationFrame(() => {
      panel.classList.add("summary-panel--open");
      container?.classList.add("chart-summary-open");
    });

    renderPanel(chartState.range);
  }

  function hideSummary() {
    const panel = document.getElementById(_id("chartSummaryPanel"));
    const container = document.getElementById(containerId) || document.querySelector(".container");
    if (!panel) return;

    _visible = false;
    panel.classList.remove("summary-panel--open");
    container?.classList.remove("chart-summary-open");
    showChartElements();
    parentRenderer.hideSummaryRangeBtn();
    closeCaptureMenu(chartState);

    _renderAc?.abort();
    _renderAc = null;

    panel.addEventListener(
      "transitionend",
      () => {
        if (!_visible) panel.remove();
      },
      { once: true },
    );

    document.querySelector(`#${_id("chartSummaryToggle")}`)?.classList.remove("active");
  }

  return {
    showSummary,
    hideSummary,
    toggleSummary: () => (_visible ? hideSummary() : showSummary()),
    syncSummary: () => {
      if (_visible) renderPanel(chartState.range);
    },
    isSummaryVisible: () => _visible,
    showSummaryRangeBtn: () => parentRenderer.showSummaryRangeBtn(),
    hideSummaryRangeBtn: () => parentRenderer.hideSummaryRangeBtn(),
  };
}
