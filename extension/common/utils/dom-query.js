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

// Climbs [parent] levels, then narrows with [only]. Returns null when the parent chain runs out.
function resolveTarget(elem, { onlySelector, parentLevel }) {
  let el = elem;
  if (parentLevel) {
    for (let i = 0; i < parentLevel; i++) el = el?.parentElement;
    if (!el) return null;
  }
  if (onlySelector) {
    const onlyEl = el.querySelector(onlySelector);
    if (onlyEl) el = onlyEl;
  }
  return el;
}

// Reads text / attribute from one element and applies [ignore], [strip] and transform.
function extractText(elem, parsed, { attr = null, transform = null } = {}) {
  const el = resolveTarget(elem, parsed);
  if (!el) return "";

  const target = parsed.ignoreSelector && !attr ? cloneWithoutIgnored(el, parsed.ignoreSelector) : el;

  let val = attr ? el.getAttribute(attr) : target.textContent;
  if (!val) return "";

  val = applyStrip(val.trim(), parsed.stripPattern);
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
 * Selects the element, takes the desired Attribute (or TextContent), then applies optional operations.
 * @param {string} selector - CSS selector (supports [ignore], [only], [strip], [parent] extensions)
 * @param {object} options - Optional Parameters
 *    - attr: String, Element Attribute Name (eg "href", "title", "src")
 *    - transform: Function, function that will be processed on the string received
 *    - root: Element or Document, Search Root (default: document)
 * @returns {string} - processed string or empty string
 */
function getText(selector, options = {}) {
  if (!selector) return "";
  const { attr = null, transform = null, root = document } = options;
  const parsed = parseIgnoreSelector(selector);

  let elem = null;
  try {
    elem = querySelectorDeep(parsed.cleanSelector, root);
  } catch (_) {}
  if (!elem) return "";

  return extractText(elem, parsed, { attr, transform });
}

/**
 * Gets text/attributes from ALL matching elements (same selector syntax and options as getText)
 * @param {string} selector - CSS selector
 * @param {object} options - Same as getText options
 * @returns {string[]} - Array of processed strings
 */
function getTextAll(selector, options = {}) {
  if (!selector) return [];
  const { attr = null, transform = null, root = document } = options;
  const parsed = parseIgnoreSelector(selector);

  let elems = [];
  try {
    elems = querySelectorDeep(parsed.cleanSelector, root, true);
  } catch (_) {}

  return elems.map((el) => extractText(el, parsed, { attr, transform })).filter((val) => val !== "");
}

function isValidSelectorUrl(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Reject strings that are valid CSS selectors.
  // CSS selectors like "img.song-image" or "div.song .lazyloaded"
  // can be misparsed as URLs (e.g. https://img.song-image/).
  try {
    document.querySelector(trimmed);
    return null;
  } catch (_) {}

  const hasProtocol = trimmed.startsWith("http://") || trimmed.startsWith("https://");
  const candidate = hasProtocol ? trimmed : "https://" + trimmed;

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    const hostname = url.hostname;
    if (!hostname.includes(".") || hostname.startsWith(".") || hostname.endsWith(".")) {
      return null;
    }

    return url.href;
  } catch (_) {
    return null;
  }
}

// Finds the image URL of one element: <img> itself, then background-image, then the first child <img>.
function imageFromElement(elem, ignoreSelector = null) {
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
 * Retrieves image URL from element matching selector.
 *
 * @param {string} selector - CSS selector to find the image element.
 * @param {Document|Element} [root=document] - Root element for querySelector.
 * @returns {string|null} Image URL or null if not found.
 */
function getImage(selector, root = document) {
  if (!selector) return null;

  // If a plain URL is entered, return it directly
  const directUrl = isValidSelectorUrl(selector);
  if (directUrl) return directUrl;

  const parsed = parseIgnoreSelector(selector);

  let elem = null;
  try {
    elem = querySelectorDeep(parsed.cleanSelector, root);
  } catch (_) {}
  if (!elem) return null;

  const target = resolveTarget(elem, parsed);
  if (!target) return null;

  return imageFromElement(target, parsed.ignoreSelector);
}

/**
 * Gets image URLs from ALL matching elements
 * @param {string} selector - CSS selector
 * @param {Document|Element} root - Search root
 * @returns {string[]} - Array of image URLs
 */
function getImageAll(selector, root = document) {
  if (!selector) return [];

  const directUrl = isValidSelectorUrl(selector);
  if (directUrl) return [directUrl];

  const parsed = parseIgnoreSelector(selector);

  let elems = [];
  try {
    elems = querySelectorDeep(parsed.cleanSelector, root, true);
  } catch (_) {}

  return elems
    .map((el) => resolveTarget(el, parsed))
    .filter(Boolean)
    .map((el) => imageFromElement(el, parsed.ignoreSelector))
    .filter(Boolean);
}

/**
 * Returns true if selector contains a class token that ends with "_" or "-".
 * Indicates a CSS Modules–style prefix class.
 */
function isPartialClassSelector(selector) {
  // Match ".class_" or ".class-" followed by a selector boundary or end
  return /\.([^\s.#\[>~+:]+[_-])(?=[\s>~+\[:#.)]|$)/.test(selector);
}

// Deep query selector that traverses shadow DOMs
function querySelectorDeep(selector, root = document, all = false) {
  const walk = (r, matcher) => {
    const acc = [];
    let hit = [];
    try {
      hit = matcher(r);
    } catch (_) {}
    if (hit.length) {
      if (!all) return [hit[0]];
      acc.push(...hit);
    }
    for (const el of r.querySelectorAll("*")) {
      if (!el.shadowRoot) continue;
      const sub = walk(el.shadowRoot, matcher);
      if (sub.length) {
        if (!all) return [sub[0]];
        acc.push(...sub);
      }
    }
    return acc;
  };
  let found = walk(root, (r) => Array.from(r.querySelectorAll(selector)));
  if (!found.length && isPartialClassSelector(selector)) found = walk(root, (r) => queryWithPartialClass(selector, r));
  return all ? found : (found[0] ?? null);
}
