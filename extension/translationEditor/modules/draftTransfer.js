// Imported values are always re-hashed against the current English source and
// target: hashes from an old file are never trusted.

const TE_DRAFT_NS_RE = new RegExp(`^(${TE_NAMESPACES.join("|")})\\.json$`);
const TE_DRAFT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/;

function teDraftKeyIsSafe(key) {
  return typeof key === "string" && TE_DRAFT_KEY_RE.test(key) && !key.includes("__proto__") && !key.includes("constructor") && !key.includes("prototype");
}

function teParseJsonObject(text, shapeError) {
  if (typeof text !== "string") return { ok: false, errors: ["File is not text"] };
  if (new TextEncoder().encode(text).length > TE_MAX_BYTES) return { ok: false, errors: ["File is too large"] };
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Invalid JSON: ${err.message}`] };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: [shapeError] };
  return { ok: true, data };
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
    if (value === null || value.length > TE_MAX_VALUE) {
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

    const unchanged = value === (target[key] ?? "");
    if (unchanged && entry.reconfirmed !== true) {
      rejected.push({ key, reason: "unchanged" });
      continue;
    }
    accepted[key] = teMakeDraftEntry(value, await teHashSource(source[key], key), await teHashTarget(target[key] ?? "", key), {
      reconfirmed: entry.reconfirmed === true,
    });
  }
  return { accepted, rejected };
}

function teSerializePretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Flat locale file import/export: { "key": "value" }, no draft metadata.
function teParseLocaleImport(text) {
  const parsed = teParseJsonObject(text, "Locale must be a flat JSON object");
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  const entries = Object.create(null);
  const rejected = [];
  for (const [key, value] of Object.entries(data)) {
    if (!teDraftKeyIsSafe(key)) {
      rejected.push({ key, reason: "invalid-key" });
      continue;
    }
    if (typeof value !== "string" || value.length > TE_MAX_VALUE) {
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
  return teSerializePretty(output);
}
