import { HC_RANGES } from "./chart.js";
import { HistoryState } from "../history/history.js";
import { ScrollManager } from "../../manager/scrollManager.js";
import { createSVG, svg_paths, updateSimpleBarPadding, relativeTime, fullDateTime, loadImage, waitForTransitionEnd } from "../../utils.js";

// Returns a details controller scoped to a given id-prefix and historyMode
export function createDetailsController(p = "", historyMode = "listen") {
  const _platformItems = new Map();
  let _detailsClickController = null;
  let _isHiding = false;
  let _detailsAnimTimer = null;

  function _id(name) {
    return p ? `${p}${name}` : name;
  }

  function hc_buildSongNode(item) {
    const wrap = document.createElement("div");
    wrap.className = "song hc-song";

    const a = Object.assign(document.createElement("a"), {
      href: item.songUrl ?? item.link ?? "",
      target: "_blank",
      rel: "noopener noreferrer",
      title: i18n.t("history.goToLink"),
    });

    const imgContainer = document.createElement("div");
    imgContainer.className = "history-image-container spinner";

    const img = Object.assign(document.createElement("img"), {
      className: "song-image",
      alt: item.title ?? "",
      loading: "lazy",
      decoding: "async",
    });

    imgContainer.appendChild(img);
    a.appendChild(imgContainer);
    wrap.appendChild(a);
    loadImage({ target: img, src: item.image });

    const info = document.createElement("div");
    info.className = "song-info";

    const dateP = document.createElement("p");
    dateP.className = "date";
    if (item.date) {
      const ts = item.date instanceof Date ? item.date.getTime() : item.date;
      dateP.title = fullDateTime(item.date);
      dateP.textContent = relativeTime(item.date);
      dateP.dataset.timestamp = ts;
    }

    const titleH = Object.assign(document.createElement("h2"), { className: "title", textContent: item.title || "_Unknown Title_" });
    const artistP = Object.assign(document.createElement("p"), { className: "artist", textContent: item.artist ?? "" });
    const sourceP = Object.assign(document.createElement("p"), { className: "source", textContent: item.source ?? "" });

    info.append(dateP, titleH, artistP, sourceP);
    wrap.appendChild(info);
    return wrap;
  }

  async function hc_toggleSongList(platformRow, songs, platName, chartState) {
    if (platformRow.dataset.animating === "true") return;
    platformRow.dataset.animating = "true";

    const wrapperId = `${p}hcSongList`;

    // 1. If a different platform is open, close it
    if (chartState.expandedPlatform && chartState.expandedPlatform !== platName) {
      const open = document.querySelector(`#${_id("chartDetails")} .chart-detail-row.hc-expanded`);
      const existing = open?.nextElementSibling;

      if (open) open.classList.remove("hc-expanded");

      if (existing?.classList.contains("hc-song-list")) {
        existing._sbInstance?.unMount();
        existing._sbInstance = null;
        ScrollManager.cleanupType(`hcSong_${p}${chartState.expandedPlatform}`);
        existing.classList.remove("hc-open");

        await waitForTransitionEnd(existing, "max-height");
        existing.remove();
      }
    }

    // 2. If the clicked platform is already open, close it
    const isOpen = platformRow.classList.contains("hc-expanded");
    if (isOpen) {
      platformRow.classList.remove("hc-expanded");
      ScrollManager.cleanupType(`hcSong_${p}${platName}`);
      chartState.expandedPlatform = null;

      const listEl = platformRow.nextElementSibling;
      if (listEl?.classList.contains("hc-song-list")) {
        listEl._sbInstance?.unMount();
        listEl._sbInstance = null;
        listEl.classList.remove("hc-open");

        await waitForTransitionEnd(listEl, "max-height");
        listEl.remove();
      }

      delete platformRow.dataset.animating;
      return;
    }

    // 3. Open the platform and create the list
    platformRow.classList.add("hc-expanded");
    chartState.expandedPlatform = platName;

    const listWrap = Object.assign(document.createElement("div"), {
      className: "hc-song-list",
      id: wrapperId,
    });
    const inner = Object.assign(document.createElement("div"), {
      className: "hc-song-list-inner",
      id: `${p}hcSongListInner`,
    });

    listWrap.appendChild(inner);
    platformRow.insertAdjacentElement("afterend", listWrap);

    if (typeof SimpleBar !== "undefined") {
      listWrap._sbInstance = new SimpleBar(listWrap, { autoHide: false });
    }

    const sorted = [...songs].sort((a, b) => new Date(b.date) - new Date(a.date));
    const PAGE = 8;
    const scrollState = {
      fullData: sorted,
      filteredData: [],
      isFiltering: false,
      currentOffset: 0,
      isLoading: false,
    };

    const scrollRenderer = {
      async render({ reset }) {
        if (reset) {
          inner.textContent = "";
          scrollState.currentOffset = 0;
        }
        const slice = scrollState.fullData.slice(scrollState.currentOffset, scrollState.currentOffset + PAGE);
        const frag = document.createDocumentFragment();
        for (const item of slice) frag.appendChild(hc_buildSongNode(item));
        inner.appendChild(frag);
        scrollState.currentOffset += slice.length;
      },
    };

    try {
      await scrollRenderer.render({ reset: true });
      ScrollManager.activate(`hcSong_${p}${platName}`, listWrap._sbInstance ?? null, scrollRenderer, scrollState, wrapperId, "songs");
    } catch (err) {
      listWrap._sbInstance?.unMount();
      listWrap._sbInstance = null;
      listWrap.remove();
      platformRow.classList.remove("hc-expanded");
      chartState.expandedPlatform = null;
      delete platformRow.dataset.animating;
      throw err;
    }

    // Add the open class and update the padding when the transition ends
    listWrap.classList.add("hc-open");
    await waitForTransitionEnd(listWrap, "max-height");
    updateSimpleBarPadding(wrapperId);

    delete platformRow.dataset.animating;
  }

  function cancelDetailsAnimation() {
    clearTimeout(_detailsAnimTimer);
    _detailsAnimTimer = null;
  }

  function _animatePanel(panel, { fromHeight, toHeight, fromOpacity, toOpacity, onComplete }) {
    cancelDetailsAnimation();
    panel.style.height = typeof fromHeight === "number" ? `${fromHeight}px` : fromHeight;
    panel.style.opacity = String(fromOpacity);
    panel.offsetHeight; // reflow
    requestAnimationFrame(() => {
      panel.style.height = typeof toHeight === "number" ? `${toHeight}px` : toHeight;
      panel.style.opacity = String(toOpacity);
    });
    _detailsAnimTimer = setTimeout(() => {
      _detailsAnimTimer = null;
      if (document.body.contains(panel)) onComplete();
    }, 300);
  }

  function initDetailsClickHandler(chartState) {
    _detailsClickController?.abort();
    _detailsClickController = new AbortController();
    const panel = document.getElementById(_id("chartDetails"));
    if (!panel) return;
    panel.addEventListener(
      "click",
      (e) => {
        if (_isHiding) return;
        const row = e.target.closest(".chart-detail-row[data-platform]");
        if (!row) return;
        const items = _platformItems.get(row.dataset.platform);
        if (items) hc_toggleSongList(row, items, row.dataset.platform, chartState);
      },
      { signal: _detailsClickController.signal },
    );
  }

  function destroyDetailsClickHandler() {
    _detailsClickController?.abort();
    _detailsClickController = null;
  }

  function _cleanupOpenSongList(chartState) {
    const orphan = document.querySelector(`#${_id("chartDetails")} .hc-song-list`);
    if (orphan) {
      orphan._sbInstance?.unMount();
      orphan._sbInstance = null;
      orphan.remove();
    }
    if (chartState.expandedPlatform) ScrollManager.cleanupType(`hcSong_${p}${chartState.expandedPlatform}`);
    const expandedRow = document.querySelector(`#${_id("chartDetails")} .chart-detail-row.hc-expanded`);
    if (expandedRow) {
      expandedRow.classList.remove("hc-expanded");
      delete expandedRow.dataset.animating;
    }
  }

  function hc_showDetails(barIndex, chartData, mode, range, chartState) {
    const panel = document.getElementById(_id("chartDetails"));
    const titleEl = document.getElementById(_id("chartDetailsTitle"));
    const totalEl = document.getElementById(_id("chartDetailsTotal"));
    const platformEl = document.getElementById(_id("chartDetailsPlatforms"));
    if (!panel || !titleEl || !totalEl || !platformEl) return;

    _isHiding = false;
    panel.style.pointerEvents = "";
    cancelDetailsAnimation();
    _cleanupOpenSongList(chartState);
    chartState.expandedPlatform = null;
    _platformItems.clear();
    totalEl.textContent = "";
    platformEl.textContent = "";

    const locale = navigator.languages?.[0] || navigator.language || "en-US";
    const cfg = HC_RANGES[range];
    const baseDate = new Date(cfg.getStart(chartState.offset));

    let titleText = "";
    if (range === "year") {
      const d = new Date(baseDate);
      d.setMonth(barIndex);
      d.setDate(1);
      titleText = d.toLocaleDateString(locale, { month: "long", year: "numeric" });
    } else if (range === "alltime") {
      titleText = chartData.labels[barIndex] || "";
    } else if (range === "month") {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + barIndex);
      titleText = d.toLocaleDateString(locale, { day: "numeric", month: "long" });
    } else {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + barIndex);
      titleText = d.toLocaleDateString(locale, { weekday: "long" });
    }
    titleEl.textContent = titleText;

    initDetailsClickHandler(chartState);

    const periodStart = new Date(cfg.getStart(chartState.offset));
    const isYear = range === "year";
    const isAllTime = range === "alltime";
    const targetMonth = isYear ? barIndex : null;
    const targetYear = isAllTime ? Number(chartData.labels[barIndex]) : periodStart.getFullYear();

    if (!isYear && !isAllTime) {
      periodStart.setDate(periodStart.getDate() + barIndex);
      periodStart.setHours(0, 0, 0, 0);
    }
    const periodTime = !isYear && !isAllTime ? periodStart.getTime() : null;

    let totalCount = 0;
    let totalMs = 0;
    const byPlatform = {};

    for (const item of HistoryState[historyMode]?.fullData ?? []) {
      if (!item.date) continue;
      const src = item.source || "Unknown";
      if (src === "Unknown") continue;
      if ((mode === "minutes" || mode === "minutes_watch") && !(item.total_listened_ms > 0)) continue;

      const d = new Date(item.date);
      d.setHours(0, 0, 0, 0);

      let hit = false;
      if (isAllTime) {
        hit = d.getFullYear() === targetYear;
      } else if (isYear) {
        hit = d.getFullYear() === targetYear && d.getMonth() === targetMonth;
      } else {
        hit = d.getTime() === periodTime;
      }

      if (!hit) continue;

      const plat = (byPlatform[src] ??= { count: 0, ms: 0, items: [] });
      plat.count += 1;
      plat.items.push(item);
      totalCount += 1;
      if (item.total_listened_ms > 0) {
        plat.ms += item.total_listened_ms;
        totalMs += item.total_listened_ms;
      }
    }

    if (totalCount === 0) {
      totalEl.textContent = i18n.t("chart.summary.empty");
      panel.classList.remove("hidden");
      return;
    }

    const minutes = Math.round(totalMs / 60_000);
    totalEl.textContent =
      mode === "songs"
        ? i18n.t(totalCount === 1 ? "chart.song.one" : "chart.song.other", { count: totalCount })
        : mode === "videos"
          ? i18n.t(totalCount === 1 ? "chart.video.one" : "chart.video.other", { count: totalCount })
          : i18n.t("chart.total.duration", { minutes });

    const fragment = document.createDocumentFragment();
    for (const [plat, stat] of Object.entries(byPlatform).sort((a, b) => b[1].count - a[1].count)) {
      const row = document.createElement("div");
      row.className = "chart-detail-row";
      row.dataset.platform = plat;

      const name = Object.assign(document.createElement("span"), { className: "chart-detail-platform", textContent: plat });
      const rowMinutes = Math.round(stat.ms / 60_000);

      const val = Object.assign(document.createElement("span"), {
        className: "chart-detail-value",
        textContent:
          mode === "songs"
            ? i18n.t(stat.count === 1 ? "chart.song.one" : "chart.song.other", { count: stat.count })
            : mode === "videos"
              ? i18n.t(stat.count === 1 ? "chart.video.one" : "chart.video.other", { count: stat.count })
              : mode === "minutes_watch"
                ? i18n.t(stat.count === 1 ? "chart.track.video.one" : "chart.track.video.other", { count: stat.count, minutes: rowMinutes })
                : i18n.t(stat.count === 1 ? "chart.track.one" : "chart.track.other", { count: stat.count, minutes: rowMinutes }),
      });
      const chevron = document.createElement("span");
      chevron.className = "chart-detail-chevron";
      chevron.append(createSVG(svg_paths.expand));

      row.append(name, val, chevron);
      _platformItems.set(plat, stat.items.slice());
      fragment.appendChild(row);
    }
    platformEl.appendChild(fragment);

    const wasOpen = !panel.classList.contains("hidden");
    panel.classList.remove("hidden");
    _animatePanel(panel, {
      fromHeight: wasOpen ? panel.offsetHeight : 0,
      toHeight: panel.scrollHeight,
      fromOpacity: wasOpen ? 1 : 0,
      toOpacity: 1,
      onComplete: () => {
        panel.style.height = "auto";
      },
    });
  }

  function hc_hideDetails(chartState) {
    const panel = document.getElementById(_id("chartDetails"));
    if (!panel) return;
    _isHiding = true;
    panel.style.pointerEvents = "none";
    _cleanupOpenSongList(chartState);
    _platformItems.clear();
    _animatePanel(panel, {
      fromHeight: panel.offsetHeight,
      toHeight: 0,
      fromOpacity: 1,
      toOpacity: 0,
      onComplete: () => {
        panel.classList.add("hidden");
        panel.style.cssText = "";
        _isHiding = false;
      },
    });
    chartState.lastClickedBarIndex = null;
    chartState.expandedPlatform = null;
  }

  function hc_destroyDetails(chartState) {
    cancelDetailsAnimation();
    destroyDetailsClickHandler();
    _cleanupOpenSongList(chartState);
    _platformItems.clear();
    chartState.expandedPlatform = null;
    chartState.lastClickedBarIndex = null;
  }

  return { hc_showDetails, hc_hideDetails, hc_destroyDetails, cancelDetailsAnimation };
}
