// Editor-side hashes must be byte-identical to web-presence-locales/tools/lib/hash.js.
// The DOMAIN prefix, the key argument and the algorithm version are all part of
// the hash input. A DOMAIN change requires a hashVersion migration, not just a
// freshness cache bump.

async function teSha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return teBytesToHex(new Uint8Array(digest));
}

async function teHashValueForVersion(kind, label, value, key, version = TE_HASH_VERSION) {
  if (typeof value !== "string" || typeof key !== "string") throw new TypeError(`${label} needs a string value and key`);
  const domain = teDomainForVersion(version);
  return teSha256Hex(`${domain}\n${kind}\n${key}\n${value}`);
}

async function teHashSourceForVersion(value, key, version = TE_HASH_VERSION) {
  return teHashValueForVersion("source", "teHashSource", value, key, version);
}

async function teHashTargetForVersion(value, key, version = TE_HASH_VERSION) {
  return teHashValueForVersion("target", "teHashTarget", value, key, version);
}

async function teHashSource(value, key) {
  return teHashSourceForVersion(value, key, TE_HASH_VERSION);
}

async function teHashTarget(value, key) {
  return teHashTargetForVersion(value, key, TE_HASH_VERSION);
}
