// Format Time
export function formatTime(sec) {
  if (!sec || sec < 0) return "00:00";

  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

// Relative Time
const t = (key, params) => window.i18n?.t(key, params) ?? "—";
export function relativeTime(dateValue) {
  if (dateValue == null || dateValue === "") return "—";

  let past = typeof dateValue === "number" ? dateValue : NaN;

  if (isNaN(past)) {
    const asNum = Number(dateValue);
    if (!isNaN(asNum) && asNum > 0) {
      past = asNum;
    } else {
      const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
      past = isNaN(d.getTime()) ? NaN : d.getTime();
    }
  }

  if (!past || isNaN(past)) return "—";

  const now = Date.now();
  const s = Math.floor((now - past) / 1000);
  if (s < 0) return t("time.just_now");

  if (s < 45) return t("time.just_now");
  if (s < 90) return t("time.minute_ago.one", { count: 1 });
  if (s < 3600) return t("time.minute_ago.other", { count: Math.floor(s / 60) });

  const mins = Math.floor(s / 60);
  if (mins < 90) return t("time.hour_ago.one", { count: 1 });
  if (mins < 1440) return t("time.hour_ago.other", { count: Math.floor(mins / 60) });

  const days = Math.floor(mins / 1440);
  if (days === 1) return t("time.yesterday");
  if (days < 7) return t("time.days_ago", { count: days });

  const weeks = Math.floor(days / 7);
  if (weeks === 1) return t("time.week_ago.one", { count: 1 });
  if (weeks < 5) return t("time.week_ago.other", { count: weeks });

  const months = Math.floor(days / 30.4);
  if (months < 12) return t("time.month_ago.other", { count: months });

  return t("time.year_ago.other", { count: Math.floor(months / 12) });
}

// Full Date Time
export function fullDateTime(dateValue, fallbackLocale = "en-US") {
  let timestamp;
  if (typeof dateValue === "number") {
    timestamp = dateValue;
  } else if (dateValue instanceof Date) {
    timestamp = dateValue.getTime();
  } else {
    const asNum = Number(dateValue);
    timestamp = !isNaN(asNum) && asNum > 0 ? asNum : new Date(dateValue).getTime();
  }
  if (isNaN(timestamp)) return "Invalid date";

  return new Date(timestamp).toLocaleString(navigator.languages?.[0] || navigator.language || fallbackLocale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Recalculate all relative time elements on the page
export function refreshRelativeTimes() {
  document.querySelectorAll("[data-timestamp]").forEach((el) => {
    const raw = el.dataset.timestamp;
    if (!raw) return;
    const ago = relativeTime(raw);
    if (el.dataset.timestampFormat === "log") {
      el.textContent = `${ago} (${fullDateTime(Number(raw))})`;
    } else {
      el.textContent = ago;
    }
  });
}

// Refresh the dates when the tab comes to the front from the background
function _onVisibilityChange() {
  if (document.visibilityState === "visible") {
    refreshRelativeTimes();
  }
}

export function initVisibilityRefresh() {
  document.removeEventListener("visibilitychange", _onVisibilityChange);
  document.addEventListener("visibilitychange", _onVisibilityChange);
}

// Create SVG
const SVG_CACHE_MAX = 50;
const svgCache = new Map();

function svgCacheSet(key, val) {
  if (svgCache.has(key)) svgCache.delete(key);
  svgCache.set(key, val);
  if (svgCache.size > SVG_CACHE_MAX) {
    svgCache.delete(svgCache.keys().next().value);
  }
}

export function createSVG(paths, options = {}) {
  const key = paths.join("");
  if (svgCache.has(key)) return svgCache.get(key).cloneNode(true);

  const { width = 16, height = 16, stroke = "var(--icon-color)", strokeWidth = 1.4, fill = "none", viewBox = "-1 -1 25.5 25.5" } = options;
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
    path.setAttribute("d", d);
    svg.appendChild(path);
  }

  svgCacheSet(cacheKey, svg.cloneNode(true));

  return svg;
}

export const svg_paths = {
  single: [
    "M5.5 2.5H18.5A3 3 0 0 1 21.5 5.5V18.5A3 3 0 0 1 18.5 21.5H5.5A3 3 0 0 1 2.5 18.5V5.5A3 3 0 0 1 5.5 2.5Z",
    "M8.5 7H15.5A1.5 1.5 0 0 1 17 8.5V15.5A1.5 1.5 0 0 1 15.5 17H8.5A1.5 1.5 0 0 1 7 15.5V8.5A1.5 1.5 0 0 1 8.5 7Z",
  ],
  dual: [
    "M5.5 2.5H18.5A3 3 0 0 1 21.5 5.5V18.5A3 3 0 0 1 18.5 21.5H5.5A3 3 0 0 1 2.5 18.5V5.5A3 3 0 0 1 5.5 2.5Z",
    "M8 7H11.5A1 1 0 0 1 12.5 8V16A1 1 0 0 1 11.5 17H8A1 1 0 0 1 7 16V8A1 1 0 0 1 8 7Z",
    "M12.5 7H16A1 1 0 0 1 17 8V16A1 1 0 0 1 16 17H12.5A1 1 0 0 1 11.5 16V8A1 1 0 0 1 12.5 7Z",
  ],
  expand: ["M4 12l8 8 8-8"],
  leftChev: ["M12 20l-8-8 8-8"],
  rightChev: ["M12 4l8 8-8 8"],
  camera: ["M3 7h4l2-2h6l2 2h4v12H3V7z M12 17a4 4 0 100-8 4 4 0 000 8z"],
  gear: [
    `M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06 a1.65 1.65
     0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09 a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83
     l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4 h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2
     2 0 1 1 2.83-2.83 l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09 a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0
     0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83 l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4 h-.09a1.65 1.65 0 0 0-1.51 1z`,
  ],
  back: ["M19 20l-8-8 8-8"],
  pen: ["M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z", "M20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"],
};

export function getTotalHeight(element, elementParent) {
  const div = typeof element !== "object" ? document.querySelector(element) : element;
  let content = div.querySelector(".simplebar-content");
  if (!content) content = div;
  const parent = typeof elementParent !== "object" ? document.querySelector(elementParent) : elementParent;
  const style = window.getComputedStyle(parent);
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  return content.scrollHeight + paddingTop + paddingBottom;
}

export function updateSimpleBarPadding(containerId) {
  const container = document.getElementById(containerId);
  if (!container || document.querySelector(".main").style.display === "none") return;
  const hasVisibleScrollbar = document.querySelector(`#${containerId} .simplebar-track[style*="visibility: visible"]`);
  container.style.paddingRight = hasVisibleScrollbar ? "22px" : "0";
}

export function updateCollapsibleHeight(type) {
  const box = document.getElementById(`${type}`);
  if (!box || !box.classList.contains("open")) return;

  const content = box.querySelector(".simplebar-content");
  if (content) {
    box.style.maxHeight = content.scrollHeight + "px";
  }
}

export function shallowEqual(objA, objB) {
  if (objA === objB) return true;
  if (typeof objA !== "object" || typeof objB !== "object" || objA == null || objB == null) {
    return false;
  }

  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key) || objA[key] !== objB[key]) {
      return false;
    }
  }
  return true;
}

export function getCSS(variable, fallback = null, format = "hex", el = document.body) {
  const raw = getComputedStyle(el).getPropertyValue(variable).trim();
  if (!raw) return fallback;

  const color = tinycolor(raw);
  if (!color.isValid()) return fallback;

  const { r, g, b, a } = color.toRgb();

  switch (format) {
    case "hex":
      return color.toHexString();

    case "hexa":
      return color.toHex8String();

    case "rgb":
      return color.toRgbString();

    case "rgba":
      return color.toRgbString();

    case "rgb-string":
      return `${r}, ${g}, ${b}`;

    case "rgba-string":
      return `${r}, ${g}, ${b}, ${a}`;

    default:
      return raw;
  }
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

export function waitForTransitionEnd(el, property) {
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

export async function handleCollapsible(header, AppState, simpleBars) {
  const box = header.nextElementSibling;
  if (!box) return;

  const heightBefore = box.offsetHeight;
  const isOpen = box.classList.contains("open");
  header.style.pointerEvents = "none";

  if (isOpen) {
    box.style.maxHeight = box.scrollHeight + "px";
    requestAnimationFrame(() => {
      box.classList.remove("open");
      header.classList.remove("open");
      box.style.maxHeight = "";
    });
    await waitForTransitionEnd(box, "max-height");
    const wrapperId = box.querySelector("[data-simplebar]")?.id;
    if (wrapperId) updateSimpleBarPadding(wrapperId);
  } else {
    box.classList.add("open");
    header.classList.add("open");
    const targetH = getTotalHeight(box, box);
    const maxH = parseInt(box.dataset.maxHeight) || 0;
    const finalH = maxH && targetH > maxH ? maxH : targetH;
    box.style.maxHeight = finalH + "px";
    Object.values(simpleBars).forEach((sb) => sb?.recalculate());

    await waitForTransitionEnd(box, "max-height");

    const heightAfter = box.offsetHeight;
    if (heightAfter - heightBefore <= 2) {
      box.classList.remove("open");
      header.classList.remove("open");
      box.style.maxHeight = "";
    } else {
      if (!box.dataset.maxHeight) box.style.maxHeight = "100vh";
    }
    const wrapperId = box.querySelector("[data-simplebar]")?.id;
    if (wrapperId) updateSimpleBarPadding(wrapperId);
  }

  header.style.pointerEvents = "";
}

export function loadImage({ target, src, fallback = "assets/icon-dark.png" } = {}) {
  if (!target) return;
  if ((target && !src) || typeof src !== "string") target.src = fallback;

  const finish = () => {
    target.classList.add("lazyloaded");
    target.closest(".spinner")?.classList.remove("spinner");
    target.removeEventListener("load", onLoad);
    target.removeEventListener("error", onError);
  };

  const onLoad = () => finish();

  const onError = () => {
    target.src = fallback;
    finish();
  };

  target.addEventListener("load", onLoad, { once: true });
  target.addEventListener("error", onError, { once: true });

  target.src = src;
}
