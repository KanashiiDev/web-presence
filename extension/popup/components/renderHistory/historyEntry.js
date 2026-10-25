function createHistoryEntry(entry, historyIndex, type, filteredHistory = []) {
  const div = Object.assign(document.createElement("div"), { className: "history-entry list-item" });
  div.dataset.historyIndex = historyIndex;

  // Checkbox
  const checkbox = Object.assign(document.createElement("input"), {
    type: "checkbox",
    className: "history-checkbox",
  });
  checkbox.dataset.index = historyIndex;

  // Image
  const imgContainer = document.createElement("div");
  imgContainer.className = "history-image-container spinner";

  const img = Object.assign(document.createElement("img"), {
    width: 46,
    height: 46,
    className: "history-image",
    alt: "",
    loading: "lazy",
    decoding: "async",
  });

  imgContainer.appendChild(img);

  // Info
  const info = document.createElement("div");
  info.className = "history-info content-meta";

  // Title
  const strong = Object.assign(document.createElement("strong"), {
    textContent: entry.t,
    className: "history-title content-meta-title",
  });
  info.appendChild(strong);

  // Source and plays container
  const small = document.createElement("small");
  small.className = "history-source content-meta-tertiary";

  // Source span
  const sourceSpan = document.createElement("span");
  sourceSpan.className = "history-source-text";
  sourceSpan.textContent = entry.s;
  small.appendChild(sourceSpan);

  // Separator
  if (type === "stats") {
    const totalPlays = filteredHistory.filter((e) => e.t === entry.t).length;
    if (totalPlays > 0) {
      const separatorSpan = document.createElement("span");
      separatorSpan.className = "history-separator";
      separatorSpan.textContent = " • ";
      small.appendChild(separatorSpan);

      // Plays span
      const playsSpan = document.createElement("span");
      playsSpan.className = "history-plays";
      playsSpan.textContent = `${totalPlays} plays`;
      playsSpan.dataset.i18n = "stats.totalPlays.count";
      playsSpan.dataset.i18nParams = JSON.stringify([totalPlays]);
      small.appendChild(playsSpan);
    }
  } else {
    const formattedTime = dateHourMinute(new Date(entry.p));
    if (formattedTime) {
      const separatorSpan = document.createElement("span");
      separatorSpan.className = "history-separator";
      separatorSpan.textContent = " • ";
      small.appendChild(separatorSpan);

      const timeSpan = document.createElement("span");
      timeSpan.className = "history-time";
      timeSpan.textContent = formattedTime;
      small.appendChild(timeSpan);
    }
  }

  info.appendChild(small);

  if (entry.a !== "Radio") {
    const artist = Object.assign(document.createElement("span"), {
      className: "history-artist content-meta-secondary",
      textContent: entry.a,
    });
    info.append(artist, document.createElement("br"));
  }

  info.appendChild(small);

  // Link
  const link = Object.assign(document.createElement("a"), {
    className: "activity-link",
    title: i18n.t("history.goToLink"),
    target: "_blank",
    rel: "noopener noreferrer",
  });
  if (entry.u) link.href = entry.u;
  link.appendChild(createSVG(svg_paths.redirectIconPaths));

  div.append(checkbox, imgContainer, info, link);
  loadImage({ target: img, src: entry.i });
  return div;
}
