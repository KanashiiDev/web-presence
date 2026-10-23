// Parses playback time values and returns detailed playback information.
function processPlaybackInfo(timePassed = "", durationElem = "") {
  let currentPosition, totalDuration;

  if (typeof timePassed === "string" && typeof durationElem === "string") {
    currentPosition = parseTime(timePassed.trim());
    totalDuration = parseTime(durationElem.trim());
  } else {
    currentPosition = Number(timePassed) || null;
    totalDuration = Number(durationElem) || null;
  }

  currentPosition = currentPosition == null || isNaN(currentPosition) ? null : Math.max(0, currentPosition);
  totalDuration = totalDuration == null || isNaN(totalDuration) ? null : Math.max(0, totalDuration);

  const timestamps = getTimestamps(currentPosition, totalDuration);
  const currentProgress = currentPosition !== null && totalDuration !== null && totalDuration > 0 ? (currentPosition / totalDuration) * 100 : null;

  return { currentPosition, totalDuration, currentProgress, timestamps };
}

function applyStrip(val, stripPattern) {
  if (!stripPattern) return val;
  const parsed = regexFromString(stripPattern);
  if (parsed) {
    try {
      return val.replace(new RegExp(parsed.source, parsed.flags || ""), "").trim();
    } catch (_) {}
  }
  return val.replaceAll(stripPattern, "").trim();
}

// Create ID from domain and patterns
function generateParserKey(domain, urlPatterns, authors = []) {
  let rawDomain = "";

  if (Array.isArray(domain)) {
    rawDomain = domain[0] || "";
  } else if (typeof domain === "string") {
    rawDomain = domain.split(",")[0] || "";
  }

  if (!rawDomain) {
    console.log("[generateParserKey] empty domain", { domain, urlPatterns });
    rawDomain = "unknown";
  }

  let patternsArray = [];
  if (Array.isArray(urlPatterns)) {
    patternsArray = urlPatterns;
  } else if (typeof urlPatterns === "string") {
    patternsArray = urlPatterns.split(",");
  }

  if (!patternsArray.length) patternsArray = [".*"];

  const patternStrings = patternsArray
    .map(function (p) {
      if (!p) return ".*";

      let strPattern = "";
      if (p instanceof RegExp) {
        strPattern = p.source;
      } else {
        strPattern = p.toString().trim() || ".*";
      }

      return strPattern.replace(/^\/|\/$/g, "") || ".*";
    })
    .sort();

  // unescape/encodeURIComponent keeps the input byte-safe for UTF-8 patterns.
  const bytes = new TextEncoder().encode(patternStrings.join("|"));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

  const hash = btoa(binary)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 10);

  const author = Array.isArray(authors) ? authors[0] : authors;

  const safeAuthor = author
    ? String(author)
        .toLowerCase()
        .replace(/[^a-z0-9_\-]/g, "")
    : "";

  const safeDomain = String(rawDomain)
    .toLowerCase()
    .replace(/[^a-z0-9_.\-]/g, "");

  return safeAuthor ? safeAuthor + "_" + safeDomain + "_" + hash : safeDomain + "_" + hash;
}

function parseRegexArray(input) {
  try {
    const trimmed = input.trim();
    const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1).trim() : trimmed;

    if (!inner) return [/.*/];

    const parts = inner
      .split(/,(?![^[]*])/g)
      .map((s) => s.trim())
      .filter(Boolean);

    const regexes = parts.map((str) => {
      const parsed = regexFromString(str);
      try {
        return parsed ? new RegExp(parsed.source, parsed.flags) : new RegExp(str);
      } catch {
        return /.*/;
      }
    });

    return regexes.length ? regexes : [/.*/];
  } catch {
    return [/.*/];
  }
}
