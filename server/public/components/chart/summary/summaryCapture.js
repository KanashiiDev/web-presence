import { createSVG } from "../../../utils.js";

export const CAPTURE_PRESETS = [
  { id: "summary-small", label: "Small", i18n: "chart.capture.small", width: 1080, widthVertical: 560, maxLengthWide: 56, maxLengthTall: 57 },
  { id: "summary-medium", label: "Medium", i18n: "chart.capture.medium", width: 1200, widthVertical: 620, maxLengthWide: 68, maxLengthTall: 68 },
  { id: "summary-large", label: "Large", i18n: "chart.capture.large", width: 1320, widthVertical: 680, maxLengthWide: 78, maxLengthTall: 79 },
  { id: "summary-wide", label: "Wide", i18n: "chart.capture.wide", width: 1400, widthVertical: 740, maxLengthWide: 84, maxLengthTall: 90 },
];

let _visible = false;
let _onCapture = null;
let _onRowCountChange = null;
let _outsideListenerActive = false;

// Proxy token - fetched once from /proxy-token and cached for the session.
// If the server restarts, the token changes; on a 403 we re-fetch and retry.
let _proxyToken = null;
let _proxyTokenPromise = null;

async function getProxyToken() {
  if (_proxyToken) return _proxyToken;
  if (_proxyTokenPromise) return _proxyTokenPromise;
  _proxyTokenPromise = fetch("/proxy-token")
    .then((res) => {
      if (!res.ok) throw new Error("Failed to fetch proxy token");
      return res.json();
    })
    .then((data) => {
      _proxyToken = data.token;
      return _proxyToken;
    });
  try {
    return await _proxyTokenPromise;
  } finally {
    _proxyTokenPromise = null;
  }
}

function _buildCaptureOptions(token, activeWidth, layout, preset, panelElement) {
  return {
    backgroundColor: null,
    width: activeWidth,
    scale: 1,
    useCORS: false,
    logging: false,
    proxy: `${location.origin}/proxy/${token}`,

    ignoreElements: (e) => e.classList.contains("summary-capture") || e.classList.contains("summary-back-btn") || e.id === "captureMenu",

    onclone: (doc) => {
      const clonedPanel = doc.getElementById(panelElement.id);
      if (!clonedPanel) return;

      clonedPanel.querySelector(".summary-two-column-layout")?.style.setProperty("display", layout === "tall" ? "block" : "");
      clonedPanel.querySelector(".summary-two-column-layout")?.classList.toggle("capture-grid", layout === "wide");

      const maxLength = layout === "tall" ? preset.maxLengthTall : preset.maxLengthWide;
      for (const el of clonedPanel.querySelectorAll(".summary-title")) {
        const text = el.textContent?.trim() ?? "";
        if (text.length > maxLength) {
          el.textContent = text.slice(0, maxLength) + "…";
        }
      }

      const wrapper = doc.createElement("div");
      wrapper.style.width = activeWidth + "px";
      clonedPanel.parentNode.insertBefore(wrapper, clonedPanel);
      wrapper.appendChild(clonedPanel);
    },
  };
}

export function initCaptureMenu({ onCapture, onRowCountChange } = {}) {
  _onCapture = onCapture ?? null;
  _onRowCountChange = onRowCountChange ?? null;
}

export function isCaptureMenuVisible() {
  return _visible;
}

export function toggleCaptureMenu(anchorEl, chartState) {
  _visible ? closeCaptureMenu(chartState) : openCaptureMenu(anchorEl, chartState);
}

export function openCaptureMenu(anchorEl, chartState) {
  _visible = true;
  _buildMenu(anchorEl, chartState);
}

export function closeCaptureMenu(chartState) {
  _visible = false;
  document.getElementById("captureMenu")?.remove();
  if (_outsideListenerActive) {
    document.removeEventListener("pointerdown", _onOutsidePointer, true);
    _outsideListenerActive = false;
  }
  _applyLayoutPreview();
  // Always reset row count to 5 when menu closes
  if (chartState && chartState.summaryRowCount !== 5) {
    chartState.summaryRowCount = 5;
    _onRowCountChange?.(5);
  }
}
// Private
function _applyLayoutPreview(layout) {
  const twoCol = document.querySelector(".summary-two-column-layout");
  if (twoCol) {
    twoCol.style.display = layout === "tall" ? "block" : "";
    twoCol.classList.toggle("capture-grid", layout === "wide");
  }
}

function _onOutsidePointer(e) {
  const menu = document.getElementById("captureMenu");
  if (!menu || menu.contains(e.target) || e.target.closest(".summary-capture")) return;
  closeCaptureMenu();
}

function _getActiveWidth(preset, layout) {
  return layout === "tall" ? (preset.widthVertical ?? preset.width) : preset.width;
}

function _buildMenu(anchorEl, chartState) {
  document.getElementById("captureMenu")?.remove();

  const menu = document.createElement("div");
  menu.id = "captureMenu";
  menu.className = "capture-menu";

  // Layout section
  let selectedLayout = "wide";
  const LAYOUT_OPTIONS = [
    {
      id: "wide",
      label: i18n.t("chart.capture.wide"),
      svgPaths: ["M1 3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3Z", "M15 3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V3Z"],
      svgOptions: { width: 28, height: 22, viewBox: "0 0 26 22", strokeWidth: 1.5 },
    },
    {
      id: "tall",
      label: i18n.t("chart.capture.tall"),
      svgPaths: ["M1 3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3Z", "M1 17a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-6Z"],
      svgOptions: { width: 22, height: 28, viewBox: "0 0 22 28", strokeWidth: 1.5 },
    },
  ];

  const layoutSection = _makeSection(i18n.t("chart.capture.title"));
  const layoutRow = document.createElement("div");
  layoutRow.className = "capture-menu-layout-row";

  for (const option of LAYOUT_OPTIONS) {
    const btn = document.createElement("button");
    btn.className = "capture-layout-btn" + (option.id === selectedLayout ? " active" : "");
    btn.dataset.layout = option.id;

    const label = document.createElement("span");
    label.textContent = option.label;

    btn.appendChild(createSVG(option.svgPaths, option.svgOptions));
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      if (selectedLayout === option.id) return;
      selectedLayout = option.id;
      layoutRow.querySelector(".capture-layout-btn.active")?.classList.remove("active");
      btn.classList.add("active");
      _applyLayoutPreview(option.id);

      for (const preset of CAPTURE_PRESETS) {
        const dimsEl = presetList.querySelector(`[data-preset="${preset.id}"] .capture-preset-dims`);
        if (dimsEl) dimsEl.textContent = `${_getActiveWidth(preset, selectedLayout)} × ${i18n.t("chart.capture.auto")}`;
      }
    });

    layoutRow.appendChild(btn);
  }

  layoutSection.appendChild(layoutRow);

  // Rows section
  let selectedRows = chartState?.summaryRowCount ?? 5;

  const rowsSection = _makeSection(i18n.t("chart.capture.rows") || "Rows");
  const rowsBtnGroup = document.createElement("div");
  rowsBtnGroup.className = "capture-rows-group";

  for (let n = 1; n <= 5; n++) {
    const btn = document.createElement("button");
    btn.className = "capture-rows-btn" + (n === selectedRows ? " active" : "");
    btn.type = "button";
    btn.dataset.rows = String(n);
    btn.textContent = String(n);

    btn.addEventListener("click", () => {
      if (selectedRows === n) return;
      selectedRows = n;
      rowsBtnGroup.querySelector(".capture-rows-btn.active")?.classList.remove("active");
      btn.classList.add("active");
      if (chartState) chartState.summaryRowCount = n;
      _onRowCountChange?.(n);
    });

    rowsBtnGroup.appendChild(btn);
  }

  rowsSection.appendChild(rowsBtnGroup);

  // Resolution section
  let selectedPreset = CAPTURE_PRESETS[0].id;

  const resSection = _makeSection(i18n.t("chart.capture.resolution"));
  const presetList = document.createElement("div");
  presetList.className = "capture-preset-list";

  for (const preset of CAPTURE_PRESETS) {
    const item = document.createElement("button");
    item.className = "capture-preset-item" + (preset.id === selectedPreset ? " active" : "");
    item.dataset.preset = preset.id;

    const name = document.createElement("span");
    name.className = "capture-preset-name";
    name.textContent = preset.label;
    name.dataset.i18n = preset.i18n;

    const dims = document.createElement("span");
    dims.className = "capture-preset-dims";
    dims.textContent = `${preset.width} × ${i18n.t("chart.capture.auto")}`;

    item.append(name, dims);

    item.addEventListener("click", () => {
      if (selectedPreset === preset.id) return;
      selectedPreset = preset.id;
      presetList.querySelector(".capture-preset-item.active")?.classList.remove("active");
      item.classList.add("active");
    });

    presetList.appendChild(item);
  }

  resSection.appendChild(presetList);

  // Footer & Save button
  const footer = document.createElement("div");
  footer.className = "capture-menu-footer";

  const saveBtn = document.createElement("button");
  saveBtn.className = "capture-menu-action-btn";
  saveBtn.textContent = i18n.t("common.save");
  saveBtn.addEventListener("click", () => {
    const preset = CAPTURE_PRESETS.find((p) => p.id === selectedPreset) ?? CAPTURE_PRESETS[0];
    const panel = anchorEl.closest(".summary-panel");
    if (_onCapture) {
      _onCapture({ layout: selectedLayout, preset });
    } else if (panel) {
      captureSummaryPanel(panel, { layout: selectedLayout, preset });
    }
    closeCaptureMenu(chartState);
  });

  footer.appendChild(saveBtn);
  menu.append(layoutSection, rowsSection, resSection, footer);
  anchorEl.appendChild(menu);

  requestAnimationFrame(() => {
    if (!_visible) return;
    document.addEventListener("pointerdown", _onOutsidePointer, true);
    _outsideListenerActive = true;
    _applyLayoutPreview("wide");
    if (typeof applyTranslations === "function") applyTranslations();
  });
}

function _makeSection(title) {
  const section = document.createElement("div");
  section.className = "capture-menu-section";

  const heading = document.createElement("div");
  heading.className = "capture-menu-section-title";
  heading.textContent = title;
  section.appendChild(heading);

  return section;
}

export async function captureSummaryPanel(panelElement, { layout = "wide", preset = CAPTURE_PRESETS[0] } = {}) {
  if (!panelElement) return;

  try {
    const activeWidth = _getActiveWidth(preset, layout);
    const token = await getProxyToken();

    let canvas;
    try {
      canvas = await html2canvas(panelElement, _buildCaptureOptions(token, activeWidth, layout, preset, panelElement));
    } catch (err) {
      const errStr = err?.message ?? String(err);
      if (/403|forbidden|proxy/i.test(errStr)) {
        _proxyToken = null;
        const newToken = await getProxyToken();
        canvas = await html2canvas(panelElement, _buildCaptureOptions(newToken, activeWidth, layout, preset, panelElement));
      } else {
        throw err;
      }
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `web-presence-music-summary-${preset.id}.png`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Capture failed:", err);
  }
}
