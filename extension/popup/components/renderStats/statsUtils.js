async function getTopSongs(filteredHistory, topN = 5) {
  if (!filteredHistory?.length) return { topArtists: [], topSongs: [] };

  const allowedArtists = await getFilteredTopArtists(filteredHistory);
  if (!allowedArtists.length) return { topArtists: [], topSongs: [] };

  const allowedSet = new Set(allowedArtists);

  const artistCounts = Object.create(null);
  const artistNameFreq = Object.create(null);
  const songCounts = Object.create(null);

  for (const e of filteredHistory) {
    const norm = normalizeArtistName(e?.a);
    if (!norm || !allowedSet.has(norm)) continue;

    // Artist count
    artistCounts[norm] = (artistCounts[norm] ?? 0) + 1;

    // Artist name frequency tracking
    const rawName = e.a;
    artistNameFreq[norm] ??= Object.create(null);
    artistNameFreq[norm][rawName] = (artistNameFreq[norm][rawName] ?? 0) + 1;

    // Song count
    if (e.t && !e.t.includes("_Unknown Title_")) {
      const key = `${e.t} - ${norm}`;
      songCounts[key] = (songCounts[key] ?? 0) + 1;
    }
  }

  // Resolve best display name per normalized artist
  const artistOriginalNames = Object.create(null);
  for (const norm in artistNameFreq) {
    const entries = Object.entries(artistNameFreq[norm]);
    entries.sort((a, b) => {
      const aIsCap = /^[A-Z]/.test(a[0]);
      const bIsCap = /^[A-Z]/.test(b[0]);
      if (aIsCap !== bIsCap) return aIsCap ? -1 : 1;
      return b[1] - a[1];
    });
    artistOriginalNames[norm] = entries[0][0];
  }

  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([norm, count]) => ({
      name: norm,
      displayName: artistOriginalNames[norm],
      count,
    }));

  const topSongs = Object.entries(songCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name, count]) => ({ name, count }));

  return { topArtists, topSongs };
}
