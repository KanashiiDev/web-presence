// Last.fm Web Services client + scrobble gate (background). Keys/session in storage.local;
// scrobbles a track right after it is committed to history.
const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_REQUEST_TIMEOUT_MS = 8000;
const LASTFM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LASTFM_CACHE_MAX_ENTRIES = 1000;
// Stay slightly under ~5 requests/second.
const LASTFM_MIN_INTERVAL_MS = 220;
const LASTFM_MAX_RETRIES = 2;
// Retryable API codes: 8 failed, 11 offline, 16 unavailable, 29 rate limit.
const LASTFM_RETRYABLE_API_ERRORS = new Set([8, 11, 16, 29]);
// Only "listen" mode is scrobbled.
const LASTFM_SCROBBLE_MODE = "listen";
// Not-found (code 6) is normal for dirty scraped names, not a failure.
const LASTFM_NOT_FOUND_CODE = 6;
// Token not yet approved by the user; auth dialog keeps polling.
const LASTFM_NOT_AUTHORIZED_CODE = 14;

class LastfmError extends Error {
  constructor(message, { code, status, body } = {}) {
    super(message);
    this.name = "LastfmError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

/** @type {Map<string, { data: object, expires: number }>} */
const lastfmCache = new Map();
/** @type {Map<string, Promise<object>>} */
const lastfmPending = new Map();

const lastfmSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const lastfmCleanName = (value) => (typeof value === "string" ? value.trim() : "");

function dKey(encodedData, salt = "LastFmExtensionKey") {
  try {
    const decoded = atob(encodedData);
    let result = "";
    const sl = salt.length;

    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ salt.charCodeAt(i % sl) ^ ((i * 31) & 0xff));
    }
    return result;
  } catch (e) {
    return "";
  }
}

// Spaces outgoing requests so parallel callers stay under the limit.
let lastfmNextSlot = 0;
async function lastfmWaitForSlot() {
  const now = Date.now();
  const slot = Math.max(now, lastfmNextSlot);
  lastfmNextSlot = slot + LASTFM_MIN_INTERVAL_MS;
  if (slot > now) await lastfmSleep(slot - now);
}

function lastfmEvictIfNeeded() {
  if (lastfmCache.size < LASTFM_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of lastfmCache) {
    if (entry.expires <= now) lastfmCache.delete(key);
  }
  if (lastfmCache.size < LASTFM_CACHE_MAX_ENTRIES) return;
  // Map preserves insertion order: first key is oldest.
  const oldest = lastfmCache.keys().next().value;
  if (oldest !== undefined) lastfmCache.delete(oldest);
}

// MD5 hex digest for api_sig (WebCrypto lacks MD5).
function lastfmMd5(input) {
  const bytes = new TextEncoder().encode(String(input));

  const add = (x, y) => {
    const low = (x & 0xffff) + (y & 0xffff);
    const high = (x >> 16) + (y >> 16) + (low >> 16);
    return (high << 16) | (low & 0xffff);
  };
  const rotl = (n, b) => (n << b) | (n >>> (32 - b));
  const cmn = (q, a, b, x, s, t) => {
    a = add(add(a, q), add(x, t));
    return add(rotl(a, s), b);
  };
  const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);

  const blockCount = Math.ceil((bytes.length + 9) / 64);
  const words = new Array(blockCount * 16).fill(0);
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= (bytes[i] & 0xff) << ((i % 4) * 8);
  }
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  const bitLength = bytes.length * 8;
  words[words.length - 2] = bitLength >>> 0;
  words[words.length - 1] = Math.floor(bitLength / 0x100000000);

  const state = [1732584193, -271733879, -1732584194, 271733878];
  for (let block = 0; block < words.length; block += 16) {
    const x = words.slice(block, block + 16);
    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];

    a = ff(a, b, c, d, x[0], 7, -680876936);
    d = ff(d, a, b, c, x[1], 12, -389564586);
    c = ff(c, d, a, b, x[2], 17, 606105819);
    b = ff(b, c, d, a, x[3], 22, -1044525330);
    a = ff(a, b, c, d, x[4], 7, -176418897);
    d = ff(d, a, b, c, x[5], 12, 1200080426);
    c = ff(c, d, a, b, x[6], 17, -1473231341);
    b = ff(b, c, d, a, x[7], 22, -45705983);
    a = ff(a, b, c, d, x[8], 7, 1770035416);
    d = ff(d, a, b, c, x[9], 12, -1958414417);
    c = ff(c, d, a, b, x[10], 17, -42063);
    b = ff(b, c, d, a, x[11], 22, -1990404162);
    a = ff(a, b, c, d, x[12], 7, 1804603682);
    d = ff(d, a, b, c, x[13], 12, -40341101);
    c = ff(c, d, a, b, x[14], 17, -1502002290);
    b = ff(b, c, d, a, x[15], 22, 1236535329);

    a = gg(a, b, c, d, x[1], 5, -165796510);
    d = gg(d, a, b, c, x[6], 9, -1069501632);
    c = gg(c, d, a, b, x[11], 14, 643717713);
    b = gg(b, c, d, a, x[0], 20, -373897302);
    a = gg(a, b, c, d, x[5], 5, -701558691);
    d = gg(d, a, b, c, x[10], 9, 38016083);
    c = gg(c, d, a, b, x[15], 14, -660478335);
    b = gg(b, c, d, a, x[4], 20, -405537848);
    a = gg(a, b, c, d, x[9], 5, 568446438);
    d = gg(d, a, b, c, x[14], 9, -1019803690);
    c = gg(c, d, a, b, x[3], 14, -187363961);
    b = gg(b, c, d, a, x[8], 20, 1163531501);
    a = gg(a, b, c, d, x[13], 5, -1444681467);
    d = gg(d, a, b, c, x[2], 9, -51403784);
    c = gg(c, d, a, b, x[7], 14, 1735328473);
    b = gg(b, c, d, a, x[12], 20, -1926607734);

    a = hh(a, b, c, d, x[5], 4, -378558);
    d = hh(d, a, b, c, x[8], 11, -2022574463);
    c = hh(c, d, a, b, x[11], 16, 1839030562);
    b = hh(b, c, d, a, x[14], 23, -35309556);
    a = hh(a, b, c, d, x[1], 4, -1530992060);
    d = hh(d, a, b, c, x[4], 11, 1272893353);
    c = hh(c, d, a, b, x[7], 16, -155497632);
    b = hh(b, c, d, a, x[10], 23, -1094730640);
    a = hh(a, b, c, d, x[13], 4, 681279174);
    d = hh(d, a, b, c, x[0], 11, -358537222);
    c = hh(c, d, a, b, x[3], 16, -722521979);
    b = hh(b, c, d, a, x[6], 23, 76029189);
    a = hh(a, b, c, d, x[9], 4, -640364487);
    d = hh(d, a, b, c, x[12], 11, -421815835);
    c = hh(c, d, a, b, x[15], 16, 530742520);
    b = hh(b, c, d, a, x[2], 23, -995338651);

    a = ii(a, b, c, d, x[0], 6, -198630844);
    d = ii(d, a, b, c, x[7], 10, 1126891415);
    c = ii(c, d, a, b, x[14], 15, -1416354905);
    b = ii(b, c, d, a, x[5], 21, -57434055);
    a = ii(a, b, c, d, x[12], 6, 1700485571);
    d = ii(d, a, b, c, x[3], 10, -1894986606);
    c = ii(c, d, a, b, x[10], 15, -1051523);
    b = ii(b, c, d, a, x[1], 21, -2054922799);
    a = ii(a, b, c, d, x[8], 6, 1873313359);
    d = ii(d, a, b, c, x[15], 10, -30611744);
    c = ii(c, d, a, b, x[6], 15, -1560198380);
    b = ii(b, c, d, a, x[13], 21, 1309151649);
    a = ii(a, b, c, d, x[4], 6, -145523070);
    d = ii(d, a, b, c, x[11], 10, -1120210379);
    c = ii(c, d, a, b, x[2], 15, 718787259);
    b = ii(b, c, d, a, x[9], 21, -343485551);

    state[0] = add(a, state[0]);
    state[1] = add(b, state[1]);
    state[2] = add(c, state[2]);
    state[3] = add(d, state[3]);
  }

  let hex = "";
  for (let i = 0; i < 4; i++) {
    // Little-endian byte order per state word.
    for (let j = 0; j < 4; j++) {
      const byte = (state[i] >> (j * 8)) & 0xff;
      hex += (byte >> 4).toString(16) + (byte & 0xf).toString(16);
    }
  }
  return hex;
}

async function lastfmFetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LASTFM_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      // last.fm sends a JSON error body on some 4xx codes.
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      throw new LastfmError(`last.fm responded HTTP ${res.status}`, {
        status: res.status,
        code: Number(body?.error) || undefined,
        body,
      });
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function lastfmIsRetryable(err) {
  if (!(err instanceof LastfmError)) return true; // network error / timeout
  if (LASTFM_RETRYABLE_API_ERRORS.has(err.code)) return true;
  return err.status === 429 || (err.status >= 500 && err.status < 600);
}

async function lastfmRequest(url, method) {
  for (let attempt = 0; ; attempt++) {
    await lastfmWaitForSlot();
    try {
      const data = await lastfmFetchJson(url);
      if (data?.error) {
        logError("[lastfm]: API error: method=%s, code=%s, message=%s", method, data.error, data.message);
        throw new LastfmError(`last.fm ${method} failed: ${data.message || data.error}`, {
          code: Number(data.error),
        });
      }
      return data;
    } catch (err) {
      if (attempt >= LASTFM_MAX_RETRIES || !lastfmIsRetryable(err)) throw err;
      await lastfmSleep(600 * 2 ** attempt);
    }
  }
}

// Calls a last.fm method; returns parsed "format=json" payload, throws LastfmError on transport
// or API errors. httpMethod defaults to "GET"; "POST" sends params in the body.
async function lastfmCallMethod(method, apiKey, params = {}, apiSecret, httpMethod = "GET") {
  const cacheKey = JSON.stringify({ method, params, httpMethod });
  const hit = lastfmCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.data;
  if (hit) lastfmCache.delete(cacheKey);

  const running = lastfmPending.get(cacheKey);
  if (running) return running;

  const promise = (async () => {
    const allParams = {
      method,
      api_key: apiKey,
      ...params,
    };

    const searchParams = new URLSearchParams();
    searchParams.set("method", method);
    searchParams.set("api_key", apiKey);
    searchParams.set("format", "json");

    if (apiSecret) {
      // Last.fm signature rule: all request parameters (api_sig excluded) are sorted
      // alphabetically by name, concatenated as key + value without separators, appended
      // with the api secret and hashed with MD5.
      const sortedKeys = Object.keys(allParams).sort();
      let signatureString = "";
      for (const key of sortedKeys) {
        signatureString += key + allParams[key];
      }
      signatureString += apiSecret;
      searchParams.set("api_sig", lastfmMd5(signatureString));
    }

    for (const [key, value] of Object.entries(params)) {
      searchParams.set(key, value);
    }

    let data;
    if (httpMethod === "POST") {
      data = await lastfmFetchJson(LASTFM_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: searchParams.toString(),
      });
      if (data?.error) {
        logError("[lastfm]: API error: method=%s, code=%s, message=%s", method, data.error, data.message);
        throw new LastfmError(`last.fm ${method} failed: ${data.message || data.error}`, {
          code: Number(data.error),
        });
      }
    } else {
      data = await lastfmRequest(`${LASTFM_API_URL}?${searchParams.toString()}`, method);
    }

    lastfmEvictIfNeeded();
    lastfmCache.set(cacheKey, { data, expires: Date.now() + LASTFM_CACHE_TTL_MS });
    return data;
  })();

  lastfmPending.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    lastfmPending.delete(cacheKey);
  }
}

// Get an auth token for the web auth flow.
async function lastfmGetAuthToken(apiKey) {
  return lastfmCallMethod("auth.getToken", apiKey);
}

// Exchange an auth token for a session key (signs with apiSecret).
async function lastfmGetSession(apiKey, apiSecret, token) {
  return lastfmCallMethod("auth.getSession", apiKey, { token }, apiSecret);
}

// Correct a track/artist name to its canonical form; returns { artist, track } or originals.
async function lastfmGetCorrection(apiKey, artist, track) {
  let data;
  try {
    data = await lastfmCallMethod("track.getcorrection", apiKey, { artist, track, autocorrect: 1 });
  } catch (err) {
    if (err?.code === LASTFM_NOT_FOUND_CODE) return { artist, track };
    throw err;
  }
  const corr = data?.corrections?.correction;
  if (!corr || !Array.isArray(corr)) return { artist, track };
  const entry = corr[0];
  const correctedTrack = entry?.track;
  if (!correctedTrack) return { artist, track };
  return {
    artist: lastfmCleanName(correctedTrack.artist?.name) || artist,
    track: lastfmCleanName(correctedTrack.name) || track,
  };
}

// Scrobble a track via the API (signs with session key + apiSecret).
async function lastfmApiScrobble(apiKey, apiSecret, sessionKey, artist, track, timestamp) {
  const params = {
    artist,
    track,
    // Timestamp in seconds.
    timestamp: Math.floor(timestamp / 1000),
    sk: sessionKey,
  };
  return lastfmCallMethod("track.scrobble", apiKey, params, apiSecret, "POST");
}

// SETTINGS
function lastfmReadSources(value) {
  return (Array.isArray(value) ? value : []).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
}

// Built-in Last.fm API credentials shared by all users; users can override in settings. Empty
// disables the built-in key until real values are provided. Keep in sync with the settings copy.
const [LF_D_K1, LF_D_K2] = (() => {
  const _0x = [76, 97, 115, 116, 70, 109, 69, 120, 116, 101, 110, 115, 105, 111, 110, 75, 101, 121];

  const _d = (v) => {
    try {
      const b = atob(v);
      const r = [];

      for (let i = 0; i < b.length; i++) {
        r[i] = String.fromCharCode(b.charCodeAt(i) ^ _0x[i % _0x.length] ^ ((i * 31) & 255));
      }

      return r.join("");
    } catch {
      return "";
    }
  };

  return [_d("fB8pTwuQzJC1Rm4WK83o+/dHBhR8ytiXn0trQT3H+pc="), _d("fksvGwzCm8W7FjwSJJ2/+fBHBkh7x9yWlEYwFT3Jqpo=")];
})();

// Load Last.fm config from storage into background state.
async function loadLastFmState() {
  try {
    const stored = await browser.storage.local.get(["lastFmScrobbleEnabled", "lastFmScrobbleSources", "lastFmApiKey", "lastFmApiSecret", "lastFmSessionKey"]);
    state.lastFm.enabled = stored.lastFmScrobbleEnabled === true;
    state.lastFm.sources = lastfmReadSources(stored.lastFmScrobbleSources);
    // User credentials win; built-in key used when empty.
    state.lastFm.apiKey = lastfmCleanName(stored.lastFmApiKey) || LF_D_K1;
    state.lastFm.apiSecret = lastfmCleanName(stored.lastFmApiSecret) || LF_D_K2;
    state.lastFm.sessionKey = lastfmCleanName(stored.lastFmSessionKey);
  } catch (err) {
    logError("[lastfm]: Failed to load Last.fm settings:", err);
  }
}

// Empty allowlist = scrobble all. Exact match or >= 3 char case-insensitive containment either way.
function lastfmSourceAllowed(source) {
  const allowed = state.lastFm.sources.length ? state.lastFm.sources : [""];
  if (!allowed.length) return true;
  const raw = String(source ?? "").trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  return allowed.some((entry) => {
    const name = entry.toLowerCase();
    return name === lower || (name.length >= 3 && (lower.includes(name) || name.includes(lower)));
  });
}

// Fire-and-forget scrobble for a committed history entry. Never throws.
async function lastfmScrobbleTrack({ title, artist, source, date, mode }) {
  try {
    const lf = state.lastFm;
    if (!lf.enabled || !lf.apiKey || !lf.apiSecret || !lf.sessionKey) return;
    // Only "listen" mode is scrobbled.
    if (mode !== LASTFM_SCROBBLE_MODE) return;
    const trackName = String(title ?? "").trim();
    const artistName = String(artist ?? "").trim();
    if (!trackName || !artistName) return;
    if (!lastfmSourceAllowed(source)) {
      logInfo("[lastfm]: Scrobble skipped - source filtered:", source);
      return;
    }
    const corrected = await lastfmGetCorrection(lf.apiKey, artistName, trackName);
    await lastfmApiScrobble(lf.apiKey, lf.apiSecret, lf.sessionKey, corrected.artist, corrected.track, date || Date.now());
    logInfo("[lastfm]: Scrobbled:", corrected.artist, "-", corrected.track);
  } catch (err) {
    logWarn("[lastfm]: Scrobble failed (non-fatal):", err?.code ?? "", err?.message ?? err);
  }
}

// SESSION KEY AUTH FLOW
// Single-user: one pending token at a time.
let lastfmPendingToken = null;

// Step 1: request a token and open the last.fm approval page.
async function handleLastFmAuthStart() {
  try {
    // Pick up freshly saved dialog keys without waiting for storage events.
    await loadLastFmState();
    const { apiKey, apiSecret } = state.lastFm;
    if (!apiKey || !apiSecret) return { ok: false, error: "missing keys" };

    const tokenData = await lastfmGetAuthToken(apiKey);
    const token = tokenData?.token;
    if (!token) return { ok: false, error: "Failed to obtain Last.fm auth token" };

    lastfmPendingToken = token;
    const authUrl = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;
    browser.tabs.create({ url: authUrl }).catch(() => {});
    return { ok: true, authUrl };
  } catch (err) {
    lastfmPendingToken = null;
    logError("[lastfm]: Auth start error:", err);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// Step 2: polled until the user approves the token.
// Error 14 keeps polling; anything else stops.
async function handleLastFmAuthPoll() {
  if (!lastfmPendingToken) return { ok: false, pending: false, error: "No pending Last.fm auth token" };
  try {
    const data = await lastfmGetSession(state.lastFm.apiKey, state.lastFm.apiSecret, lastfmPendingToken);
    const sessionKey = lastfmCleanName(data?.session?.key);
    if (!sessionKey) {
      lastfmPendingToken = null;
      return { ok: false, pending: false, error: "No session key returned" };
    }
    lastfmPendingToken = null;
    state.lastFm.sessionKey = sessionKey;
    await browser.storage.local.set({ lastFmSessionKey: sessionKey });
    return { ok: true };
  } catch (err) {
    if (err instanceof LastfmError && err.code === LASTFM_NOT_AUTHORIZED_CODE) {
      return { ok: false, pending: true };
    }
    // The token is single-use and can only be tried with the same key set: stop polling on error.
    lastfmPendingToken = null;
    logError("[lastfm]: Auth poll error:", err);
    return { ok: false, pending: false, error: err?.message ?? String(err) };
  }
}

// Dialog closed or cancel: drop the pending token.
function handleLastFmAuthCancel() {
  lastfmPendingToken = null;
  return { ok: true };
}
