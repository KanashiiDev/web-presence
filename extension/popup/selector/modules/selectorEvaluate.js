// Selector Evaluation
function evaluateSelector(selector, targetEl = null) {
  const isPartialClass = isPartialClassSelector(selector);

  let nodes;
  let isUnique = false;
  let isFirstMatchFallback = false;

  if (isPartialClass) {
    nodes = safeQueryPartial(selector);
    if (nodes.length === 1 && (!targetEl || nodes[0] === targetEl)) isUnique = true;
    else if (targetEl && nodes.length > 0 && nodes[0] === targetEl) isFirstMatchFallback = true;
  } else {
    nodes = safeQuery(selector);
    // A single match only counts when it IS the target (shadow DOM / stale DOM can yield a unique-but-wrong element)
    if (nodes.length === 1 && (!targetEl || nodes[0] === targetEl)) isUnique = true;
    // Several elements match but the first one is the target: usable by a first-match consumer,
    // yet order-dependent, so it is never "unique" (low base score, sorted after strict-unique selectors).
    else if (targetEl && nodes.length > 0 && nodes[0] === targetEl) isFirstMatchFallback = true;
  }

  if (!isUnique && !isFirstMatchFallback)
    return { score: 0, isUnique: false, isClassChain: false, isSmartChain: false, isPartialClass: false, isFirstMatchFallback: false };

  let score = isFirstMatchFallback ? 15 : 50; // Low score for fallback
  const parts = selector.split(" > ");
  const testAttrFlag = isTestAttribute(selector);

  const bonus = getSelectorBonus(selector, parts, testAttrFlag, isPartialClass);
  const penalty = getSelectorPenalty(selector, parts, testAttrFlag);

  score += bonus.score;
  score -= penalty;

  score = Math.max(SELECTOR_CONSTANTS.SCORE_THRESHOLDS.MIN_SELECTOR_SCORE, Math.min(score, 100));

  return {
    score,
    isUnique,
    isFirstMatchFallback,
    isClassChain: bonus.isClassChain,
    isSmartChain: selector.includes(":nth-child(") || bonus.isClassChain,
    isTestAttribute: testAttrFlag,
    isPartialClass,
  };
}

function getSelectorBonus(selector, parts, testAttrFlag, isPartialClass = false) {
  let score = 0;

  // Test attribute bonus
  if (testAttrFlag) score += 40;

  // ID bonus
  if (/^#[\w-]+$/.test(selector)) score += 35;
  else if (selector.includes("#") && !testAttrFlag) score += 25;

  // Stable data attribute bonus
  if (STABLE_DATA_ATTRS.some((p) => p.test(selector)) && !testAttrFlag) score += 20;

  // Class chain bonus - only count SEMANTIC classes, not utility classes
  const classTokens = selector.match(/\.([^\s.#\[>~+:]+)/g) || [];
  let semanticClassCount = 0;
  for (const token of classTokens) {
    const cls = token.slice(1);
    // Skip state classes
    if (STATE_CLASS_PATTERNS.some((p) => p.test(cls))) continue;
    // Skip utility classes
    if (UTILITY_CLASS_PATTERNS.some((p) => p.test(cls))) continue;
    semanticClassCount++;
  }
  const isClassChain = semanticClassCount >= Math.floor(parts.length * 0.6);
  if (isClassChain) score += Math.min(semanticClassCount * 5, 20);

  // Semantic BEM bonus
  const bemDoubleUnderscore = (selector.match(/__/g) || []).length;
  score += Math.min(bemDoubleUnderscore * 5, 15);

  // Simple selector and length bonus
  if (SIMPLE_PATTERNS.some((p) => p.test(selector))) score += 15;
  if (selector.length < 40) score += 12;
  if (!selector.includes(":nth-")) score += 10;
  if (isPartialClass) score += 18;

  // Penalty for using utility classes (unstable)
  const utilityCount = classTokens.filter((t) => UTILITY_CLASS_PATTERNS.some((p) => p.test(t.slice(1)))).length;
  if (utilityCount > 0) score -= utilityCount * 8;

  return { score, isClassChain };
}

function getSelectorPenalty(selector, parts, testAttrFlag) {
  let penalty = 0;

  if (selector.length > 100) penalty += 10;
  if ((selector.match(/>/g) || []).length > 5) penalty += 7;

  if (!testAttrFlag && (selector.includes(":nth-of-type") || selector.includes(":nth-child"))) penalty += 5;

  if (/^\w+\s*>\s*\w+$/.test(selector)) penalty += 20;

  // Penalty for CSS Modules / CSS-in-JS hash classes (unstable)
  const cssModuleHashPatterns = [
    /^_[a-z0-9]{3,12}_[a-z0-9]{3,12}$/i,
    /^[A-Z][a-z]+_[a-zA-Z0-9]+_[a-z0-9]{4,12}$/i,
    HASH_SUFFIX_PATTERN, // suffix hash like _d2gle_10 (needs a digit)
    /^[a-z]{2,4}\d{4,8}[a-z]{2,4}\d{2,6}$/i,
    /^e[a-z]{2,4}\d[a-z0-9]{4,12}$/i,
  ];

  const classTokens = selector.match(/\.([^\s.#\[>~+:]+)/g) || [];
  for (const token of classTokens) {
    const cls = token.slice(1); // remove leading .
    if (cssModuleHashPatterns.some((p) => p.test(cls))) {
      penalty += 15; // heavy penalty for detected hash
      break; // one hash in selector is enough to penalize
    }
  }

  // Count compounds for BOTH '>' and descendant combinators (parts only splits on ' > ')
  const compoundCount = selector.trim().split(/\s*[>+~]\s*|\s+/).length;
  if (compoundCount > 2) penalty += Math.min((compoundCount - 2) * 6, 18);

  const chainLength = parts.length;
  if (chainLength > 3) {
    penalty += isTestAttribute(selector) ? Math.min((chainLength - 3) * 3, 15) : Math.min((chainLength - 3) * 5, 25);
  }

  return penalty;
}

// Selector Filtering and Sorting
function normalizeSelectorStructure(selector) {
  return (
    selector
      .replace(/#[\w-]+/g, "#id")
      // Replace hash suffix but KEEP prefix
      .replace(/\.([\w-]*?[_-])([a-zA-Z0-9]{4,16})(?:_\d+)?(?=[\s>~+\[:#.)\]|$]|$)/g, ".$1class")
      // Non-hash classes: keep first 2 chars to distinguish
      .replace(/\.([\w-]+)/g, (m, cls) => (cls.includes("_") || cls.includes("-") ? ".class" : `.${cls.slice(0, 3)}..`))
      .replace(/:nth-[^ >]+/g, ":nth")
      .replace(/\[data-[^\]]+\]/g, "[data]")
      .replace(/(^|(?<=[>\s~+]))([a-z][a-z0-9]*)(?=[>\s~+]|$)(?![#.\[])/g, "$1tag")
  );
}

function isTestAttribute(selector) {
  return STABLE_DATA_ATTRS.some((attr) => attr.test(selector));
}

function isSimilarSelector(selA, selB, threshold = 70) {
  const partsA = selA.split(/ > |\s+/);
  const partsB = selB.split(/ > |\s+/);

  let score = 0;
  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    const a = partsA[i],
      b = partsB[i];

    const idA = (a.match(/#([\w-]+)/) || [])[1];
    const idB = (b.match(/#([\w-]+)/) || [])[1];
    if (idA && idB) score += idA === idB ? 50 : -20;

    const classesA = a.match(/\.[\w-]+/g) || [];
    const classesB = b.match(/\.[\w-]+/g) || [];
    score += classesA.filter((c) => classesB.includes(c)).length * 10;

    const tagA = a.replace(/[#.].*$/, "");
    const tagB = b.replace(/[#.].*$/, "");
    if (tagA && tagB) score += tagA === tagB ? 10 : -5;

    if (a.includes(">") !== b.includes(">")) score -= 5;
  }

  score = Math.min(100, Math.max(0, score));
  return score >= threshold;
}

// Canonical form: ignores combinator type and tag prefixes, so
// "div.a > .b", "div.a .b", ".a > span.b", ".a span.b" all collapse to ".a .b".
function canonicalSelectorKey(selector) {
  return selector
    .replace(/\s*[>+~]\s*/g, " ")
    .replace(/(^|\s)[a-z][a-z0-9]*(?=[.#\[:])/gi, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:html|body)\s+)+/i, ""); // "body .x" is the same as ".x"
}

// Last compound of the selector (the part that actually targets the element)
function selectorLeafKey(selector) {
  const last =
    selector
      .trim()
      .split(/\s*[>+~]\s*|\s+/)
      .pop() || selector;
  return last.replace(/^[a-z][a-z0-9]*(?=[.#\[:])/i, "");
}

function countCompounds(selector) {
  return selector.trim().split(/\s*[>+~]\s*|\s+/).length;
}

/**
 * Stability rank (lower is better):
 * 0 id / test attribute, 1 stable classes, 2 weak (utility/state) classes, 3 positional (:nth-*)
 */
function selectorRank(selector) {
  if (/:nth-/.test(selector)) return 3;
  const re = /\.((?:\\.|[^\s.#\[>~+:\\])+)/g;
  let m;
  while ((m = re.exec(selector))) {
    if (classifyClass(m[1].replace(/\\(.)/g, "$1")) === "weak") return 2;
  }
  if (!/[.#\[]/.test(selector)) return 3; // tag-only chains ("header span") are purely structural
  if (isTestAttribute(selector) || selector.includes("#")) return 0;
  return 1;
}

const WEAK_SCORE_CAP = 45;
const MAX_WEAK_RESULTS = 5;

// All tag / class / id / attribute / pseudo tokens of a selector as a set (combinators ignored)
function selectorTokenSet(selector) {
  const set = new Set();
  for (const compound of selector.trim().split(/\s*[>+~]\s*|\s+/)) {
    const parsed = typeof tokenizeCompound === "function" ? tokenizeCompound(compound) : null;
    if (!parsed) {
      set.add(compound);
      continue;
    }
    if (parsed.tag) set.add(parsed.tag);
    parsed.tokens.forEach((t) => set.add(t));
  }
  return set;
}

// Strict uniqueness: exactly one match and it is the target (no first-match fallback)
function isStrictUnique(selector, el) {
  const nodes = isPartialClassSelector(selector) ? safeQueryPartialMemo(selector) : safeQuery(selector);
  return nodes.length === 1 && nodes[0] === el;
}

function filterAndSortSelectors(selectors, targetElement, maxResults = SELECTOR_CONSTANTS.MAX_RESULTS, field = null, maxPerLeaf = 2) {
  const evaluated = selectors
    .map((selector) => {
      const result = { selector, ...evaluateSelector(selector, targetElement) };
      if (field === "image" && (result.isUnique || result.isFirstMatchFallback) && !getImage(selector)) result.score = 0;
      return result;
    })
    .filter((item) => (item.isUnique || item.isFirstMatchFallback) && item.score > SELECTOR_CONSTANTS.SCORE_THRESHOLDS.MIN_SELECTOR_SCORE)
    .map((item) => {
      const rank = selectorRank(item.selector);
      return { ...item, rank, compounds: countCompounds(item.selector), score: rank === 2 ? Math.min(item.score, WEAK_SCORE_CAP) : item.score };
    });

  // 1) Same canonical form -> keep the better one
  const compare = (a, b) =>
    Number(!!a.isFirstMatchFallback) - Number(!!b.isFirstMatchFallback) ||
    a.rank - b.rank ||
    a.compounds - b.compounds ||
    a.selector.length - b.selector.length ||
    b.score - a.score;
  const best = new Map();
  for (const item of evaluated) {
    const key = canonicalSelectorKey(item.selector);
    const cur = best.get(key);
    if (!cur || compare(item, cur) < 0) best.set(key, item);
  }

  // 2) Order: strictly unique first, then stability tier -> fewest compounds -> shortest -> score
  const sorted = [...best.values()].sort(compare);

  // 3) Diversity: at most maxPerLeaf selectors per leaf compound
  const leafCount = new Map();
  const keptTokens = [];
  let weakCount = 0;
  const results = [];
  for (const item of sorted) {
    if (results.length >= maxResults) break;
    if (item.rank === 2 && weakCount >= MAX_WEAK_RESULTS) continue;

    // Subsumption: skip a selector whose tokens are a strict superset of an already kept (unique) selector
    const tokens = selectorTokenSet(item.selector);
    if (item.rank < 3 && keptTokens.some((kept) => kept.size < tokens.size && [...kept].every((t) => tokens.has(t)))) continue;

    const leaf = selectorLeafKey(item.selector);
    if ((leafCount.get(leaf) || 0) >= maxPerLeaf) continue;
    keptTokens.push(tokens);
    if (item.rank === 2) weakCount++;
    leafCount.set(leaf, (leafCount.get(leaf) || 0) + 1);
    results.push({ sel: item.selector, score: item.score, rank: item.rank, tier: item.rank === 2 ? "weak" : "stable", firstMatchOnly: !!item.isFirstMatchFallback });
  }
  return results;
}

// Helper: Evaluate and add selector to Set
function evaluateAndAddSelector(selector, element, selectorSet, minScore = SELECTOR_CONSTANTS.SCORE_THRESHOLDS.BASIC_VARIANT) {
  const evaluation = evaluateSelector(selector, element);
  if (evaluation.isUnique && evaluation.score > minScore) selectorSet.add(selector);
  else if (evaluation.isFirstMatchFallback && evaluation.score > SELECTOR_CONSTANTS.SCORE_THRESHOLDS.MIN_SELECTOR_SCORE) selectorSet.add(selector);
}
