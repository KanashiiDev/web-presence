// Check if value is a gradient
function isGradient(value) {
  return value && value.includes("linear-gradient");
}

// Parse the gradient (degree and colors)
function parseGradient(gradientString) {
  const degreeMatch = gradientString.match(/linear-gradient\((\d+)deg/);
  const degree = degreeMatch ? degreeMatch[1] : "90";
  const colors = extractGradientColors(gradientString);
  return { degree, colors };
}

// Extract colors from the gradient
function extractGradientColors(gradientString) {
  const match = gradientString.match(/rgba?\([^)]+\)/g);
  return match || [];
}

// Create foreground scales for the gradient (each one is a gradient)
function generateForegroundScaleGradients(gradientInfo, theme = "dark") {
  const { degree, colors } = gradientInfo;
  const steps = [0, 6, 12, 18, 26, 36, 48];

  return steps.map((step) => {
    // Lighten/darken for each color
    const scaledColors = colors.map((color) => {
      const base = tinycolor(color);
      const alpha = base.getAlpha();
      const scaled = theme === "dark" ? base.clone().lighten(step) : base.clone().darken(step);
      scaled.setAlpha(alpha);
      return scaled.toRgbString();
    });

    // Create new gradient
    return `linear-gradient(${degree}deg, ${scaledColors.join(", ")})`;
  });
}

// Create foreground scales for a single color
function generateForegroundScale(baseColor, theme = "dark") {
  const base = tinycolor(baseColor);
  const alpha = base.getAlpha();

  const steps = [0, 6, 12, 18, 26, 36, 48];

  return steps.map((step) => {
    const color = theme === "dark" ? base.clone().lighten(step) : base.clone().darken(step);
    color.setAlpha(alpha);
    return color.toRgbString();
  });
}

// Get the default value from CSS
function getCSSThemeDefault(cssVar) {
  const computed = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();

  // If there is a value, convert it to RGBA format
  if (computed) {
    const color = tinycolor(computed);
    return color.toRgbString();
  }
}

function getDefaultCSSValue(item) {
  if (item.key === "foregroundColor") {
    return getCSSThemeDefault("--foreground-color-100");
  }
  return getCSSThemeDefault(item.cssVar);
}

function getColorVariant(value, brightValue) {
  if (isGradient(value)) {
    const gradientInfo = parseGradient(value);
    const brightenedColors = gradientInfo.colors.map((color) => {
      const base = tinycolor(color);
      const alpha = base.getAlpha();
      const bright = brightValue > 0 ? base.clone().lighten(brightValue) : base.clone().darken(Math.abs(brightValue));
      bright.setAlpha(alpha);
      return bright.toRgbString();
    });
    return `linear-gradient(${gradientInfo.degree}deg, ${brightenedColors.join(", ")})`;
  }

  const base = tinycolor(value);
  const alpha = base.getAlpha();
  const bright = brightValue > 0 ? base.clone().lighten(brightValue) : base.clone().darken(Math.abs(brightValue));
  bright.setAlpha(alpha);
  return bright.toRgbString();
}

// Settings Panel - Color Settings
function getColorSettings() {
  return [
    {
      key: "backgroundColor",
      i18n: "settings.color.backgroundColor",
      cssVar: "--background-color",
      default: getCSSThemeDefault("--background-color"),
      enableGradient: 1,
    },
    {
      key: "foregroundColor",
      i18n: "settings.color.foregroundColor",
      cssVar: "--foreground-color",
      default: getCSSThemeDefault("--foreground-color-100"),
      enableGradient: 1,
    },
    {
      key: "accentColor",
      i18n: "settings.color.accentColor",
      cssVar: "--accent-color",
      default: getCSSThemeDefault("--accent-color"),
      enableGradient: 1,
    },
    {
      key: "scrollbarColor",
      i18n: "settings.color.scrollbarColor",
      cssVar: "--scrollbar-color",
      default: getCSSThemeDefault("--scrollbar-color"),
      enableGradient: 1,
      bright: { value: "hover", amount: 12 },
    },
    {
      key: "borderColor",
      i18n: "settings.color.borderColor",
      cssVar: "--border-color",
      default: getCSSThemeDefault("--border-color"),
      bright: { value: "hover", amount: 12 },
    },
    {
      key: "shadowColor",
      i18n: "settings.color.shadowColor",
      cssVar: "--shadow-color",
      default: getCSSThemeDefault("--shadow-color"),
    },
    {
      key: "textColor",
      i18n: "settings.color.textColor",
      cssVar: "--text-color-primary",
      default: getCSSThemeDefault("--text-color-primary"),
    },
    {
      key: "accentButtonColor",
      i18n: "settings.color.accentButtonColor",
      cssVar: "--text-color-btn",
      default: getCSSThemeDefault("--text-color-btn"),
    },
    {
      key: "linkColor",
      i18n: "settings.color.linkColor",
      cssVar: "--link-color",
      default: getCSSThemeDefault("--link-color"),
      bright: { value: "bright", amount: 12 },
    },
  ];
}

// Color Settings
const saveStyleAttrs = debounce(async () => {
  await browser.storage.local.set({
    styleAttrs: document.body.getAttribute("style"),
  });
}, 100);

async function applyColorSettings(save = true) {
  const stored = await browser.storage.local.get("colorSettings");
  const config = stored.colorSettings || {};
  const COLORS = getColorSettings();

  for (const item of COLORS) {
    const val = config[item.key];
    if (val) {
      document.body.style.setProperty(item.cssVar, val);
    } else {
      document.body.style.removeProperty(item.cssVar);

      // Clear derived colors when the foreground is deleted
      if (item.key === "foregroundColor") {
        for (let i = 1; i <= 7; i++) {
          document.body.style.removeProperty(`--foreground-color-${i * 100}`);
        }
      }
    }
    if (item.bright) {
      if (config[item.key]) {
        document.body.style.setProperty(`${item.cssVar}-${item.bright.value}`, getColorVariant(config[item.key], item.bright.amount));
      } else {
        document.body.style.removeProperty(`${item.cssVar}-${item.bright.value}`);
      }
    }
  }

  if (config.applyFgBlur) {
    document.body.classList.add("fg-blur");
  } else {
    document.body.classList.remove("fg-blur");
  }

  // Foreground derivation
  if (config.foregroundColor) {
    const theme = document.body.getAttribute("data-theme") || "dark";

    // Gradient handling
    if (isGradient(config.foregroundColor)) {
      const gradientInfo = parseGradient(config.foregroundColor);
      const fgScaleGradients = generateForegroundScaleGradients(gradientInfo, theme);

      fgScaleGradients.forEach((gradient, index) => {
        document.body.style.setProperty(`--foreground-color-${(index + 1) * 100}`, gradient);
      });
    } else {
      const fgScale = generateForegroundScale(config.foregroundColor, theme);
      fgScale.forEach((color, index) => {
        document.body.style.setProperty(`--foreground-color-${(index + 1) * 100}`, color);
      });
    }
  }

  if (config.textColor) {
    document.body.style.setProperty("--text-color-primary", config.textColor);
    document.body.style.setProperty("--text-color-secondary", getColorVariant(config.textColor, -12));
    document.body.style.setProperty("--text-color-muted", getColorVariant(config.textColor, -24));
  } else {
    document.body.style.removeProperty("--text-color-primary");
    document.body.style.removeProperty("--text-color-secondary");
    document.body.style.removeProperty("--text-color-muted");
  }

  // Accent color bright variant
  if (config.accentColor) {
    if (isGradient(config.accentColor)) {
      const gradientInfo = parseGradient(config.accentColor);

      // Create a bright version for the entire gradient
      const brightGradient = getColorVariant(config.accentColor, 12);
      document.body.style.setProperty("--accent-color-bright", brightGradient);

      // Use the middle color for the border
      const middleIndex = Math.floor(gradientInfo.colors.length / 2);
      const borderColor = gradientInfo.colors[middleIndex];
      document.body.style.setProperty("--accent-color-border", borderColor);
    } else {
      const base = tinycolor(config.accentColor);
      const alpha = base.getAlpha();
      const bright = base.clone().lighten(12);
      bright.setAlpha(alpha);
      document.body.style.setProperty("--accent-color-bright", bright.toRgbString());

      // If it's a single color, use the same color
      document.body.style.setProperty("--accent-color-border", config.accentColor);
    }
  } else {
    // Clear the bright variant and border when the accent color is deleted
    document.body.style.removeProperty("--accent-color-bright");
    document.body.style.removeProperty("--accent-color-border");
  }

  if (save) saveStyleAttrs();
}

// Background Image settings
async function applyBackgroundSettings(save = true) {
  const bgStorage = await browser.storage.local.get("backgroundSettings");
  const bgSettings = bgStorage.backgroundSettings;

  if (!bgSettings || !bgSettings.image) {
    document.body.style.removeProperty("--backgroundImage");
    document.body.style.removeProperty("--backgroundPositionX");
    document.body.style.removeProperty("--filter");
  } else {
    document.body.style.setProperty("--backgroundImage", `url(${bgSettings.image})`);
    document.body.style.setProperty("--backgroundPositionX", `${bgSettings.positionX}%`);
    document.body.style.setProperty("--filter", `blur(${bgSettings.blur}px) brightness(${bgSettings.brightness}%) saturate(${bgSettings.saturation}%)`);
  }

  if (save) saveStyleAttrs();
}
