// Create SVG
const svgCache = new Map();
function createSVG(paths, options = {}) {
  // SVG cache
  const key = paths.join("");
  if (svgCache.has(key)) return svgCache.get(key).cloneNode(true);

  const { width = 16, height = 16, stroke = "var(--icon-color)", strokeWidth = 2, fill = "none", viewBox = "-1 -1 25.5 25.5" } = options;
  const cacheKey = `${paths.join("|")}|${width}|${height}|${stroke}|${strokeWidth}|${fill}|${viewBox}`;

  if (svgCache.has(cacheKey)) {
    return svgCache.get(cacheKey).cloneNode(true);
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("fill", fill);
  svg.setAttribute("stroke", stroke);
  svg.setAttribute("stroke-width", strokeWidth);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

    if (typeof d === "string") {
      path.setAttribute("d", d);
    } else {
      path.setAttribute("d", d.d);

      if (d.fill) path.setAttribute("fill", d.fill);
      if (d.stroke) path.setAttribute("stroke", d.stroke);
    }

    svg.appendChild(path);
  }

  if (svgCache.size < 50) {
    svgCache.set(cacheKey, svg.cloneNode(true));
  }

  return svg;
}

// Generic element creation helper
function createEl(tag, options = {}) {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.textContent) el.textContent = options.textContent;
  if (options.html) el.innerHTML = options.html;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value != null) el.setAttribute(key, value);
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      el.dataset[key] = value;
    }
  }
  if (options.style) {
    Object.assign(el.style, options.style);
  }
  if (options.hidden) el.hidden = true;
  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      el.addEventListener(event, handler);
    }
  }
  if (options.appendTo) {
    options.appendTo.appendChild(el);
  }
  return el;
}

// Create an SVG icon from svg_paths key
function iconSVG(key, size = 14) {
  return createSVG(svg_paths[key], { width: size, height: size });
}

// Clear all children from an element
function clearChildren(el) {
  if (!el) return;
  el.replaceChildren();
}

// Split a comma-separated string into trimmed non-empty values
function splitAndTrim(str = "") {
  return str
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Download a Blob as a file
function downloadBlob(content, fileName, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// Create a spinner element
function createSpinner(extraClass = "", tag = "div") {
  return Object.assign(document.createElement(tag), { className: `spinner${extraClass ? " " + extraClass : ""}` });
}

// Create an icon button
function createIconButton(svgPaths, options = {}) {
  const btn = document.createElement("button");
  btn.className = options.className || "";
  if (options.title) btn.title = options.title;
  if (options.id) btn.id = options.id;
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      btn.dataset[key] = value;
    }
  }
  if (options.type) btn.type = options.type;
  if (options.disabled) btn.disabled = options.disabled;
  if (options.addEventListener) {
    for (const [event, handler] of Object.entries(options.addEventListener)) {
      btn.addEventListener(event, handler);
    }
  }
  const svgOptions = options.svgOptions || {};
  btn.appendChild(createSVG(svgPaths, svgOptions));
  return btn;
}

// Create a badge element
function createBadge(text, variantClass = "") {
  const badge = document.createElement("span");
  badge.className = `badge${variantClass ? " " + variantClass : ""}`;
  badge.textContent = text;
  return badge;
}

// Open an extension page (reuses existing tab or creates new)
async function openExtensionPage(relativePath, options = {}) {
  const { closePopup = true, storage = null, reload = true, query = null } = options;
  let url = browser.runtime.getURL(relativePath);
  if (query) {
    url += "?" + new URLSearchParams(query).toString();
  }

  if (storage) {
    await browser.storage.local.set(storage);
  }

  try {
    const tabs = await browser.tabs.query({ url });
    if (tabs.length > 0 && tabs[0].id) {
      if (reload) {
        await browser.tabs.reload(tabs[0].id);
      }
      await browser.tabs.update(tabs[0].id, { active: true });
      await browser.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
      if (closePopup && typeof window.close === "function") window.close();
      return tabs[0];
    }

    await browser.tabs.create({ url });
    if (closePopup && typeof window.close === "function") window.close();
  } catch (err) {
    logError(`[openExtensionPage]: Failed to open ${relativePath}:`, err);
  }
}

// Create a modal overlay with standard structure
function createModal(contentClassName = "") {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.display = "flex";

  const content = document.createElement("div");
  content.className = contentClassName ? `modal-content ${contentClassName}` : "modal-content";
  modal.appendChild(content);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn close-btn";
  closeBtn.textContent = i18n.t("common.close");
  closeBtn.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  return { modal, content, closeBtn };
}

// Create a modal with title, body content, and footer buttons
function createContentModal(title, bodyContent, extraContentClass = "", footerButtons = []) {
  const { modal, content, closeBtn } = createModal(extraContentClass);

  const titleEl = document.createElement("h2");
  titleEl.textContent = title;
  content.appendChild(titleEl);

  if (bodyContent) {
    content.appendChild(bodyContent);
  }

  if (footerButtons.length > 0) {
    const btnRow = document.createElement("div");
    btnRow.className = "button-group footer-buttons";
    footerButtons.forEach((btn) => btnRow.appendChild(btn));
    if (closeBtn) btnRow.appendChild(closeBtn);
    content.appendChild(btnRow);
  } else if (closeBtn) {
    content.appendChild(closeBtn);
  }

  document.body.appendChild(modal);
  return modal;
}

// Create a standard footer button for modals
function createFooterButton(labelKey, className = "") {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = i18n.t(labelKey);
  return btn;
}

// Create a list item action button with an SVG icon
function createListActionButton(svgPaths, className, title, itemId, svgOptions = {}) {
  return createIconButton(svgPaths, {
    className,
    title,
    dataset: { id: itemId },
    svgOptions,
  });
}

// Create the common set of list action buttons (toggle, edit, export, delete)
function createListActionButtons(itemId, isEnabled) {
  return {
    btnToggle: createListActionButton(
      isEnabled ? svg_paths.pauseIconPaths : svg_paths.startIconPaths,
      `btnToggle ${isEnabled ? "btn-disable" : "btn-enable"}`,
      isEnabled ? i18n.t("common.disable") : i18n.t("common.enable"),
      itemId,
    ),
    btnEdit: createListActionButton(svg_paths.penIconPaths, "btnEdit", i18n.t("common.edit"), itemId),
    btnExport: createListActionButton(svg_paths.exportIconPaths, "btnExport", i18n.t("userscript.listControls.export"), itemId, { strokeWidth: 1.5 }),
    btnDelete: createListActionButton(svg_paths.trashIconPaths, "btnDelete", i18n.t("common.delete"), itemId),
  };
}

const svg_paths = {
  redirectIconPaths: ["M18 3h3v3", "M21 3l-9 9", "M15 3H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9"],
  gearIconPaths: [
    `M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06 a1.65 1.65
     0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09 a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83
     l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4 h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2
     2 0 1 1 2.83-2.83 l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09 a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0
     0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83 l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4 h-.09a1.65 1.65 0 0 0-1.51 1z`,
  ],
  trashIconPaths: ["M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M19 6l-1.5 14h-11L5 6", "M10 11v6", "M14 11v6"],
  historyIconPaths: ["M3 3v5h5", "M3.05 13a9 9 0 1 0 2.13-9.36L3 8", "M12 7v5l3 3"],
  historyStatsIconPaths: [
    "M9 5c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2V5z",
    "M3 11c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2v-8z",
    "M15 7c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2V7z",
  ],
  backIconPaths: ["M19 20l-8-8 8-8"],
  forwardIconPaths: ["M5 4l8 8-8 8"],
  checkIconPaths: ["M20 6L9 17 4 12"],
  crossIconPaths: ["M6 6L18 18 M18 6L6 18"],
  minusIconPaths: ["M6 12L18 12"],
  plusIconPaths: ["M12 6L12 18 M6 12L18 12"],
  filterIconPaths: ["M3 4h18", "M6 12h12", "M10 20h4"],
  pauseIconPaths: ["M6 5h4v14H6z", "M14 5h4v14h-4z"],
  startIconPaths: ["M8 5v14l10-7z"],
  exportIconPaths: [
    "M20.15,13.1h1.35v6.9a1.9,1.9,0,0,1-1.9,1.9H4.4a1.9,1.9,0,0,1-1.9-1.9V5.6a1.9,1.9,0,0,1,1.9-1.9h6.9v1.35H4.4a0.7,0.7,0,0,0-0.7,0.7V19.8a0.7,0.7,0,0,0,0.7,0.7H19.6a0.7,0.7,0,0,0,0.7-0.7Z",
    "M17,2.6v1h4L12.7,11.6l0.9,0.9L21.9,4.2v3.4h.7V2.8Z",
  ],
  penIconPaths: [
    "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z",
    "M20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z",
  ],
  manageParsersIconPaths: ["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M12 9v6", "M9 12h6"],
  filtersIconPaths: ["M2 2h20l-7 8v8l-6 4v-12z"],
  dashboardIconPaths: ["M2 2h20v20H2z", "M6 11l4-3 4 3 4-4", "M6 15h12v2H6z"],
  storeIconPaths: ["M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22", "M1 12h22", "M12 1c4.5 3 4.5 19 0 22", "M12 1c-4.5 3-4.5 19 0 22"],
  refreshIconPaths: ["M23 4v6h-6", "M1 20v-6h6", "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"],
  downloadIconPaths: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  chevronRightIconPaths: ["M9 18l6-6-6-6"],
  emptyCircleIconPaths: ["M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z", "M12 8v4", "M12 16h.01"],
  spinnerIconPaths: ["M12 2v4", "M12 18v4", "M4.93 4.93l2.83 2.83", "M16.24 16.24l2.83 2.83", "M2 12h4", "M18 12h4", "M4.93 19.07l2.83-2.83", "M16.24 7.76l2.83-2.83"],
  listViewIconPaths: ["M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M2 12h20"],
  gridViewIconPaths: ["M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M12 3v18", "M2 12h20"],
  githubIconPaths: [
    "M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22",
  ],
  issueIconPaths: ["M10 3h4l-.5 12h-3z", "M10 18h4v3h-4z"],
  copyIconPaths: ["M11 9H20A2 2 0 0 1 22 11V20A2 2 0 0 1 20 22H11A2 2 0 0 1 9 20V11A2 2 0 0 1 11 9Z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
  musicNotePaths: [
    "M8.65 1.51A2 2 0 0 0 6 3.41v9.88A3.98 3.98 0 0 0 4.5 13C2.57 13 1 14.34 1 16s1.57 3 3.5 3S8 17.66 8 16V5.4l11 3.81v7.08a3.98 3.98 0 0 0-1.5-.29c-1.93 0-3.5 1.34-3.5 3s1.57 3 3.5 3 3.5-1.34 3.5-3V7.03c0-.74-.47-1.4-1.18-1.65L8.65 1.51Z",
  ],
  dragIconPaths: ["M9 6h.01", "M9 12h.01", "M9 18h.01", "M15 6h.01", "M15 12h.01", "M15 18h.01"],
};

// Load image with fallback
function loadImage({ target, src, fallback = browser.runtime.getURL("icons/48x48.png") } = {}) {
  if (!target) return;

  const container = target.parentNode;

  const applyLoadedState = () => {
    target.classList.add("lazyloaded");
    if (container && container.classList.contains("spinner")) {
      container.classList.remove("spinner");
    }
  };

  const finalSrc = typeof src === "string" && src ? src : fallback;

  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 16));

  idle(() => {
    const img = new Image();

    img.onload = () => {
      target.src = finalSrc;
      applyLoadedState();
    };

    img.onerror = () => {
      target.src = fallback;
      applyLoadedState();
    };

    img.src = finalSrc;
  });
}
