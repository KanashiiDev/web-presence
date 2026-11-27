// Normalize host string
const normalizeHost = (hostOrUrl) => {
  try {
    if (!hostOrUrl || typeof hostOrUrl !== "string") return "";
    if (!hostOrUrl.includes("://")) {
      return hostOrUrl
        .trim()
        .replace(/^www\./g, "")
        .toLowerCase();
    }
    return new URL(hostOrUrl).hostname
      .trim()
      .replace(/^www\./g, "")
      .toLowerCase();
  } catch {
    return "";
  }
};

// Extract /pattern/flags from a string representation of a regex
const regexFromString = (str) => {
  const match = str.match(/^\/(.+)\/([gimsuy]*)$/);
  if (!match) return null;
  return { source: match[1], flags: match[2] };
};

function isDomainMatch(parserDomainRaw, tabHostnameRaw) {
  const parserDomain = normalizeHost(parserDomainRaw);
  const tabDomain = normalizeHost(tabHostnameRaw);

  if (!parserDomain || !tabDomain) return false;
  if (parserDomain === tabDomain) return true;
  if (parserDomain.startsWith("*.")) {
    const base = parserDomain.slice(2);
    return tabDomain.endsWith(`.${base}`) && tabDomain !== base;
  }
  return false;
}

// Url Pattern Regex
const parseUrlPattern = (pattern) => {
  if (pattern instanceof RegExp) return pattern;
  if (typeof pattern === "string") {
    const parsed = regexFromString(pattern);
    if (parsed) {
      try {
        return new RegExp(parsed.source, parsed.flags || undefined);
      } catch (e) {
        logWarn("Invalid regex:", pattern, e);
        return /.^/;
      }
    }
    try {
      return new RegExp(pattern);
    } catch (e) {
      logWarn("Invalid regex:", pattern, e);
    }
  }
  return /.^/;
};

// Find matching parsers for URL
const findMatchingParsersForUrl = (url, list) => {
  const host = normalizeHost(url);
  return list.filter(({ domain }) => {
    const domains = Array.isArray(domain) ? domain : [domain];
    return domains.some((d) => isDomainMatch(d, host));
  });
};

// Resolve a branch head to an immutable commit SHA via the GitHub REST API
const GITHUB_HEAD_CACHE = new Map();

async function fetchGitHubHead({ owner, repo, branch = "main", token = null, minIntervalMs = 0, timeout = 10000, force = false }) {
  const key = `${owner}/${repo}/${branch}`;
  let state = GITHUB_HEAD_CACHE.get(key);
  if (!state) {
    state = { sha: null, etag: null, nextAt: 0, lastError: null, pending: null };
    GITHUB_HEAD_CACHE.set(key, state);
  }
  const now = Date.now();
  // Only reuse a cached SHA while its minimum interval is still active. A
  // missing SHA must trigger the first request, not an early empty return.
  if (!force && state.sha && now < state.nextAt) {
    return { sha: state.sha, etag: state.etag, fromCache: true, ok: true };
  }
  if (!force && state.pending) return state.pending;

  const request = (async () => {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (state.etag) headers["If-None-Match"] = state.etag;

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
    let response;
    try {
      response = await fetchWithTimeout(url, { headers, cache: "no-store" }, timeout);
    } catch (err) {
      state.nextAt = now + 60000;
      state.lastError = err.message;
      return { sha: state.sha, etag: state.etag, fromCache: true, ok: !!state.sha, error: err.message };
    }

    if (response.status === 304) {
      state.nextAt = now + minIntervalMs;
      return { sha: state.sha, etag: state.etag, fromCache: true, ok: !!state.sha };
    }

    if (!response.ok) {
      // Rate limits and transient API failures must fall back to the last known
      // good SHA, not to a mutable branch URL. Back off before retrying.
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(Math.max(retryAfter * 1000, 60000), 300000) : 60000;
      state.nextAt = now + delay;
      state.lastError = `HTTP ${response.status}`;
      try {
        await response.text();
      } catch (_err) {
        /* body is irrelevant */
      }
      return { sha: state.sha, etag: state.etag, fromCache: true, ok: !!state.sha, error: state.lastError };
    }

    try {
      const data = await response.json();
      const sha = data?.object?.sha;
      if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error("Invalid head SHA");
      state.sha = sha;
      state.etag = response.headers.get("ETag") || state.etag;
      state.nextAt = now + minIntervalMs;
      state.lastError = null;
      return { sha, etag: state.etag, fromCache: false, ok: true };
    } catch (err) {
      state.nextAt = now + 60000;
      state.lastError = err.message;
      return { sha: state.sha, etag: state.etag, fromCache: true, ok: !!state.sha, error: err.message };
    }
  })();
  state.pending = request;
  try {
    return await request;
  } finally {
    if (state.pending === request) state.pending = null;
  }
}

// Fetch with timeout
const fetchWithTimeout = async (url, options = {}, timeout = 5000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      logError(`[Fetch]: Request timed out after ${timeout / 1000} seconds: ${url}`);
    } else {
      logError(`[Fetch]: Fetch error: ${url}`, err);
    }
    throw err;
  }
};
