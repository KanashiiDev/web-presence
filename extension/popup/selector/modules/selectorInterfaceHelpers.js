const i18nData = {
  translations: {},
  fallback: {},
};

function t(key, params) {
  let str = i18nData.translations[key] ?? i18nData.fallback[key] ?? key;

  if (params) {
    if (Array.isArray(params)) {
      str = str.replace(/\{(\d+)\}/g, (_, i) => params[i] ?? `{${i}}`);
    } else {
      str = str.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
    }
  }

  return str;
}

function applyInjectedTranslations(root = document) {
  // data-i18n
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const params = el.dataset.i18nParams ? JSON.parse(el.dataset.i18nParams) : null;

    const text = t(key, params);
    const attr = el.dataset.i18nAttr;

    if (attr) {
      el.setAttribute(attr, text);
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.placeholder = text;
    } else {
      el.textContent = text;
    }
  });

  // TEXT NODE
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);

  let node;
  while ((node = walker.nextNode())) {
    const raw = node.nodeValue.trim();
    if (!raw) continue;

    const translated = t(raw);
    if (translated !== raw) {
      node.nodeValue = translated;
    }
  }

  // ATTRIBUTE
  const attrTargets = root.querySelectorAll("[placeholder], [title]");

  attrTargets.forEach((el) => {
    // placeholder
    if (el.hasAttribute("placeholder")) {
      const raw = el.getAttribute("placeholder")?.trim();
      if (raw) {
        const translated = t(raw);
        if (translated !== raw) {
          el.setAttribute("placeholder", translated);
        }
      }
    }

    // title
    if (el.hasAttribute("title")) {
      const raw = el.getAttribute("title")?.trim();
      if (raw) {
        const translated = t(raw);
        if (translated !== raw) {
          el.setAttribute("title", translated);
        }
      }
    }
  });
}

let FIELDS_CONFIG = {
  name: {
    label: "selector.editor.name.label",
    placeholder: (hostname) => t("selector.editor.name.placeholder").replace("${hostname}", hostname),
    desc: "selector.editor.name.desc",
    type: "text",
    dynamicPlaceholder: true,
    disableSelect: true,
  },
  domain: {
    label: "selector.editor.domain.label",
    placeholder: (hostname) => hostname,
    desc: "selector.editor.domain.desc",
    type: "text",
    dynamicPlaceholder: true,
    disableSelect: true,
  },
  title: {
    label: "selector.editor.title.label",
    placeholder: "selector.editor.type.selectorText",
    desc: "selector.editor.title.desc",
    type: "text",
    required: true,
  },
  artist: {
    label: "selector.editor.artist.label",
    placeholder: "selector.editor.type.selectorText",
    desc: "selector.editor.artist.desc",
    type: "text",
  },
  timePassed: {
    label: "selector.editor.timePassed.label",
    placeholder: "selector.editor.type.selector",
    desc: "selector.editor.timePassed.desc",
    type: "text",
  },
  duration: {
    label: "selector.editor.duration.label",
    placeholder: "selector.editor.type.selector",
    desc: "selector.editor.duration.desc",
    type: "text",
  },
  image: {
    label: "selector.editor.image.label",
    placeholder: "selector.editor.type.selectorUrl",
    desc: "selector.editor.image.desc",
    type: "text",
  },
  link: {
    label: "selector.editor.link.label",
    placeholder: "selector.editor.type.selectorUrl",
    desc: "selector.editor.link.desc",
    type: "text",
  },
  source: {
    label: "selector.editor.source.label",
    placeholder: "selector.editor.type.selectorText",
    desc: "selector.editor.source.desc",
    type: "text",
  },
  isPlaying: {
    label: "selector.editor.isPlaying.label",
    placeholder: "selector.editor.type.selector",
    desc: "selector.editor.isPlaying.desc",
    type: "text",
  },
  regex: {
    label: "selector.editor.regex.label",
    placeholder: "playlist.*",
    desc: "selector.editor.regex.desc",
    type: "text",
  },
  mode: {
    label: "selector.editor.activityMode.label",
    type: "select",
    desc: "selector.editor.activityMode.desc",
    options: [
      { value: "listen", label: "selector.editor.activityMode.listen" },
      { value: "watch", label: "selector.editor.activityMode.watch" },
    ],
    defaultValue: "listen",
  },
  watchAutoDetect: {
    label: "selector.editor.activityMode.watch.autoDetect",
    type: "select",
    desc: "selector.editor.activityMode.watch.autoDetect.desc",
    hidden: true,
    options: [
      { value: "enable", label: "common.enable" },
      { value: "disable", label: "common.disable" },
    ],
    defaultValue: "enable",
  },
  buttonText: {
    label: "selector.editor.buttonText.label",
    placeholder: "selector.editor.type.selectorText",
    desc: "selector.editor.buttonText.desc",
    type: "text",
    group: "buttons",
  },
  buttonLink: {
    label: "selector.editor.buttonLink.label",
    placeholder: "selector.editor.type.selectorUrl",
    desc: "selector.editor.buttonLink.desc",
    type: "text",
    group: "buttons",
  },
  buttonText2: {
    label: "selector.editor.buttonText2.label",
    placeholder: "selector.editor.type.selectorText",
    desc: "selector.editor.buttonText2.desc",
    type: "text",
    group: "buttons",
  },
  buttonLink2: {
    label: "selector.editor.buttonLink2.label",
    placeholder: "selector.editor.type.selectorUrl",
    desc: "selector.editor.buttonLink2.desc",
    type: "text",
    group: "buttons",
  },
};

function resolveFieldsConfig(ctx = {}) {
  const resolved = {};

  for (const [key, field] of Object.entries(FIELDS_CONFIG)) {
    const out = { ...field };

    // label
    if (field.label) out.label = t(field.label);

    // desc
    if (field.desc) out.desc = t(field.desc);

    // placeholder
    if (field.placeholder) {
      let text = t(field.placeholder);

      // dynamic placeholder
      if (field.dynamicPlaceholder && ctx.hostname) {
        text = text.replace("${hostname}", ctx.hostname);
      }

      out.placeholder = text;
    }

    // select options
    if (field.options) {
      out.options = field.options.map((opt) => ({
        ...opt,
        label: t(opt.label),
      }));
    }

    resolved[key] = out;
  }

  FIELDS_CONFIG = resolved;
}

const ALL_FIELDS = Object.keys(FIELDS_CONFIG);

function getCleanHostname() {
  return location.hostname.replace(/^https?:\/\/|^www\./g, "");
}

function getPlaceholderMap(hostname = getCleanHostname()) {
  const map = {};
  Object.entries(FIELDS_CONFIG).forEach(([key, cfg]) => {
    if (typeof cfg.placeholder === "function") {
      map[key] = cfg.placeholder(hostname);
    } else {
      map[key] = cfg.placeholder || "selector (#id, .class, [attribute])";
    }
  });
  return map;
}

function createContainer() {
  let container = document.getElementById("userRpc-selectorContainer");

  if (!container) {
    container = document.createElement("div");
    container.id = "userRpc-selectorContainer";
    document.documentElement.appendChild(container);
  }

  return container;
}

function setupContainerStyles(container) {
  container.style.cssText = `
    all: initial !important;
    position: fixed !important;
    z-index: 2147483647 !important;
    isolation: isolate !important;
  `;
}

function createRootElement(theme, style = {}, bg = {}, blur = false) {
  const root = document.createElement("div");
  root.id = "userRpc-selectorRoot";
  root.dataset.theme = theme || "dark";

  const bgLayer = document.createElement("div");
  bgLayer.id = "bg-layer";
  bgLayer.style.position = "absolute";
  for (const [key, value] of Object.entries(bg)) {
    bgLayer.style.setProperty(key, value);
  }

  const contentLayer = document.createElement("div");
  contentLayer.className = "content";
  if (blur) contentLayer.classList.add("fg-blur");

  for (const [key, value] of Object.entries(style)) {
    root.style.setProperty(key, value);
  }

  contentLayer.appendChild(bgLayer);
  root.appendChild(contentLayer);
  root.bgLayer = bgLayer;
  root._contentLayer = contentLayer;

  return root;
}

function createTitleElements(root, editMode) {
  const heading = document.createElement("h3");
  heading.className = "userRpc-h3";
  heading.textContent = "Web Presence";
  root.appendChild(heading);

  const editTitleWrapper = document.createElement("div");
  editTitleWrapper.className = "userRpc-h4-wrapper";

  const editTitle = document.createElement("h4");
  editTitle.className = "userRpc-h4";
  editTitle.textContent = editMode ? "" : t("selector.editor.addNew");
  editTitleWrapper.appendChild(editTitle);

  const selectorTip = document.createElement("span");
  selectorTip.className = "settings-option-tip";
  selectorTip.textContent = "i";

  selectorTip.addEventListener("click", async () => {
    const fields = Object.entries(FIELDS_CONFIG)
      .filter(([, field]) => field.desc)
      .map(([key, field]) => {
        const ignoreType = ["name", "domain"].includes(key);

        const type = !ignoreType && typeof field.placeholder === "string" ? ` - <i>${field.placeholder}</i>` : "";
        return `<b>${t(field.label)}</b>${type}\n${t(field.desc)}`;
      });

    const bodyText = fields.join("\n\n");

    await showAlert(t("selector.editor.addNew"), bodyText, "tip", {
      target: root,
      labelOk: t("common.ok"),
    });
  });
  editTitleWrapper.appendChild(selectorTip);
  root.appendChild(editTitleWrapper);
}

function createFieldInputs(placeholderMap = getPlaceholderMap()) {
  const listItems = document.createElement("div");
  listItems.className = "userRpc-listItems";

  Object.entries(FIELDS_CONFIG).forEach(([key, config]) => {
    const wrapper = document.createElement("div");
    wrapper.className = "field-row";
    if (config.hidden) wrapper.style.display = "none";
    if (config.group === "buttons") wrapper.classList.add("button-group");

    const label = document.createElement("label");
    label.className = "userRpc-label";
    label.id = `${key}Label`;
    label.textContent = config.label;
    label.htmlFor = `${key}Selector`;
    label.title = config.desc || "";

    let input;
    if (config.type === "select") {
      input = document.createElement("select");
      input.id = `${key}Selector`;
      input.className = "userRpc-select";

      (config.options || []).forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.text = opt.label;
        if (opt.value === config.defaultValue) option.selected = true;
        input.appendChild(option);
      });
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.id = `${key}Selector`;
      input.className = "userRpc-select";
      input.autocomplete = "off";
      input.placeholder = placeholderMap[key] || "";
    }

    const button = document.createElement("a");
    const hideSelect = config.type === "select" || config.hidden || config.disableSelect || key === "regex";
    if (hideSelect) wrapper.classList.add("select-hidden");
    button.setAttribute("data-field", key);
    button.className = `userRpc-selectBtn${hideSelect ? " hidden" : ""}`;
    button.title = "selector.editor.selectWithClick";
    button.id = `${key}Button`;
    button.appendChild(createSVG(svg_paths.plusIconPaths));
    wrapper.append(label, input, button);
    listItems.appendChild(wrapper);
  });

  return listItems;
}

function createActionButtons(root, shadow) {
  const optionsDiv = document.createElement("div");
  optionsDiv.className = "userRpc-listItemOptions";

  const saveBtn = document.createElement("a");
  saveBtn.className = "userRpc-optionButtons";
  saveBtn.id = "saveSelectors";
  saveBtn.textContent = "common.save";

  const exitBtn = document.createElement("a");
  exitBtn.className = "userRpc-optionButtons";
  exitBtn.id = "closeSelectorUI";
  exitBtn.textContent = "common.close";

  const addButtonsToggle = document.createElement("a");
  addButtonsToggle.className = "userRpc-optionButtons addButtonsToggle";
  addButtonsToggle.textContent = "selector.editor.addButtons";
  addButtonsToggle.addEventListener("click", () => {
    shadow.querySelectorAll('[id*="buttonText"], [id*="buttonLink"]').forEach((el) => {
      if (el.tagName === "BR") {
        el.style.display = "inline";
      } else if (el.tagName === "INPUT" || el.tagName === "SELECT") {
        el.style.display = "inline-block";
      } else {
        el.style.display = "flex";
      }
    });
    addButtonsToggle.remove();
  });

  optionsDiv.appendChild(addButtonsToggle);
  optionsDiv.appendChild(saveBtn);
  optionsDiv.appendChild(exitBtn);
  root.appendChild(optionsDiv);
}

function createStatusElement(root) {
  const statusDiv = document.createElement("div");
  statusDiv.id = "userRpc-selectorStatus";
  root.appendChild(statusDiv);
}

// Make the selector draggable
function setupDragFunctionality(root) {
  const content = root._contentLayer;

  let isDragging = false;
  let hasMoved = false;
  let offsetX = 0;
  let offsetY = 0;

  content.addEventListener("mousedown", (e) => {
    if (e.target !== e.currentTarget) return;

    isDragging = true;

    const rect = root.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    hasMoved = true;

    const newLeft = e.clientX - offsetX;
    const newTop = e.clientY - offsetY;

    moveWithinBounds(newLeft, newTop);
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });

  window.addEventListener("resize", () => {
    if (hasMoved) {
      keepInsideViewport();
    } else {
      const rect = root.getBoundingClientRect();
      root.style.left = window.innerWidth - rect.width - 15 + "px";
      root.style.top = "15px";
    }
  });

  function moveWithinBounds(left, top) {
    const maxLeft = window.innerWidth - root.offsetWidth;
    const maxTop = window.innerHeight - root.offsetHeight;
    root.style.left = Math.max(0, Math.min(left, maxLeft)) + "px";
    root.style.top = Math.max(0, Math.min(top, maxTop)) + "px";
  }

  function keepInsideViewport() {
    const rect = root.getBoundingClientRect();
    moveWithinBounds(rect.left, rect.top);
  }
}

// Inject Selector CSS
async function injectStyles(shadowRoot) {
  try {
    const url = browser.runtime.getURL("popup/selector/selector.css");
    const response = await fetch(url);
    const css = await response.text();

    try {
      const sheet = new CSSStyleSheet();
      await sheet.replace(css);

      if ("adoptedStyleSheets" in shadowRoot) {
        shadowRoot.adoptedStyleSheets = [...(shadowRoot.adoptedStyleSheets || []), sheet];
        return;
      }
    } catch (_) {}

    const style = document.createElement("style");
    style.textContent = css;
    shadowRoot.appendChild(style);
  } catch (err) {
    console.error("injectStyles failed:", err);
  }
}

// Set the position of the Selector
function positionElement(root) {
  const rect = root.getBoundingClientRect();
  root.style.left = window.innerWidth - rect.width - 25 + "px";
  root.style.top = "15px";
  root.style.right = "";
}

// Populate existing data
async function populateExistingData(shadow, hostname = getCleanHostname()) {
  const pathname = location.pathname;

  const exactParsers = (window.parsers?.[hostname] || []).filter((p) => p.userAdd);
  const wildcardParsers = Object.entries(window.parsers || {})
    .filter(([key]) => key.startsWith("*.") && hostname.endsWith(`.${key.slice(2)}`))
    .flatMap(([, parsers]) => parsers.filter((p) => p.userAdd));

  const userParsers = [...exactParsers, ...wildcardParsers];
  const matchedParser = userParsers.find((parser) => parser.patterns?.some((regex) => regex.test(pathname)));

  const domainInput = shadow.getElementById("domainSelector");
  if (domainInput) {
    if (matchedParser) {
      const settings = await browser.storage.local.get("userParserSelectors");
      const parserArray = Array.isArray(settings.userParserSelectors) ? settings.userParserSelectors : [];
      const current =
        parserArray.find((p) => p.id === matchedParser.id) ||
        parserArray.find((p) => {
          const raw = Array.isArray(p.domain) ? p.domain[0] : p.domain;
          const pDomain = (raw || "").toLowerCase();
          return hostname.endsWith(`.${pDomain}`);
        });
      domainInput.value = current?.domain ?? hostname;
    } else {
      domainInput.value = hostname;
    }
  }

  if (matchedParser) {
    const settings = await browser.storage.local.get("userParserSelectors");
    const parserArray = Array.isArray(settings.userParserSelectors) ? settings.userParserSelectors : [];
    const current =
      parserArray.find((p) => p.id === matchedParser.id) ||
      parserArray.find((p) => {
        const raw = Array.isArray(p.domain) ? p.domain[0] : p.domain;
        const pDomain = (raw || "").toLowerCase();
        return hostname.endsWith(`.${pDomain}`);
      });

    if (current?.selectors) {
      for (const [key, val] of Object.entries(current.selectors)) {
        const input = shadow.getElementById(`${key}Selector`);
        if (input) input.value = val;
      }
    }
  }
}

// Setup Selector Event Listeners
function setupEventListeners(shadow) {
  // Selection buttons
  shadow.querySelectorAll(".userRpc-selectBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.field;
      startSelectorMode(field, shadow);
    });
  });

  // Prevent page shortcuts inside inputs
  shadow.querySelectorAll("input").forEach((input) => {
    ["keydown", "keyup", "keypress"].forEach((eventType) => {
      input.addEventListener(eventType, (e) => e.stopPropagation(), true);
    });
  });

  // Save User Add RPC
  shadow.getElementById("saveSelectors").addEventListener("click", async () => {
    const fields = ALL_FIELDS;
    const selectors = {};

    fields.forEach((f) => {
      if (f === "domain") return;
      const inputEl = shadow.getElementById(`${f}Selector`);
      if (!inputEl) return;
      const val = inputEl.value.trim();
      if (val) selectors[f] = val;
    });

    if (!selectors.title) {
      showStatusMsg(t("selector.editor.warn.fillTitleField"), 1, 0, shadow);
      return;
    }

    // Check Selector Fields
    const checkFields = ["timePassed", "duration"];
    const invalidFields = [];

    checkFields.forEach((f) => {
      if (selectors[f] && !querySelectorDeep(selectors[f])) {
        invalidFields.push(FIELDS_CONFIG[f]?.label || formatLabel(f));
      }
    });

    if (invalidFields.length > 0) {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode(t("selector.editor.warn.invalidFields")));
      fragment.appendChild(document.createElement("br"));

      const ul = document.createElement("ul");
      invalidFields.forEach((label) => {
        const li = document.createElement("li");
        li.textContent = label;
        ul.appendChild(li);
      });
      fragment.appendChild(ul);

      showStatusMsg(fragment, true, false, shadow);
      return;
    }

    const domainInputVal = shadow.getElementById("domainSelector")?.value?.trim();
    const hostname = getCleanHostname();
    const savedDomain = domainInputVal.includes(",")
      ? domainInputVal
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean)
      : domainInputVal || hostname;

    const rawPattern = selectors["regex"] || ".*";
    const patternStrings = Array.isArray(rawPattern) ? rawPattern.map((p) => p.toString()) : [rawPattern.toString()];
    const id = generateParserKey(savedDomain, rawPattern);

    const newEntry = {
      id,
      domain: savedDomain,
      title: selectors["name"] || hostname,
      userAdd: true,
      urlPatterns: patternStrings,
      selectors,
    };

    const settings = await browser.storage.local.get("userParserSelectors");
    const parserArray = Array.isArray(settings.userParserSelectors) ? settings.userParserSelectors : [];

    const existingIndex = parserArray.findIndex((p) => p.id === id);
    if (existingIndex !== -1) {
      parserArray[existingIndex] = newEntry;
    } else {
      parserArray.push(newEntry);
    }

    await browser.storage.local.set({ userParserSelectors: parserArray });

    showStatusMsg(t("selector.editor.saved"), 0, 0, shadow);
  });

  // Close User Add RPC
  shadow.getElementById("closeSelectorUI").addEventListener("click", () => {
    clearInterval(previewInterval);
    shadow.host.remove();
  });

  // Update Watch Auto-Detect Visibility
  function updateWatchAutoDetectVisibility() {
    const modeSelect = shadow.getElementById("modeSelector");
    const watchAutoDetectRow = shadow.getElementById("watchAutoDetectSelector")?.closest(".field-row");
    if (!modeSelect || !watchAutoDetectRow) return;

    watchAutoDetectRow.style.display = modeSelect.value === "watch" ? "" : "none";
  }
  updateWatchAutoDetectVisibility();
  shadow.getElementById("modeSelector")?.addEventListener("change", updateWatchAutoDetectVisibility);
}

// Clean Selector Elements
function cleanupOldSelectorElements(shadowDoc) {
  ["userRpc-selectorChooser-container", "userRpc-selectorOverlay", "userRpc-selectorHighlight"].forEach((id) => {
    shadowDoc.getElementById(id)?.remove();
    document.getElementById(id)?.remove();
  });
}

// Selector Overlay
function createOverlay(id) {
  const el = document.createElement("div");
  el.id = id;

  if (id === "userRpc-selectorOverlay") {
    Object.assign(el.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      background: "rgba(0, 0, 0, 0.1)",
      cursor: "crosshair",
      zIndex: "2147483646",
      pointerEvents: "auto",
    });
  } else if (id === "userRpc-selectorHighlight") {
    Object.assign(el.style, {
      position: "absolute",
      zIndex: "2147483647",
      pointerEvents: "auto",
    });
  }

  return el;
}

let lastHighlightedElement = null;
// Selector Element Highlight Box
function updateHighlight(e, overlay, highlight, shadowDoc) {
  const el = deepElementFromPoint(e.clientX, e.clientY);
  const isBlocked = isPointOnBlockedElement(e.clientX, e.clientY, shadowDoc);

  // Check the overlay and highlight
  if (!el || el === overlay || el === highlight || el === document.body || el === document.documentElement) {
    highlight.style.display = "none";
    lastHighlightedElement = null;
    return;
  }

  if (el.closest("#userRpc-selectorRoot")) {
    highlight.style.display = "none";
    lastHighlightedElement = null;
    return;
  }

  if (el !== lastHighlightedElement) {
    lastHighlightedElement = el;
    const rect = el.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: "block",
      position: "absolute",
      background: isBlocked
        ? `repeating-linear-gradient(135deg, rgba(255, 0, 0, 0.3) 0px, rgba(255, 0, 0, 0.3) 10px, rgba(255, 0, 0, 0.1) 10px, rgba(255, 0, 0, 0.1) 20px)`
        : "rgba(59, 130, 246, 0.1)",
      border: isBlocked ? "4px solid #ef4444" : "4px solid #3b82f6",
      pointerEvents: "none",
      top: `${rect.top + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      contain: "layout style paint",
      zIndex: "2147483647",
    });
  }
}

// Handle Selector Element Click
function handleElementClick(e, field, shadowDoc, cleanup) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const el = deepElementFromPoint(e.clientX, e.clientY);
  const isBlocked = isPointOnBlockedElement(e.clientX, e.clientY, shadowDoc);

  if (isBlocked || !el) {
    showStatusMsg(t("selector.warn.forbiddenArea"), 1, 1, shadowDoc);
    return;
  }

  let targetEl = el;
  if (targetEl.id && targetEl.id === "userRpc-selectorContainer") {
    cleanup();
    showStatusMsg("", 0, 0, shadowDoc);
    return;
  }

  if (!isValidElement(targetEl)) {
    showStatusMsg(t("selector.warn.notValid"), 1, 1, shadowDoc);
    return;
  }

  if (field === "image") {
    targetEl = findImageElement(el);
    if (!targetEl) {
      showStatusMsg(t("selector.warn.noImage"), 1, 1, shadowDoc);
      return;
    }
  } else if (field === "link") {
    targetEl = findLinkElement(el);
    if (!targetEl) {
      showStatusMsg(t("selector.warn.noLink"), 1, 1, shadowDoc);
      return;
    }
  } else if (field === "isPlaying") {
    targetEl = findElement(el);
    if (!targetEl) {
      showStatusMsg(t("selector.warn.notValid"), 1, 1, shadowDoc);
      return;
    }
  } else {
    targetEl = findTextElement(el);
    if (!targetEl) {
      showStatusMsg(t("selector.warn.noText"), 1, 1, shadowDoc);
      return;
    }
  }

  try {
    const selectors = generateSelectorOptions(targetEl, field);
    showSelectorChooser(selectors, field, shadowDoc);
  } catch (error) {
    showStatusMsg(t("selector.generateError"), 1, 1, shadowDoc);
  } finally {
    cleanup();
  }
}

// Selector ESC Exit
function handleEscapeKey(e, cleanup, shadowDoc) {
  if (e.key === "Escape") {
    cleanup();
    showStatusMsg("", 0, 0, shadowDoc);
  }
}

// Selector Status Message
let statusTimeoutId = null;

function showStatusMsg(content, isAlert = false, isTemp = false, shadowDoc) {
  const statusEl = shadowDoc.getElementById("userRpc-selectorStatus");
  if (!statusEl) return;

  if (statusTimeoutId) {
    clearTimeout(statusTimeoutId);
    statusTimeoutId = null;
  }

  statusEl.textContent = "";

  if (!content) {
    statusEl.classList.remove("open", "alert");
    return;
  }

  if (typeof content === "string") {
    statusEl.textContent = content;
  } else if (content instanceof Node) {
    statusEl.appendChild(content);
  }

  statusEl.classList.add("open");
  statusEl.classList.toggle("alert", !!isAlert);

  if (isTemp) {
    statusTimeoutId = setTimeout(() => {
      statusEl.textContent = "";
      statusEl.classList.remove("open", "alert");
      statusTimeoutId = null;
    }, 3000);
  }
}
