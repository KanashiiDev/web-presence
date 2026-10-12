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
