const statsModule = {
  currentCustomStart: null,
  currentCustomEnd: null,
  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;

    document.getElementById("applyCustomRange")?.addEventListener("click", handleApplyCustomRange);
    document.getElementById("clearCustomRange")?.addEventListener("click", handleClearCustomRange);

    flatpickrInstances.start = flatpickr("#customStartDate", {
      dateFormat: "d-m-Y",
      onChange([date]) {
        if (!date) return;
        date.setHours(0, 0, 0, 0);
        statsModule.currentCustomStart = date.getTime();
      },
    });

    flatpickrInstances.end = flatpickr("#customEndDate", {
      dateFormat: "d-m-Y",
      onChange([date]) {
        if (!date) return;
        date.setHours(23, 59, 59, 999);
        statsModule.currentCustomEnd = date.getTime();
      },
    });
  },
};

async function renderTopStats(history, range = "day", topN = 5, customStart = null, customEnd = null) {
  const container = document.getElementById("statsEntries");
  if (!container) return;

  // Clean up previous listener
  if (container._artistClickListener) {
    container.removeEventListener("click", container._artistClickListener);
    container._artistClickListener = null;
  }

  container.replaceChildren();
  const spinner = createSpinner();
  container.appendChild(spinner);

  const filteredHistory = filterHistoryByRange(history, range, customStart, customEnd);
  const stats = await getTopSongs(filteredHistory, topN);
  spinner.remove();

  // Top Artists
  const artistHeader = document.createElement("h3");
  artistHeader.textContent = "Top Artists";
  artistHeader.dataset.i18n = "stats.topArtists.title";

  container.appendChild(artistHeader);

  if (stats.topArtists.length) {
    const frag = document.createDocumentFragment();

    stats.topArtists.forEach((artist, i) => {
      const div = document.createElement("div");
      div.className = "history-stats-artist-entry list-item";
      div.dataset.artist = artist.name;
      div.dataset.artistId = `artist-${i}`;
      div.dataset.range = range;
      if (customStart != null) div.dataset.customStart = customStart;
      if (customEnd != null) div.dataset.customEnd = customEnd;

      const header = document.createElement("div");
      header.className = "artist-header";

      const name = document.createElement("span");
      name.className = "artist-name";
      name.textContent = artist.displayName;

      const total = document.createElement("span");
      total.className = "artist-total";
      total.title = "Total Plays";
      total.dataset.i18n = "stats.totalPlays.title";
      total.setAttribute("data-i18n-attr", "title");
      total.textContent = `▶ ${artist.count}`;

      header.append(name, total);

      const statsDiv = document.createElement("div");
      statsDiv.className = "stats";
      statsDiv.id = `artist-${i}-stats`;

      div.append(header, statsDiv);
      frag.appendChild(div);
    });

    container.appendChild(frag);
    applyTranslations();

    // Set initial collapsed height
    container.querySelectorAll(".history-stats-artist-entry").forEach((entry) => {
      const header = entry.children[0];
      if (header) entry.style.maxHeight = `${header.offsetHeight}px`;
    });
  } else {
    const iTag = document.createElement("i");
    iTag.textContent = "Empty.";
    iTag.dataset.i18n = "stats.topArtists.empty";
    container.appendChild(iTag);
  }

  // Attach delegated click listener once
  container._artistClickListener = handleArtistEntryClick;
  container.addEventListener("click", container._artistClickListener);

  // Top Tracks
  const trackHeader = document.createElement("h3");
  trackHeader.textContent = "Top Tracks";
  trackHeader.dataset.i18n = "stats.topTracks.title";
  container.appendChild(trackHeader);

  if (stats.topSongs.length) {
    const frag = document.createDocumentFragment();
    for (const { name } of stats.topSongs) {
      const separatorIdx = name.lastIndexOf(" - ");
      if (separatorIdx === -1) continue;
      const title = name.slice(0, separatorIdx);
      const artist = name.slice(separatorIdx + 3);
      const entry = filteredHistory.find((e) => e?.t === title && normalizeArtistName(e?.a) === artist);
      if (!entry) continue;
      frag.appendChild(createHistoryEntry(entry, null, "stats", filteredHistory));
    }
    container.appendChild(frag);
  } else {
    const iTag = document.createElement("i");
    iTag.textContent = "Empty.";
    iTag.dataset.i18n = "stats.topTracks.empty";
    container.appendChild(iTag);
  }
  applyTranslations();
}
