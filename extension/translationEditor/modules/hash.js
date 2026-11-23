// Editor-side hashes must be byte-identical to web-presence-locales/tools/lib/hash.js.
// The DOMAIN prefix, the key argument and the algorithm version are all part of
// the hash input. A DOMAIN change requires a hashVersion migration, not just a
// freshness cache bump.

async function teSha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function teHashSourceForVersion(value, key, version = TE_HASH_VERSION) {
  if (typeof value !== "string" || typeof key !== "string") throw new TypeError("teHashSource needs a string value and key");
  const domain = teDomainForVersion(version);
  return teSha256Hex(`${domain}\nsource\n${key}\n${value}`);
}

async function teHashTargetForVersion(value, key, version = TE_HASH_VERSION) {
  if (typeof value !== "string" || typeof key !== "string") throw new TypeError("teHashTarget needs a string value and key");
  const domain = teDomainForVersion(version);
  return teSha256Hex(`${domain}\ntarget\n${key}\n${value}`);
}

async function teHashSource(value, key) {
  return teHashSourceForVersion(value, key, TE_HASH_VERSION);
}

async function teHashTarget(value, key) {
  return teHashTargetForVersion(value, key, TE_HASH_VERSION);
}

// SHA-1 of the Git blob representation, matching `git hash-object` and the
// blob SHAs used in web-presence-locales/runtime/manifest.json.
async function teGitBlobSha(text) {
  return teGitBlobShaForText(text);
}
