import { dom } from "../../core/dom.js";
import { DataStore } from "../../core/dataStore.js";
import { formatTime } from "../../utils.js";

const activityCardState = {
  customStartTime: null,
  lastTrackId: null,
  lastKnownActivity: {
    title: null,
    artist: null,
    source: null,
    cover: null,
    hasTimestamps: null,
    start: null,
    end: null,
    isPlaying: null,
    button1Label: null,
    button1Url: null,
    button2Label: null,
    button2Url: null,
  },
};

function updateactivityCardUI() {
  const cardContainer = dom.activityCard.container;
  if (!cardContainer || cardContainer.hidden || cardContainer.closest("[hidden]")) return;

  const activityData = DataStore.get("activity");
  const act = activityData?.activity;

  if (!act?.details) {
    if (activityCardState.lastKnownActivity.isPlaying !== false) {
      dom.activityCard.trackTitle.textContent = i18n.t("activity.empty");
      dom.activityCard.trackArtist.textContent = i18n.t("common.artist");
      dom.activityCard.trackSource.textContent = i18n.t("common.source");
      dom.activityCard.coverImage.src = "assets/icon-dark.png";
      dom.activityCard.progressFill.style.width = "0%";
      dom.activityCard.timePassed.textContent = "0:00";
      dom.activityCard.duration.textContent = "0:00";
      dom.activityCard.trackLink1.style.display = "none";
      dom.activityCard.trackLink1.textContent = "Button 1";
      dom.activityCard.trackLink2.style.display = "none";
      dom.activityCard.trackLink2.textContent = "Button 2";
      dom.activityCard.container.classList.add("no-activity");

      activityCardState.lastKnownActivity.isPlaying = false;
      activityCardState.customStartTime = null;
      activityCardState.lastTrackId = null;
      activityCardState.lastKnownActivity.title = null;
      activityCardState.lastKnownActivity.artist = null;
      activityCardState.lastKnownActivity.source = null;
      activityCardState.lastKnownActivity.cover = null;
      activityCardState.lastKnownActivity.start = null;
      activityCardState.lastKnownActivity.end = null;
      activityCardState.lastKnownActivity.button1Label = null;
      activityCardState.lastKnownActivity.button1Url = null;
      activityCardState.lastKnownActivity.button2Label = null;
      activityCardState.lastKnownActivity.button2Url = null;
    }
    return;
  }

  if (activityCardState.lastKnownActivity.isPlaying !== true) {
    dom.activityCard.container.classList.remove("no-activity");
    activityCardState.lastKnownActivity.isPlaying = true;
  }

  const title = act.details || "Unknown Title";
  let artist = act._artist || act.state || "Unknown Artist";
  const source = act._source || act.largeImageText || "Unknown Source";
  let cover = act._cover || act.largeImageKey || "assets/icon-dark.png";

  if (artist === source) artist = "";

  if (cover.startsWith("key-")) {
    cover = "assets/icon-dark.png";
  }

  // Update UI and state
  if (title !== activityCardState.lastKnownActivity.title) {
    dom.activityCard.trackTitle.textContent = title;
    activityCardState.lastKnownActivity.title = title;
  }
  if (artist !== activityCardState.lastKnownActivity.artist) {
    dom.activityCard.trackArtist.textContent = artist;
    activityCardState.lastKnownActivity.artist = artist;
  }
  if (source !== activityCardState.lastKnownActivity.source) {
    dom.activityCard.trackSource.textContent = source;
    activityCardState.lastKnownActivity.source = source;
  }
  if (cover !== activityCardState.lastKnownActivity.cover) {
    dom.activityCard.coverImage.src = cover;
    activityCardState.lastKnownActivity.cover = cover;
  }

  const trackId = `${title}__${artist}`;
  if (trackId !== activityCardState.lastTrackId) {
    activityCardState.lastTrackId = trackId;
    activityCardState.customStartTime = Date.now();
  }

  if (act.startTimestamp && act.endTimestamp) {
    const start = act.startTimestamp;
    const end = act.endTimestamp;
    const total = Math.max(0, end - start);
    const passed = Math.min(Math.max(0, Math.floor(Date.now() / 1000) - start), total);

    const timeStr = formatTime(passed);
    const durStr = formatTime(total);
    const percent = total === 0 ? 0 : (passed / total) * 100;

    if (activityCardState.lastKnownActivity.hasTimestamps !== true) {
      dom.activityCard.duration.style.display = "inline-block";
      dom.activityCard.progressBar.style.display = "flex";
      activityCardState.lastKnownActivity.hasTimestamps = true;
    }

    if (dom.activityCard.duration.textContent !== durStr) dom.activityCard.duration.textContent = durStr;
    if (dom.activityCard.timePassed.textContent !== timeStr) dom.activityCard.timePassed.textContent = timeStr;

    const newWidth = `${Math.min(percent, 100)}%`;
    if (dom.activityCard.progressFill.style.width !== newWidth) {
      dom.activityCard.progressFill.style.width = newWidth;
    }

    activityCardState.lastKnownActivity.start = start;
    activityCardState.lastKnownActivity.end = end;
  } else {
    const elapsed = activityCardState.customStartTime ? Math.floor((Date.now() - activityCardState.customStartTime) / 1000) : 0;
    const timeStr = formatTime(elapsed);

    if (activityCardState.lastKnownActivity.hasTimestamps !== false) {
      dom.activityCard.duration.style.display = "none";
      dom.activityCard.progressBar.style.display = "none";
      activityCardState.lastKnownActivity.hasTimestamps = false;
    }
    if (dom.activityCard.timePassed.textContent !== timeStr) dom.activityCard.timePassed.textContent = timeStr;
  }

  [0, 1].forEach((index) => {
    const btnData = act.buttons?.[index];
    const btnDom = index === 0 ? dom.activityCard.trackLink1 : dom.activityCard.trackLink2;

    const labelKey = index === 0 ? "button1Label" : "button2Label";
    const urlKey = index === 0 ? "button1Url" : "button2Url";

    if (btnData) {
      const newLabel = btnData.label;
      const newUrl = btnData.url;

      if (newLabel !== activityCardState.lastKnownActivity[labelKey] || newUrl !== activityCardState.lastKnownActivity[urlKey] || btnDom.style.display === "none") {
        btnDom.textContent = newLabel;
        btnDom.href = newUrl;
        btnDom.style.display = "inline-block";

        activityCardState.lastKnownActivity[labelKey] = newLabel;
        activityCardState.lastKnownActivity[urlKey] = newUrl;
      }
    } else {
      if (btnDom.style.display !== "none") {
        btnDom.style.display = "none";
        btnDom.textContent = "";
        btnDom.href = "#";

        activityCardState.lastKnownActivity[labelKey] = null;
        activityCardState.lastKnownActivity[urlKey] = null;
      }
    }
  });
}

// UI update interval
let uiUpdateInterval = null;
let _unsubscribeActivity = null;

// Start the music card
export function initactivityCard() {
  destroyactivityCard();

  // Update static fields (title, artist, cover, etc.) when fetching
  _unsubscribeActivity = DataStore.subscribe("activity", () => {
    updateactivityCardUI();
  });

  // Update the UI every 1 second
  uiUpdateInterval = setInterval(updateactivityCardUI, 1050);
}

// Cleanup
export function destroyactivityCard() {
  if (uiUpdateInterval) {
    clearInterval(uiUpdateInterval);
    uiUpdateInterval = null;
  }
  if (_unsubscribeActivity) {
    _unsubscribeActivity();
    _unsubscribeActivity = null;
  }
}
