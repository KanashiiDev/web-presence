/**
 * Color settings: gradient parsing, color derivation and CSS variable application.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lighten/darken amounts used to derive the foreground color scale. */
const FG_STEPS = [0, 6, 12, 18, 26, 36, 48];

/** Amount used for "hover" variants of colors. */
const HOVER_AMOUNT = 12;

/** Amount used for "bright" variants of colors. */
const BRIGHT_AMOUNT = 12;

/** Brightness shifts (negative = darker) for derived text colors. */
const TEXT_SECONDARY_SHIFT = -12;
const TEXT_MUTED_SHIFT = -24;

/** Direction used when a gradient string does not specify one. */
const DEFAULT_GRADIENT_DIRECTION = "90deg";

/** Matches a gradient direction: an angle ("135deg") or a keyword ("to right"). */
const GRADIENT_DIRECTION_RE = /^(-?\d*\.?\d+(?:deg|grad|rad|turn)|to\s)/i;

/** Matches one or two trailing stop positions, e.g. " 40%" or " 10% 30%". */
const GRADIENT_POSITION_RE = /(?:\s+-?\d*\.?\d+(?:%|px|em|rem|vw|vh|deg)?){1,2}$/;

/** Background image defaults, used when a stored value is missing. */
const BG_DEFAULTS = { positionX: 50, blur: 0, brightness: 100, saturation: 100 };

/**
 * CSS variable name of the n-th foreground scale entry.
 * @param {number} index Zero-based index into FG_STEPS.
 * @returns {string}
 */
function fgVar(index) {
  return `--foreground-color-${(index + 1) * 100}`;
}

// ---------------------------------------------------------------------------
// Small DOM helper
// ---------------------------------------------------------------------------

/**
 * Sets a CSS property on <body>, or removes it when the value is empty.
 * @param {string} prop CSS property / custom property name.
 * @param {string|null|undefined} value Value to set.
 */
function setOrRemove(prop, value) {
  if (value) {
    document.body.style.setProperty(prop, value);
  } else {
    document.body.style.removeProperty(prop);
  }
}

// ---------------------------------------------------------------------------
// Gradient parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GradientStop
 * @property {string} color    Any CSS color (hex, rgb[a], hsl[a], named).
 * @property {string} position Stop position(s) such as "40%", or "" if absent.
 */

/**
 * @typedef {Object} GradientInfo
 * @property {string} direction Original direction ("135deg", "to right") or the default.
 * @property {number|null} degree Numeric angle in degrees, or null for keyword/non-deg directions.
 * @property {GradientStop[]} stops Color stops in order.
 */

/**
 * Checks whether a value is a linear-gradient string.
 * @param {*} value
 * @returns {boolean}
 */
function isGradient(value) {
  return typeof value === "string" && value.includes("linear-gradient(");
}

/**
 * Splits a string on commas that are not nested inside parentheses.
 * @param {string} str
 * @returns {string[]}
 */
function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const ch of str) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  parts.push(current.trim());
  return parts.filter(Boolean);
}

/**
 * Splits a single stop ("rgba(0,0,0,.5) 40%") into color and position.
 * @param {string} part
 * @returns {GradientStop}
 */
function parseGradientStop(part) {
  const match = part.match(GRADIENT_POSITION_RE);
  if (!match) return { color: part, position: "" };
  return {
    color: part.slice(0, match.index).trim(),
    position: match[0].trim(),
  };
}

/**
 * Parses a linear-gradient string into direction and color stops.
 * @param {string} gradientString
 * @returns {GradientInfo}
 */
function parseGradient(gradientString) {
  const start = gradientString.indexOf("(", gradientString.indexOf("linear-gradient"));
  const end = gradientString.lastIndexOf(")");
  const parts = splitTopLevel(gradientString.slice(start + 1, end));

  let direction = DEFAULT_GRADIENT_DIRECTION;
  if (parts.length && GRADIENT_DIRECTION_RE.test(parts[0])) {
    direction = parts.shift();
  }

  const degree = /deg$/i.test(direction) ? parseFloat(direction) : null;
  const stops = parts.map(parseGradientStop);

  return { direction, degree, stops };
}

// ---------------------------------------------------------------------------
// Color derivation
// ---------------------------------------------------------------------------

/**
 * Lightens (positive) or darkens (negative) a color while preserving alpha.
 * Invalid colors are returned unchanged.
 * @param {string} color Any CSS color string.
 * @param {number} amount Percentage to shift; negative values darken.
 * @returns {string} Color as an rgb/rgba string (or the original input if invalid).
 */
function shiftColor(color, amount) {
  const base = tinycolor(color);
  if (!base.isValid()) return color;

  const alpha = base.getAlpha();
  const shifted = amount >= 0 ? base.clone().lighten(amount) : base.clone().darken(-amount);
  shifted.setAlpha(alpha);
  return shifted.toRgbString();
}

/**
 * Applies a color transform to a single color, or to every stop of a gradient.
 * Gradient direction and stop positions are preserved.
 * @param {string} value A CSS color or a linear-gradient string.
 * @param {(color: string) => string} fn Transform applied to each color.
 * @returns {string}
 */
function mapColor(value, fn) {
  if (!isGradient(value)) return fn(value);

  const { direction, stops } = parseGradient(value);
  const mapped = stops.map((stop) => {
    const color = fn(stop.color);
    return stop.position ? `${color} ${stop.position}` : color;
  });
  return `linear-gradient(${direction}, ${mapped.join(", ")})`;
}

/**
 * Returns a lighter (positive) or darker (negative) variant of a color or gradient.
 * @param {string} value A CSS color or a linear-gradient string.
 * @param {number} amount Percentage to shift; negative values darken.
 * @returns {string}
 */
function getColorVariant(value, amount) {
  return mapColor(value, (color) => shiftColor(color, amount));
}

/**
 * Builds the foreground color scale (one entry per FG_STEPS item).
 * Works for single colors and gradients alike.
 * @param {string} value A CSS color or a linear-gradient string.
 * @param {"dark"|"light"} [theme="dark"] Dark themes lighten, light themes darken.
 * @returns {string[]}
 */
function generateForegroundScale(value, theme = "dark") {
  const sign = theme === "dark" ? 1 : -1;
  return FG_STEPS.map((step) => getColorVariant(value, sign * step));
}

// ---------------------------------------------------------------------------
// CSS defaults
// ---------------------------------------------------------------------------

/**
 * Reads a CSS custom property from :root and normalizes it to an rgb/rgba string.
 * @param {string} cssVar Custom property name, e.g. "--accent-color".
 * @returns {string|null} Normalized color, or null if missing/invalid.
 */
function getCSSThemeDefault(cssVar) {
  const computed = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  if (!computed) return null;

  const color = tinycolor(computed);
  return color.isValid() ? color.toRgbString() : null;
}

/**
 * Returns the theme default for a color setting item.
 * @param {{key: string, cssVar: string}} item
 * @returns {string|null}
 */
function getDefaultCSSValue(item) {
  if (item.key === "foregroundColor") {
    return getCSSThemeDefault("--foreground-color-100");
  }
  return getCSSThemeDefault(item.cssVar);
}

// ---------------------------------------------------------------------------
// Settings panel - color settings
// ---------------------------------------------------------------------------

/**
 * Static color setting definitions (no theme-dependent values).
 * `variants` lists extra derived variables, each named `${cssVar}-${suffix}`
 * and shifted by `amount` (positive = lighter, negative = darker).
 */
const COLOR_SETTING_DEFS = [
  { key: "backgroundColor", i18n: "settings.color.backgroundColor", cssVar: "--background-color", enableGradient: true },
  { key: "foregroundColor", i18n: "settings.color.foregroundColor", cssVar: "--foreground-color", enableGradient: true },
  { key: "accentColor", i18n: "settings.color.accentColor", cssVar: "--accent-color", enableGradient: true },
  {
    key: "scrollbarColor",
    i18n: "settings.color.scrollbarColor",
    cssVar: "--scrollbar-color",
    enableGradient: true,
    variants: [{ suffix: "hover", amount: HOVER_AMOUNT }],
  },
  {
    key: "borderColor",
    i18n: "settings.color.borderColor",
    cssVar: "--border-color",
    variants: [
      { suffix: "hover", amount: HOVER_AMOUNT },
      { suffix: "bright", amount: BRIGHT_AMOUNT },
    ],
  },
  { key: "shadowColor", i18n: "settings.color.shadowColor", cssVar: "--shadow-color" },
  { key: "textColor", i18n: "settings.color.textColor", cssVar: "--text-color-primary" },
  { key: "accentButtonColor", i18n: "settings.color.accentButtonColor", cssVar: "--text-color-btn" },
  {
    key: "linkColor",
    i18n: "settings.color.linkColor",
    cssVar: "--link-color",
    variants: [{ suffix: "bright", amount: BRIGHT_AMOUNT }],
  },
];

/**
 * Returns the color settings for the settings panel, including the
 * current theme defaults (read from CSS on every call, so they stay fresh).
 * @returns {Array<Object>}
 */
function getColorSettings() {
  return COLOR_SETTING_DEFS.map((def) => ({ ...def, default: getDefaultCSSValue(def) }));
}

// ---------------------------------------------------------------------------
// Applying color settings
// ---------------------------------------------------------------------------

/** Persists the inline style of <body> so it can be restored quickly on load. */
const saveStyleAttrs = debounce(async () => {
  try {
    await browser.storage.local.set({
      styleAttrs: document.body.getAttribute("style"),
    });
  } catch (err) {
    console.error("[colors] Failed to save style attributes:", err);
  }
}, 100);

/**
 * Applies the base colors (and their derived variants) from the config.
 * @param {Object} config Stored color settings.
 */
function applyBaseColors(config) {
  for (const item of COLOR_SETTING_DEFS) {
    const val = config[item.key];
    setOrRemove(item.cssVar, val);

    for (const { suffix, amount } of item.variants ?? []) {
      setOrRemove(`${item.cssVar}-${suffix}`, val ? getColorVariant(val, amount) : null);
    }
  }
}

/**
 * Derives the foreground color scale, or clears it when no foreground is set.
 * @param {Object} config Stored color settings.
 */
function applyForegroundScale(config) {
  if (!config.foregroundColor) {
    FG_STEPS.forEach((_, i) => document.body.style.removeProperty(fgVar(i)));
    return;
  }

  const theme = document.body.getAttribute("data-theme") || "dark";
  generateForegroundScale(config.foregroundColor, theme).forEach((value, i) => {
    document.body.style.setProperty(fgVar(i), value);
  });
}

/**
 * Derives the secondary and muted text colors from the primary text color.
 * (The primary color itself is applied in applyBaseColors.)
 * @param {Object} config Stored color settings.
 */
function applyTextColors(config) {
  const text = config.textColor;
  setOrRemove("--text-color-secondary", text ? getColorVariant(text, TEXT_SECONDARY_SHIFT) : null);
  setOrRemove("--text-color-muted", text ? getColorVariant(text, TEXT_MUTED_SHIFT) : null);
}

/**
 * Derives the accent "bright", "border" and "border-bright" variants.
 * These are always based on the user's chosen accent color and do not
 * depend on the current theme.
 * @param {Object} config Stored color settings.
 */
function applyAccentVariants(config) {
  const accent = config.accentColor;

  // The border is always a single color: the accent itself, or the middle stop of a gradient.
  // (For an even stop count, the later of the two middle stops is used.)
  let border = null;
  if (accent) {
    if (isGradient(accent)) {
      const { stops } = parseGradient(accent);
      const middle = stops[Math.floor(stops.length / 2)];
      border = middle ? middle.color : null;
    } else {
      border = accent;
    }
  }

  setOrRemove("--accent-color-bright", accent ? getColorVariant(accent, BRIGHT_AMOUNT) : null);
  setOrRemove("--accent-color-border", border);
  setOrRemove("--accent-color-border-bright", border ? getColorVariant(border, BRIGHT_AMOUNT) : null);
}

/**
 * Reads the stored color settings and applies them to <body> as CSS variables.
 * @param {boolean} [save=true] Whether to persist the resulting inline style.
 * @returns {Promise<void>}
 */
async function applyColorSettings(save = true) {
  let config;
  try {
    ({ colorSettings: config = {} } = await browser.storage.local.get("colorSettings"));
  } catch (err) {
    console.error("[colors] Failed to read color settings:", err);
    return;
  }

  applyBaseColors(config);
  applyForegroundScale(config);
  applyTextColors(config);
  applyAccentVariants(config);
  document.body.classList.toggle("fg-blur", !!config.applyFgBlur);

  if (save) saveStyleAttrs();
}

// ---------------------------------------------------------------------------
// Background image settings
// ---------------------------------------------------------------------------

/**
 * Escapes a string for safe use inside a double-quoted CSS url("...").
 * @param {string} url
 * @returns {string}
 */
function escapeCssUrl(url) {
  return String(url).replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\a ");
}

/**
 * Reads the stored background settings and applies them to <body>.
 * @param {boolean} [save=true] Whether to persist the resulting inline style.
 * @returns {Promise<void>}
 */
async function applyBackgroundSettings(save = true) {
  let bgSettings;
  try {
    ({ backgroundSettings: bgSettings } = await browser.storage.local.get("backgroundSettings"));
  } catch (err) {
    console.error("[colors] Failed to read background settings:", err);
    return;
  }

  if (!bgSettings || !bgSettings.image) {
    setOrRemove("--backgroundImage", null);
    setOrRemove("--backgroundPositionX", null);
    setOrRemove("--filter", null);
  } else {
    const positionX = bgSettings.positionX ?? BG_DEFAULTS.positionX;
    const blur = bgSettings.blur ?? BG_DEFAULTS.blur;
    const brightness = bgSettings.brightness ?? BG_DEFAULTS.brightness;
    const saturation = bgSettings.saturation ?? BG_DEFAULTS.saturation;

    setOrRemove("--backgroundImage", `url("${escapeCssUrl(bgSettings.image)}")`);
    setOrRemove("--backgroundPositionX", `${positionX}%`);
    setOrRemove("--filter", `blur(${blur}px) brightness(${brightness}%) saturate(${saturation}%)`);
  }

  if (save) saveStyleAttrs();
}
