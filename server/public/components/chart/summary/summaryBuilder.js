import { createSVG, loadImage, svg_paths } from "../../../utils.js";
import { getArtistTopSongs } from "./summaryData.js";

const STORAGE_KEY = "summary-custom-images";
let _imageCache = null;

function getCustomImages() {
  if (!_imageCache) {
    _imageCache = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  }
  return _imageCache;
}

function _saveImages(images) {
  _imageCache = images;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(images));
}

function makeTitleKey(title) {
  return "title:" + encodeURIComponent(title.toLowerCase().trim());
}

function makeImageKey(url) {
  return encodeURIComponent(url);
}

function saveCustomImage(originalUrl, customUrl) {
  const images = getCustomImages();
  images[makeImageKey(originalUrl)] = customUrl;
  _saveImages(images);
}

function saveCustomImageByTitle(title, customUrl) {
  const images = getCustomImages();
  images[makeTitleKey(title)] = customUrl;
  _saveImages(images);
}

function getCustomImage(originalUrl, title) {
  const images = getCustomImages();
  if (title) {
    const byTitle = images[makeTitleKey(title)];
    if (byTitle) return byTitle;
  }
  return images[makeImageKey(originalUrl)] || null;
}

async function openImageChangeDialog(currentUrl, title, onSave, onRemove) {
  const images = getCustomImages();
  const hasCustom = !!images[makeImageKey(currentUrl)] || !!(title && images[makeTitleKey(title)]);

  const newUrl = await showPrompt(i18n.t("chart.summary.dialog.title"), currentUrl || "", {
    placeholder: "https://example.com/image.jpg",
    extraButtons: hasCustom ? [{ label: i18n.t("common.delete"), cls: "danger", value: "__remove__" }] : [],
    validator: (val) => {
      try {
        const parsed = new URL(val);
        if (!["http:", "https:"].includes(parsed.protocol)) return i18n.t("chart.summary.dialog.error.protocol");
        return null;
      } catch {
        return i18n.t("chart.summary.dialog.error.protocol");
      }
    },
  });

  if (!newUrl) return;
  if (newUrl === "__remove__") {
    onRemove?.();
    return;
  }
  onSave(newUrl);
}

/** Renders the minutes/tracks hero block. */
export function buildMinutesView(data) {
  const wrap = document.createElement("div");
  wrap.className = "summary-minutes-view";

  const hero = document.createElement("div");
  hero.className = "summary-hero";

  const createCell = (number, labelText) => {
    const cell = document.createElement("div");
    cell.className = "summary-hero-cell";

    const num = document.createElement("div");
    num.className = "summary-hero-number";
    num.textContent = number.toLocaleString();

    const label = document.createElement("div");
    label.className = "summary-hero-label";
    label.dataset.i18n = `chart.summary.${labelText.replace(/[^\w]/g, "_")}`;
    label.textContent = labelText;

    cell.appendChild(num);
    cell.appendChild(label);
    return cell;
  };

  hero.appendChild(createCell(data.totalMinutes, "minutes listened"));
  hero.appendChild(createCell(data.totalSongs, "tracks played"));
  wrap.appendChild(hero);
  return wrap;
}

/**
 * Builds the artist drill-down view (top 10 songs for one artist).
 * Replaces `.summary-content` children, adds a back button in the header.
 * @param {object} artist  - item from topArtists
 * @param {object} summaryData  - full data returned by buildSummaryData (with _songMap)
 */
export function buildArtistDrillDown(artist, summaryData, panel) {
  if (!panel) return;

  const content = panel.querySelector(".summary-content");
  if (!content) return;

  const periodLabel = panel.querySelector(".summary-period-label");
  if (periodLabel) {
    periodLabel.dataset.savedLabel ??= periodLabel.textContent || "";

    const backBtn = document.createElement("button");
    backBtn.className = "summary-back-btn";
    backBtn.type = "button";
    backBtn.appendChild(createSVG(svg_paths.leftChev));

    const artistTitle = document.createElement("span");
    artistTitle.className = "summary-artist-drilldown-title";
    artistTitle.textContent = artist.displayName || artist.name;

    periodLabel.replaceChildren(backBtn, artistTitle);

    backBtn.addEventListener("click", () => _closeDrillDown(panel));
  }

  // Content: artist hero + song list
  content.replaceChildren();
  content.classList.add("summary-content--drilldown");

  // Top songs list
  const songs = getArtistTopSongs(summaryData, artist.name);
  const songList = buildRankedList(songs, "songs");
  songList.classList.add("summary-ranked-list--drilldown");
  content.appendChild(songList);
}

function _closeDrillDown(panel) {
  const content = panel.querySelector(".summary-content");
  const periodLabel = panel.querySelector(".summary-period-label");

  // Restore original period label
  if (periodLabel && periodLabel.dataset.savedLabel !== undefined) {
    periodLabel.textContent = periodLabel.dataset.savedLabel;
    delete periodLabel.dataset.savedLabel;
  }

  if (content) {
    content.classList.remove("summary-content--drilldown");
  }

  // Re-render the main summary view - import renderPanel lazily via a custom event
  panel.dispatchEvent(new CustomEvent("summary:back", { bubbles: true }));
}

/** Renders a ranked list of songs or artists. */
export function buildRankedList(items, type) {
  const wrap = document.createElement("div");
  wrap.className = "summary-ranked-list";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "summary-empty";
    empty.dataset.i18n = `chart.summary.empty`;
    empty.textContent = "No data for this period.";
    wrap.appendChild(empty);
    return wrap;
  }

  const maxCount = items[0].count;
  const isSongs = type === "songs" || type === "videos";

  for (const [idx, item] of items.entries()) {
    const row = document.createElement("div");
    row.className = idx === 0 ? "summary-row summary-row--top" : "summary-row";

    const rank = document.createElement("div");
    rank.className = "summary-rank";
    rank.textContent = idx + 1;

    const imgWrap = document.createElement("div");
    imgWrap.className = "summary-img-wrap spinner";

    const img = document.createElement("img");
    img.className = "summary-img";
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    imgWrap.appendChild(img);

    const overlay = document.createElement("button");
    overlay.className = "summary-img-overlay";
    overlay.type = "button";
    overlay.dataset.itemIdx = idx;
    overlay.dataset.itemType = type;

    overlay.appendChild(createSVG(svg_paths.pen));
    imgWrap.appendChild(overlay);

    const info = document.createElement("div");
    info.className = "summary-info";

    const title = document.createElement("div");
    title.className = "summary-title";
    title.textContent = isSongs ? item.title || "Unknown" : item.displayName || item.name || "Unknown";

    const sub = document.createElement("div");
    sub.className = "summary-sub";
    if ((isSongs && !item.artist) || !isSongs) {
      sub.dataset.i18n = `${item.uniqueSongs !== 1 ? "chart.summary.uniqueTrack.other" : "chart.summary.uniqueTrack.one"}`;
      sub.dataset.i18nParams = JSON.stringify({ count: item.uniqueSongs });
    }
    sub.textContent = isSongs ? item.artist || "" : `${item.uniqueSongs} unique track${item.uniqueSongs !== 1 ? "s" : ""}`;

    info.appendChild(title);
    info.appendChild(sub);

    const right = document.createElement("div");
    right.className = "summary-right";

    const barWrap = document.createElement("div");
    barWrap.className = "summary-bar-wrap";

    const bar = document.createElement("div");
    bar.className = "summary-bar";
    bar.style.setProperty("--summary-bar-pct", `${Math.max(4, Math.round((item.count / maxCount) * 100))}%`);
    barWrap.appendChild(bar);

    const count = document.createElement("div");
    count.className = "summary-count";
    count.textContent = `${item.count}×`;

    right.appendChild(barWrap);
    right.appendChild(count);

    row.appendChild(rank);
    row.appendChild(imgWrap);
    row.appendChild(info);
    row.appendChild(right);

    if (isSongs && item.link) {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".summary-img-overlay")) return;
        window.open(item.link, "_blank", "noopener,noreferrer");
      });
    }

    if (!isSongs) {
      row.classList.add("summary-row--clickable");
      row.addEventListener("click", (e) => {
        if (e.target.closest(".summary-img-overlay")) return;
        row.dispatchEvent(new CustomEvent("summary:artistClick", { bubbles: true, detail: { artist: item } }));
      });
    }

    wrap.appendChild(row);

    const customImage = getCustomImage(item.image, isSongs ? item.title : item.displayName || item.name);
    loadImage({ target: img, src: customImage || item.image });
  }

  wrap.addEventListener("click", async (e) => {
    const overlay = e.target.closest(".summary-img-overlay[data-item-idx]");
    if (!overlay) return;

    e.stopPropagation();
    e.preventDefault();

    const idx = Number(overlay.dataset.itemIdx);
    const itemType = overlay.dataset.itemType;
    const itemIsSong = itemType === "songs";
    const item = items[idx];
    if (!item) return;

    const img = overlay.closest(".summary-img-wrap")?.querySelector(".summary-img");
    const itemTitle = itemIsSong ? item.title || null : item.displayName || item.name || null;

    await openImageChangeDialog(
      item.image,
      itemTitle,
      (newUrl) => {
        if (itemTitle) saveCustomImageByTitle(itemTitle, newUrl);
        else saveCustomImage(item.image, newUrl);
        if (img) loadImage({ target: img, src: newUrl });
      },
      () => {
        const images = getCustomImages();
        delete images[makeImageKey(item.image)];
        if (itemTitle) delete images[makeTitleKey(itemTitle)];
        _saveImages(images);
        if (img) loadImage({ target: img, src: item.image });
      },
    );
  });

  return wrap;
}
