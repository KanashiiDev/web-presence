import { HC_RANGES } from "../chart.js";
import { HistoryState } from "../../history/history.js";

/** Returns { start, end } Date objects for the current period. */
export function getPeriodBounds(range, chartState) {
  const cfg = HC_RANGES[range];
  const start = cfg.getStart(chartState.offset);
  const end = new Date(start);

  if (range === "week") end.setDate(end.getDate() + 7);
  else if (range === "month") end.setMonth(end.getMonth() + 1);
  else if (range === "year") end.setFullYear(end.getFullYear() + 1);
  else if (range === "alltime") return { start, end: new Date() };

  return { start, end: new Date(Math.min(end.getTime(), Date.now())) };
}

/** Returns history items that fall within the current period. */
function filterItems(range, chartState, historyMode = "listen") {
  const items = HistoryState[historyMode]?.fullData;
  if (!Array.isArray(items) || !items.length) return [];

  const { start, end } = getPeriodBounds(range, chartState);
  const lo = start.getTime();
  const hi = end.getTime();

  return items.filter((item) => {
    const ts = item?.date ? new Date(item.date).getTime() : null;
    return ts !== null && ts >= lo && ts < hi;
  });
}

/**
 * Picks the best display name for a normalized artist key.
 */
function resolveBestName(freqMap) {
  const entries = Object.entries(freqMap);
  if (!entries.length) return "Unknown";
  return entries.sort((a, b) => {
    const aCap = /^[A-Z]/.test(a[0]);
    const bCap = /^[A-Z]/.test(b[0]);
    if (aCap !== bCap) return aCap ? -1 : 1;
    return b[1] - a[1];
  })[0][0];
}

/**
 * Aggregates history items into summary stats.
 */
export function buildSummaryData(range, chartState, historyMode = "listen") {
  const items = filterItems(range, chartState, historyMode);

  if (!items.length) {
    return { topSongs: [], topArtists: [], totalMinutes: 0, totalSongs: 0 };
  }

  const normalizeArtistName = (name) => {
    if (!name) return "";
    return name
      .split(/,|&|feat\.|Feat\.|FEAT\./)[0]
      .trim()
      .toLowerCase();
  };

  // norm -> count
  const artistCounts = Object.create(null);
  // norm -> { rawName -> count }  (for display name resolution)
  const artistNameFreq = Object.create(null);
  // norm -> { image, songs: Set<songKey> }
  const artistMeta = Object.create(null);

  // songKey -> { title, displayArtist, image, songUrl, count, ms }
  const songMap = new Map();
  const sourceCounts = new Map();
  let totalMs = 0;

  for (const item of items) {
    const ms = item.total_listened_ms > 0 ? item.total_listened_ms : 0;
    totalMs += ms;

    const source = item.source?.trim() || "Unknown";
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);

    const rawTitle = item.title?.trim() || "Unknown";
    const rawArtist = item.artist?.trim() || "Unknown";

    const norm = normalizeArtistName(rawArtist);
    const titleKey = rawTitle.toLowerCase();
    const songKey = `${titleKey}__${norm}`;

    // Artist counts
    artistCounts[norm] = (artistCounts[norm] ?? 0) + 1;

    // Artist name frequency (for display name resolution)
    artistNameFreq[norm] ??= Object.create(null);
    artistNameFreq[norm][rawArtist] = (artistNameFreq[norm][rawArtist] ?? 0) + 1;

    // Artist meta (image, unique songs)
    artistMeta[norm] ??= { image: null, songs: new Set() };
    artistMeta[norm].image ??= item.image || null;
    artistMeta[norm].songs.add(songKey);

    // Songs - skip "_Unknown Title_" entries
    if (rawTitle === "Unknown" || rawTitle.includes("_Unknown Title_")) continue;

    const song = songMap.get(songKey);
    if (song) {
      song.count++;
      song.ms += ms;
      song.image ??= item.image || null;
      song.link ??= item.link || null;
    } else {
      songMap.set(songKey, {
        title: rawTitle,
        artist: rawArtist,
        image: item.image || null,
        link: item.link || null,
        count: 1,
        ms,
      });
    }
  }

  // Resolve best display name for every normalized artist key
  const displayNames = Object.create(null);
  for (const norm in artistNameFreq) {
    displayNames[norm] = resolveBestName(artistNameFreq[norm]);
  }

  // Stamp resolved display names onto song entries
  for (const [songKey, song] of songMap) {
    const norm = songKey.split("__")[1];
    if (displayNames[norm]) song.artist = displayNames[norm];
  }

  const rowCount = chartState.summaryRowCount ?? 5;
  const topSongs = [...songMap.values()].sort((a, b) => b.count - a.count).slice(0, rowCount);

  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, rowCount)
    .map(([norm, count]) => ({
      name: norm,
      displayName: displayNames[norm],
      image: artistMeta[norm]?.image ?? null,
      uniqueSongs: artistMeta[norm]?.songs.size ?? 0,
      count,
    }));

  return {
    topSongs,
    topArtists,
    totalMinutes: Math.round(totalMs / 60_000),
    totalSongs: items.length,
    _songMap: songMap,
    _displayNames: displayNames,
  };
}

/**
 * Returns the top 10 songs for a given artist norm key within the cached summary data.
 * @param {{ _songMap: Map, _displayNames: Record<string,string> }} summaryData
 * @param {string} artistNorm  - the normalized artist key (item.name from topArtists)
 * @returns {Array}
 */
export function getArtistTopSongs(summaryData, artistNorm) {
  const { _songMap } = summaryData;
  if (!_songMap) return [];

  return [..._songMap.entries()]
    .filter(([key]) => key.endsWith(`__${artistNorm}`))
    .map(([, song]) => song)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}
