// Global picker state
let globalPicker = null;
let globalPickerElements = null;
let currentEditingItem = null;
let currentSwatch = null;
let currentDeleteBtn = null;
let isGradientMode = false;
let isBlurMode = false;
let gradientDegree = 90;
let lastGradientColors = null;

// Create picker popover once
function createPickerPopover() {
  const popover = document.createElement("div");
  popover.className = "picker-popover hidden";

  const popoverWrapper = document.createElement("div");
  popoverWrapper.className = "picker-popover-wrapper";

  const popoverInner = document.createElement("div");
  popoverInner.className = "picker-popover-inner";

  // Gradient Controls
  const gradientControls = document.createElement("div");
  gradientControls.className = "gradient-controls hidden";

  // Degree Slider
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

  degreeSliderRow.appendChild(degreeSlider);
  degreeSliderRow.appendChild(degreeValue);
  degreeContainer.appendChild(degreeLabel);
  degreeContainer.appendChild(degreeSliderRow);

  // Color Count Controls
  const colorCountContainer = document.createElement("div");
  colorCountContainer.className = "colorCountContainer";

  const colorCountLabel = document.createElement("label");
  colorCountLabel.textContent = i18n.t("colorPicker.colors");

  const btnRemoveColor = document.createElement("span");
  btnRemoveColor.className = "gradient-color-btn btn";
  btnRemoveColor.appendChild(createSVG(svg_paths.minusIconPaths));

  const colorCount = document.createElement("span");

  const btnAddColor = document.createElement("span");
  btnAddColor.appendChild(createSVG(svg_paths.plusIconPaths));
  btnAddColor.className = "gradient-color-btn btn";

  // Color List
  const colorListContainer = document.createElement("div");
  colorListContainer.className = "gradient-color-list";
  colorListContainer.id = "gradientColorList";

  colorListContainer.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });

  colorListContainer.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  colorCountContainer.appendChild(colorCountLabel);
  colorCountContainer.appendChild(btnRemoveColor);
  colorCountContainer.appendChild(colorCount);
  colorCountContainer.appendChild(btnAddColor);

  gradientControls.appendChild(degreeContainer);
  gradientControls.appendChild(colorCountContainer);
  gradientControls.appendChild(colorListContainer);

  // Hex Input (single color mode)
  const hexInputContainer = document.createElement("div");
  hexInputContainer.className = "hex-input-container";

  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.placeholder = "#000000";

  hexInputContainer.appendChild(hexInput);

  // Blur Button
  const btnBlur = document.createElement("span");
  btnBlur.className = "blur-btn btn";

  // Gradient Button
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

// Initialize global picker once
function initGlobalPicker() {
  if (globalPickerElements) return;

  globalPickerElements = createPickerPopover();

  // Create the iro picker
  globalPicker = new iro.ColorPicker(globalPickerElements.popoverInner, {
    width: 100,
    colors: ["#000000"],
    layoutDirection: "vertical",
    layout: [
      { component: iro.ui.Box },
      { component: iro.ui.Slider, options: { sliderType: "hue", sliderSize: 10 } },
      { component: iro.ui.Slider, options: { sliderType: "alpha", sliderSize: 10 } },
    ],
  });

  globalPickerElements.popoverInner.appendChild(globalPickerElements.gradientControls);

  setupPickerEventsOnce();
}

// Setup all picker events
function setupPickerEventsOnce() {
  const { degreeSlider, degreeValue, btnAddColor, btnRemoveColor, colorCount, hexInput, btnBlur, btnGradient, popover } = globalPickerElements;

  // Hex input
  hexInput.addEventListener("mousedown", (e) => e.stopPropagation());
  hexInput.addEventListener("click", (e) => e.stopPropagation());

  hexInput.addEventListener("input", (e) => {
    const hex = e.target.value;
    if (tinycolor(hex).isValid()) {
      globalPicker.colors[0].hexString = hex;
      updateGradient();
    }
  });

  hexInput.addEventListener("change", () => {
    if (tinycolor(hexInput.value).isValid()) {
      pickerEnd();
    } else {
      hexInput.value = globalPicker.colors[0].hexString;
    }
  });

  // Degree slider
  degreeSlider.addEventListener("input", () => {
    gradientDegree = parseInt(degreeSlider.value);
    degreeValue.textContent = `${gradientDegree}°`;
    updateGradient();
  });

  degreeSlider.addEventListener("change", pickerEnd);

  // Add/Remove colors
  btnAddColor.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!globalPicker || !globalPicker.colors) return;

    const lastColor = globalPicker.colors[globalPicker.colors.length - 1];
    globalPicker.addColor(lastColor.rgbaString);
    globalPickerElements.colorCount.textContent = globalPicker.colors.length;
    rebuildColorList();
    updateGradient();
    pickerEnd();
  });

  btnRemoveColor.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!globalPicker || globalPicker.colors.length <= 2) return;

    globalPicker.removeColor(globalPicker.colors.length - 1);
    globalPickerElements.colorCount.textContent = globalPicker.colors.length;
    rebuildColorList();
    updateGradient();
    pickerEnd();
  });

  // Blur toggle
  btnBlur.addEventListener("click", (e) => {
    e.stopPropagation();
    isBlurMode = !isBlurMode;
    btnBlur.textContent = i18n.t("settings.backgroundImage.blur") + " (" + (isBlurMode ? i18n.t("common.disable") : i18n.t("common.enable")) + ")";
    pickerEnd();
  });

  // Gradient toggle
  btnGradient.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGradientMode();
  });

  // Close on popover click
  popover.addEventListener("click", (e) => {
    if (e.target === popover) {
      popover.classList.add("hidden");
    }
    e.stopPropagation();
  });

  globalPickerElements.popoverInner.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".IroColorPicker")) {
      globalPickerElements.popoverInner.setPointerCapture(e.pointerId);
    }
  });
}

// Setup dynamic picker events (called each time picker opens)
function setupDynamicPickerEvents() {
  // Remove old listeners
  globalPicker.off("color:change");
  globalPicker.off("input:end");

  const pickerChange = () => {
    if (!isGradientMode) {
      globalPickerElements.hexInput.value = globalPicker.colors[0].hexString;
    }
    updateColorItemsDisplay();
    updateGradient();
  };

  globalPicker.on("input:end", pickerEnd);
  globalPicker.on("color:change", pickerChange);
}

// Helper functions
function updateGradient() {
  if (!currentSwatch) return;

  if (isGradientMode && globalPicker.colors.length > 1) {
    const colors = globalPicker.colors.map((c) => c.rgbaString).join(", ");
    currentSwatch.style.background = `linear-gradient(${gradientDegree}deg, ${colors})`;
  } else {
    currentSwatch.style.background = globalPicker.colors[0].rgbaString;
  }
}

async function pickerEnd() {
  if (!currentEditingItem?.key || !currentSwatch) return;

  let value;
  if (isGradientMode && globalPicker.colors.length > 1) {
    const colors = globalPicker.colors.map((c) => c.rgbaString).join(", ");
    value = `linear-gradient(${gradientDegree}deg, ${colors})`;
  } else {
    value = globalPicker.colors[0].rgbaString;
  }

  const storage = await browser.storage.local.get("colorSettings");
  const config = storage.colorSettings || {};
  config[currentEditingItem.key] = value;
  currentSwatch.style.background = value;

  if (currentEditingItem.key === "foregroundColor") {
    const hasTransparency = isGradientMode ? globalPicker.colors.some((c) => c.alpha < 1) : globalPicker.colors[0].alpha < 1;
    config["applyFgBlur"] = isBlurMode && hasTransparency;
  }

  await browser.storage.local.set({ colorSettings: config });
  await applyColorSettings();
  await updateCurrentDeleteBtn();

  const deleteColorsBtn = document.querySelector(".all-colors-delete-btn");
  deleteColorsBtn.classList.toggle("disabled", Object.keys(config).length === 0);
}

// Toggle gradient mode
function toggleGradientMode() {
  const { btnGradient, gradientControls, hexInputContainer, hexInput, colorCount, degreeSlider, degreeValue, popover } = globalPickerElements;
  document.body.style.transition = "none";
  if (!isGradientMode) {
    // Switch to gradient
    const currentHue = globalPicker.colors[0].hue;

    if (lastGradientColors && lastGradientColors.length > 1) {
      globalPicker.colors[0].set(lastGradientColors[0]);
      for (let i = 1; i < lastGradientColors.length; i++) {
        globalPicker.addColor(lastGradientColors[i]);
      }
    } else {
      const currentColor = globalPicker.colors[0].rgbaString;
      globalPicker.addColor(currentColor);
      globalPicker.colors[1].hue = currentHue;
    }

    globalPicker.setActiveColor(0);

    isGradientMode = true;
    popover.classList.add("gradient-mode");
    btnGradient.textContent = i18n.t("colorPicker.single");
    gradientControls.classList.remove("hidden");
    hexInputContainer.classList.add("hidden");
    colorCount.textContent = globalPicker.colors.length;
    degreeSlider.value = gradientDegree;
    degreeValue.textContent = `${gradientDegree}°`;
    rebuildColorList();
    updateGradient();
  } else {
    // Switch to single color
    lastGradientColors = globalPicker.colors.map((c) => c.rgbaString);
    const firstColor = globalPicker.colors[0].rgbaString;

    currentSwatch.style.background = firstColor;
    popover.classList.add("hidden");

    while (globalPicker.colors.length > 1) {
      globalPicker.removeColor(globalPicker.colors.length - 1);
    }

    globalPicker.colors[0].set(firstColor);
    globalPicker.setActiveColor(0);

    isGradientMode = false;
    popover.classList.remove("gradient-mode");
    btnGradient.textContent = i18n.t("colorPicker.gradient");
    gradientControls.classList.add("hidden");
    hexInputContainer.classList.remove("hidden");
    hexInput.value = globalPicker.colors[0].hexString;
  }
  setTimeout(() => {
    popover.classList.remove("hidden");
    document.body.style.transition = "";
  }, 50);
}

// Update color items display
function updateColorItemsDisplay() {
  const { colorListContainer } = globalPickerElements;
  const colorItems = colorListContainer.querySelectorAll(".gradient-color-item");

  colorItems.forEach((colorItem, index) => {
    if (globalPicker.colors[index]) {
      const miniSwatch = colorItem.querySelector("div.indicator");
      const miniInput = colorItem.querySelector("input");

      if (miniSwatch) {
        miniSwatch.style.background = globalPicker.colors[index].rgbaString;
      }

      if (miniInput && document.activeElement !== miniInput) {
        miniInput.value = globalPicker.colors[index].hexString;
      }
    }
  });
}

// Rebuild color list
async function rebuildColorList() {
  const { colorListContainer } = globalPickerElements;
  const existingItems = colorListContainer.querySelectorAll(".gradient-color-item");

  if (existingItems.length === globalPicker.colors.length) {
    return;
  }

  while (colorListContainer.firstChild) {
    colorListContainer.removeChild(colorListContainer.firstChild);
  }

  globalPicker.colors.forEach((color, index) => {
    const colorItem = document.createElement("div");
    colorItem.className = "gradient-color-item";

    const miniSwatch = document.createElement("div");
    miniSwatch.className = "indicator";
    miniSwatch.style.background = color.rgbaString;

    miniSwatch.addEventListener("click", (e) => {
      e.stopPropagation();
      globalPicker.setActiveColor(index);
      rebuildColorList();
    });

    const miniHexInput = document.createElement("input");
    miniHexInput.type = "text";
    miniHexInput.value = color.hexString;
    miniHexInput.placeholder = "#000000";

    miniHexInput.addEventListener("mousedown", (e) => e.stopPropagation());
    miniHexInput.addEventListener("click", (e) => e.stopPropagation());

    miniHexInput.addEventListener("input", (e) => {
      const hex = e.target.value;
      if (tinycolor(hex).isValid()) {
        globalPicker.colors[index].hexString = hex;
        miniSwatch.style.background = globalPicker.colors[index].rgbaString;
        if (currentSwatch) {
          if (isGradientMode && globalPicker.colors.length > 1) {
            const colors = globalPicker.colors.map((c) => c.rgbaString).join(", ");
            currentSwatch.style.background = `linear-gradient(${gradientDegree}deg, ${colors})`;
          } else {
            currentSwatch.style.background = globalPicker.colors[0].rgbaString;
          }
        }
      }
    });

    miniHexInput.addEventListener("change", async () => {
      if (tinycolor(miniHexInput.value).isValid()) {
        if (!currentEditingItem || !currentSwatch) return;

        let value;
        if (isGradientMode && globalPicker.colors.length > 1) {
          const colors = globalPicker.colors.map((c) => c.rgbaString).join(", ");
          value = `linear-gradient(${gradientDegree}deg, ${colors})`;
        } else {
          value = globalPicker.colors[0].rgbaString;
        }

        const storage = await browser.storage.local.get("colorSettings");
        const config = storage.colorSettings || {};
        config[currentEditingItem.key] = value;
        currentSwatch.style.background = value;

        await browser.storage.local.set({ colorSettings: config });
        await applyColorSettings();
        await updateCurrentDeleteBtn();
      } else {
        miniHexInput.value = globalPicker.colors[index].hexString;
      }
    });

    miniHexInput.addEventListener("focus", () => {
      globalPicker.setActiveColor(index);
      rebuildColorList();
    });

    if (globalPicker.colors.length > 2) {
      const deleteBtn = document.createElement("span");
      deleteBtn.appendChild(createSVG(svg_paths.crossIconPaths));
      deleteBtn.className = "btn btn-action";
      deleteBtn.title = "Remove color";

      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        globalPicker.removeColor(index);
        globalPickerElements.colorCount.textContent = globalPicker.colors.length;

        if (globalPicker.activeColor >= globalPicker.colors.length) {
          globalPicker.setActiveColor(globalPicker.colors.length - 1);
        }

        rebuildColorList();

        if (currentSwatch) {
          const colors = globalPicker.colors.map((c) => c.rgbaString).join(", ");
          currentSwatch.style.background = `linear-gradient(${gradientDegree}deg, ${colors})`;
        }

        if (!currentEditingItem || !currentSwatch) return;

        const colors = globalPicker.colors.map((c) => c.rgbaString).join(", ");
        const value = `linear-gradient(${gradientDegree}deg, ${colors})`;

        const storage = await browser.storage.local.get("colorSettings");
        const config = storage.colorSettings || {};
        config[currentEditingItem.key] = value;
        currentSwatch.style.background = value;

        await browser.storage.local.set({ colorSettings: config });
        await applyColorSettings();
        await updateCurrentDeleteBtn();
      });

      colorItem.appendChild(deleteBtn);
    }

    colorItem.appendChild(miniSwatch);
    colorItem.appendChild(miniHexInput);
    colorListContainer.appendChild(colorItem);
  });
  await destroyOtherSimpleBars("colorExpandableSection");
  await activateSimpleBar("gradientColorList");
}

// Update delete button
async function updateCurrentDeleteBtn() {
  if (!currentDeleteBtn || !currentEditingItem) return;

  const storage = await browser.storage.local.get("colorSettings");
  const config = storage.colorSettings || {};
  const currentValue = config[currentEditingItem.key];

  if (!currentValue || currentValue === currentEditingItem.default) {
    currentDeleteBtn.classList.add("disabled");
  } else {
    currentDeleteBtn.classList.remove("disabled");
  }
}

// Open picker for a swatch
async function openPickerForSwatch(item, swatch, btnDelete) {
  initGlobalPicker();

  // Clear previous state completely
  currentEditingItem = null;
  currentSwatch = null;
  currentDeleteBtn = null;
  isGradientMode = false;
  gradientDegree = 90;
  lastGradientColors = null;

  const colorStorage = await browser.storage.local.get("colorSettings");
  const colorConfig = colorStorage.colorSettings || {};
  const initialColor = colorConfig[item.key] || item.default;
  const isInitiallyGradient = initialColor && initialColor.includes("linear-gradient");

  // Parse initial color
  let initialColors = [item.default];
  if (isInitiallyGradient) {
    const degreeMatch = initialColor.match(/linear-gradient\((\d+)deg/);
    if (degreeMatch) {
      gradientDegree = parseInt(degreeMatch[1]);
    }

    const colors = initialColor.match(/rgba?\([^)]+\)/g) || [];
    if (colors.length > 0) {
      initialColors = colors;
      lastGradientColors = [...colors]; // Clone array
      isGradientMode = true;
    } else {
      initialColors = [item.default];
      isGradientMode = false;
    }
  } else {
    initialColors = [initialColor];
    isGradientMode = false;
  }

  // Completely reset picker colors
  globalPicker.off("color:change");
  globalPicker.off("input:end");

  // Remove ALL colors
  while (globalPicker.colors.length > 0) {
    globalPicker.removeColor(0);
  }

  // Add fresh colors
  for (let i = 0; i < initialColors.length; i++) {
    if (i === 0) {
      globalPicker.addColor(initialColors[0]);
    } else {
      globalPicker.addColor(initialColors[i]);
    }
  }

  globalPicker.setActiveColor(0);

  // Update UI
  const { btnBlur, btnGradient, gradientControls, hexInputContainer, hexInput, colorCount, degreeSlider, degreeValue, popover } = globalPickerElements;

  btnBlur.style.display = item.key === "foregroundColor" ? "inline-block" : "none";
  btnGradient.style.display = item.enableGradient ? "inline-block" : "none";

  isBlurMode = colorConfig.applyFgBlur;
  btnBlur.textContent = i18n.t("settings.backgroundImage.blur") + " (" + (isBlurMode ? i18n.t("common.disable") : i18n.t("common.enable")) + ")";

  if (isGradientMode) {
    popover.classList.add("gradient-mode");
    gradientControls.classList.remove("hidden");
    hexInputContainer.classList.add("hidden");
    btnGradient.textContent = i18n.t("colorPicker.single");
    degreeSlider.value = gradientDegree;
    degreeValue.textContent = `${gradientDegree}°`;
    colorCount.textContent = globalPicker.colors.length;
    await rebuildColorList();
  } else {
    popover.classList.remove("gradient-mode");
    gradientControls.classList.add("hidden");
    hexInputContainer.classList.remove("hidden");
    btnGradient.textContent = i18n.t("colorPicker.gradient");
    hexInput.value = globalPicker.colors[0].hexString;
    // Clear color list
    while (globalPickerElements.colorListContainer.firstChild) {
      globalPickerElements.colorListContainer.removeChild(globalPickerElements.colorListContainer.firstChild);
    }
  }

  // set current state
  currentEditingItem = item;
  currentSwatch = swatch;
  currentDeleteBtn = btnDelete;

  setupDynamicPickerEvents();

  // Append popover to swatch's parent control
  const control = swatch.parentElement;
  control.appendChild(popover);

  popover.classList.remove("hidden");
  const colorList = document.querySelector(".color.expandable-section");
  const scrollEl = simpleBarInstances.get(colorList)?.getScrollElement();
  const containerRect = scrollEl.getBoundingClientRect();
  const popoverTop = popover.getBoundingClientRect().top - containerRect.top + scrollEl.scrollTop - 10;
  await smoothScrollTo(scrollEl, popoverTop);
}

// Close picker
async function closePicker() {
  if (globalPickerElements) {
    globalPickerElements.popover.classList.add("hidden");
  }
  currentEditingItem = null;
  currentSwatch = null;
  currentDeleteBtn = null;
  await activateSimpleBar(document.querySelector(".color.expandable-section"));
}

// Update all swatches when theme changes
async function updateAllSwatchesForTheme() {
  const colorStorage = await browser.storage.local.get("colorSettings");
  const colorConfig = colorStorage.colorSettings || {};
  const COLOR_SETTINGS = getColorSettings();

  // Update all swatches in DOM
  const allSwatches = document.querySelectorAll(".color-swatch");
  allSwatches.forEach((swatch, index) => {
    if (COLOR_SETTINGS[index]) {
      const item = COLOR_SETTINGS[index];
      const value = colorConfig[item.key] || getDefaultCSSValue(item);
      swatch.style.background = value;
    }
  });

  // Update all delete buttons
  const allDeleteBtns = document.querySelectorAll(".color-delete-btn");
  allDeleteBtns.forEach((btnDelete, index) => {
    if (COLOR_SETTINGS[index]) {
      const item = COLOR_SETTINGS[index];
      const currentValue = colorConfig[item.key];
      const defaultValue = getDefaultCSSValue(item);

      if (!currentValue || currentValue === defaultValue) {
        btnDelete.classList.add("disabled");
      } else {
        btnDelete.classList.remove("disabled");
      }
    }
  });

  const deleteColorsBtn = document.querySelector(".all-colors-delete-btn");
  deleteColorsBtn.classList.toggle("disabled", Object.keys(colorConfig).length === 0);

  // If picker is currently open, update it too
  if (currentEditingItem && currentSwatch) {
    // Close picker temporarily
    closePicker();

    // Wait a bit then reopen with new values
    setTimeout(async () => {
      // Find the swatch and button again
      const COLOR_SETTINGS = getColorSettings();
      const itemIndex = COLOR_SETTINGS.findIndex((i) => i.key === currentEditingItem.key);
      if (itemIndex >= 0) {
        const swatch = document.querySelectorAll(".color-swatch")[itemIndex];
        const btnDelete = document.querySelectorAll(".color-delete-btn")[itemIndex];
        if (swatch && btnDelete) {
          await openPickerForSwatch(currentEditingItem, swatch, btnDelete);
        }
      }
    }, 100);
  }
}
