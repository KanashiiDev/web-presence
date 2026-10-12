// Validate URL function
const isValidUrl = (url) => {
  try {
    const parsed = new URL(url, location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (_) {
    return false;
  }
};

const isAllowedDomain = async (hostname, pathname) => {
  if (!state.parserListLoaded || state.parserListLoading) {
    await (state.parserListLoading || parserReady());
  }
  try {
    const normHost = normalizeHost(hostname);
    for (const parser of state.parserList) {
      const domains = (Array.isArray(parser.domain) ? parser.domain : [parser.domain]).filter(Boolean);
      const domainMatch = domains.some((d) => isDomainMatch(d, normHost));

      if (!domainMatch) continue;
      // URL pattern check
      const urlPatterns = parser.urlPatterns || [];
      const hasMatch = urlPatterns.length === 0 || urlPatterns.map(parseUrlPattern).some((re) => re.test(pathname));

      if (!hasMatch) continue;

      // Parser enabled check
      const cached = state.parserEnabledCache.has(parser.id) ? state.parserEnabledCache.get(parser.id) : parser.isEnabled !== false;
      if (cached) {
        return { ok: true, match: `[isAllowedDomain]: Match: ${hostname}${pathname} (parser: ${parser.title || parser.id})` };
      }
    }

    return { ok: false, error: { code: 2, message: `[isAllowedDomain]: Hostname not allowed (${hostname})` } };
  } catch (err) {
    logError("[isAllowedDomain]: Domain Match Error", err);
    return { ok: false, error: { code: 3, message: "[isAllowedDomain]: Domain Match Error" } };
  }
};

// Helper function to safely get text content
const getSafeText = (getFn, key, fallback) => {
  try {
    const el = getFn(key);
    return el?.textContent?.trim() || fallback || null;
  } catch (_) {
    return fallback || null;
  }
};

// Helper function to safely get href
const getSafeHref = (getFn, key, fallback) => {
  try {
    const el = getFn(key);
    let raw = el?.getAttribute?.("href") ?? fallback;

    try {
      raw = new URL(raw, location.origin).href;
    } catch (_) {
      // If URL parsing fails, fallback to the original href
    }

    return isValidUrl(raw) ? raw : null;
  } catch (_) {
    try {
      fallback = new URL(fallback, location.origin).href;
    } catch (_) {}
    return isValidUrl(fallback) ? fallback : null;
  }
};
