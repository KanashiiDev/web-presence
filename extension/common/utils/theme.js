// Apply Theme
async function applyThemeSettings() {
  const theme = await browser.storage.local.get("theme");
  const currentTheme = theme.theme || "dark";
  document.body.dataset.theme = currentTheme;
  document.documentElement.dataset.theme = currentTheme;
  return currentTheme;
}

// Update Color Delete Button Visibility
function updateDeleteButtonVisibility(item, pickerValue, btnDelete, colorConfig) {
  const currentValue = colorConfig[item.key];
  const defaultValue = item.default;

  // If there is no value in the config, it means the default is being used
  if (!currentValue) {
    btnDelete.classList.add("disabled");
    return;
  }

  // Normalize both colors with tinycolor
  const current = tinycolor(currentValue);
  const defaultColor = tinycolor(defaultValue);

  // Compare RGBA values
  const currentRgba = current.toRgb();
  const defaultRgba = defaultColor.toRgb();

  const isDefault =
    currentRgba.r === defaultRgba.r && currentRgba.g === defaultRgba.g && currentRgba.b === defaultRgba.b && Math.abs(currentRgba.a - defaultRgba.a) < 0.01;

  if (isDefault) {
    btnDelete.classList.add("disabled");
  } else {
    btnDelete.classList.remove("disabled");
  }
}
