/**
 * Color picker popover used by the color settings panel.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PICKER_WIDTH = 82;
const PICKER_SLIDER_SIZE = 10;
const MIN_GRADIENT_COLORS = 2;
const DEFAULT_GRADIENT_DEGREE = 90;
const MODE_SWITCH_DELAY_MS = 50;
const SCROLL_OFFSET = 10;
const FALLBACK_COLOR = "#000000";

/** Matches a hex color without an alpha channel (#rgb or #rrggbb). */
const NO_ALPHA_HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** The single iro.ColorPicker instance (created lazily). */
let globalPicker = null;

/** DOM references returned by createPickerPopover (created lazily). */
let globalPickerElements = null;

/**
 * Mutable state of the picker for the item currently being edited.
 * @type {{
 *   item: Object|null,
 *   swatch: HTMLElement|null,
 *   deleteBtn: HTMLElement|null,
 *   isGradientMode: boolean,
 *   isBlurMode: boolean,
 *   degree: number,
 *   lastGradientColors: string[]|null
 * }}
 */
const pickerState = {
  item: null,
  swatch: null,
  deleteBtn: null,
  isGradientMode: false,
  isBlurMode: false,
  degree: DEFAULT_GRADIENT_DEGREE,
  lastGradientColors: null,
};

/** Serializes storage writes so quick successive edits cannot overwrite each other. */
let saveQueue = Promise.resolve();

/** Timer used to re-show the popover after a mode switch. */
let modeSwitchTimer = null;

/** Clears everything that belongs to the previously edited item. */
function resetPickerState() {
  pickerState.item = null;
  pickerState.swatch = null;
  pickerState.deleteBtn = null;
  pickerState.isGradientMode = false;
  pickerState.degree = DEFAULT_GRADIENT_DEGREE;
  pickerState.lastGradientColors = null;
}

/** Whether the color picker is currently open for a color row. */
function isPickerOpen() {
  return pickerState.swatch !== null;
}

/** Returns the delete button of the color row currently being edited, or null. */
function getPickerDeleteBtn() {
  return pickerState.deleteBtn;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Stops the given events from bubbling out of an element.
 * @param {HTMLElement} element
 * @param {string[]} [events]
 */
function stopPropagationFor(element, events = ["mousedown", "click"]) {
  events.forEach((type) => element.addEventListener(type, (e) => e.stopPropagation()));
}

/**
 * Formats an iro color as hex, including alpha only when it is below 1.
 * @param {Object} color iro color instance.
 * @returns {string}
 */
function formatHex(color) {
  return color.alpha < 1 ? color.hex8String : color.hexString;
}

/**
 * Checks whether a text value is a color that tinycolor can parse.
 * @param {string} text
 * @returns {boolean}
 */
function isValidColorText(text) {
  return tinycolor(text.trim()).isValid();
}

/**
 * Applies a user-typed color to an iro color. A hex value without alpha keeps
 * the current alpha instead of resetting it to 1.
 * @param {Object} color iro color instance.
 * @param {string} text User input (hex, rgb, hsl or a named color).
 * @returns {boolean} False if the text is not a valid color.
 */
function applyTextToColor(color, text) {
  const trimmed = text.trim();
  const parsed = tinycolor(trimmed);
  if (!parsed.isValid()) return false;

  if (NO_ALPHA_HEX_RE.test(trimmed)) parsed.setAlpha(color.alpha);
  color.hex8String = parsed.toHex8String();
  return true;
}

/**
 * Returns the current picker value: a single color or a linear-gradient string.
 * @returns {string}
 */
function getPickerValue() {
  const colors = globalPicker.colors.map((c) => c.rgbaString);
  if (pickerState.isGradientMode && colors.length > 1) {
    return `linear-gradient(${pickerState.degree}deg, ${colors.join(", ")})`;
  }
  return colors[0];
}

/**
 * Checks whether a stored value differs from the theme default.
 * @param {string|undefined} value Stored value.
 * @param {string|null} defaultValue Theme default.
 * @returns {boolean}
 */
function isCustomValue(value, defaultValue) {
  if (!value) return false;
  if (isGradient(value) || !defaultValue) return true;
  return !tinycolor.equals(value, defaultValue);
}

/**
 * Enables or disables a per-item delete button depending on the stored value.
 * @param {HTMLElement} btn
 * @param {Object} item Color setting item.
 * @param {Object} config Stored color settings.
 */
function setDeleteBtnState(btn, item, config) {
  btn.classList.toggle("disabled", !isCustomValue(config[item.key], getDefaultCSSValue(item)));
}

/**
 * Enables or disables the "delete all colors" button.
 * @param {Object} config Stored color settings.
 */
function updateDeleteAllBtn(config) {
  const btn = document.querySelector(".all-colors-delete-btn");
  if (btn) btn.classList.toggle("disabled", Object.keys(config).length === 0);
}

/** Updates the blur toggle label from the current state. */
function updateBlurLabel() {
  const status = i18n.t(pickerState.isBlurMode ? "common.disable" : "common.enable");
  globalPickerElements.btnBlur.textContent = `${i18n.t("settings.backgroundImage.blur")} (${status})`;
}

/**
 * Sets the gradient angle and syncs the slider and its label.
 * @param {number} value Angle in degrees.
 */
function setDegree(value) {
  const { degreeSlider, degreeValue } = globalPickerElements;
  pickerState.degree = value;
  degreeSlider.value = value;
  degreeValue.textContent = `${value}°`;
}

/**
 * Finds the DOM element that belongs to a color setting. Prefers a
 * `data-key` attribute and falls back to the item's position.
 * @param {string} selector Element selector, e.g. ".color-swatch".
 * @param {Object} item Color setting item.
 * @param {number} index Position of the item in getColorSettings().
 * @returns {HTMLElement|null}
 */
function findItemElement(selector, item, index) {
  return document.querySelector(`${selector}[data-key="${item.key}"]`) ?? document.querySelectorAll(selector)[index] ?? null;
}

// ---------------------------------------------------------------------------
// Popover creation
// ---------------------------------------------------------------------------

/**
 * Builds the picker popover DOM (called once).
 * @returns {Object} References to the popover and its controls.
 */
function createPickerPopover() {
  const popover = document.createElement("div");
  popover.className = "picker-popover hidden";

  const popoverWrapper = document.createElement("div");
  popoverWrapper.className = "picker-popover-wrapper";

  const popoverInner = document.createElement("div");
  popoverInner.className = "picker-popover-inner";

  // Gradient controls
  const gradientControls = document.createElement("div");
  gradientControls.className = "gradient-controls hidden";

  // Degree slider
  const degreeContainer = document.createElement("div");
  degreeContainer.style.cssText = "margin-bottom: 8px;";

  const degreeLabel = document.createElement("label");
  degreeLabel.textContent = i18n.t("colorPicker.degree");

  const degreeSliderRow = document.createElement("div");
  degreeSliderRow.className = "degree-slider-row";

  const degreeSlider = document.createElement("input");
  degreeSlider.type = "range";
  degreeSlider.min = "0";
  degreeSlider.max = "360";
  degreeSlider.className = "slider-input";

  const degreeValue = document.createElement("span");

  degreeSliderRow.append(degreeSlider, degreeValue);
  degreeContainer.append(degreeLabel, degreeSliderRow);

  const colorCountLabel = document.createElement("label");
  colorCountLabel.textContent = i18n.t("colorPicker.colors");

  // Color count controls
  const colorCountContainer = document.createElement("div");
  colorCountContainer.className = "colorCountContainer";

  const btnRemoveColor = document.createElement("span");
  btnRemoveColor.className = "gradient-color-btn btn";
  btnRemoveColor.appendChild(createSVG(svg_paths.minusIconPaths));

  const colorCount = document.createElement("span");

  const btnAddColor = document.createElement("span");
  btnAddColor.className = "gradient-color-btn btn";
  btnAddColor.appendChild(createSVG(svg_paths.plusIconPaths));

  // Color list
  const colorListContainer = document.createElement("div");
  colorListContainer.className = "gradient-color-list";
  colorListContainer.id = "gradientColorList";
  stopPropagationFor(colorListContainer);

  colorCountContainer.append(btnRemoveColor, colorCount, btnAddColor);
  gradientControls.append(degreeContainer, colorCountLabel, colorListContainer, colorCountContainer);

  // Hex input (single color mode)
  const hexInputContainer = document.createElement("div");
  hexInputContainer.className = "hex-input-container";

  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.placeholder = FALLBACK_COLOR;

  hexInputContainer.appendChild(hexInput);

  // Blur and gradient buttons
  const btnBlur = document.createElement("span");
  btnBlur.className = "blur-btn btn";

  const btnGradient = document.createElement("span");
  btnGradient.className = "gradient-btn btn";

  popoverWrapper.append(popoverInner, btnBlur, hexInputContainer, btnGradient);
  popover.append(popoverWrapper);

  return {
    popover,
    popoverInner,
    gradientControls,
    degreeSlider,
    degreeValue,
    btnAddColor,
    btnRemoveColor,
    colorCount,
    colorListContainer,
    hexInput,
    hexInputContainer,
    btnBlur,
    btnGradient,
  };
}

/** Creates the popover and the iro picker once, and wires up all events. */
function initGlobalPicker() {
  if (globalPickerElements) return;

  globalPickerElements = createPickerPopover();

  globalPicker = new iro.ColorPicker(globalPickerElements.popoverInner, {
    width: PICKER_WIDTH,
    colors: [FALLBACK_COLOR],
    layoutDirection: "vertical",
    layout: [
      { component: iro.ui.Box },
      { component: iro.ui.Slider, options: { sliderType: "hue", sliderSize: PICKER_SLIDER_SIZE } },
      { component: iro.ui.Slider, options: { sliderType: "alpha", sliderSize: PICKER_SLIDER_SIZE } },
    ],
  });

  globalPickerElements.popoverInner.appendChild(globalPickerElements.gradientControls);

  setupPickerEvents();
}

// ---------------------------------------------------------------------------
// Events (registered once)
// ---------------------------------------------------------------------------

/** Registers every DOM and iro event handler. Handlers read the shared state, so this runs only once. */
function setupPickerEvents() {
  const { degreeSlider, btnAddColor, btnRemoveColor, hexInput, btnBlur, btnGradient, popover, popoverInner } = globalPickerElements;

  // Hex input (single color mode)
  stopPropagationFor(hexInput);

  hexInput.addEventListener("input", () => {
    if (applyTextToColor(globalPicker.colors[0], hexInput.value)) updatePreview();
  });

  hexInput.addEventListener("change", () => {
    if (isValidColorText(hexInput.value)) pickerEnd();
    hexInput.value = formatHex(globalPicker.colors[0]);
  });

  // Degree slider
  degreeSlider.addEventListener("input", () => {
    setDegree(parseInt(degreeSlider.value, 10));
    updatePreview();
  });
  degreeSlider.addEventListener("change", pickerEnd);

  // Add / remove colors
  btnAddColor.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const lastColor = globalPicker.colors[globalPicker.colors.length - 1];
    globalPicker.addColor(lastColor.rgbaString);
    commitColorListChange();
  });

  btnRemoveColor.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (globalPicker.colors.length <= MIN_GRADIENT_COLORS) return;
    removeGradientColor(globalPicker.colors.length - 1);
  });

  // Blur toggle
  btnBlur.addEventListener("click", (e) => {
    e.stopPropagation();
    pickerState.isBlurMode = !pickerState.isBlurMode;
    updateBlurLabel();
    pickerEnd();
  });

  // Gradient toggle
  btnGradient.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGradientMode();
  });

  // Click on the popover backdrop closes the picker
  popover.addEventListener("click", (e) => {
    if (e.target === popover) closePicker();
    e.stopPropagation();
  });

  popoverInner.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".IroColorPicker")) {
      popoverInner.setPointerCapture(e.pointerId);
    }
  });

  // iro events. They are ignored while no item is being edited, which also
  // covers the colors being reset in openPickerForSwatch.
  globalPicker.on("input:end", () => {
    if (pickerState.swatch) pickerEnd();
  });

  globalPicker.on("color:change", () => {
    if (!pickerState.swatch) return;

    if (!pickerState.isGradientMode && document.activeElement !== hexInput) {
      hexInput.value = formatHex(globalPicker.colors[0]);
    }
    updateColorItemsDisplay();
    updatePreview();
  });
}

// ---------------------------------------------------------------------------
// Preview and persistence
// ---------------------------------------------------------------------------

/** Mirrors the current picker value on the swatch. */
function updatePreview() {
  if (!pickerState.swatch) return;
  pickerState.swatch.style.background = getPickerValue();
}

/**
 * Persists the current picker value (and, for the foreground color, the blur flag),
 * then re-applies the color settings. Writes are queued, and the value is captured
 * at call time so later picker changes cannot alter a queued save.
 * @returns {Promise<void>}
 */
function pickerEnd() {
  const { item, swatch, deleteBtn, isGradientMode, isBlurMode } = pickerState;
  if (!item?.key || !swatch) return Promise.resolve();

  const value = getPickerValue();
  const hasTransparency = isGradientMode ? globalPicker.colors.some((c) => c.alpha < 1) : globalPicker.colors[0].alpha < 1;
  const applyFgBlur = isBlurMode && hasTransparency;
  swatch.style.background = value;

  saveQueue = saveQueue
    .then(async () => {
      const { colorSettings } = await browser.storage.local.get("colorSettings");
      const config = colorSettings || {};
      config[item.key] = value;

      if (item.key === "foregroundColor") {
        config.applyFgBlur = applyFgBlur;
      }

      await browser.storage.local.set({ colorSettings: config });
      await applyColorSettings();

      if (deleteBtn) setDeleteBtnState(deleteBtn, item, config);
      updateDeleteAllBtn(config);
    })
    .catch((err) => console.error("[colorPicker] Failed to save color:", err));

  return saveQueue;
}

/** Updates the delete button of the item currently being edited. */
async function updateCurrentDeleteBtn() {
  const { item, deleteBtn } = pickerState;
  if (!deleteBtn || !item) return;

  const { colorSettings } = await browser.storage.local.get("colorSettings");
  setDeleteBtnState(deleteBtn, item, colorSettings || {});
}

// ---------------------------------------------------------------------------
// Mode handling
// ---------------------------------------------------------------------------

/** Syncs the popover UI with the current mode (single color or gradient). */
function syncModeUI() {
  const { popover, gradientControls, hexInputContainer, hexInput, btnGradient, colorCount } = globalPickerElements;
  const gradient = pickerState.isGradientMode;

  popover.classList.toggle("gradient-mode", gradient);
  gradientControls.classList.toggle("hidden", !gradient);
  hexInputContainer.classList.toggle("hidden", gradient);
  btnGradient.textContent = i18n.t(gradient ? "colorPicker.single" : "colorPicker.gradient");

  if (gradient) {
    setDegree(pickerState.degree);
    colorCount.textContent = globalPicker.colors.length;
  } else {
    hexInput.value = formatHex(globalPicker.colors[0]);
  }
}

/** Switches between single color and gradient mode, and saves the result immediately. */
function toggleGradientMode() {
  const { popover } = globalPickerElements;
  document.body.style.transition = "none";

  if (!pickerState.isGradientMode) {
    // Single -> gradient
    const currentHue = globalPicker.colors[0].hue;
    const saved = pickerState.lastGradientColors;

    if (saved && saved.length > 1) {
      globalPicker.colors[0].set(saved[0]);
      saved.slice(1).forEach((color) => globalPicker.addColor(color));
    } else {
      globalPicker.addColor(globalPicker.colors[0].rgbaString);
      globalPicker.colors[1].hue = currentHue;
    }

    globalPicker.setActiveColor(0);
    pickerState.isGradientMode = true;
  } else {
    // Gradient -> single
    pickerState.lastGradientColors = globalPicker.colors.map((c) => c.rgbaString);
    const firstColor = globalPicker.colors[0].rgbaString;

    popover.classList.add("hidden");

    while (globalPicker.colors.length > 1) {
      globalPicker.removeColor(globalPicker.colors.length - 1);
    }

    globalPicker.colors[0].set(firstColor);
    globalPicker.setActiveColor(0);
    pickerState.isGradientMode = false;
  }

  syncModeUI();
  if (pickerState.isGradientMode) rebuildColorList(true);
  updatePreview();
  pickerEnd();

  clearTimeout(modeSwitchTimer);
  modeSwitchTimer = setTimeout(() => {
    if (pickerState.swatch) popover.classList.remove("hidden");
    document.body.style.transition = "";
    activateSimpleBar("colorExpandableSection");
  }, MODE_SWITCH_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Gradient color list
// ---------------------------------------------------------------------------

/** Refreshes count, list, preview and storage after the number of gradient colors changed. */
function commitColorListChange() {
  globalPickerElements.colorCount.textContent = globalPicker.colors.length;
  rebuildColorList();
  updatePreview();
  pickerEnd();
}

/**
 * Removes one gradient color and keeps a valid color active.
 * @param {number} index Index of the color to remove.
 */
function removeGradientColor(index) {
  globalPicker.removeColor(index);
  globalPicker.setActiveColor(Math.min(index, globalPicker.colors.length - 1));
  commitColorListChange();
}

/** Updates the swatches and hex inputs of the gradient color list from the picker. */
function updateColorItemsDisplay() {
  const { colorListContainer } = globalPickerElements;
  const colorItems = colorListContainer.querySelectorAll(".gradient-color-item");

  colorItems.forEach((colorItem, index) => {
    const color = globalPicker.colors[index];
    if (!color) return;

    const miniSwatch = colorItem.querySelector("div.indicator");
    const miniInput = colorItem.querySelector("input");

    if (miniSwatch) miniSwatch.style.background = color.rgbaString;
    if (miniInput && document.activeElement !== miniInput) miniInput.value = formatHex(color);
  });
}

/**
 * Builds one row of the gradient color list.
 * @param {Object} color iro color instance.
 * @param {number} index Position of the color in the picker.
 * @returns {HTMLElement}
 */
function createColorListItem(color, index) {
  const colorItem = document.createElement("div");
  colorItem.className = "gradient-color-item";

  const miniSwatch = document.createElement("div");
  miniSwatch.className = "indicator";
  miniSwatch.style.background = color.rgbaString;
  miniSwatch.addEventListener("click", (e) => {
    e.stopPropagation();
    globalPicker.setActiveColor(index);
  });

  const miniHexInput = document.createElement("input");
  miniHexInput.type = "text";
  miniHexInput.value = formatHex(color);
  miniHexInput.placeholder = FALLBACK_COLOR;
  stopPropagationFor(miniHexInput);

  miniHexInput.addEventListener("input", () => {
    const target = globalPicker.colors[index];
    if (target && applyTextToColor(target, miniHexInput.value)) {
      miniSwatch.style.background = target.rgbaString;
      updatePreview();
    }
  });

  miniHexInput.addEventListener("change", () => {
    if (isValidColorText(miniHexInput.value)) {
      pickerEnd();
    } else {
      miniHexInput.value = formatHex(globalPicker.colors[index]);
    }
  });

  miniHexInput.addEventListener("focus", () => globalPicker.setActiveColor(index));

  if (globalPicker.colors.length > MIN_GRADIENT_COLORS) {
    const deleteBtn = document.createElement("span");
    deleteBtn.className = "btn btn-action";
    deleteBtn.title = i18n.t("common.delete");
    deleteBtn.appendChild(createSVG(svg_paths.crossIconPaths));
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeGradientColor(index);
    });
    colorItem.appendChild(deleteBtn);
  }

  colorItem.append(miniSwatch, miniHexInput);
  return colorItem;
}

/** Renders the gradient color list items (DOM only, no scrollbar activation). */
function renderColorList() {
  const { colorListContainer } = globalPickerElements;

  colorListContainer.replaceChildren();
  globalPicker.colors.forEach((color, index) => {
    colorListContainer.appendChild(createColorListItem(color, index));
  });
}

/**
 * Activates SimpleBar on the gradient color list. The list is looked up in the
 * document and must be measured while visible, so this does nothing until the
 * popover is attached to the page.
 * @returns {Promise<void>}
 */
async function activateColorListScroll() {
  if (!globalPickerElements.popover.isConnected) return;

  await destroySimplebar("gradientColorList");
  await activateSimpleBar("gradientColorList");
}

/**
 * Rebuilds the gradient color list. Skipped when the item count is unchanged,
 * unless `force` is set (needed when the colors themselves were replaced).
 * @param {boolean} [force=false]
 * @returns {Promise<void>}
 */
async function rebuildColorList(force = false) {
  const { colorListContainer } = globalPickerElements;
  const existingCount = colorListContainer.querySelectorAll(".gradient-color-item").length;

  if (!force && existingCount === globalPicker.colors.length) return;

  renderColorList();
  await activateColorListScroll();
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/**
 * Replaces all colors of the picker.
 * @param {string[]} colors Colors accepted by iro.
 */
function resetPickerColors(colors) {
  while (globalPicker.colors.length > 0) {
    globalPicker.removeColor(0);
  }
  colors.forEach((color) => globalPicker.addColor(color));
  globalPicker.setActiveColor(0);
}

/**
 * Opens the picker for a color setting.
 * @param {Object} item Color setting item (from getColorSettings()).
 * @param {HTMLElement} swatch Swatch that shows the item's color.
 * @param {HTMLElement} btnDelete Delete button of the item.
 * @returns {Promise<void>}
 */
async function openPickerForSwatch(item, swatch, btnDelete) {
  initGlobalPicker();

  // Clear the previous state completely. iro events are ignored while swatch is null.
  resetPickerState();

  const { colorSettings } = await browser.storage.local.get("colorSettings");
  const config = colorSettings || {};
  const initialValue = config[item.key] || item.default || FALLBACK_COLOR;

  // Work out the initial colors and mode
  let initialColors = [tinycolor(initialValue).isValid() ? initialValue : FALLBACK_COLOR];

  if (isGradient(initialValue)) {
    const { degree, stops } = parseGradient(initialValue);
    const colors = stops.map((stop) => stop.color).filter((color) => tinycolor(color).isValid());

    if (colors.length > 1) {
      initialColors = colors;
      pickerState.lastGradientColors = [...colors];
      pickerState.isGradientMode = true;
      pickerState.degree = Math.round(degree ?? DEFAULT_GRADIENT_DEGREE);
    } else {
      initialColors = [colors[0] ?? item.default ?? FALLBACK_COLOR];
    }
  }

  resetPickerColors(initialColors);

  // Update the UI
  const { btnBlur, btnGradient, colorListContainer, popover } = globalPickerElements;

  btnBlur.style.display = item.key === "foregroundColor" ? "inline-block" : "none";
  btnGradient.style.display = item.enableGradient ? "inline-block" : "none";

  pickerState.isBlurMode = !!config.applyFgBlur;
  updateBlurLabel();
  syncModeUI();

  if (pickerState.isGradientMode) {
    renderColorList();
  } else {
    colorListContainer.replaceChildren();
  }

  // Start editing
  pickerState.item = item;
  pickerState.swatch = swatch;
  pickerState.deleteBtn = btnDelete;
  applyPickerDeleteButtonState(btnDelete);

  // Attach and show the popover BEFORE activating SimpleBar: on the first open the
  // popover is not in the document yet, and a hidden list cannot be measured.
  swatch.parentElement.appendChild(popover);
  popover.classList.remove("hidden");

  if (pickerState.isGradientMode) await activateColorListScroll();

  // Scroll the popover into view
  const colorSection = document.querySelector(".color.expandable-section");
  const scrollEl = colorSection ? simpleBarInstances.get(colorSection)?.getScrollElement() : null;
  if (scrollEl) {
    const containerRect = scrollEl.getBoundingClientRect();
    const popoverTop = popover.getBoundingClientRect().top - containerRect.top + scrollEl.scrollTop - SCROLL_OFFSET;
    await smoothScrollTo(scrollEl, popoverTop);
  }
}

/**
 * Closes the picker and clears the item being edited.
 * @returns {Promise<void>}
 */
async function closePicker() {
  restoreDeleteButtons();
  if (globalPickerElements) {
    globalPickerElements.popover.classList.add("hidden");
  }

  pickerState.item = null;
  pickerState.swatch = null;
  pickerState.deleteBtn = null;

  const colorSection = document.querySelector(".color.expandable-section");
  if (colorSection) await activateSimpleBar(colorSection);
}

// ---------------------------------------------------------------------------
// Theme changes
// ---------------------------------------------------------------------------

/**
 * Refreshes all swatches and delete buttons after a theme change. If the picker
 * is open, it is reopened so it shows the new values.
 * @returns {Promise<void>}
 */
async function updateAllSwatchesForTheme() {
  const { colorSettings } = await browser.storage.local.get("colorSettings");
  const config = colorSettings || {};
  const settings = getColorSettings();

  settings.forEach((item, index) => {
    const swatch = findItemElement(".color-swatch", item, index);
    if (swatch) swatch.style.background = config[item.key] || item.default;

    const btnDelete = findItemElement(".color-delete-btn", item, index);
    if (btnDelete) setDeleteBtnState(btnDelete, item, config);
  });

  updateDeleteAllBtn(config);

  // Reopen the picker if it was open. The item is read before closePicker() clears it.
  const openKey = pickerState.item?.key;
  if (!openKey) return;

  const index = settings.findIndex((item) => item.key === openKey);
  if (index < 0) return;

  await closePicker();

  const item = settings[index];
  const swatch = findItemElement(".color-swatch", item, index);
  const btnDelete = findItemElement(".color-delete-btn", item, index);
  if (swatch && btnDelete) {
    await openPickerForSwatch(item, swatch, btnDelete);
  }
}
