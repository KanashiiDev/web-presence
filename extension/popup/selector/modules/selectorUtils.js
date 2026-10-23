/* ───────────────────────────────────── */
/*      Core Safe Utility Functions      */
/* ───────────────────────────────────── */
// Deep query roots, in the SAME order querySelectorDeep visits them:
// document first, then every open shadow root depth-first. Uniqueness / first-match must be
// judged across all of them, because the consumer resolves selectors through querySelectorDeep.
let __roots = null;

function collectQueryRoots(start = document) {
  const roots = [];
  const walk = (root) => {
    roots.push(root);
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(start);
  return roots;
}

function getQueryRoots() {
  return __roots || [document];
}

function withDeepQuery(fn) {
  const prev = __roots;
  __roots = collectQueryRoots(document); // one DOM pass per generation
  partialQueryCache.clear(); // cached node lists are only valid for one DOM snapshot
  try {
    return fn();
  } finally {
    __roots = prev;
  }
}

function safeQuery(selector) {
  if (typeof selector !== "string" || selector.length > SELECTOR_CONSTANTS.MATCH_LIMITS.MAX_SELECTOR_LENGTH) {
    return [];
  }
  try {
    return getQueryRoots().flatMap((root) => Array.from(root.querySelectorAll(selector)));
  } catch {
    return [];
  }
}

function safeGetComputedStyle(el) {
  try {
    return getComputedStyle(el);
  } catch {
    return null;
  }
}

function safeElementsFromPoint(x, y, root = document) {
  try {
    let elements = [];
    if (root.elementsFromPoint) {
      elements = Array.from(root.elementsFromPoint(x, y) || []);
    } else {
      const element = root.elementFromPoint?.(x, y) || document.elementFromPoint(x, y);
      if (element) elements = [element];
    }

    // Also check shadow roots
    const allElements = [...elements];
    for (const el of elements) {
      if (el.shadowRoot) {
        const shadowElements = safeElementsFromPoint(x, y, el.shadowRoot);
        allElements.push(...shadowElements);
      }
    }

    return allElements;
  } catch {
    return [];
  }
}

function safeClosest(element, selector) {
  try {
    return element.closest(selector);
  } catch {
    return null;
  }
}

function safeGetAttributes(element) {
  try {
    return Array.from(element.attributes || []);
  } catch {
    return [];
  }
}

function safeGetClassList(element) {
  try {
    return Array.from(element.classList || []);
  } catch {
    return [];
  }
}

/* ────────────────────────────────── */
/*      Element Finder Utilities      */
/* ────────────────────────────────── */
function findParentElementByCondition(el, conditionFn) {
  let current = el;
  let safety = 0;
  const MAX_SAFE = 2;

  while (current && safety < MAX_SAFE) {
    if (conditionFn(current)) return current;

    if (current === document.body || current === document.documentElement) break;
    if (!current.parentElement) break;

    current = current.parentElement;
    safety++;
  }
  return null;
}

function findElement(el, options = {}) {
  const { excludeHidden = true, excludeScriptStyle = true } = options;

  return findParentElementByCondition(el, (currentEl) => {
    if (excludeHidden && !isElementVisible(currentEl)) return false;

    if (excludeScriptStyle) {
      const tag = currentEl.tagName.toLowerCase();
      if (["script", "style", "noscript"].includes(tag)) return false;
    }

    return true;
  });
}

function findImageElement(el) {
  return findParentElementByCondition(el, (currentEl) => {
    const tag = currentEl.tagName?.toLowerCase();
    const style = safeGetComputedStyle(currentEl);
    const bg = style?.backgroundImage;

    // <img> elements
    if (tag === "img" && currentEl.src && currentEl.src !== window.location.href) return true;

    // background-image control
    if (bg && /url\(["']?([^"']+)["']?\)/i.test(bg)) {
      const urlMatch = bg.match(/url\(["']?([^"']+)["']?\)/i);
      if (urlMatch?.[1] && !urlMatch[1].startsWith("data:")) return true;
    }

    // The img elements underneath
    if (currentEl.querySelector(":scope > img[src]")) return true;

    // ::before / ::after check
    try {
      const before = getComputedStyle(currentEl, "::before")?.backgroundImage;
      const after = getComputedStyle(currentEl, "::after")?.backgroundImage;
      return (before && /url\(["']?([^"']+)["']?\)/i.test(before)) || (after && /url\(["']?([^"']+)["']?\)/i.test(after));
    } catch {
      return false;
    }
  });
}

function findLinkElement(el) {
  return findParentElementByCondition(el, (currentEl) => {
    const tag = currentEl.tagName?.toLowerCase();
    const role = currentEl.getAttribute("role");
    const href = currentEl.getAttribute("href");
    const xlinkHref = currentEl.getAttribute("xlink:href");

    const hasValidHref = href && href !== "#" && href !== "" && !href.startsWith("javascript:");
    const hasValidXlink = xlinkHref && xlinkHref !== "#" && xlinkHref !== "";

    return (tag === "a" && (hasValidHref || hasValidXlink)) || role === "link" || (tag !== "a" && hasValidXlink);
  });
}

function findTextElement(el, options = {}) {
  const { minLength = 1, maxLength = 500, excludeHidden = true, excludeScriptStyle = true } = options;

  return findParentElementByCondition(el, (currentEl) => {
    if (excludeHidden && !isElementVisible(currentEl)) return false;

    if (excludeScriptStyle) {
      const tag = currentEl.tagName.toLowerCase();
      if (["script", "style", "noscript"].includes(tag)) return false;
    }

    const text = currentEl.textContent?.trim();
    if (!text || text.length < minLength || text.length > maxLength || !/\S/.test(text)) {
      return false;
    }

    return true;
  });
}

// Visibility Utilities
function isElementVisible(el) {
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && el.offsetWidth > 0 && el.offsetHeight > 0;
}

/* ────────────────────────────────────── */
/*      Flutter Canvas Detection          */
/* ────────────────────────────────────── */
function isFlutterPage() {
  return !!document.querySelector("flutter-view, flt-glass-pane, flt-canvas-container > canvas[aria-hidden='true']");
}

/* ──────────────────────────── */
/*      Element Validation      */
/* ──────────────────────────── */
function isValidElement(el) {
  if (!el || SELECTOR_CONSTANTS.BLOCKED_IDS.includes(el.id)) return false;
  if (el === document || el === window || el.nodeType !== 1) return false;

  try {
    const style = safeGetComputedStyle(el);
    if (!style) return false;

    const hidden = style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0 || style.pointerEvents === "none";

    if (hidden) return false;

    return hasVisibleContent(el) || hasInteractiveRole(el);
  } catch {
    return false;
  }
}

function hasVisibleContent(el) {
  const tag = el.tagName?.toLowerCase();
  const isNavbar = !!safeClosest(el, "header, nav, .navbar, .header, .nav, [role='navigation']");

  const hasContent =
    el.textContent?.trim().length > 0 ||
    el.innerHTML?.trim().length > 5 ||
    el.hasAttribute("src") ||
    el.hasAttribute("href") ||
    el.querySelector("img, svg, i, span, canvas, video, iframe");

  const hasSize = el.offsetWidth > 0 || el.offsetHeight > 0;
  const hasClientRect = el.getClientRects().length > 0;

  if (isNavbar) return hasSize || hasContent;
  return hasContent || hasSize || hasClientRect;
}

function hasInteractiveRole(el) {
  const interactiveTags = ["a", "button", "input", "select", "textarea", "label", "summary", "menuitem", "option", "li"];
  return interactiveTags.includes(el.tagName?.toLowerCase());
}

/* ─────────────────────────── */
/*      Element Detection      */
/* ─────────────────────────── */
function isFullScreenOverlay(el) {
  if (!el || el === document.body || el === document.documentElement) return false;

  // Recursion guard
  if (isFullScreenOverlay._depth > 5) return false;
  isFullScreenOverlay._depth = (isFullScreenOverlay._depth || 0) + 1;

  try {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    const coversViewport = rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
    const isPositioned = style.position === "fixed" || style.position === "absolute";
    const hasNoContent = el.children.length === 0 && el.textContent.trim().length === 0;
    const isTransparent = style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent";
    return coversViewport && isPositioned && (hasNoContent || isTransparent);
  } finally {
    isFullScreenOverlay._depth--;
  }
}

function deepElementFromPoint(x, y, root = document) {
  const hidden = [];

  let el = root.elementFromPoint ? root.elementFromPoint(x, y) : document.elementFromPoint(x, y);
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (el && isFullScreenOverlay(el) && iterations < MAX_ITERATIONS) {
    hidden.push(el);
    el.style.pointerEvents = "none";
    el = root.elementFromPoint ? root.elementFromPoint(x, y) : document.elementFromPoint(x, y);
    iterations++;
  }

  hidden.forEach((e) => (e.style.pointerEvents = ""));

  if (el && el.shadowRoot) {
    const shadowEl = deepElementFromPoint(x, y, el.shadowRoot);
    if (shadowEl) return shadowEl;
  }

  return el;
}

/* ──────────────────────────────── */
/*      Blocked Element Checks      */
/* ──────────────────────────────── */
function isIframeElement(el) {
  if (!el) return false;
  if (el.tagName?.toLowerCase() === "iframe") return true;

  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    if (parent.tagName?.toLowerCase() === "iframe") return true;
    parent = parent.parentElement;
  }
  return false;
}

function isPointOnBlockedElement(x, y) {
  const deepEl = deepElementFromPoint(x, y);
  return isPointOnBlockedElementFromEl(deepEl);
}

function isPointOnBlockedElementFromEl(el) {
  if (!el) return false;
  if (SELECTOR_CONSTANTS.BLOCKED_IDS.includes(el.id) || safeClosest(el, SELECTOR_CONSTANTS.BLOCKED_SELECTORS[0]) || isIframeElement(el)) {
    return true;
  }
  // Check if any element at the same point is an iframe
  // We can't easily do this without coordinates, so we skip the elementsFromPoint check for performance
  return false;
}

/* ───────────────────────── */
/*      Class Utilities      */
/* ───────────────────────── */
// A token that looks machine-generated (hash / atomic-css id): mixed letters+digits, or a long vowel-less run.
function looksRandomToken(t) {
  if (!t || t.length < 5) return false;
  const hasDigit = /\d/.test(t);
  const hasLetter = /[a-z]/i.test(t);
  if (hasDigit && hasLetter) return true;
  if (!hasDigit && t.length >= 6 && !/[aeiouy]/i.test(t)) return true;
  return false;
}

function looksHashedClass(cls) {
  return cls.split(/[-_]+/).some(looksRandomToken);
}

/**
 * Class tiers:
 *  "stable" - semantic enough to build selectors from
 *  "weak"   - utility / layout / state / numbered / variant classes. Only used by the last-resort fallback
 *  "hash"   - machine-generated. Never used verbatim; only their stable prefix is used (partial-class variants)
 */
function classifyClass(cls) {
  if (!cls || cls.length < 2) return "weak";
  if (looksHashedClass(cls)) return "hash";
  if (isStateClass(cls)) return "weak";
  if (CLASS_BLOCKLIST_PATTERNS.some((p) => p.test(cls))) return "weak";
  return "stable";
}

function isGenericClass(cls) {
  return classifyClass(cls) !== "stable";
}

function filterNonGenericClasses(classes) {
  return Array.from(classes || []).filter((cls) => classifyClass(cls) === "stable");
}

// Source classes for prefix extraction: stable + hash (weak classes have no meaningful prefix)
function filterPartialSourceClasses(classes) {
  return Array.from(classes || []).filter((cls) => classifyClass(cls) !== "weak");
}

/* ───────────────────────────── */
/*      Attribute name checks    */
/* ───────────────────────────── */
function isStableAttrName(name) {
  return STABLE_DATA_ATTRS.some((p) => p.test(`[${name}]`));
}

// ATTR_BLOCKLIST_PATTERNS mixes raw-name patterns and "[attr]"-form patterns; test both forms.
function isBlockedAttrName(name) {
  if (!name) return true;
  if (isStableAttrName(name)) return false;
  const bracketed = `[${name}]`;
  return ATTR_BLOCKLIST_PATTERNS.some((p) => p.test(name) || p.test(bracketed));
}
/* ─────────────────────────────────────── */
/*      Partial-Class Query Utilities      */
/* ─────────────────────────────────────── */

/**
 * Selector where class tokens are treated as prefix matches.
 * Supports: space, >, +, ~ combinators.
 */
function queryWithPartialClass(selector, root = document) {
  const tokenRe = /([>~+]|\s+)/;
  const allParts = selector
    .split(tokenRe)
    .map((s) => s.trim())
    .filter(Boolean);

  const segmentList = [];
  const combinatorList = [];

  for (const part of allParts) {
    if (/^[>~+]$/.test(part) || part === "") combinatorList.push(part || " ");
    else segmentList.push(part);
  }

  while (combinatorList.length < segmentList.length - 1) combinatorList.push(" ");

  function matchesSegment(el, segment) {
    if (!el || el.nodeType !== 1) return false;

    const tagMatch = segment.match(/^([a-zA-Z][a-zA-Z0-9]*)?/);
    const tag = tagMatch?.[1];

    if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;

    const classTokens = [...segment.matchAll(/\.([^\s.#[>~+:]+)/g)].map((m) => m[1]);

    // Must contain at least tag or class
    if (!tag && classTokens.length === 0) return false;

    // Check pseudo-classes (nth-child, nth-of-type)
    const nthChildMatch = segment.match(/:nth-child\((\d+)\)/);
    if (nthChildMatch) {
      const index = parseInt(nthChildMatch[1], 10);
      const parent = el.parentElement;
      if (!parent) return false;
      const siblings = Array.from(parent.children);
      if (siblings.indexOf(el) + 1 !== index) return false;
    }

    const nthOfTypeMatch = segment.match(/:nth-of-type\((\d+)\)/);
    if (nthOfTypeMatch) {
      const index = parseInt(nthOfTypeMatch[1], 10);
      const parent = el.parentElement;
      if (!parent) return false;
      const siblings = Array.from(parent.children).filter((s) => s.tagName === el.tagName);
      if (siblings.indexOf(el) + 1 !== index) return false;
    }

    if (classTokens.length === 0) return true;

    const elClasses = el.classList ? [...el.classList] : [];
    return classTokens.every((p) => elClasses.some((c) => c.startsWith(p)));
  }

  function initialQueryFor(segment) {
    const tag = segment.match(/^([a-zA-Z][a-zA-Z0-9]*)/)?.[1];
    if (tag) return tag;
    if (segment.includes(".")) return "[class]";
    return null;
  }

  const MAX_CANDIDATES = 500;

  function resolve(contextEls, segIndex) {
    if (segIndex >= segmentList.length) return contextEls;

    const seg = segmentList[segIndex];
    const combinator = segIndex === 0 ? " " : combinatorList[segIndex - 1] || " ";

    const initialQ = initialQueryFor(seg);
    if (!initialQ) return [];

    const candidates = [];

    for (const ctx of contextEls) {
      if (!ctx?.querySelectorAll) continue;

      try {
        if (segIndex === 0 || combinator === " ") {
          candidates.push(...ctx.querySelectorAll(initialQ));
        } else if (combinator === ">") {
          candidates.push(...(ctx.children || []));
        } else if (combinator === "+") {
          if (ctx.nextElementSibling) candidates.push(ctx.nextElementSibling);
        } else if (combinator === "~") {
          let sib = ctx.nextElementSibling;
          while (sib) {
            candidates.push(sib);
            sib = sib.nextElementSibling;
          }
        }
      } catch {}

      if (candidates.length >= MAX_CANDIDATES) break;
    }

    const matched = candidates.slice(0, MAX_CANDIDATES).filter((el) => matchesSegment(el, seg));

    return resolve(matched, segIndex + 1);
  }

  return resolve([root], 0);
}

function safeQueryPartial(selector) {
  if (typeof selector !== "string") return [];
  try {
    return getQueryRoots().flatMap((root) => queryWithPartialClass(selector, root));
  } catch {
    return [];
  }
}

function getPartialClassPrefix(cls) {
  if (!cls || typeof cls !== "string") return null;

  // Multiple patterns for different CSS-in-JS libraries
  const patterns = [
    // CSS Modules: Component_button__a1b2c3, component_button_a1b2c3, Component_button_a1b2c3_1
    /^(.*?[_-])([a-zA-Z0-9]{4,16})(?:_\d+)?$/,
    // emotion: emotion-abc123def, emotion-abc123
    /^([a-z]+)-([a-z0-9]{6,})$/i,
    // styled-components: sc-abc123def, sc-abc123
    /^([a-z]{2,})-([a-z0-9]{6,})$/i,
    // styled: styled.abc123def
    /^([a-z]+)\.([a-z0-9]{6,})$/i,
  ];

  for (const pattern of patterns) {
    const m = cls.match(pattern);
    if (!m) continue;

    const prefix = m[1];
    const hashSeg = m[2];

    // Validate hash segment: must be mixed alphanumeric (indicates generated hash)
    const isMixed = /[a-zA-Z]/.test(hashSeg) && /\d/.test(hashSeg);
    if (!isMixed) continue;

    // Validate prefix stability: not too short, not generic
    if (!isStablePrefix(prefix)) continue;

    return prefix;
  }

  return null;
}

function isStablePrefix(prefix) {
  if (!prefix) return false;
  const clean = prefix.replace(/[_-]+$/, "");
  // Must be at least 3 chars after removing trailing separators
  if (clean.length < 3) return false;
  // Reject known generic prefixes
  if (/^(c|x|z|css|styles?|class|module|comp|ui|app|style|sheet)$/i.test(clean)) return false;
  // Reject prefixes that are just numbers or single letters
  if (/^[a-z0-9]{1,2}$/i.test(clean)) return false;
  return true;
}

// Memoized partial query to avoid repeated DOM traversal
const partialQueryCache = new Map();
const MAX_PARTIAL_CACHE = 200;

function safeQueryPartialMemo(selector) {
  if (partialQueryCache.has(selector)) {
    return partialQueryCache.get(selector);
  }
  const result = safeQueryPartial(selector);
  // LRU-style eviction
  if (partialQueryCache.size >= MAX_PARTIAL_CACHE) {
    const firstKey = partialQueryCache.keys().next().value;
    partialQueryCache.delete(firstKey);
  }
  partialQueryCache.set(selector, result);
  return result;
}

function isStateClass(cls) {
  if (!cls || typeof cls !== "string") return false;
  return STATE_CLASS_PATTERNS.some((p) => p.test(cls));
}
