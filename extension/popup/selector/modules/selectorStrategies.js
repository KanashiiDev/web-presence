/**
 * Main Selector Production Function.
 * Generates unique selectors with a multi-layered strategy.
 */
const SELECTOR_TIME_BUDGET_MS = 600;

function generateSelectorOptions(element, field = null) {
  if (!isValidElement(element)) return [];
  return withDeepQuery(() => generateSelectorOptionsInRoot(element, field));
}

function generateSelectorOptionsInRoot(element, field) {
  const t0 = Date.now();
  const overBudget = () => Date.now() - t0 > SELECTOR_TIME_BUDGET_MS;
  const allSelectors = new Set();

  // 1. Basic Variants
  const basicVariants = generateSelectorVariants(element);
  basicVariants.forEach((v) => evaluateAndAddSelector(v, element, allSelectors));

  // 2. Parent Combinations
  if (!overBudget()) {
    const parentCombos = generateParentCombinations(element);
    parentCombos.forEach((c) => evaluateAndAddSelector(c, element, allSelectors));
  }

  // 3. Smart Chain
  if (!overBudget()) {
    const smartChain = buildSmartClassChain(element);
    if (smartChain) evaluateAndAddSelector(smartChain, element, allSelectors);
  }

  // 4. Hybrid Selector
  if (allSelectors.size < 5 && !overBudget()) {
    const hybrid = generateHybridSelector(element);
    if (hybrid) evaluateAndAddSelector(hybrid, element, allSelectors);
  }

  // 5. Partial-Class Variants
  if (!overBudget()) {
    const rewriteCandidates = [...allSelectors];
    const partialVariants = generatePartialClassVariants(element, rewriteCandidates);
    partialVariants.forEach((v) => evaluateAndAddSelector(v, element, allSelectors));
  }

  // 6. Minimization: shrink the longest candidates while they stay unique
  if (!overBudget()) {
    const seeds = [...allSelectors].sort((a, b) => b.length - a.length).slice(0, 12);
    for (const seed of seeds) {
      if (overBudget()) break;
      const min = minimizeSelector(seed, element);
      if (min !== seed) evaluateAndAddSelector(min, element, allSelectors);
    }
  }

  let results = filterAndSortSelectors([...allSelectors], element, undefined, field);

  // 7. Last resort: no strictly-unique id/attribute/stable-class result -> combos of weak (utility) classes
  if (!results.some((r) => r.rank <= 1 && !r.firstMatchOnly)) {
    const weak = generateWeakFallbackSelectors(element);
    const weakMin = weak.map((sel) => minimizeSelector(sel, element));
    results = filterAndSortSelectors([...allSelectors, ...weak, ...weakMin], element, undefined, field);
  }

  // 8. Absolute last resort: a purely structural path (always exists, strictly unique)
  if (!results.length) {
    const path = generateStructuralPath(element);
    if (path) results = filterAndSortSelectors([path], element, undefined, field);
  }

  return results;
}

// "tag:nth-child(n)" chain from the element upward, only as long as needed to become unique
function generateStructuralPath(el) {
  const compound = (node) => {
    // parentNode (not parentElement): direct children of a ShadowRoot have no parentElement
    const siblings = node.parentNode && node.parentNode.children ? node.parentNode.children : [node];
    const index = Array.prototype.indexOf.call(siblings, node) + 1;
    return `${node.tagName.toLowerCase()}:nth-child(${index})`;
  };
  let path = compound(el);
  let node = el;
  for (let depth = 0; depth < 20; depth++) {
    if (isStrictUnique(path, el)) return path;
    node = node.parentElement;
    if (!node || node === document.documentElement) break;
    path = `${compound(node)} > ${path}`;
  }
  return isStrictUnique(path, el) ? path : null;
}

/* ──────────────────────────────── */
/*          Minimization            */
/* ──────────────────────────────── */
function splitSelectorCompounds(selector) {
  const parts = selector.trim().split(/(\s*[>+~]\s*|\s+)/);
  const compounds = [];
  const combs = [];
  parts.forEach((p, i) => {
    if (i % 2 === 0) compounds.push(p);
    else combs.push(/[>+~]/.test(p) ? ` ${p.trim()} ` : " ");
  });
  return { compounds, combs };
}

function joinCompounds(compounds, combs) {
  return compounds.map((c, i) => (i === 0 ? c : combs[i - 1] + c)).join("");
}

const COMPOUND_TOKEN_RE = /\.(?:\\.|[^\s.#\[>~+:\\])+|#(?:\\.|[^\s.#\[>~+:\\])+|\[[^\]]*\]|:[a-zA-Z-]+(?:\([^)]*\))?/g;

function tokenizeCompound(compound) {
  const tag = compound.match(/^[a-zA-Z][a-zA-Z0-9-]*/)?.[0] || "";
  const rest = compound.slice(tag.length);
  const tokens = rest.match(COMPOUND_TOKEN_RE) || [];
  return tokens.join("") === rest ? { tag, tokens } : null; // bail out on anything we cannot round-trip
}

/**
 * Greedy minimization: drop ancestor compounds, tag prefixes, extra tokens and
 * ">" combinators one by one, keeping a removal only if the selector stays strictly unique.
 */
function minimizeSelector(selector, el) {
  if (!selector || /,|:not\(|:is\(|:has\(|"[^"]*\s[^"]*"/.test(selector)) return selector;
  if (!isStrictUnique(selector, el)) return selector;

  let { compounds, combs } = splitSelectorCompounds(selector);
  const stillUnique = (c, k) => isStrictUnique(joinCompounds(c, k), el);

  // a) drop ancestor compounds (never the last one)
  for (let i = 0; i < compounds.length - 1;) {
    const c2 = compounds.slice();
    const k2 = combs.slice();
    c2.splice(i, 1);
    if (i === 0) k2.splice(0, 1);
    else k2.splice(i - 1, 2, " ");
    if (stillUnique(c2, k2)) {
      compounds = c2;
      combs = k2;
    } else i++;
  }

  // b) drop tag prefixes, then extra tokens inside each compound
  for (let i = compounds.length - 1; i >= 0; i--) {
    const parsed = tokenizeCompound(compounds[i]);
    if (!parsed) continue;
    let { tag, tokens } = parsed;

    if (tag && tokens.length) {
      const c2 = compounds.slice();
      c2[i] = tokens.join("");
      if (stillUnique(c2, combs)) {
        compounds = c2;
        tag = "";
      }
    }
    for (const token of tokens.slice()) {
      if ((tag ? 1 : 0) + tokens.length <= 1) break;
      const rest = tokens.filter((t) => t !== token);
      const c2 = compounds.slice();
      c2[i] = tag + rest.join("");
      if (stillUnique(c2, combs)) {
        compounds = c2;
        tokens = rest;
      }
    }
  }

  // c) direct-child combinators -> descendant (shorter, more tolerant)
  for (let i = 0; i < combs.length; i++) {
    if (combs[i] !== " > ") continue;
    const k2 = combs.slice();
    k2[i] = " ";
    if (stillUnique(compounds, k2)) combs = k2;
  }

  const result = joinCompounds(compounds, combs);
  return result.length < selector.length ? result : selector;
}

/* ──────────────────────────────── */
/*   Weak-class (utility) fallback  */
/* ──────────────────────────────── */
function subsetsUpTo(items, maxSize) {
  const out = [];
  const walk = (start, picked) => {
    if (picked.length) out.push(picked.slice());
    if (picked.length === maxSize) return;
    for (let i = start; i < items.length; i++) {
      picked.push(items[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * Only used when no id / attribute / stable-class selector exists.
 * Tries class subsets (utility classes included) on the element, then anchors them to ancestors.
 */
function generateWeakFallbackSelectors(el) {
  const found = new Set();
  const MAX_EVALS = 300;
  let evals = 0;
  const tag = el.tagName.toLowerCase();
  const toSel = (classes) => classes.map((c) => `.${CSS.escape(c)}`).join("");
  // State classes (is-active, --playing) change at runtime, so they never enter the fallback; utility classes do.
  const pool = (node, max) =>
    safeGetClassList(node)
      .filter((c) => classifyClass(c) !== "hash" && !isStateClass(c))
      .slice(0, max);
  const tryAdd = (sel) => {
    if (evals++ >= MAX_EVALS) return false;
    if (!isStrictUnique(sel, el)) return false;
    found.add(sel);
    return true;
  };

  // 1) the element alone
  const own = subsetsUpTo(pool(el, 8), 3)
    .map(toSel)
    .sort((a, b) => a.length - b.length);
  for (const o of own) {
    if (!tryAdd(o)) tryAdd(tag + o);
  }

  // 2) anchored to an ancestor (stable anchor first, then ancestor class subsets)
  const ownShort = [...own.slice(0, 12), tag];
  let parent = el.parentElement;
  for (let depth = 0; parent && parent !== document.body && depth <= SELECTOR_CONSTANTS.MAX_PARENT_DEPTH && evals < MAX_EVALS; depth++) {
    const parentTag = parent.tagName.toLowerCase();
    const anchors = [...getAllParentSelectors(parent).filter((s) => s !== parentTag), ...subsetsUpTo(pool(parent, 6), 2).map(toSel)].slice(0, 12);
    for (const a of anchors) {
      for (const o of ownShort) {
        tryAdd(`${a} > ${o}`);
        tryAdd(`${a} ${o}`);
      }
    }
    parent = parent.parentElement;
  }

  return [...found];
}

/* ──────────────────────────────── */
/*         Hybrid Selector          */
/* ──────────────────────────────── */
function generateHybridSelector(element) {
  const candidates = [];
  const path = [];
  let current = element;
  let safety = 0;
  let isTargetElement = true;

  while (current && current !== document.body && safety < SELECTOR_CONSTANTS.MATCH_LIMITS.MAX_DEPTH_SAFETY) {
    let part = current.tagName.toLowerCase();

    // 1. If there is an ID and it is appropriate - use it immediately
    if (current.id && !matchesAny(current.id, ID_BLOCKLIST_PATTERNS)) {
      part += `#${CSS.escape(current.id)}`;
      path.unshift(part);
      const fullPath = path.join(" > ");
      if (isUniqueSelector(fullPath, element)) {
        candidates.push(fullPath);
        break;
      }
    }

    // 2. Add semantic class if available
    const goodClass = getGoodClass(current);
    if (goodClass) {
      part += `.${CSS.escape(goodClass)}`;
    } else {
      // 3. No semantic class - try data attribute on ancestor (not target)
      if (!isTargetElement) {
        const dataAttr = safeGetAttributes(current).find((attr) => attr.name.startsWith("data-") && isStableAttrName(attr.name) && attr.value?.trim());
        if (dataAttr) {
          part += `[${dataAttr.name}="${CSS.escape(dataAttr.value)}"]`;
        }
      } else if (isTargetElement) {
        // 4. Target element has no semantic class - use nth-child for THIS element only
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children);
          const index = siblings.indexOf(current) + 1;
          if (index > 0 && siblings.length > 1) {
            part += `:nth-child(${index})`;
          }
        }
      }
    }

    path.unshift(part);

    // 5. Is the path unique so far?
    const currentPath = path.join(" > ");
    if (isUniqueSelector(currentPath, element)) {
      candidates.push(currentPath);
    }

    current = current.parentElement;
    isTargetElement = false;
    safety++;
  }

  // 6. Fallback: numeric path (full chain) - only if we have no candidates
  if (candidates.length === 0) {
    const numeric = generateNumericFallbackPath(element);
    if (numeric) candidates.push(numeric);
  }

  // Return best candidate (shortest, then highest score)
  if (candidates.length > 0) {
    return candidates.map((c) => ({ selector: c, ...evaluateSelector(c, element) })).sort((a, b) => a.selector.length - b.selector.length || b.score - a.score)[0]
      .selector;
  }
  return null;
}

/* ──────────────────────────────── */
/*      Numeric Fallback Path       */
/* ──────────────────────────────── */
function generateNumericFallbackPath(element) {
  const pathWithIndex = [];
  let current = element;

  while (current && current !== document.body) {
    const parent = current.parentElement;
    const index = parent ? [...parent.children].indexOf(current) + 1 : 1;
    pathWithIndex.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    current = parent;
  }

  const finalPath = pathWithIndex.join(" > ");
  return isUniqueSelector(finalPath, element) ? finalPath : null;
}

/* ──────────────────────────────── */
/*       Parent Combinations        */
/* ──────────────────────────────── */
function generateParentCombinations(element) {
  const combinations = new Set();
  const elementVariants = generateSelectorVariants(element);

  let parent = element.parentElement;
  let depth = 0;

  while (parent && depth < SELECTOR_CONSTANTS.MAX_PARENT_DEPTH) {
    const parentSelectors = getAllParentSelectors(parent);
    if (parentSelectors.length === 0) {
      parent = parent.parentElement;
      depth++;
      continue;
    }

    for (const parentSelector of parentSelectors) {
      for (const variant of elementVariants) {
        // Direct child
        const childCombo = `${parentSelector} > ${variant}`;
        const childEval = evaluateSelector(childCombo, element);
        if (childEval.isUnique && childEval.score > SELECTOR_CONSTANTS.SCORE_THRESHOLDS.PARENT_COMBO) {
          combinations.add(childCombo);
        } else if (childEval.isFirstMatchFallback && childEval.score > SELECTOR_CONSTANTS.SCORE_THRESHOLDS.MIN_SELECTOR_SCORE) {
          combinations.add(childCombo);
        }

        // Descendant
        const descCombo = `${parentSelector} ${variant}`;
        const descEval = evaluateSelector(descCombo, element);
        if (descEval.isUnique && descEval.score > SELECTOR_CONSTANTS.SCORE_THRESHOLDS.PARENT_COMBO) {
          combinations.add(descCombo);
        } else if (descEval.isFirstMatchFallback && descEval.score > SELECTOR_CONSTANTS.SCORE_THRESHOLDS.MIN_SELECTOR_SCORE) {
          combinations.add(descCombo);
        }
      }
    }

    parent = parent.parentElement;
    depth++;
  }

  return [...combinations];
}

/* ──────────────────────────────── */
/*          Parent Selector         */
/* ──────────────────────────────── */
function getOptimizedParentSelector(parent) {
  if (!parent) return null;

  // 1️. ID
  if (parent.id && !matchesAny(parent.id, ID_BLOCKLIST_PATTERNS)) {
    return `#${CSS.escape(parent.id)}`;
  }

  // 2️. Class
  const goodClasses = filterNonGenericClasses(safeGetClassList(parent));
  if (goodClasses.length > 0) {
    return `${parent.tagName.toLowerCase()}.${CSS.escape(goodClasses[0])}`;
  }

  // 3️. Data attributes
  const dataAttr = safeGetAttributes(parent).find((attr) => attr.name.startsWith("data-") && isStableAttrName(attr.name) && attr.value?.trim());
  if (dataAttr) {
    return `[${dataAttr.name}="${CSS.escape(dataAttr.value)}"]`;
  }

  // 4️. No useful anchor - skip this parent
  return null;
}

function getAllParentSelectors(parent) {
  const selectors = [];
  if (!parent) return selectors;

  // 1️. ID
  if (parent.id && !matchesAny(parent.id, ID_BLOCKLIST_PATTERNS)) {
    selectors.push(`#${CSS.escape(parent.id)}`);
  }

  // 2️. Classes (top 3 non-generic)
  const goodClasses = filterNonGenericClasses(safeGetClassList(parent)).slice(0, 3);
  for (const cls of goodClasses) {
    selectors.push(`${parent.tagName.toLowerCase()}.${CSS.escape(cls)}`);
    selectors.push(`.${CSS.escape(cls)}`);
  }

  // 3️. Data attributes
  const dataAttrs = safeGetAttributes(parent)
    .filter((attr) => attr.name.startsWith("data-") && isStableAttrName(attr.name) && attr.value?.trim())
    .slice(0, 2);
  for (const attr of dataAttrs) {
    selectors.push(`[${attr.name}="${CSS.escape(attr.value)}"]`);
  }

  // 4️. Tag only (if no other anchors)
  if (selectors.length === 0) {
    selectors.push(parent.tagName.toLowerCase());
  }

  return selectors;
}

/* ──────────────────────────────── */
/*       Selector Variants          */
/* ──────────────────────────────── */
function generateSelectorVariants(element) {
  const variants = new Set();
  const tag = element.tagName.toLowerCase();
  const attrs = safeGetAttributes(element);
  const nonGenericClasses = filterNonGenericClasses(safeGetClassList(element));

  addIdSelectors(element, tag, variants);
  addDataAttributeSelectors(attrs, variants);
  addOptimizedClassSelectors(element, tag, nonGenericClasses, variants);

  return [...variants];
}

function addIdSelectors(el, tag, set) {
  if (el.id && !matchesAny(el.id, ID_BLOCKLIST_PATTERNS)) {
    set.add(`#${CSS.escape(el.id)}`);
    set.add(`${tag}#${CSS.escape(el.id)}`);
  }
}

function addDataAttributeSelectors(attrs, set) {
  const dataAttrs = attrs
    .filter((attr) => !isBlockedAttrName(attr.name) && attr.name.startsWith("data-"))
    .sort((a, b) => Number(matchesAny(b.name, STABLE_DATA_ATTRS)) - Number(matchesAny(a.name, STABLE_DATA_ATTRS)));

  dataAttrs.forEach((attr) => {
    // Use presence selector [data-attr] if value is empty/whitespace, else value selector
    const value = attr.value?.trim();
    const selector = value ? `[${attr.name}="${CSS.escape(value)}"]` : `[${attr.name}]`;
    set.add(selector);
  });
}

function addOptimizedClassSelectors(el, tag, classes, set) {
  if (classes.length === 0) return;
  const limited = classes.slice(0, 10);

  // Single class selectors - skip transient state classes
  limited.forEach((cls) => {
    if (isStateClass(cls)) return;
    const sel = `.${CSS.escape(cls)}`;
    set.add(sel);
    set.add(`${tag}${sel}`);
  });

  // Combination - skip if any class is a state class
  const nonStateClasses = classes.filter((cls) => !isStateClass(cls));
  if (nonStateClasses.length >= 2 && nonStateClasses.length <= 3) {
    const combo = nonStateClasses.map((c) => `.${CSS.escape(c)}`).join("");
    set.add(combo);
    set.add(`${tag}${combo}`);
  }

  // Parent context
  nonStateClasses.forEach((cls) => addParentContextSelectors(el, `.${CSS.escape(cls)}`, set));
}

/* ──────────────────────────────── */
/*     Parent Context Selectors     */
/* ──────────────────────────────── */
function addParentContextSelectors(el, clsSelector, set) {
  const tag = el.tagName.toLowerCase();
  let parent = el.parentElement;

  for (let depth = 0; depth < SELECTOR_CONSTANTS.MAX_PARENT_DEPTH && parent && parent !== document.body; depth++) {
    const parentSelector = getOptimizedParentSelector(parent);
    if (!parentSelector) {
      parent = parent.parentElement;
      continue;
    }

    const parentHasClass = hasNonGenericClass(parent);
    const elHasClass = hasNonGenericClass(el);

    // Only use > combinator if el is a DIRECT child of this parent
    const isDirectChild = el.parentElement === parent;

    if (isDirectChild && (parentHasClass || elHasClass)) {
      const childCombo = `${parentSelector} > ${clsSelector}`;
      const childComboUnique = isUniqueSelector(childCombo, el);
      if (childComboUnique) set.add(childCombo);
      // Also try with tag prefix for specificity - ONLY if bare class is not unique
      const childComboTagged = `${parentSelector} > ${tag}${clsSelector}`;
      if (!childComboUnique && isUniqueSelector(childComboTagged, el)) set.add(childComboTagged);
    }

    if (parentHasClass && elHasClass) {
      const descCombo = `${parentSelector} ${clsSelector}`;
      if (isUniqueSelector(descCombo, el)) set.add(descCombo);
    }

    parent = parent.parentElement;
  }
}

/* ──────────────────────────────── */
/*        Smart Class Chain         */
/* ──────────────────────────────── */
function buildSmartClassChain(el, depth = SELECTOR_CONSTANTS.MAX_COMBINATION_DEPTH, limit = SELECTOR_CONSTANTS.MAX_COMBINATION_DEPTH_LIMIT) {
  let hasAnyClass = false;
  let probe = el;
  for (let i = 0; i < limit && probe && probe !== document.body; i++) {
    if (filterNonGenericClasses(safeGetClassList(probe)).length > 0 || probe.id) {
      hasAnyClass = true;
      break;
    }
    probe = probe.parentElement;
  }
  if (!hasAnyClass) return null;

  let chain = buildSmartClassChainPass(el, depth);
  while (!chain && depth < limit) chain = buildSmartClassChainPass(el, ++depth);
  return chain;
}

function buildSmartClassChainPass(el, maxDepth) {
  const chain = [];
  let current = el;

  for (let d = 0; d < maxDepth && current && current !== document.body; d++) {
    const best = getSmartSelector(current);
    chain.unshift(best);

    const full = chain.join(" > ");
    const evalRes = evaluateSelector(full, el);

    if (evalRes.isUnique && chain.length >= 2 && evalRes.score > SELECTOR_CONSTANTS.SCORE_THRESHOLDS.CLASS_CHAIN) return full;

    current = current.parentElement;
  }

  const final = chain.join(" > ");
  const finalEval = evaluateSelector(final, el);
  return finalEval.isUnique && finalEval.score > SELECTOR_CONSTANTS.SCORE_THRESHOLDS.SMART_CHAIN ? final : null;
}

/* ──────────────────────────────── */
/*         Helper Functions         */
/* ──────────────────────────────── */
function getSmartSelector(el) {
  if (el.id && !matchesAny(el.id, ID_BLOCKLIST_PATTERNS)) {
    const idSel = `#${CSS.escape(el.id)}`;
    if (isUniqueSelector(idSel, el)) return idSel;
  }

  const clsSel = getBestClassSelector(el);
  if (clsSel) return clsSel + (getNumericSuffix(el) || "");

  const attrSel = getBestAttrSelector(el);
  if (attrSel) return attrSel;

  return getNumericSelector(el);
}

function getGoodClass(el) {
  const classes = filterNonGenericClasses(safeGetClassList(el));
  if (classes.length === 0) return null;

  // Score each class: prioritize uniqueness; hashed-looking classes are penalised
  const scored = classes
    .filter((cls) => safeQuery(`.${CSS.escape(cls)}`).length < 15)
    .map((cls) => {
      const matches = safeQuery(`.${CSS.escape(cls)}`).length;
      const uniqueness = 1 / Math.max(1, matches);
      const penalty = looksHashedClass(cls) ? 0.7 : 1; // hashed-looking classes are less stable
      return { cls, score: uniqueness * penalty };
    })
    .filter((c) => c.score > 0)
    // ties: the longer name is usually the more specific one (track-title over wrapper)
    .sort((a, b) => b.score - a.score || b.cls.length - a.cls.length);

  return scored[0]?.cls ?? null;
}

function isPartialClass(cls) {
  // Check if class looks like CSS Modules hashed class (prefix_hash)
  return /[_-][a-zA-Z0-9]{4,16}(?:_\d+)?$/.test(cls);
}

function hasNonGenericClass(el) {
  return filterNonGenericClasses(safeGetClassList(el)).length > 0;
}

function matchesAny(value, patterns) {
  return patterns.some((re) => re.test(value));
}

function isUniqueSelector(selector, el) {
  return evaluateSelector(selector, el).isUnique;
}

function getBestClassSelector(element) {
  const nonGenericClasses = filterNonGenericClasses(safeGetClassList(element));
  if (nonGenericClasses.length === 0) return null;

  // Check only first 10 classes for performance
  const classesToCheck = nonGenericClasses.slice(0, 10);

  for (const cls of classesToCheck) {
    if (isStateClass(cls)) continue;
    const selector = `.${CSS.escape(cls)}`;
    const matches = safeQuery(selector);

    // Use if reasonable number of matches
    if (matches.length > 0 && matches.length < SELECTOR_CONSTANTS.MATCH_LIMITS.MAX_CLASS_MATCHES) {
      return selector;
    }
  }

  return null;
}

function getNumericSuffix(element) {
  const parent = element.parentElement;
  if (!parent) return null;

  const siblings = Array.from(parent.children);
  const nonGenericClasses = filterNonGenericClasses(safeGetClassList(element));
  const classSignature = nonGenericClasses.join();

  const sameClassSiblings = siblings.filter((sibling) => sibling !== element && filterNonGenericClasses(safeGetClassList(sibling)).join() === classSignature);

  if (sameClassSiblings.length > 0) {
    const index = siblings.indexOf(element) + 1;
    return `:nth-child(${index})`;
  }

  const sameTagSiblings = siblings.filter((sibling) => sibling !== element && sibling.tagName === element.tagName);
  if (sameTagSiblings.length > 0) {
    const sameTagIndex = siblings.filter((s) => s.tagName === element.tagName).indexOf(element) + 1;
    return `:nth-of-type(${sameTagIndex})`;
  }

  return null;
}

function getBestAttrSelector(element) {
  const attrs = safeGetAttributes(element)
    .filter((attr) => !isBlockedAttrName(attr.name))
    .filter((attr) => !isDynamicAttributeValue(attr.value))
    .map((attr) => `[${attr.name}="${CSS.escape(attr.value)}"]`)
    .filter((sel) => evaluateSelector(sel, element).isUnique);

  return attrs.length > 0 ? attrs[0] : null;
}

function isDynamicAttributeValue(value) {
  if (!value || typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;

  // Reject full URLs with dynamic/hash segments
  // CDN URLs with long hashes: /bx160803-Rcr3IvhE7q9c.png
  if (/https?:\/\/[^\/]+\/(?:[^\/]+\/)*[a-z0-9]{8,}-[a-zA-Z0-9]{10,}\.(?:png|jpg|jpeg|webp|gif|svg)/i.test(v)) return true;
  // Generic long hash in path: /abc123def456ghi789/
  if (/[a-f0-9]{16,}/i.test(v)) return true;
  // URL with query params that look like IDs
  if (/[\?&](?:id|key|token|hash|sig|ts|expires?)=[a-z0-9]{8,}/i.test(v)) return true;
  // Data URLs
  if (v.startsWith("data:")) return true;
  // Blob URLs
  if (v.startsWith("blob:")) return true;

  return false;
}

function getNumericSelector(element) {
  const parent = element.parentElement;
  if (!parent) return element.tagName.toLowerCase();

  const siblings = Array.from(parent.children);
  const index = siblings.indexOf(element) + 1;
  return `${element.tagName.toLowerCase()}:nth-child(${index})`;
}

/* ──────────────────────────────────── */
/*      Partial-Class Variants          */
/* ──────────────────────────────────── */

/**
 * Rewrites every hashed class token inside each candidate selector to its
 * stable prefix form, then validates uniqueness via safeQueryPartial.
 * Additionally generates standalone prefix selectors for each hashed class
 * on the element itself and its ancestors (bottom-up, up to MAX_PARENT_DEPTH).
 *
 * @param {Element}  element     The target element.
 * @param {string[]} candidates  Already-discovered selectors to rewrite.
 * @returns {string[]}
 */
const __nodeIds = new WeakMap();
let __nodeIdSeq = 0;
function nodeKey(node) {
  let id = __nodeIds.get(node);
  if (!id) {
    id = ++__nodeIdSeq;
    __nodeIds.set(node, id);
  }
  return id;
}

function generatePartialClassVariants(element, candidates = []) {
  const results = new Set();
  const MAX_PARTIAL_VARIANTS = 50;
  // Track matched element sets to avoid duplicates
  const matchedElementSets = new Set();

  function getElementSetKey(nodes) {
    return [...nodes]
      .map(nodeKey)
      .sort((a, b) => a - b)
      .join("|");
  }

  function tryAddSelector(selector) {
    if (!selector || results.has(selector)) return false;
    const nodes = safeQueryPartialMemo(selector);
    if (nodes.length !== 1) return false;
    // Must match the target element, not just any unique element
    if (nodes[0] !== element) return false;
    const key = getElementSetKey(nodes);
    if (matchedElementSets.has(key)) return false;
    matchedElementSets.add(key);
    results.add(selector);
    return true;
  }

  // Rewrite every candidate selector
  for (const sel of candidates) {
    const rewritten = rewriteSelectorToPartial(sel);
    if (rewritten !== sel) {
      tryAddSelector(rewritten);
      if (results.size >= MAX_PARTIAL_VARIANTS) return [...results];
    }
  }

  // Standalone prefix selectors from the element + ancestors
  const tag = element.tagName.toLowerCase();
  let current = element;
  let depth = 0;
  // Limit ancestor depth for partial variants to avoid spam
  const MAX_PARTIAL_ANCESTOR_DEPTH = 3;

  while (current && current !== document.body && depth <= MAX_PARTIAL_ANCESTOR_DEPTH) {
    const classes = filterPartialSourceClasses(safeGetClassList(current));
    const currentTag = current.tagName.toLowerCase();

    // Collect all valid prefixes for this element
    const prefixes = [];
    for (const cls of classes) {
      const prefix = getPartialClassPrefix(cls);
      if (prefix) prefixes.push(prefix);
    }

    if (prefixes.length === 0) {
      current = current.parentElement;
      depth++;
      continue;
    }

    // Generate combinations of prefixes on the same element (up to 3)
    const prefixTokens = prefixes.map((p) => `.${CSS.escape(p)}`);
    const prefixCombos = [...prefixTokens];
    if (prefixes.length >= 2) {
      // Two-prefix combinations
      for (let i = 0; i < prefixes.length; i++) {
        for (let j = i + 1; j < prefixes.length; j++) {
          prefixCombos.push(`${prefixTokens[i]}${prefixTokens[j]}`);
        }
      }
    }
    if (prefixes.length >= 3) {
      // Three-prefix combinations
      prefixCombos.push(prefixTokens.slice(0, 3).join(""));
    }

    if (current === element) {
      // Plain prefix and tag+prefix for the element itself - only if unique.
      for (const token of prefixCombos) {
        tryAddSelector(token);
        tryAddSelector(`${tag}${token}`);
      }
    } else {
      // Ancestor: build combinators with each prefix/combo
      for (const token of prefixCombos) {
        const base = `${currentTag}${token}`;

        // Direct child - preferred, try first
        const child = `${base} > ${tag}`;
        const childAdded = tryAddSelector(child);

        // If direct child gave multiple matches, try nth-child for uniqueness
        if (!childAdded) {
          const childNodes = safeQueryPartialMemo(child);
          if (childNodes.length > 1) {
            const siblings = Array.from(current.children);
            const index = siblings.indexOf(element) + 1;
            if (index > 0 && siblings.length > 1) {
              const withNth = `${base} > ${tag}:nth-child(${index})`;
              tryAddSelector(withNth);
            }
          }
        }

        // Descendant - only if direct child didn't already match uniquely
        const desc = `${base} ${tag}`;
        // Check if descendant would match same elements as child
        const descNodes = safeQueryPartialMemo(desc);
        if (descNodes.length === 1) {
          const childNodes = safeQueryPartialMemo(child);
          const descKey = getElementSetKey(descNodes);
          const childKey = getElementSetKey(childNodes);
          if (descKey !== childKey) {
            // Only add if it matches different elements than child
            tryAddSelector(desc);
          }
        }

        // Adjacent sibling (element follows ancestor with this prefix)
        // Only if element is actually a next sibling of something matching base
        tryAddSelector(`${base} + ${tag}`);

        // General sibling (element appears after ancestor with this prefix)
        tryAddSelector(`${base} ~ ${tag}`);
      }
    }

    current = current.parentElement;
    depth++;
  }

  return [...results];
}

/**
 * Rewrites every hashed CSS-Modules class token in `selector` to its stable
 * prefix form. Tokens that are not hashed are left unchanged.
 */
function rewriteSelectorToPartial(selector) {
  return selector.replace(/\.([^\s.#\[>~+:]+)/g, (match, cls) => {
    const prefix = getPartialClassPrefix(cls);
    return prefix ? `.${CSS.escape(prefix)}` : match;
  });
}
