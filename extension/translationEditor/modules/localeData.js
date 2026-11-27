function teFlattenTranslations(translations, prefix = "") {
  const result = Object.create(null);
  Object.entries(translations || {}).forEach(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, teFlattenTranslations(value, fullKey));
    } else {
      result[fullKey] = typeof value === "string" ? value : "";
    }
  });
  return result;
}

function teComputeStatus(row) {
  if (row.prPending) return "PR Pending";
  const stale = row.keyStatus === "outdated" || row.keyStatus === "unverified";
  // The contributor explicitly confirmed that the old translation is still
  // correct for the new English source.
  if (row.reconfirmed && stale) return "Translated";
  const mainChanged = row.edited && (row.draftSourceHash !== row.currentSourceHash || (row.draftBaseTargetHash && row.draftBaseTargetHash !== row.currentTargetHash));
  if (mainChanged) return "Outdated";
  if (stale) return "Outdated";
  return row.target ? "Translated" : "Untranslated";
}

function teShouldShowRestore(row) {
  return row.target === "" && typeof row.originalTarget === "string" && row.originalTarget.length > 0;
}

function teRestoreRowTarget(row) {
  row.target = row.originalTarget;
  row.edited = false;
  row.draftSourceHash = row.currentSourceHash;
  row.draftBaseTargetHash = row.currentTargetHash;
  row.status = teComputeStatus(row);
}

function teMakeDraftEntry(target, sourceHash, baseTargetHash, flags = {}) {
  return {
    target,
    sourceHash,
    baseTargetHash,
    ...(typeof flags.originalBaseTargetHash === "string" ? { originalBaseTargetHash: flags.originalBaseTargetHash } : {}),
    ...(flags.lineChangeAcknowledged ? { lineChangeAcknowledged: true } : {}),
    ...(flags.reconfirmed === true ? { reconfirmed: true, ...(typeof flags.localOnly === "boolean" ? { localOnly: flags.localOnly } : {}) } : {}),
  };
}

function teBuildDraftEntriesFromRows(rows) {
  const entries = {};
  rows.forEach((row) => {
    if (!row.prPending && (row.target !== row.originalTarget || row.reconfirmed)) {
      entries[row.key] = teMakeDraftEntry(row.target, row.draftSourceHash, row.draftBaseTargetHash, {
        originalBaseTargetHash: row.originalBaseTargetHash,
        lineChangeAcknowledged: row.lineChangeAcknowledged,
        reconfirmed: !!row.reconfirmed,
        localOnly: row.localOnly === true,
      });
    }
  });
  return entries;
}

function teRecoverEmptyDrafts(rows, entries) {
  const kept = { ...(entries || {}) };
  const recovered = [];
  rows.forEach((row) => {
    const entry = kept[row.key];
    if (!entry || entry.target !== "") return;
    if (typeof row.originalTarget !== "string" || !row.originalTarget) return;
    teRestoreRowTarget(row);
    delete kept[row.key];
    recovered.push(row.key);
  });
  return { entries: kept, recovered };
}

async function teBuildRows(sourceRaw, targetRaw) {
  const source = teFlattenTranslations(sourceRaw);
  const target = teFlattenTranslations(targetRaw);

  return Promise.all(
    Object.keys(source)
      .sort()
      .map(async (key) => {
        const value = target[key];
        const translated = typeof value === "string" ? value : "";
        const currentSourceHash = await teHashSource(source[key], key);
        const currentTargetHash = await teHashTarget(translated, key);
        const row = {
          key,
          source: source[key],
          target: translated,
          originalTarget: translated,
          currentSourceHash,
          currentTargetHash,
          edited: false,
          draftSourceHash: currentSourceHash,
          draftBaseTargetHash: currentTargetHash,
          keyStatus: "up-to-date",
        };
        row.status = teComputeStatus(row);
        return row;
      }),
  );
}

function teApplyFreshness(rows, freshness) {
  rows.forEach((row) => {
    row.keyStatus = freshness?.keyStatus?.[row.key] || "up-to-date";
    row.status = teComputeStatus(row);
  });
}
