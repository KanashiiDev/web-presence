// Port of web-presence-locales/tools/lib/freshness.js for the browser editor.
// Repository-derived results are cached by blob SHAs; draft comparisons never are.

const TE_FRESHNESS_CACHE_KEY = "translationFreshnessCache";
const TE_FRESHNESS_CACHE_VERSION = 1;
const TE_FRESHNESS_CACHE_LIMIT = 8;
const TE_VALIDATOR_VERSION = 1;
let teFreshnessWriteChain = Promise.resolve();

function teFreshnessCacheKey(enBlobSha, targetBlobSha, options = {}) {
  const validatorVersion = options.validatorVersion ?? TE_VALIDATOR_VERSION;
  const hashVersion = options.hashVersion ?? TE_HASH_VERSION;
  return `${enBlobSha}:${targetBlobSha}:${validatorVersion}:${hashVersion}:${options.ns || ""}:${options.metaFingerprint || ""}`;
}

async function teMetaFingerprint(meta) {
  const keys = meta?.keys || {};
  const parts = Object.keys(keys)
    .sort()
    .map((key) => `${key}=${keys[key]?.sourceHash || ""}`);
  return teSha256Hex(parts.join("\n"));
}

function teFreshnessStoreIsValid(store) {
  return !!store && store.version === TE_FRESHNESS_CACHE_VERSION && !!store.entries && typeof store.entries === "object";
}

async function teReadFreshnessCache(key) {
  try {
    const stored = await browser.storage.local.get(TE_FRESHNESS_CACHE_KEY);
    const store = stored?.[TE_FRESHNESS_CACHE_KEY];
    if (!teFreshnessStoreIsValid(store)) return null;
    const entry = store.entries[key];
    return entry?.validatorVersion === TE_VALIDATOR_VERSION && entry?.hashVersion === TE_HASH_VERSION ? entry : null;
  } catch (_err) {
    return null;
  }
}

// One parent key keeps the cache inspectable and lets us prune old snapshots.
// Writes are serialized so two language loads cannot lose each other's entry.
async function teWriteFreshnessCache(key, value) {
  const entry = { ...value, validatorVersion: TE_VALIDATOR_VERSION, hashVersion: TE_HASH_VERSION, key, storedAt: Date.now() };
  teFreshnessWriteChain = teFreshnessWriteChain.then(async () => {
    try {
      const stored = await browser.storage.local.get(TE_FRESHNESS_CACHE_KEY);
      const current = stored?.[TE_FRESHNESS_CACHE_KEY];
      const entries = teFreshnessStoreIsValid(current) ? { ...current.entries } : Object.create(null);
      entries[key] = entry;
      const kept = Object.entries(entries)
        .sort((a, b) => (b[1]?.storedAt || 0) - (a[1]?.storedAt || 0))
        .slice(0, TE_FRESHNESS_CACHE_LIMIT);
      await browser.storage.local.set({ [TE_FRESHNESS_CACHE_KEY]: { version: TE_FRESHNESS_CACHE_VERSION, entries: Object.fromEntries(kept) } });
    } catch (_err) {
      // Cache is best effort; a failed write must not block editing.
    }
  });
  return teFreshnessWriteChain;
}

async function teEvaluateNamespaceFreshness({ source, target, meta, sourceHashes = null }) {
  const sourceKeys = Object.keys(source).sort();
  const missingKeys = sourceKeys.filter((key) => !(key in target));
  const keyStatus = Object.create(null);
  const outdatedKeys = [];
  const unverifiedKeys = [];

  for (const key of sourceKeys) {
    if (!(key in target)) continue;
    const currentSourceHash = sourceHashes && Object.prototype.hasOwnProperty.call(sourceHashes, key) ? sourceHashes[key] : await teHashSource(source[key], key);
    const accepted = meta?.keys?.[key]?.sourceHash;
    let status;
    if (accepted === undefined) {
      status = "unverified";
      unverifiedKeys.push(key);
    } else if (accepted !== currentSourceHash) {
      status = "outdated";
      outdatedKeys.push(key);
    } else {
      status = "up-to-date";
    }
    keyStatus[key] = status;
  }

  const total = sourceKeys.length;
  return {
    total,
    // Presence of a target value is not proof of a translation: a newly seeded
    // language contains the English copy. Only accepted metadata counts.
    translated: teAcceptedKeyCount(source, meta?.keys),
    missingKeys,
    outdatedKeys,
    unverifiedKeys,
    keyStatus,
  };
}

async function teCheckLanguageOpen({ source, target, meta, ns, enBlobSha, targetBlobSha, useCache = true, sourceHashes = null }) {
  const key = teFreshnessCacheKey(enBlobSha || "none", targetBlobSha || "none", {
    ns,
    metaFingerprint: await teMetaFingerprint(meta),
  });
  if (useCache) {
    const cached = await teReadFreshnessCache(key);
    if (cached) return { ...cached, fromCache: true };
  }
  const result = {
    validatorVersion: TE_VALIDATOR_VERSION,
    hashVersion: TE_HASH_VERSION,
    enBlobSha,
    targetBlobSha,
    ns,
    ...(await teEvaluateNamespaceFreshness({ source, target, meta, sourceHashes })),
  };
  if (useCache) await teWriteFreshnessCache(key, result);
  return { ...result, fromCache: false };
}

async function teCompareDraft({ draft, source, target }) {
  const results = Object.create(null);
  let changed = false;
  const entries = draft?.entries || draft?.changes || {};
  for (const [key, change] of Object.entries(entries)) {
    const value = typeof change?.value === "string" ? change.value : change?.target;
    if (typeof value !== "string") continue;
    const currentSource = key in source ? await teHashSource(source[key], key) : null;
    // A missing target key has an empty-string base (same rule as the
    // processor). It must not be reported as "target-changed" for a brand new
    // language whose file does not exist yet.
    const currentTargetHash = await teHashTarget(key in target ? target[key] : "", key);
    const statuses = [];
    if (currentSource === null || currentSource !== change.sourceHash) statuses.push("source-changed");
    if (currentTargetHash !== change.baseTargetHash) statuses.push("target-changed");
    if (key in target && target[key] === value) statuses.push("draft-applied");
    const status = statuses.length ? statuses.join("+") : "ok";
    results[key] = { status, currentSourceHash: currentSource, currentTargetHash };
    if (status !== "ok") changed = true;
  }
  return { changed, keys: results };
}
