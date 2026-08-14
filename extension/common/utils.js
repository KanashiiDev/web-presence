// Default Parser Options
const DEFAULT_PARSER_OPTIONS = {
  showArtist: { type: "checkbox", value: true },
  showSource: { type: "checkbox", value: true },
  showCover: { type: "checkbox", value: true },
  showTimeLeft: { type: "checkbox", value: true },
  showButtons: { type: "checkbox", value: true },
  showFavIcon: { type: "checkbox", value: false },
  saveHistory: { type: "checkbox", value: true },
  customCover: { type: "checkbox", value: false },
  customCoverUrl: { type: "text", value: "" },
  customButton1: { type: "checkbox", value: false },
  customButton1Text: { type: "text", value: "" },
  customButton1Link: { type: "text", value: "" },
  customButton2: { type: "checkbox", value: false },
  customButton2Text: { type: "text", value: "" },
  customButton2Link: { type: "text", value: "" },
  customPlaceholder: { type: "checkbox", value: false },
  customPlaceholderUrl: { type: "text", value: "" },
};

function applyParserOptionLabels() {
  for (const key of Object.keys(DEFAULT_PARSER_OPTIONS)) {
    DEFAULT_PARSER_OPTIONS[key].label = i18n.t(`parserOptions.${key}`);
  }
}

// Motion Preference
const MotionPreference = {
  SYSTEM: "system",
  ALWAYS: "always",
  NEVER: "never",
};

let cachedMotion = MotionPreference.SYSTEM;
const motionKey = "motionPreference";

async function setMotionPreference(value) {
  if (!Object.values(MotionPreference).includes(value)) return;
  await browser.storage.local.set({ [motionKey]: value });
  cachedMotion = value;
  setMotionClass();
}

function setMotionClass() {
  document.documentElement.classList.toggle("reduced-motion", !shouldAnimate());
}

async function initMotionPreference() {
  const result = await browser.storage.local.get(motionKey);
  cachedMotion = result[motionKey] ?? MotionPreference.ALWAYS;
  setMotionClass();
}

function shouldAnimate() {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  switch (cachedMotion) {
    case MotionPreference.ALWAYS:
      return true;
    case MotionPreference.NEVER:
      return false;
    case MotionPreference.SYSTEM:
    default:
      return !prefersReduced;
  }
}

// Logs
// Write helper
function _writeDebugLog(level, args) {
  const _LOG_SOURCE = (() => {
    if (typeof window === "undefined") return "background";
    return "content";
  })();

  const _IS_BACKGROUND = _LOG_SOURCE === "background";
  try {
    if (_IS_BACKGROUND) {
      if (typeof debugLog === "function") {
        debugLog(level, _LOG_SOURCE, args);
      }
    } else {
      if (typeof browser !== "undefined" && browser?.runtime?.sendMessage) {
        browser.runtime.sendMessage({ action: "debug_log", level, source: _LOG_SOURCE, args: args.map(String) }).catch(() => {});
      }
    }
  } catch {}
}

// Debug mode check
const getDebugMode = async () => {
  try {
    const stored = await browser.storage.local.get("debugMode");
    return stored?.debugMode === 1 ? true : stored?.debugMode === 0 ? false : (CONFIG?.debugMode ?? false);
  } catch {
    return CONFIG?.debugMode ?? false;
  }
};

// Log functions
const logInfo = async (...args) => {
  if (!(await getDebugMode())) return;

  const _shouldPersist = (args) => {
    return typeof args[0] === "string" && /^\[[\w\s:\/\-]+\]/.test(args[0]);
  };

  const _stripConsoleFormatting = (args) => {
    if (typeof args[0] !== "string" || !args[0].includes("%c")) return args;
    const msg = args[0].replace(/%c/g, "");
    const cleaned = [msg];
    let cssSkip = (args[0].match(/%c/g) || []).length;
    for (let i = 1; i < args.length; i++) {
      if (cssSkip > 0 && typeof args[i] === "string" && args[i].includes("color:")) {
        cssSkip--;
        continue;
      }
      cleaned.push(args[i]);
    }
    return cleaned;
  };

  // Only those starting with [TAG] in IndexedDB
  if (_shouldPersist(args)) {
    _writeDebugLog("info", _stripConsoleFormatting(args));
  }

  const prefix = "[WEB-PRESENCE - INFO]";
  if (typeof args[0] === "string" && args[0].includes("%c")) {
    console.info(`%c${prefix}%c ${args[0]}`, "color:#2196f3; font-weight:bold;", "color:#fff;", ...args.slice(1));
  } else {
    console.info(`%c${prefix}`, "color:#2196f3; font-weight:bold;", ...args);
  }
};

const logWarn = async (...args) => {
  if (!(await getDebugMode())) return;

  _writeDebugLog("warn", args);

  const prefix = "%c[WEB-PRESENCE - WARN]%c";
  const prefixCSS = ["color:#ff9800; font-weight:bold;", "color:#fff;"];
  console.log(prefix, ...prefixCSS, ...args);
};

const errorFilter = (() => {
  const ignorePatterns = [
    /No tab with id/i,
    /extension context invalidated/i,
    /could not establish connection/i,
    /failed to fetch/i,
    /update failed after all retries/i,
    /update failed \(no response\)/i,
    /Request timed out/i,
    /signal is aborted without reason/i,
    /Nonexistent script ID/i,
    /Cannot read properties of undefined \(reading \'getScripts\'\)/i,
    /No compatible userscript API available/i,
  ];

  const normalizeError = (err) => {
    if (!err) return "";
    if (typeof err === "string") return err;
    return err.message || err.stack || String(err);
  };

  const shouldIgnore = (error) => {
    const text = normalizeError(error);
    return ignorePatterns.some((re) => re.test(text));
  };

  return { shouldIgnore };
})();

const logError = (...a) => {
  const safeStringify = (obj) => {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
  };

  const shouldIgnoreAny = a.some((arg) => errorFilter.shouldIgnore(arg));

  if (!shouldIgnoreAny) {
    _writeDebugLog("error", a);

    console.error(
      "[web-presence - ERROR]",
      ...a.map((arg) => {
        if (arg instanceof Error) {
          return `${arg.name || ""} ${arg.message || ""} ${arg.stack || ""}`;
        } else if (typeof arg === "object" && arg !== null) {
          return safeStringify(arg);
        }
        return arg?.toString?.() || "";
      }),
    );
  }
};

function detectBrowser() {
  const url = browser.runtime.getURL("");

  if (url.startsWith("moz-extension://")) {
    return "firefox";
  }

  return "chrome";
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

// Apply Theme
async function applyThemeSettings() {
  const theme = await browser.storage.local.get("theme");
  const currentTheme = theme.theme || "dark";
  document.body.dataset.theme = currentTheme;
  document.documentElement.dataset.theme = currentTheme;
  return currentTheme;
}

// Apply Attrs
async function initApplyAttrs() {
  const { styleAttrs } = await browser.storage.local.get("styleAttrs");
  document.body.setAttribute("style", styleAttrs ?? "");

  const { colorSettings } = await browser.storage.local.get("colorSettings");
  document.body.classList.toggle("fg-blur", !!colorSettings?.applyFgBlur);

  const { theme } = await browser.storage.local.get("theme");
  document.body.dataset.theme = theme ?? "dark";
}

// Init Storage Listener
function initStorageListener() {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.colorSettings) {
      const applyFgBlur = changes.colorSettings.newValue?.applyFgBlur;
      document.body.classList.toggle("fg-blur", !!applyFgBlur);
    }

    if (changes.styleAttrs) {
      const styleString = changes.styleAttrs.newValue ?? "";
      document.body.setAttribute("style", styleString);
    }

    if (changes.theme) {
      document.body.dataset.theme = changes.theme.newValue ?? "dark";
    }
  });
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
      const brightenedColors = gradientInfo.colors.map((color) => {
        const base = tinycolor(color);
        const alpha = base.getAlpha();
        const bright = base.clone().lighten(12);
        bright.setAlpha(alpha);
        return bright.toRgbString();
      });

      // Create a bright version for the entire gradient
      const brightGradient = `linear-gradient(${gradientInfo.degree}deg, ${brightenedColors.join(", ")})`;
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

// Delay
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Debounce
function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// Throttle
function throttle(fn, wait) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, args);
    }
  };
}

// Mutex
function createMutex() {
  let lock = Promise.resolve();
  return async (fn) => {
    const unlock = lock;
    let resolveNext;
    lock = new Promise((r) => (resolveNext = r));
    await unlock;
    try {
      return await fn();
    } finally {
      resolveNext();
    }
  };
}

// Waits for a condition to become true
function waitFor(fn, maxWait = 1000) {
  const start = performance.now();

  return new Promise((resolve, reject) => {
    try {
      if (fn()) return resolve(true);
    } catch (error) {
      return reject(error);
    }

    const tick = () => {
      try {
        if (fn()) return resolve(true);
        if (performance.now() - start >= maxWait) return resolve(false);
        requestAnimationFrame(tick);
      } catch (error) {
        reject(error);
      }
    };

    requestAnimationFrame(tick);
  });
}

function getTransitionDuration(el, property) {
  const style = getComputedStyle(el);
  const props = style.transitionProperty.split(", ");
  const durations = style.transitionDuration.split(", ");
  const index = props.indexOf(property);
  const raw = index !== -1 ? (durations[index] ?? durations[0]) : null;
  if (!raw) return 0;
  return parseFloat(raw) * (raw.includes("ms") ? 1 : 1000);
}

function waitForTransitionEnd(el, property) {
  if (!el || !shouldAnimate?.()) return Promise.resolve();

  const duration = getTransitionDuration(el, property);
  if (duration === 0) return Promise.resolve();

  const adaptive = Math.max(duration * 1.3, 300);

  return new Promise((resolve) => {
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      el.removeEventListener("transitionend", handler);
      resolve();
    };

    const handler = ({ target, propertyName }) => {
      if (target === el && propertyName === property) finish();
    };

    el.addEventListener("transitionend", handler);
    const timer = setTimeout(finish, adaptive);
  });
}

async function smoothScrollTo(element, target, baseDuration = 300) {
  if (!element || typeof element.scrollTop !== "number") {
    return Promise.reject(new Error("Invalid scroll element"));
  }

  if (!shouldAnimate?.()) {
    element.scrollTop = target;
    return;
  }

  const start = element.scrollTop;
  const change = target - start;
  const distance = Math.abs(change);

  if (distance < 2) {
    element.scrollTop = target;
    return;
  }

  const durationMs = Math.min(baseDuration, Math.max(100, distance / 0.5));
  const startTime = performance.now();

  const easeOutCubic = (t) => 1 - (1 - t) ** 3;

  return new Promise((resolve) => {
    const animate = (now) => {
      const progress = Math.min((now - startTime) / durationMs, 1);
      element.scrollTop = Math.round(start + change * easeOutCubic(progress));

      if (progress < 1 && element.isConnected) {
        requestAnimationFrame(animate);
      } else {
        element.scrollTop = target;
        resolve();
      }
    };

    requestAnimationFrame(animate);
  });
}

async function scrollToElementPosition(target, container) {
  if (!target || !container) return;

  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  await smoothScrollTo(container, container.scrollTop + offset);
}

// Time
const getCurrentTime = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const dateToday = new Date();
const dateYesterday = new Date();
dateYesterday.setDate(dateToday.getDate() - 1);
const isSameDay = (d1, d2) => d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();

// Time Calculations
function getStartTime(range, customStart = null, customEnd = null) {
  const now = new Date();

  const setStartOfDay = (d) => {
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const setEndOfDay = (d) => {
    d.setHours(23, 59, 59, 999);
    return d;
  };

  let startTime = 0;
  let endTime = now.getTime();

  if (range === "custom" && customStart) {
    return { startTime: customStart, endTime: customEnd || endTime };
  }

  switch (range) {
    case "day": {
      const d = setStartOfDay(new Date(now));
      startTime = d.getTime();
      endTime = setEndOfDay(new Date(now)).getTime();
      break;
    }

    case "yesterday": {
      const d = setStartOfDay(new Date(now));
      d.setDate(d.getDate() - 1);
      startTime = d.getTime();
      endTime = setEndOfDay(new Date(d)).getTime();
      break;
    }

    case "week": {
      const d = setStartOfDay(new Date(now));
      const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
      d.setDate(d.getDate() + diff);
      startTime = d.getTime();

      const weekEnd = new Date(d);
      weekEnd.setDate(weekEnd.getDate() + 6);
      endTime = setEndOfDay(weekEnd).getTime();
      break;
    }

    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "3months": {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "6months": {
      const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "year": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31);
      startTime = start.getTime();
      endTime = setEndOfDay(end).getTime();
      break;
    }

    case "all": {
      startTime = 0;
      endTime = now.getTime();
      break;
    }

    default: {
      startTime = 0;
      endTime = now.getTime();
      break;
    }
  }

  return { startTime, endTime };
}

// Date formatting
const userLocale = navigator.languages?.[0] || navigator.language || "en-US";
const dateHourMinute = (time) =>
  time.toLocaleTimeString(userLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: undefined,
  });

const dateFull = (time) =>
  time.toLocaleDateString(userLocale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

// Format Label
function formatLabel(name) {
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  return capitalized.replace(/([A-Z0-9])/g, " $1").trim();
}

// Normalize artist name
function normalizeArtistName(name) {
  if (!name) return "";
  return name
    .split(/,|&|feat\.|Feat\.|FEAT\./)[0]
    .trim()
    .toLowerCase();
}

// Normalize title and artist
async function normalizeTitleAndArtist(inputTitle, inputArtist, replaceArtist = true, stripDashPrefix = false) {
  let title = typeof inputTitle === "string" ? inputTitle : "";
  let artist = typeof inputArtist === "string" ? inputArtist : "";

  if (!title) return { title, artist };
  if (!window._NORMALIZATION_STATUS_) window._NORMALIZATION_STATUS_ = await browser.storage.local.get("normalization");

  const { normalization } = window._NORMALIZATION_STATUS_ || (await browser.storage.local.get("normalization"));
  const map = {
    enable: [true, false],
    cleanTitle: [false, true],
    disable: [false, false],
  };

  [replaceArtist, stripDashPrefix] = map[normalization] ?? [true, false];

  // Core Helpers
  const canonical = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();

  const splitArtists = (str) =>
    (str || "")
      .split(/\s*(?:,|&|\+|x|×|feat\.?|featuring|ft\.?|with)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);

  const mergeArtists = (a, b) => {
    const map = new Map();

    for (const x of [...splitArtists(a), ...splitArtists(b)]) {
      const key = canonical(x);
      if (key && !map.has(key)) {
        map.set(key, x);
      }
    }

    return [...map.values()].join(" & ");
  };

  const isRemix = (t) => /\b(remix|edit|vip|flip)\b/i.test(t);

  // Title Preprocess
  const parenIndex = title.search(/[\[\(（【]/);
  const baseTitle = parenIndex !== -1 ? title.slice(0, parenIndex) : title;
  const parenPart = parenIndex !== -1 ? title.slice(parenIndex) : "";

  // Dash Parse
  const dashMatch = baseTitle.match(/^(.+?)\s[-–—]\s(.+)$/);

  if (dashMatch) {
    const left = dashMatch[1].trim();
    const right = dashMatch[2].trim() + (parenPart ? " " + parenPart : "");

    // stripDashPrefix: delete the dash on the left
    if (stripDashPrefix) {
      title = right;
      return { title, artist };
    }

    if (replaceArtist) {
      const leftCanon = canonical(left);
      const inputCanon = canonical(artist);

      const leftArtists = splitArtists(left);
      const inputArtists = splitArtists(artist);

      const overlap = leftCanon === inputCanon || leftArtists.some((a) => inputArtists.some((b) => canonical(a) === canonical(b)));

      if (isRemix(title)) {
        const remixer = artist;
        artist = left;
        title = right;
        return { title, artist, remixer };
      }

      if (overlap) {
        artist = mergeArtists(left, artist);
      } else {
        artist = left;
      }

      title = right;
    }
  }

  // Clean Prefix Artifacts
  const cleanTitle = (t, artistStr) => {
    if (!t || !artistStr) return t;

    const escaped = artistStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^\\s*${escaped}\\s*[-–—:]\\s*`, "i");

    return t.replace(pattern, "").trim();
  };

  title = cleanTitle(title, artist);

  // Output
  return { title, artist };
}

// Normalize host string
const normalizeHost = (hostOrUrl) => {
  try {
    if (!hostOrUrl || typeof hostOrUrl !== "string") return "";
    if (!hostOrUrl.includes("://")) {
      return hostOrUrl
        .trim()
        .replace(/^www\./g, "")
        .toLowerCase();
    }
    return new URL(hostOrUrl).hostname
      .trim()
      .replace(/^www\./g, "")
      .toLowerCase();
  } catch {
    return "";
  }
};

function isDomainMatch(parserDomainRaw, tabHostnameRaw) {
  const parserDomain = normalizeHost(parserDomainRaw);
  const tabDomain = normalizeHost(tabHostnameRaw);

  if (!parserDomain || !tabDomain) return false;
  if (parserDomain === tabDomain) return true;
  if (parserDomain.startsWith("*.")) {
    const base = parserDomain.slice(2);
    return tabDomain.endsWith(`.${base}`) && tabDomain !== base;
  }
  return false;
}

// Url Pattern Regex
const parseUrlPattern = (pattern) => {
  if (pattern instanceof RegExp) return pattern;
  if (typeof pattern === "string") {
    const match = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
    if (match) {
      try {
        return new RegExp(match[1], match[2] || undefined);
      } catch (e) {
        logWarn("Invalid regex:", pattern, e);
        return /.^/;
      }
    }
    try {
      return new RegExp(pattern);
    } catch (e) {
      logWarn("Invalid regex:", pattern, e);
    }
  }
  return /.^/;
};

// Find matching parsers for URL
const findMatchingParsersForUrl = (url, list) => {
  const host = normalizeHost(url);
  return list.filter(({ domain }) => {
    const domains = Array.isArray(domain) ? domain : [domain];
    return domains.some((d) => isDomainMatch(d, host));
  });
};

// Fetch with timeout
const fetchWithTimeout = async (url, options = {}, timeout = 5000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      logError(`[Fetch]: Request timed out after ${timeout / 1000} seconds: ${url}`);
    } else {
      logError(`[Fetch]: Fetch error: ${url}`, err);
    }
    throw err;
  }
};

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
};

// Get Fresh Parser List
async function getFreshParserList(force = false) {
  try {
    const response = await browser.runtime.sendMessage({
      type: "REQUEST_FRESH_PARSER_LIST",
      force,
    });

    return response?.data ?? [];
  } catch (error) {
    logError("[parserList]: getFreshParserList error:", error);
    return [];
  }
}

// Helper to split time strings like "5:47 / 6:57".
function extractTimeParts(input) {
  if (typeof input !== "string" || !input.includes("/")) return [null, null];
  const parts = input.split("/");
  if (parts.length !== 2) return [null, null];
  const [start, end] = parts;
  const s = start.trim();
  const e = end.trim();
  if (!s || !e) return [null, null];
  return [s, e];
}

// Helper to convert mm:ss to seconds.
function parseTime(timeInput) {
  if (typeof timeInput === "number" && isFinite(timeInput)) {
    return timeInput < 0 ? -Math.floor(-timeInput) : Math.floor(timeInput);
  }

  if (typeof timeInput !== "string") return null;

  let s = timeInput.trim();
  if (s === "") return null;
  // catch any short/long dash/minus character
  const neg = /^[-–—]/.test(s);
  s = s.replace(/^[-–—]+/, "");

  const parts = s.split(":").reverse();
  let hasValid = false;
  const seconds = parts.reduce((acc, part, i) => {
    if (acc === null) return null;
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0) return null;
    hasValid = true;
    return acc + n * Math.pow(60, i);
  }, 0);

  if (seconds === null || !hasValid) return null;

  return neg ? -seconds : seconds;
}

// Helper to convert seconds to mm:ss format.
function formatTime(seconds) {
  if (typeof seconds === "string") {
    seconds = parseTime(seconds);
  }

  if (seconds === null || !isFinite(seconds) || typeof seconds !== "number") return "00:00";

  const neg = seconds < 0;
  seconds = Math.abs(Math.floor(seconds));

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  let formatted;
  if (hrs > 0) {
    formatted = `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  } else {
    formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return (neg ? "-" : "") + formatted;
}

// Helper to get timestamps
function getTimestamps(currentPosition, totalDuration, options = { returnEnd: true }) {
  if (currentPosition == null || totalDuration == null || isNaN(currentPosition) || isNaN(totalDuration) || totalDuration <= 0) {
    return {};
  }

  const now = Date.now();

  // Start is "now"
  const startTimestamp = now;

  if (options.returnEnd) {
    // End is "now + remaining time"
    const remaining = totalDuration - currentPosition;
    return {
      startTimestamp,
      endTimestamp: startTimestamp + Math.max(0, remaining) * 1000,
    };
  } else {
    return { startTimestamp };
  }
}

// Parses playback time values and returns detailed playback information.
function processPlaybackInfo(timePassed = "", durationElem = "") {
  let currentPosition, totalDuration;

  if (typeof timePassed === "string" && typeof durationElem === "string") {
    currentPosition = parseTime(timePassed.trim());
    totalDuration = parseTime(durationElem.trim());
  } else {
    currentPosition = Number(timePassed) || null;
    totalDuration = Number(durationElem) || null;
  }

  currentPosition = currentPosition == null || isNaN(currentPosition) ? null : Math.max(0, currentPosition);
  totalDuration = totalDuration == null || isNaN(totalDuration) ? null : Math.max(0, totalDuration);

  const timestamps = getTimestamps(currentPosition, totalDuration);
  const currentProgress = currentPosition !== null && totalDuration !== null && totalDuration > 0 ? (currentPosition / totalDuration) * 100 : null;

  return { currentPosition, totalDuration, currentProgress, timestamps };
}

function applyStrip(val, stripPattern) {
  if (!stripPattern) return val;
  const reMatch = stripPattern.match(/^\/(.+)\/([gimsuy]*)$/);
  if (reMatch) {
    try {
      return val.replace(new RegExp(reMatch[1], reMatch[2] || ""), "").trim();
    } catch (_) {}
  }
  return val.replaceAll(stripPattern, "").trim();
}

const parseIgnoreSelector = (selector) => {
  const ignoreMatches = [...selector.matchAll(/\[ignore=['"]([^'"]+)['"]\]/g)];
  const onlyMatch = selector.match(/\[only=['"]([^'"]+)['"]\]/);
  const stripMatch = selector.match(/\[strip=['"]([^'"]+)['"]\]/);
  const parentMatch = selector.match(/\[parent(?:=['"](\d+)['"])?\]/);

  let cleanSelector = selector;
  ignoreMatches.forEach((m) => (cleanSelector = cleanSelector.replace(m[0], "")));
  if (onlyMatch) cleanSelector = cleanSelector.replace(onlyMatch[0], "");
  if (stripMatch) cleanSelector = cleanSelector.replace(stripMatch[0], "");
  if (parentMatch) cleanSelector = cleanSelector.replace(parentMatch[0], "");

  return {
    cleanSelector: cleanSelector.trim(),
    ignoreSelector: ignoreMatches.length ? ignoreMatches.map((m) => m[1]).join(",") : null,
    onlySelector: onlyMatch?.[1] ?? null,
    stripPattern: stripMatch?.[1] ?? null,
    parentLevel: parentMatch ? parseInt(parentMatch[1] ?? "1", 10) : 0,
  };
};

function cloneWithoutIgnored(elem, ignoreSelector) {
  const clone = elem.cloneNode(true);
  try {
    clone.querySelectorAll(ignoreSelector).forEach((el) => el.remove());
  } catch (_) {}
  return clone;
}

/**
 *Selects the element, takes the desired Attribute (or TextContent), then applies optional operations.
 * @param {string} selector - CSS selector
 * @param {object} options - Optional Parameters
 *    - attr: String, Element Attribute Name (eg "href", "title", "src")
 *    - transform: Function, function that will be processed on the string received
 *    - root: Element or Document, Search Root (default: document)
 * @returns {string} - processed string or empty string
 */
function getText(selector, options = {}) {
  if (!selector) return "";
  const { attr = null, transform = null, root = document } = options;
  const { cleanSelector, ignoreSelector, onlySelector, stripPattern, parentLevel } = parseIgnoreSelector(selector);

  let elem = null;
  try {
    elem = querySelectorDeep(cleanSelector, root);
  } catch (_) {}
  if (!elem) elem = queryWithPartialClass(cleanSelector, root)[0] ?? null;
  if (!elem) return "";

  // Parent selector
  if (parentLevel) {
    let p = elem;
    for (let i = 0; i < parentLevel; i++) p = p?.parentElement;
    if (!p) return "";
    elem = p;
  }

  // Only selector
  if (onlySelector) {
    const onlyEl = elem.querySelector(onlySelector);
    if (onlyEl) elem = onlyEl;
  }

  // Ignore selector
  let target = elem;
  if (ignoreSelector && !attr) {
    target = cloneWithoutIgnored(elem, ignoreSelector);
  }

  let val = attr ? elem.getAttribute(attr) : target.textContent;
  if (!val) return "";

  val = applyStrip(val.trim(), stripPattern);
  if (!val) return "";

  if (transform) {
    try {
      val = transform(val);
      if (!val) return "";
    } catch (_) {
      return "";
    }
  }

  return val;
}

/**
 * Gets text/attributes from ALL matching elements
 * @param {string} selector - CSS selector
 * @param {object} options - Same as getText options
 * @returns {string[]} - Array of processed strings
 */
function getTextAll(selector, options = {}) {
  const { root = document, ...rest } = options;
  const elements = root.querySelectorAll(selector);

  return Array.from(elements)
    .map((el) => extractValue(el, rest))
    .filter((val) => val !== "");
}

/**
 * Retrieves image URL from element matching selector.
 *
 * @param {string} selector - CSS selector to find the image element.
 * @param {Document|Element} [root=document] - Root element for querySelector.
 * @returns {string|null} Image URL or null if not found.
 */
function getImage(selector, root = document) {
  if (!selector) return null;
  const { cleanSelector, ignoreSelector, onlySelector, parentLevel } = parseIgnoreSelector(selector);

  let elem = null;
  try {
    elem = querySelectorDeep(cleanSelector, root);
  } catch (_) {}
  if (!elem) return null;

  // Parent selector
  if (parentLevel) {
    let p = elem;
    for (let i = 0; i < parentLevel; i++) p = p?.parentElement;
    if (!p) return null;
    elem = p;
  }

  // Only selector
  if (onlySelector) {
    const onlyEl = elem.querySelector(onlySelector);
    if (onlyEl) elem = onlyEl;
  }

  // Priority: element directly <img>
  if (elem.tagName.toLowerCase() === "img" && elem.src) return elem.src;

  // Alternative: background-image
  const bgImage = getComputedStyle(elem).backgroundImage;
  if (bgImage && bgImage !== "none") {
    const match = bgImage.match(/url\(["']?(https?[^"')]+)["']?\)/);
    if (match) return match[1];
  }

  // Alternative: check for <img> inside
  const childImgs = Array.from(elem.querySelectorAll("img[src]"));
  const filtered = ignoreSelector ? childImgs.filter((img) => !img.matches(ignoreSelector) && !img.closest(ignoreSelector)) : childImgs;
  return filtered[0]?.src || null;
}

/**
 * Gets image URLs from ALL matching elements
 * @param {string} selector - CSS selector
 * @param {Document|Element} root - Search root
 * @returns {string[]} - Array of image URLs
 */
function getImageAll(selector, root = document) {
  const elements = root.querySelectorAll(selector);

  return Array.from(elements)
    .map((el) => getImage(el.tagName === "IMG" ? el : selector, el.parentElement))
    .filter((url) => url !== null);
}

// Deep query selector that traverses shadow DOMs
function querySelectorDeep(selector, root = document, all = false) {
  const results = [];

  try {
    if (all) {
      results.push(...root.querySelectorAll(selector));
    } else {
      let el = root.querySelector(selector);

      if (!el) {
        el = queryWithPartialClass(selector, root)[0] ?? null;
      }

      if (el) return el;
    }
  } catch (_) {}

  const elemsWithShadow = root.querySelectorAll("*");
  for (const elem of elemsWithShadow) {
    if (elem.shadowRoot) {
      const found = querySelectorDeep(selector, elem.shadowRoot, all);
      if (all) {
        results.push(...found);
      } else if (found) {
        return found;
      }
    }
  }

  return all ? results : null;
}

// Create ID from domain and patterns
function generateParserKey(domain, urlPatterns, authors = []) {
  let rawDomain = "";

  if (Array.isArray(domain)) {
    rawDomain = domain[0] || "";
  } else if (typeof domain === "string") {
    rawDomain = domain.split(",")[0] || "";
  }

  if (!rawDomain) {
    console.log("[generateParserKey] empty domain", { domain, urlPatterns });
    rawDomain = "unknown";
  }

  let patternsArray = [];
  if (Array.isArray(urlPatterns)) {
    patternsArray = urlPatterns;
  } else if (typeof urlPatterns === "string") {
    patternsArray = urlPatterns.split(",");
  }

  if (!patternsArray.length) patternsArray = [".*"];

  const patternStrings = patternsArray
    .map(function (p) {
      if (!p) return ".*";

      let strPattern = "";
      if (p instanceof RegExp) {
        strPattern = p.source;
      } else {
        strPattern = p.toString().trim() || ".*";
      }

      return strPattern.replace(/^\/|\/$/g, "") || ".*";
    })
    .sort();

  const hash = btoa(patternStrings.join("|"))
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 10);

  const author = Array.isArray(authors) ? authors[0] : authors;

  const safeAuthor = author
    ? String(author)
        .toLowerCase()
        .replace(/[^a-z0-9_\-]/g, "")
    : "";

  const safeDomain = String(rawDomain)
    .toLowerCase()
    .replace(/[^a-z0-9_.\-]/g, "");

  return safeAuthor ? safeAuthor + "_" + safeDomain + "_" + hash : safeDomain + "_" + hash;
}

// Create a platform dropdown with options
function createPlatformDropdown(label, options, manifestVersion) {
  const container = document.createElement("div");
  container.classList.add("setup-link-dropdown-container");

  const button = document.createElement("a");
  button.textContent = label;
  button.classList.add("setup-link", "setup-link-dropdown-toggle");
  container.appendChild(button);

  const dropdown = document.createElement("div");
  dropdown.classList.add("setup-dropdown");
  container.appendChild(dropdown);

  options.forEach((option) => {
    const dropdownLink = document.createElement("a");
    dropdownLink.href = option.url.replace(/{version}/g, manifestVersion);
    dropdownLink.textContent = option.label;
    dropdownLink.target = "_blank";
    dropdownLink.rel = "noopener noreferrer";
    dropdownLink.classList.add("setup-dropdown-item");
    dropdown.appendChild(dropdownLink);
  });

  // Toggle dropdown
  let leaveTimeout;

  const showDropdown = () => {
    clearTimeout(leaveTimeout);
    dropdown.classList.add("show");
  };

  const hideDropdown = () => {
    leaveTimeout = setTimeout(() => {
      dropdown.classList.remove("show");
    }, 100);
  };

  container.addEventListener("click", showDropdown);
  container.addEventListener("mouseleave", hideDropdown);
  dropdown.addEventListener("mouseenter", showDropdown);
  dropdown.addEventListener("mouseleave", hideDropdown);

  return container;
}

// Show initial setup dialog
async function fetchLatestVersion() {
  try {
    const res = await fetch("https://api.github.com/repos/KanashiiDev/web-presence/releases/latest", { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const version = data.tag_name?.replace(/^v/, "") ?? null;
    if (version) return version;
  } catch (e) {
    logInfo("GitHub version could not be retrieved, fallback is being used:", e);
  }

  return browser.runtime.getManifest().version;
}

async function showInitialSetupDialog(appendBody) {
  const version = await fetchLatestVersion();

  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.id = "setupAlert";

    const dialog = document.createElement("div");
    dialog.className = "setup-dialog";

    const content = document.createElement("div");
    content.className = "setup-dialog-content";

    const contentHeader = document.createElement("h2");
    contentHeader.textContent = i18n.t("setup.companion.header");
    content.appendChild(contentHeader);

    const contentText = document.createElement("p");
    contentText.textContent = i18n.t("setup.companion.message");
    content.appendChild(contentText);

    const contentLinkContainer = document.createElement("div");
    contentLinkContainer.classList.add("setup-link-container");
    content.appendChild(contentLinkContainer);

    // Windows Dropdown
    const windowsOptions = [
      {
        label: "Installer (EXE)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x64-installer.exe`,
      },
      {
        label: "Portable (ZIP)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x64.zip`,
      },
    ];
    contentLinkContainer.appendChild(createPlatformDropdown("Windows", windowsOptions, version));

    // Linux Dropdown
    const linuxOptions = [
      {
        label: "AppImage (x64)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x86_64.AppImage`,
      },
      {
        label: "DEB (x64)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-amd64.deb`,
      },
      {
        label: "RPM (x64)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x86_64.rpm`,
      },
      {
        label: "TAR.ZST (x64)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x64.pkg.tar.zst`,
      },
      {
        label: "More",
        url: `https://github.com/KanashiiDev/web-presence#desktop-app`,
      },
    ];
    contentLinkContainer.appendChild(createPlatformDropdown("Linux", linuxOptions, version));

    // MacOS Dropdown
    const macOptions = [
      {
        label: "Universal",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-universal.dmg`,
      },
    ];
    contentLinkContainer.appendChild(createPlatformDropdown("MacOS", macOptions, version));

    const contentNote = document.createElement("p");
    contentNote.textContent = i18n.t("setup.companion.provider");
    contentNote.classList.add("setup-note");
    content.appendChild(contentNote);

    const contentNote2 = document.createElement("p");
    const noteText = document.createTextNode(i18n.t("setup.companion.provider.link"));
    const noteLink = document.createElement("a");
    noteLink.href = "https://github.com/KanashiiDev/web-presence/releases/latest";
    noteLink.target = "_blank";
    noteLink.rel = "noopener noreferrer";
    noteLink.textContent = "GitHub Releases";
    noteLink.classList.add("setup-link-github");
    noteLink.classList.add("setup-note-link");

    contentNote2.appendChild(noteText);
    contentNote2.appendChild(noteLink);
    content.appendChild(contentNote2);

    const confirmButton = document.createElement("button");
    confirmButton.id = "confirmSetup";
    confirmButton.textContent = i18n.t("setup.companion.installed");
    content.appendChild(confirmButton);
    dialog.appendChild(content);

    if (appendBody) wrapper.appendChild(dialog);
    const appendTarget = appendBody ? wrapper : dialog;
    const contentDiv = appendBody ? document.body : document.querySelector(".content");
    contentDiv.appendChild(appendTarget);
    document.documentElement.classList.add("setup-dialog-open");

    const cleanup = () => {
      contentDiv.removeChild(appendTarget);
      document.documentElement.classList.remove("setup-dialog-open");
    };

    document.getElementById("confirmSetup").addEventListener("click", async () => {
      await browser.storage.local.set({ initialSetupDone: true });
      cleanup();
      resolve();
    });
  });
}

// Show host permission dialog
async function showHostPermissionDialog(appendBody) {
  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.id = "setupAlert";

    const dialog = document.createElement("div");
    dialog.className = "setup-dialog";

    const content = document.createElement("div");
    content.className = "setup-dialog-content";

    const contentHeader = document.createElement("h2");
    contentHeader.textContent = i18n.t("setup.permission.header");
    content.appendChild(contentHeader);

    const contentText = document.createElement("p");
    contentText.textContent = i18n.t("setup.permission.message");
    content.appendChild(contentText);

    const contentNote = document.createElement("p");
    contentNote.textContent = i18n.t("setup.permission.note");
    contentNote.classList.add("setup-note");
    content.appendChild(contentNote);

    const buttons = document.createElement("div");
    buttons.className = "setup-dialog-buttons";

    const grantButton = document.createElement("button");
    grantButton.id = "grantPermission";
    grantButton.textContent = i18n.t("setup.permission.grant");

    const ignoreButton = document.createElement("button");
    ignoreButton.id = "ignorePermission";
    ignoreButton.textContent = i18n.t("common.continue");
    ignoreButton.classList.add("secondary");

    buttons.appendChild(grantButton);
    buttons.appendChild(ignoreButton);

    content.appendChild(buttons);

    dialog.appendChild(content);

    if (appendBody) wrapper.appendChild(dialog);
    const appendTarget = appendBody ? wrapper : dialog;
    const contentDiv = appendBody ? document.body : document.querySelector(".content");
    contentDiv.appendChild(appendTarget);

    document.documentElement.classList.add("setup-dialog-open", "permission");

    let requested = false;

    grantButton.addEventListener("click", async () => {
      if (requested) return;
      requested = true;

      try {
        const granted = await browser.permissions.request({
          origins: ["*://*/*"],
        });

        if (granted) {
          resolve(granted);
          if (!appendBody) window.close();
        }
      } catch (err) {
        console.error("Permission request failed:", err);
        resolve(false);
        if (!appendBody) window.close();
      } finally {
        if (appendBody) location.reload();
      }
    });

    ignoreButton.addEventListener("click", () => {
      resolve(false);
      contentDiv.removeChild(appendTarget);
      document.documentElement.classList.remove("setup-dialog-open", "permission");
    });
  });
}

// Show initial tutorial dialog
async function showInitialTutorial() {
  // Steps in the tutorial
  const steps = [
    {
      text: i18n.t("tutorial.step1"),
      selector: ".parser-entry",
    },
    {
      text: i18n.t("tutorial.step2"),
      selector: ".parser-entry .switch-label",
    },
    {
      text: i18n.t("tutorial.step3"),
      selector: "#openSelector",
    },
    {
      text: i18n.t("tutorial.step4"),
      selector: "#openManager",
    },
    {
      text: i18n.t("tutorial.step5"),
      selector: "#openFiltersBtn",
    },
    {
      text: i18n.t("tutorial.step6"),
      selector: "#openDashboardBtn",
    },
    {
      text: i18n.t("tutorial.step7"),
      selector: "#openLibraryBtn",
    },
  ];

  // References to DOM elements
  const tooltip = document.getElementById("tutorialTooltip");
  const tooltipHeader = document.getElementById("tooltipHeader");
  const tooltipText = document.getElementById("tooltipText");
  const nextBtn = document.getElementById("tooltipNextBtn");
  const skipBtn = document.getElementById("tooltipSkipBtn");
  const siteList = document.getElementById("siteList");
  const allEntries = document.querySelectorAll(".header-container, .parser-entry, .search-controls, #openSelector, #openManager, .simplebar-track.simplebar-vertical");

  // Initial settings
  let currentStep = 0;
  tooltip.style.display = "block";
  siteList.style.pointerEvents = "none";

  // Highlight a specific item
  function highlightElement(targetEl) {
    // Add fading to all entries
    allEntries.forEach((entry) => entry.classList.add("fading"));

    // If there is a target element, remove fading from it
    if (targetEl) {
      targetEl.classList.remove("fading");

      // If the target element is inside a parser entry, remove it from there as well.
      const parserParent = targetEl.closest(".parser-entry");
      if (parserParent) {
        parserParent.classList.remove("fading");
      }
    }

    // Remove previous highlights
    document.querySelectorAll(".tutorialTooltip-highlight").forEach((el) => el.classList.remove("tutorialTooltip-highlight"));

    // Add Highlight
    if (targetEl) {
      targetEl.classList.add("tutorialTooltip-highlight");
    }
  }

  // Set the tooltip position relative to the target element
  function positionTooltip(targetEl) {
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    const scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft;

    const tooltipHeight = tooltip.offsetHeight;
    const popupHeight = document.body.scrollHeight;

    // Place the tooltip below or above the target
    const top = rect.bottom + 8 + tooltipHeight > popupHeight ? rect.top + scrollTop - tooltipHeight - 12 : rect.bottom + scrollTop + 8;

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${rect.left + scrollLeft}px`;

    // Let the tooltip not go outside the screen
    const tooltipRect = tooltip.getBoundingClientRect();
    if (tooltipRect.right > window.innerWidth) {
      tooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
    }
  }

  // Show a specific step
  function showStep(index) {
    const step = steps[index];
    const isLastStep = index + 1 >= steps.length;
    const currentStep = `${index + 1}/${steps.length}`;

    tooltipHeader.textContent = i18n.t("tutorial.step", { step: currentStep });
    nextBtn.classList.remove("finish");
    nextBtn.textContent = i18n.t("button.next");
    skipBtn.style.display = index === 0 ? "" : "none";

    tooltipText.textContent = step.text;

    const targetEl = document.querySelector(step.selector);
    highlightElement(targetEl);
    positionTooltip(targetEl);

    // The last step is to show the 'Finish' button
    if (isLastStep) {
      nextBtn.classList.add("finish");
      nextBtn.textContent = i18n.t("tutorial.finish");
      skipBtn.remove();
    }
  }

  // End the tutorial
  async function endTutorial() {
    tooltip.style.display = "none";
    siteList.style.pointerEvents = "";
    document.querySelectorAll(".tutorialTooltip-highlight").forEach((el) => el.classList.remove("tutorialTooltip-highlight"));
    allEntries.forEach((entry) => entry.classList.remove("fading"));
    await browser.storage.local.set({ initialTutorialDone: true });
  }

  // Event Listener
  nextBtn.addEventListener("click", async () => {
    currentStep++;
    if (currentStep >= steps.length) {
      await endTutorial();
    } else {
      showStep(currentStep);
    }
  });

  skipBtn.addEventListener("click", async () => {
    await endTutorial();
  });

  // Start the first step
  showStep(currentStep);
}

function getPlainText(text) {
  if (typeof text !== "string") return text;
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/^[.#]/.test(trimmed)) return null;

  const firstWord = trimmed.split(/[\s.#\[>+~:"'`]/)[0].toLowerCase();
  if (!firstWord) return null;

  try {
    const el = document.createElement(firstWord);
    const isKnownTag = el.constructor !== HTMLUnknownElement && el.constructor !== HTMLElement;
    if (isKnownTag) return null;
  } catch {}

  return trimmed;
}

function uint8ToBase64(uint8) {
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

function encodeValue(value) {
  if (value instanceof Uint8Array) {
    return { __type: "uint8array", data: uint8ToBase64(value) };
  }
  if (value instanceof ArrayBuffer) {
    return { __type: "arraybuffer", data: uint8ToBase64(new Uint8Array(value)) };
  }
  return value;
}

function decodeValue(value) {
  if (value?.__type === "uint8array") {
    const binary = atob(value.data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr;
  }
  if (value?.__type === "arraybuffer") {
    const binary = atob(value.data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr.buffer;
  }
  return value;
}

function openIndexedDB(DB_NAME, STORE_NAME, DB_VERSION) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: null });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => {
      logError("[IndexedDB]: IndexedDB open error:", e.target.error);
      reject(e.target.error);
    };
  });
}

async function exportIndexedDB(dbName) {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const storeNames = [...db.objectStoreNames];

  if (storeNames.length === 0) {
    db.close();
    return {};
  }

  const tx = db.transaction(storeNames, "readonly");
  const result = {};

  await Promise.all(
    storeNames.map((storeName) => {
      const store = tx.objectStore(storeName);
      return new Promise((res, rej) => {
        const keysReq = store.getAllKeys();
        const valsReq = store.getAll();

        let keys, vals;
        const tryResolve = () => {
          if (keys === undefined || vals === undefined) return;
          const entries = {};
          keys.forEach((key, i) => {
            entries[key] = encodeValue(vals[i]);
          });
          result[storeName] = entries;
          res();
        };

        keysReq.onsuccess = () => {
          keys = keysReq.result;
          tryResolve();
        };
        valsReq.onsuccess = () => {
          vals = valsReq.result;
          tryResolve();
        };
        keysReq.onerror = valsReq.onerror = () => rej(keysReq.error ?? valsReq.error);
      });
    }),
  );

  db.close();
  return result;
}

async function importIndexedDB(dbName, data) {
  if (!data || Object.keys(data).length === 0) return;

  await new Promise((res, rej) => {
    const del = indexedDB.deleteDatabase(dbName);
    del.onsuccess = res;
    del.onerror = () => rej(del.error);
  });

  await new Promise((resolve, reject) => {
    const openReq = indexedDB.open(dbName);

    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      for (const storeName of Object.keys(data)) {
        db.createObjectStore(storeName);
      }
    };

    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction(Object.keys(data), "readwrite");

      for (const [storeName, entries] of Object.entries(data)) {
        const store = tx.objectStore(storeName);
        for (const [key, value] of Object.entries(entries)) {
          store.put(decodeValue(value), key);
        }
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };

    openReq.onerror = () => reject(openReq.error);
  });
}

async function getIconAsDataUrl() {
  const iconUrl = browser.runtime.getURL("icons/128x128.png");
  const response = await fetch(iconUrl);
  const blob = await response.blob();

  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function parseRegexArray(input) {
  try {
    const trimmed = input.trim();
    const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1).trim() : trimmed;

    if (!inner) return [/.*/];

    const parts = inner
      .split(/,(?![^[]*])/g)
      .map((s) => s.trim())
      .filter(Boolean);

    const regexes = parts.map((str) => {
      const m = str.match(/^\/(.+)\/([gimsuy]*)$/);
      try {
        return m ? new RegExp(m[1], m[2]) : new RegExp(str);
      } catch {
        return /.*/;
      }
    });

    return regexes.length ? regexes : [/.*/];
  } catch {
    return [/.*/];
  }
}

// Validate URL function
const isValidUrl = (url) => {
  try {
    const parsed = new URL(url, location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (_) {
    return false;
  }
};

const isAllowedDomain = async (hostname, pathname) => {
  if (!state.parserListLoaded || state.parserListLoading) {
    await (state.parserListLoading || parserReady());
  }
  try {
    const normHost = normalizeHost(hostname);
    for (const parser of state.parserList) {
      const domains = (Array.isArray(parser.domain) ? parser.domain : [parser.domain]).filter(Boolean);
      const domainMatch = domains.some((d) => isDomainMatch(d, normHost));

      if (!domainMatch) continue;
      // URL pattern check
      const urlPatterns = parser.urlPatterns || [];
      const hasMatch = urlPatterns.length === 0 || urlPatterns.map(parseUrlPattern).some((re) => re.test(pathname));

      if (!hasMatch) continue;

      // Parser enabled check
      const cached = state.parserEnabledCache.has(parser.id) ? state.parserEnabledCache.get(parser.id) : parser.isEnabled !== false;
      if (cached) {
        return { ok: true, match: `[isAllowedDomain]: Match: ${hostname}${pathname} (parser: ${parser.title || parser.id})` };
      }
    }

    return { ok: false, error: { code: 2, message: `[isAllowedDomain]: Hostname not allowed (${hostname})` } };
  } catch (err) {
    logError("[isAllowedDomain]: Domain Match Error", err);
    return { ok: false, error: { code: 3, message: "[isAllowedDomain]: Domain Match Error" } };
  }
};

// Helper function to safely get text content
const getSafeText = (getFn, key, fallback) => {
  try {
    const el = getFn(key);
    return el?.textContent?.trim() || fallback || null;
  } catch (_) {
    return fallback || null;
  }
};

// Helper function to safely get href
const getSafeHref = (getFn, key, fallback) => {
  try {
    const el = getFn(key);
    let raw = el?.getAttribute?.("href") ?? fallback;

    try {
      raw = new URL(raw, location.origin).href;
    } catch (_) {
      // If URL parsing fails, fallback to the original href
    }

    return isValidUrl(raw) ? raw : null;
  } catch (_) {
    try {
      fallback = new URL(fallback, location.origin).href;
    } catch (_) {}
    return isValidUrl(fallback) ? fallback : null;
  }
};

// Get Sender Tab
async function getSenderTab(sender) {
  if (sender?.tab?.id) return sender.tab;

  try {
    const [activeTab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (activeTab) return activeTab;
  } catch (err) {
    logWarn("[background]: getSenderTab fallback error:", err);
  }

  return null;
}

// Activate simplebar
const simpleBarInstances = new WeakMap();
const panelPromises = new WeakMap();
const allPanels = new Set();

async function activateSimpleBar(targets, timeout = 500, interval = 30) {
  if (!Array.isArray(targets)) targets = [targets];

  const results = [];

  for (const target of targets) {
    try {
      let panel;
      let id = null;

      // If it is an HTMLElement, use it directly
      if (target instanceof HTMLElement) {
        panel = target;
        id = panel.id || "(no-id)";
      }
      // If not, treat it as an id string
      else {
        id = String(target).replace(/^#/, "");
        panel = document.getElementById(id);
      }

      if (!panel) {
        results.push({ id, success: false, reason: "not_found" });
        continue;
      }

      // Wait for panel visibility
      const isVisible = await waitFor(() => {
        const style = getComputedStyle(panel);
        return style.display !== "none" && style.visibility !== "hidden" && panel.offsetWidth > 0 && panel.offsetHeight > 0;
      }, 200);

      if (!isVisible) {
        results.push({ id, success: false, reason: "not_visible" });
        continue;
      }

      // Initialize or update SimpleBar
      let instance = simpleBarInstances.get(panel);
      if (instance && typeof instance.recalculate === "function") {
        instance.recalculate();
        await new Promise(requestAnimationFrame);
        results.push({ id, success: true, action: "recalculated" });
      } else {
        // Clear the old instance
        if (instance?.unMount) {
          instance.unMount();
          simpleBarInstances.delete(panel);
          panelPromises.delete(panel);
          panel.dataset.sbInit = "";
        }
        // Create a new instance
        instance = new SimpleBar(panel, { autoHide: false });
        simpleBarInstances.set(panel, instance);
        allPanels.add(panel);
        panel.dataset.sbInit = "1";
        results.push({ id, success: true, action: "initialized" });
      }

      // Update the padding
      await updatePanelPadding(panel, timeout, interval);
    } catch (error) {
      results.push({
        id: typeof target === "string" ? target : target?.id || null,
        success: false,
        reason: "error",
        error: error.message,
      });
    }
  }

  return results;
}

// Destroy Single Simplebar
async function destroySimplebar(panelOrId) {
  const panel = typeof panelOrId === "string" ? document.getElementById(panelOrId) : panelOrId;

  if (!panel) return;

  const instance = simpleBarInstances.get(panel);
  if (!instance) return;
  instance.unMount?.();
  instance.el.querySelectorAll(":scope > .simplebar-track").forEach((el) => el.remove());

  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 16));

  // Cleanup
  simpleBarInstances.delete(panel);
  panel.dataset.sbInit = "";
  panel.style.paddingRight = "";
  allPanels?.delete?.(panel);
}

// Wait for unmount simplebar
function waitForUnmountSimplebars() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

// Destroy other simplebars except the one with keepId
let destroyingSimplebars = false;
let destroyQueue = Promise.resolve();
async function destroyOtherSimpleBarsQueued(keepId) {
  destroyQueue = destroyQueue.then(() => destroyOtherSimpleBars(keepId));
  return destroyQueue;
}

async function destroyOtherSimpleBars(keepId) {
  if (destroyingSimplebars) return;
  destroyingSimplebars = true;

  try {
    const keepPanel = document.getElementById(keepId);
    const unmountPromises = [];

    allPanels.forEach((panel) => {
      if (panel !== keepPanel) {
        const instance = simpleBarInstances.get(panel);

        const scrollbar = instance.el.querySelectorAll(":scope > .simplebar-track");
        scrollbar.forEach((el) => el.remove());

        instance?.unMount?.();
        unmountPromises.push(waitForUnmountSimplebars());

        simpleBarInstances.delete(panel);
        panelPromises.delete(panel);
        panel.dataset.sbInit = "";
        panel.style.paddingRight = "2px";

        allPanels.delete(panel);
      }
    });

    await Promise.all(unmountPromises);

    if (keepId) {
      const header = document.getElementById("mainHeader");
      header.style.pointerEvents = "none";
      await waitForUnmountSimplebars();
      await new Promise((r) => setTimeout(r, 30));
      header.style.pointerEvents = "";
    }
  } finally {
    destroyingSimplebars = false;
  }
}

// If simplebar is added, update the element's padding
async function updatePanelPadding(panel, timeout = 1000) {
  if (panelPromises.has(panel)) return panelPromises.get(panel);

  const promise = (async () => {
    try {
      const instance = simpleBarInstances.get(panel);
      if (!instance) return { ok: false, reason: "no_instance" };

      instance.recalculate?.();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      const scrollbar = await waitForScrollbar(instance, timeout);

      if (!scrollbar) {
        panel.style.paddingRight = "2px";
        return { ok: false, reason: "scrollbar_not_found" };
      }

      const isVisible = getComputedStyle(scrollbar).visibility === "visible";
      if (!panel.style.transition) {
        panel.style.transition = "padding var(--transition-reduced-fast), min-height var(--transition-reduced-fast)";
      }

      const newPadding = isVisible ? "16px" : "2px";

      if (panel.style.paddingRight === newPadding) {
        return { ok: true, visible: isVisible };
      }

      await new Promise((resolve) => {
        const handler = (e) => {
          if (e.propertyName !== "padding-right") return;
          panel.removeEventListener("transitionend", handler);
          resolve();
        };
        panel.addEventListener("transitionend", handler);
        panel.style.paddingRight = newPadding;
        setTimeout(resolve, 150);
      });

      return { ok: true, visible: isVisible };
    } catch (error) {
      panel.style.paddingRight = "2px";
      return { ok: false, error: error.message };
    } finally {
      panelPromises.delete(panel);
    }
  })();

  panelPromises.set(panel, promise);
  return promise;
}

// Wait for scrollbar to appear
function waitForScrollbar(instance, timeout = 1000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const scrollbar = instance.el.querySelector(":scope > .simplebar-vertical");

    // If scrollbar already exists
    if (scrollbar && scrollbar.offsetHeight > 0) {
      return resolve(scrollbar);
    }

    // Monitor DOM changes with MutationObserver
    const observer = new MutationObserver(() => {
      const currentScrollbar = instance.el.querySelector(":scope > .simplebar-vertical");
      if (currentScrollbar && currentScrollbar.offsetHeight > 0) {
        observer.disconnect();
        resolve(currentScrollbar);
      }

      // Timeout control
      if (Date.now() - startTime > timeout) {
        observer.disconnect();
        resolve(null);
      }
    });

    observer.observe(instance.el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    // Fallback: timeout
    setTimeout(() => {
      observer.disconnect();
      const finalScrollbar = instance.el.querySelector(":scope > .simplebar-vertical");
      resolve(finalScrollbar);
    }, timeout);
  });
}

// Send Action to background with retry
async function sendAction(action, payload = {}) {
  for (let retry = 0; retry < 10; retry++) {
    try {
      const response = await browser.runtime.sendMessage({ action, ...payload });

      // If no response
      if (response === undefined) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      if (response && typeof response === "object" && "ok" in response) {
        return response;
      }

      return { ok: true, data: response };
    } catch (err) {
      const msg = err?.message || "";

      if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: "No response after retries" };
}

function getCurrentStyleAttributes() {
  const styleAttrs = {};
  const rootStyles = document.body.style;

  for (const name of rootStyles) {
    rootStyles.getPropertyValue(name) && (styleAttrs[name] = rootStyles.getPropertyValue(name));
  }

  return styleAttrs;
}

function parseTemplate(str, boldMap = {}, codeMap = {}) {
  const nodes = [];
  const parts = str.split(/(\{bold_\w+\}|\{code_\w+\}|\n)/);

  for (const part of parts) {
    if (!part) continue;

    if (part === "\n") {
      nodes.push(document.createElement("br"));
    } else if (part.startsWith("{bold_")) {
      const key = part.slice(1, -1);
      const text = boldMap[key] ?? part;
      nodes.push(createBold(text));
    } else if (part.startsWith("{code_")) {
      const key = part.slice(1, -1);
      const text = codeMap[key] ?? part;
      nodes.push(createCode(text));
    } else {
      nodes.push(document.createTextNode(part));
    }
  }

  return nodes;
}

// If mv3 and the user have not granted userscript permission, show a warning.
function createMv3PermissionAlert(config) {
  const wrapper = document.createElement("div");
  wrapper.id = "mv3Alert";

  const box = document.createElement("div");
  box.className = "box";

  // Title
  const title = document.createElement("h2");
  title.textContent = `⚠️ ${i18n.t("userscript.apiWarn.title")} ⚠️`;

  // Intro
  const intro = document.createElement("p");
  intro.append(...parseTemplate(i18n.t("userscript.apiWarn.intro"), { bold_api: i18n.t("userscript.apiWarn.introApi") }));

  // Why section
  const whyTitle = document.createElement("h4");
  whyTitle.textContent = i18n.t("userscript.apiWarn.whyTitle");

  const whyText = document.createElement("p");
  whyText.textContent = i18n.t("userscript.apiWarn.whyText");

  // Fix section
  const fixTitle = document.createElement("h4");
  fixTitle.textContent = i18n.t("userscript.apiWarn.fixTitle");

  const fixWrap = document.createElement("div");
  fixWrap.className = "mv3-fixWrap";

  const fixText = document.createElement("ol");
  fixText.className = "mv3-fixText";

  // Step 1
  const fixStep1 = document.createElement("li");
  fixStep1.append(...parseTemplate(i18n.t("userscript.apiWarn.fixStep1")));

  // Step 2
  const fixStep2 = document.createElement("li");
  fixStep2.append(document.createTextNode(i18n.t("userscript.apiWarn.fixStep2")));

  // Step 3
  const fixStep3 = document.createElement("li");
  fixStep3.append(document.createTextNode(i18n.t(config.type === "chrome" ? "userscript.apiWarn.fixStep3" : "userscript.apiWarn.fixStep3-moz")));

  // Step 3.5 (Firefox)
  const fixStep3_moz = document.createElement("li");
  fixStep3_moz.append(document.createTextNode(i18n.t("userscript.apiWarn.fixStep3.5-moz")));

  const fixStep4 = document.createElement("li");
  fixStep4.append(...parseTemplate(i18n.t("userscript.apiWarn.fixStep4"), {}, { code_permission: config.permissionLabel }));

  // Step 5
  const fixStep5 = document.createElement("li");
  fixStep5.append(document.createTextNode(i18n.t("userscript.apiWarn.fixStep5")));

  const fixImage = document.createElement("img");
  fixImage.className = "mv3-fixImage";
  fixImage.src = config.image;

  fixText.append(fixStep1, fixStep2, fixStep3, ...(config.type === "firefox" ? [fixStep3_moz] : []), fixStep4, fixStep5);
  fixWrap.append(fixText, fixImage);

  box.append(title, intro, document.createElement("br"), whyTitle, whyText, document.createElement("br"), fixTitle, fixWrap);
  wrapper.appendChild(box);
  return wrapper;
}

function createBold(text) {
  const b = document.createElement("b");
  b.textContent = text;
  return b;
}

function createCode(text) {
  const code = document.createElement("code");
  code.textContent = text;
  return code;
}

async function checkUserScriptsPermission() {
  const BROWSER_CONFIG = {
    chrome: {
      type: "chrome",
      extensionPage: "chrome://extensions/",
      permissionLabel: i18n.t("userscript.apiWarn.chromePermission"),
      image: browser.runtime.getURL("assets/chrome-userscript.png"),
      showPermissionAndDataStep: false,
    },
    firefox: {
      type: "firefox",
      extensionPage: "about:addons",
      permissionLabel: i18n.t("userscript.apiWarn.firefoxPermission"),
      image: browser.runtime.getURL("assets/firefox-userscript.png"),
      showPermissionAndDataStep: true,
    },
  };

  const manifest = browser.runtime.getManifest();
  if (manifest.manifest_version !== 3) return false;

  if (!browser.userScripts) {
    const browserType = detectBrowser();
    const config = BROWSER_CONFIG[browserType];
    if (document.getElementById("mv3Alert")) return false;
    document.body.appendChild(createMv3PermissionAlert(config));
    return false;
  }
  return true;
}

// Open Selector Parser Manager
async function openselectorParserManager(id) {
  const url = browser.runtime.getURL("manager/selectorParserManager.html");
  await browser.storage.local.set({
    managerContext: {
      target: id,
    },
  });

  const tabs = await browser.tabs.query({ url });
  if (tabs.length > 0 && tabs[0].id) {
    // if tab is already open → refresh it
    await browser.tabs.reload(tabs[0].id);
    await browser.tabs.update(tabs[0].id, { active: true });
    window.close();
    return;
  }

  // if tab is not open → create new tab
  await browser.tabs.create({ url });
  window.close();
}

// Open User Script Manager
async function openUserScriptManager(id) {
  const url = browser.runtime.getURL("manager/userScriptManager.html");
  await browser.storage.local.set({
    managerContext: {
      target: id,
    },
  });

  const tabs = await browser.tabs.query({ url });
  if (tabs.length > 0 && tabs[0].id) {
    // if tab is already open → refresh it
    await browser.tabs.reload(tabs[0].id);
    await browser.tabs.update(tabs[0].id, { active: true });
    window.close();
    return;
  }

  // if tab is not open → create new tab
  await browser.tabs.create({ url });
  window.close();
}

// Load all favicons
async function loadFavIcons(icons, concurrency = 3, delayMs = 150, slowAfter = 8) {
  if (!icons?.length) return;

  const queue = Array.from(icons);
  let loadedCount = 0;

  function loadSingleIcon(icon, domain) {
    return new Promise((resolve) => {
      if (!domain) return resolve();

      const rawDomain = Array.isArray(domain) ? domain[0] : domain;
      const cleanDomain = (rawDomain || "").replace(/^\*\./, "");
      const primaryDomain = cleanDomain.split(",")[0].trim();
      const proxyUrl = `https://favicons.seadfeng.workers.dev/${primaryDomain}.ico`;
      const googleUrl = `https://www.google.com/s2/favicons?domain=${primaryDomain}&sz=32`;
      const fallback = browser.runtime.getURL("icons/48x48.png");

      const finish = () => {
        icon.onload = null;
        icon.onerror = null;
        icon.classList.remove("hidden-visibility");
        icon.parentElement?.classList.remove("spinner");
        resolve();
      };

      icon.onload = finish;

      icon.onerror = () => {
        if (icon.src === proxyUrl) {
          icon.src = googleUrl;
        } else {
          if (icon.src !== fallback) {
            icon.onerror = finish;
            icon.src = fallback;
          } else {
            finish();
          }
        }
      };

      icon.src = proxyUrl;
      if (icon.complete && icon.naturalWidth !== 0) {
        finish();
      }
    });
  }

  async function worker() {
    while (queue.length > 0) {
      const icon = queue.shift();
      if (icon == null) return;

      const domain = icon.dataset?.src;
      await loadSingleIcon(icon, domain);

      const slowdown = ++loadedCount > slowAfter ? delayMs * 2 : delayMs;
      await delay(slowdown + Math.random() * 60);
    }
  }

  const safeConcurrency = Math.min(concurrency, queue.length);
  await Promise.all(Array.from({ length: safeConcurrency }, worker));
}

// Popup Message
let showPopupMessageTimeout = null;
let currentMessageContainer = null;
function showPopupMessage(text, type = "info", closeAfter = null, preventClick = false, appendTo = "body > footer") {
  const footer = document.querySelector(appendTo);

  if (currentMessageContainer && currentMessageContainer.parentNode) {
    currentMessageContainer.remove();
    currentMessageContainer = null;
  }

  let messageContainer = document.querySelector(".popup-message");
  if (!messageContainer) {
    messageContainer = document.createElement("div");
    messageContainer.className = `popup-message ${type}`;
    footer.appendChild(messageContainer);
  }

  const handleMessageClick = () => {
    hidePopupMessage();
  };

  messageContainer.addEventListener("click", handleMessageClick, { once: true });
  currentMessageContainer = messageContainer;

  messageContainer.textContent = text;

  if (preventClick) document.body.style.pointerEvents = "none";

  if (closeAfter) {
    clearTimeout(showPopupMessageTimeout);
    const loadingIndicator = document.createElement("div");
    loadingIndicator.className = "popup-message-indicator";
    loadingIndicator.style.animationDuration = `${closeAfter}ms`;
    messageContainer.appendChild(loadingIndicator);
    loadingIndicator.style.display = "none";
    void loadingIndicator.offsetWidth;
    loadingIndicator.style.display = "block";

    showPopupMessageTimeout = setTimeout(() => {
      hidePopupMessage();
    }, closeAfter);
  }
}

function hidePopupMessage() {
  if (currentMessageContainer && currentMessageContainer.parentNode) {
    currentMessageContainer.classList.add("hide");
    setTimeout(() => {
      document.body.style.pointerEvents = "";
      currentMessageContainer.remove();
      currentMessageContainer = null;
    }, 300);
  }
  if (showPopupMessageTimeout) {
    clearTimeout(showPopupMessageTimeout);
    showPopupMessageTimeout = null;
  }
}

// Restart Extension
async function restartExtension(tab) {
  try {
    if (tab && tab.id) {
      await browser.tabs.reload(tab.id);
      browser.runtime.reload();
    } else {
      browser.runtime.reload();
    }
  } catch (err) {
    logError("[restartExtension]: Restart the extension error:", err);
  }
}

// Toggle Debug Mode
async function toggleDebugMode(tab) {
  try {
    const stored = (await browser.storage.local.get("debugMode")).debugMode;
    const current = stored ?? CONFIG.debugMode;
    const newValue = current === 0 ? 1 : 0;

    await browser.storage.local.set({ debugMode: newValue });
    CONFIG.debugMode = newValue;

    if (tab && tab.id) browser.tabs.reload(tab.id);
  } catch (err) {
    logError("[toggleDebugMode]: Toggle Debug Mode error:", err);
  }
}

// Factory Reset
let factoryResetConfirm = false;
let factoryResetTimer = null;
const factoryResetTimeout = 5000;

async function factoryReset(tab, fromSettings = false) {
  const ORIGINAL_FACTORY_TITLE = "Reset to Defaults (Click > Open Menu Again > Confirm)";
  const CONFIRM_FACTORY_TITLE = "❗ Confirm Reset to Defaults (Click)";

  // Settings Section Action
  if (fromSettings && !factoryResetConfirm) {
    factoryResetConfirm = true;

    setTimeout(() => {
      factoryResetConfirm = false;
    }, factoryResetTimeout);

    return { needConfirm: true };
  }

  // Context Menu Action
  if (!fromSettings && !factoryResetConfirm) {
    factoryResetConfirm = true;

    browser.contextMenus.update("factoryReset", { title: CONFIRM_FACTORY_TITLE });

    factoryResetTimer = setTimeout(() => {
      factoryResetConfirm = false;
      browser.contextMenus.update("factoryReset", { title: ORIGINAL_FACTORY_TITLE });
    }, factoryResetTimeout);

    return;
  }

  // Factory Reset Action
  factoryResetConfirm = false;
  clearTimeout(factoryResetTimer);
  try {
    await browser.storage.local.clear();
    if (tab && tab.id) await browser.tabs.reload(tab.id);
    browser.runtime.reload();
  } catch (err) {
    logError("[factoryReset]: Reset to Defaults error:", err);
  }
}

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
