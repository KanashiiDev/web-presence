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

function isValidSelectorUrl(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

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
