// Format Label
function formatLabel(name) {
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  return capitalized.replace(/([A-Z0-9])/g, " $1").trim();
}

// Normalize artist name
function normalizeArtistName(name) {
  if (!name) return "";
  return name
    .split(/,|&|feat\.|Feat\.|FEAT\./)[0]
    .trim()
    .toLowerCase();
}

// Normalize title and artist
async function normalizeTitleAndArtist(inputTitle, inputArtist) {
  let title = typeof inputTitle === "string" ? inputTitle : "";
  let artist = typeof inputArtist === "string" ? inputArtist : "";

  if (!title) return { title, artist };
  if (!window._NORMALIZATION_STATUS_) window._NORMALIZATION_STATUS_ = await browser.storage.local.get("normalization");

  const { normalization } = window._NORMALIZATION_STATUS_ || (await browser.storage.local.get("normalization"));
  const defaultValue = [true, false];
  const map = {
    enable: defaultValue,
    cleanTitle: [false, false],
    stripDashPrefix: [false, true],
    disable: null,
  };

  const flags = normalization in map ? map[normalization] : defaultValue;
  if (!flags) return { title, artist };
  const [replaceArtist, stripDashPrefix] = flags;

  // Core Helpers
  const canonical = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();

  const splitArtists = (str) =>
    (str || "")
      .split(/\s*(?:,|&|\+|x|×|feat\.?|featuring|ft\.?|with)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);

  const isRemix = (t) => /\b(remix|edit|vip|flip)\b/i.test(t);

  // Title Preprocess
  const parenIndex = title.search(/[\[\(（【]/);
  const baseTitle = parenIndex !== -1 ? title.slice(0, parenIndex) : title;
  const parenPart = parenIndex !== -1 ? title.slice(parenIndex) : "";

  // Dash Parse
  const dashMatch = baseTitle.match(/^(.+?)\s[-–—]\s(.+)$/);

  if (dashMatch) {
    const left = dashMatch[1].trim();
    const right = dashMatch[2].trim() + (parenPart ? " " + parenPart : "");

    // stripDashPrefix: remove the left part of the dash
    if (stripDashPrefix) {
      title = right;
      return { title, artist };
    }

    const leftSet = new Set(splitArtists(left).map(canonical).filter(Boolean));
    const inputSet = new Set(splitArtists(artist).map(canonical).filter(Boolean));

    if (replaceArtist) {
      if (isRemix(title)) {
        const remixer = artist;
        artist = left;
        title = right;
        return { title, artist, remixer };
      }

      // if left is not a subset of artist, left is richer, replace it
      const leftIsSubset = [...leftSet].every((p) => inputSet.has(p));
      if (!leftIsSubset) artist = left;
      title = right;
    } else {
      // cleanTitle — don't touch the artist, just clean the title
      const parenSet = new Set(
        splitArtists(parenPart.replace(/[\[\](）】（【\(\)]/g, ""))
          .map(canonical)
          .filter(Boolean),
      );

      // at least one artist track must match on the left
      const hasOverlap = [...inputSet].some((p) => leftSet.has(p));
      // the unmatched part should be in parenSet
      const remaining = [...inputSet].filter((p) => !leftSet.has(p));
      const remainingInParen = remaining.every((p) => parenSet.has(p));

      if (hasOverlap && remainingInParen) title = right;
    }
  }

  return { title, artist };
}
