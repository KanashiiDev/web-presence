// Export/import of local translation drafts. Imported values are always
// re-hashed against the current English source and target: hashes from an old
// export are never trusted.

const TE_DRAFT_EXPORT_FORMAT = "web-presence-translation-drafts";
const TE_DRAFT_EXPORT_VERSION = 1;
const TE_DRAFT_NS_RE = /^(extension|server|shared)\.json$/;
const TE_DRAFT_LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/i;
const TE_DRAFT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/;
const TE_DRAFT_MAX_ENTRIES = 5000;
const TE_DRAFT_MAX_VALUE = 20000;
const TE_DRAFT_MAX_BYTES = 512 * 1024;

function teDraftKeyIsSafe(key) {
  return typeof key === "string" && TE_DRAFT_KEY_RE.test(key) && !key.includes("__proto__") && !key.includes("constructor") && !key.includes("prototype");
}

function teDraftLanguageIsValid(lang) {
  const normalized = teNormalizeLang(lang);
  return typeof lang === "string" && TE_DRAFT_LANG_RE.test(lang) && normalized !== "en" && TE_LANG_RE.test(normalized) && !TE_RESERVED_SUBMISSION_DIRS.has(normalized);
}

function teDraftDraftsShapeIsValid(drafts) {
  if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) return false;
  return Object.entries(drafts).every(([file, entries]) => {
    if (!TE_DRAFT_NS_RE.test(file)) return false;
    return entries && typeof entries === "object" && !Array.isArray(entries) && Object.keys(entries).length <= TE_DRAFT_MAX_ENTRIES;
  });
}

function teParseDraftExport(text) {
  if (typeof text !== "string") return { ok: false, errors: ["File is not text"] };
  if (new TextEncoder().encode(text).length > TE_DRAFT_MAX_BYTES) return { ok: false, errors: ["File is too large"] };
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Invalid JSON: ${err.message}`] };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, errors: ["Payload must be an object"] };
  const errors = [];
  if (payload.format !== TE_DRAFT_EXPORT_FORMAT) errors.push("Unknown file format");
  if (payload.version !== TE_DRAFT_EXPORT_VERSION) errors.push("Unsupported file version");

  let languages = null;
  if (Array.isArray(payload.languages)) {
    languages = payload.languages.map((entry) => ({ lang: entry?.lang, drafts: entry?.drafts }));
  } else if (payload.lang !== undefined || payload.drafts !== undefined) {
    languages = [{ lang: payload.lang, drafts: payload.drafts }];
  } else {
    errors.push("Missing language data");
  }

  if (languages) {
    if (!languages.length) errors.push("No languages in file");
    languages.forEach((entry) => {
      if (!teDraftLanguageIsValid(entry.lang)) errors.push(`Invalid language: ${entry.lang}`);
      if (!teDraftDraftsShapeIsValid(entry.drafts)) errors.push(`Invalid drafts for ${entry.lang}`);
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, data: { languages } };
}

function teDraftValueOf(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.target === "string") return entry.target;
  if (typeof entry.value === "string") return entry.value;
  return null;
}

async function teBuildDraftEntriesFromImport({ entries, source, target }) {
  const accepted = Object.create(null);
  const rejected = [];
  for (const [key, entry] of Object.entries(entries || {})) {
    if (!teDraftKeyIsSafe(key)) {
      rejected.push({ key, reason: "invalid-key" });
      continue;
    }
    const value = teDraftValueOf(entry);
    if (value === null || value.length > TE_DRAFT_MAX_VALUE) {
      rejected.push({ key, reason: "invalid-value" });
      continue;
    }
    if (teValueIsUnsafe(value)) {
      rejected.push({ key, reason: "unsafe-value" });
      continue;
    }
    if (!(key in source)) {
      rejected.push({ key, reason: "missing-in-source" });
      continue;
    }

    const confirmed = value === source[key] || value === (target[key] ?? "");
    accepted[key] = {
      target: value,
      sourceHash: await teHashSource(source[key], key),
      baseTargetHash: await teHashTarget(target[key] ?? "", key),
      ...(confirmed ? { reconfirmed: true } : {}),
    };
  }
  return { accepted, rejected };
}

function teCollectDraftsForExport(allDrafts, lang) {
  const grouped = Object.create(null);
  for (const [key, draft] of Object.entries(allDrafts || {})) {
    const separator = key.indexOf("/");
    if (separator < 0) continue;
    const entryLang = key.slice(0, separator);
    const file = key.slice(separator + 1);
    if (lang && entryLang !== lang) continue;
    if (!TE_DRAFT_NS_RE.test(file) || !draft?.entries) continue;
    if (!grouped[entryLang]) grouped[entryLang] = Object.create(null);
    grouped[entryLang][file] = draft.entries;
  }
  return grouped;
}

function teSerializeDraftExport(grouped) {
  const languages = Object.entries(grouped).map(([lang, drafts]) => ({ lang, drafts }));
  const payload = {
    format: TE_DRAFT_EXPORT_FORMAT,
    version: TE_DRAFT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    languages,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

// Flat locale file import/export: { "key": "value" }, no draft metadata.
function teParseLocaleImport(text) {
  if (typeof text !== "string") return { ok: false, errors: ["File is not text"] };
  if (new TextEncoder().encode(text).length > TE_DRAFT_MAX_BYTES) return { ok: false, errors: ["File is too large"] };
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Invalid JSON: ${err.message}`] };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: ["Locale must be a flat JSON object"] };
  const entries = Object.create(null);
  const rejected = [];
  for (const [key, value] of Object.entries(data)) {
    if (!teDraftKeyIsSafe(key)) {
      rejected.push({ key, reason: "invalid-key" });
      continue;
    }
    if (typeof value !== "string" || value.length > TE_DRAFT_MAX_VALUE) {
      rejected.push({ key, reason: "invalid-value" });
      continue;
    }
    if (teValueIsUnsafe(value)) {
      rejected.push({ key, reason: "unsafe-value" });
      continue;
    }
    entries[key] = value;
  }
  return { ok: true, entries, rejected };
}

function teSerializeLocaleExport(source, target) {
  const output = Object.create(null);
  for (const key of Object.keys(source || {})) {
    output[key] = typeof target?.[key] === "string" ? target[key] : "";
  }
  return `${JSON.stringify(output, null, 2)}\n`;
}
