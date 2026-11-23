const TE_DRAFT_STORAGE_PREFIX = "translationDrafts:";
const TE_LEGACY_DRAFT_KEY = "translationDrafts";
let teDraftMigration = null;

function teDraftKey(lang, file) {
  // Case-insensitive filesystems make `zh-CN` and `zh-cn` the same draft.
  return `${teNormalizeLang(lang)}/${file}`;
}

function teDraftStorageKey(lang, file) {
  return `${TE_DRAFT_STORAGE_PREFIX}${teDraftKey(lang, file)}`;
}

// One-time migration from the old single-object layout. Per-file keys avoid a
// read-modify-write of every language on each keystroke and prevent lost
// updates between draft writes and submit/load metadata updates.
async function teMigrateLegacyDrafts() {
  if (!teDraftMigration) {
    teDraftMigration = (async () => {
      const stored = await browser.storage.local.get(TE_LEGACY_DRAFT_KEY);
      const legacy = stored[TE_LEGACY_DRAFT_KEY];
      if (!legacy || typeof legacy !== "object") return;
      const targets = Object.keys(legacy).map((key) => `${TE_DRAFT_STORAGE_PREFIX}${key}`);
      const existing = targets.length ? await browser.storage.local.get(targets) : {};
      const updates = {};
      Object.entries(legacy).forEach(([key, value]) => {
        const target = `${TE_DRAFT_STORAGE_PREFIX}${key}`;
        if (!existing[target]) updates[target] = value;
      });
      if (Object.keys(updates).length) await browser.storage.local.set(updates);
      await browser.storage.local.remove(TE_LEGACY_DRAFT_KEY);
    })();
  }
  return teDraftMigration;
}

async function teLoadDraft(lang, file) {
  await teMigrateLegacyDrafts();
  const key = teDraftStorageKey(lang, file);
  const stored = await browser.storage.local.get(key);
  return stored[key] || null;
}

// Returns the same shape used by the submit preview: { "lang/file.json": draft }.
async function teLoadAllDrafts() {
  await teMigrateLegacyDrafts();
  const stored = await browser.storage.local.get(null);
  const drafts = {};
  Object.entries(stored).forEach(([key, value]) => {
    if (key.startsWith(TE_DRAFT_STORAGE_PREFIX) && value && typeof value === "object") {
      drafts[key.slice(TE_DRAFT_STORAGE_PREFIX.length)] = value;
    }
  });
  return drafts;
}

async function teSaveDraft(lang, file, entries) {
  await teMigrateLegacyDrafts();
  const key = teDraftStorageKey(lang, file);
  if (!Object.keys(entries).length) {
    await browser.storage.local.remove(key);
    return;
  }
  const stored = await browser.storage.local.get(key);
  const previous = stored[key] || {};
  // A real edit reopens a submitted draft. An unchanged flush (e.g. a timer
  // firing after submit) must keep "submitted" so merge detection still works.
  const changed = !previous.entries || JSON.stringify(previous.entries) !== JSON.stringify(entries);
  const draft = {
    ...previous,
    ...(changed ? { status: "draft", prUrl: "", prNumber: null } : {}),
    updatedAt: new Date().toISOString(),
    entries,
  };
  await browser.storage.local.set({ [key]: draft });
}

async function teUpdateDraft(lang, file, patch) {
  await teMigrateLegacyDrafts();
  const key = teDraftStorageKey(lang, file);
  const stored = await browser.storage.local.get(key);
  if (!stored[key]) return;
  await browser.storage.local.set({ [key]: { ...stored[key], ...patch, updatedAt: new Date().toISOString() } });
}

async function teClearDraft(lang, file) {
  await teMigrateLegacyDrafts();
  await browser.storage.local.remove(teDraftStorageKey(lang, file));
}
