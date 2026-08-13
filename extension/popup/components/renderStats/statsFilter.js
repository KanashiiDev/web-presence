function filterHistoryByRange(history, range, customStart = null, customEnd = null) {
  if (!Array.isArray(history)) return [];
  const { startTime, endTime } = getStartTime(range, customStart, customEnd);
  return history.filter((e) => e?.p >= startTime && e?.p <= endTime && e?.m !== "watch");
}

async function getFilteredTopArtists(filteredHistory) {
  if (!filteredHistory?.length) return [];

  const seen = new Set();
  const allArtists = [];

  for (const e of filteredHistory) {
    if (!e?.a || e.a.includes("Unknown Artist")) continue;
    const norm = normalizeArtistName(e.a);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      allArtists.push(norm);
    }
  }

  if (!allArtists.length) return [];

  const list = await getFreshParserList();
  const parserTexts = list.map((entry) => ((entry?.title ?? "") + " " + (entry?.domain ?? "")).toLowerCase());

  return allArtists.filter((norm) => !parserTexts.some((text) => text.includes(norm)));
}
