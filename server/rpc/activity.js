const { saveListeningTime, isSameActivityIgnore } = require("../utils.js");
const { truncate, isValidUrl } = require("../../shared/utils.js");
const { state, CLIENT_ID, isBridgeConnected } = require("./state.js");

const { isRpcReady, scheduleReconnect } = require("./client.js");
const wnpClient = require("../services/wnpClient.js");
const { readSettings } = require("../routes/settings.js");
const userDataPath = process.env.USERDATA_PATH;
const settingsFilePath = process.env.SETTINGS_FILE_PATH;

// Init Activity File Store
const settings = readSettings(settingsFilePath)?.settings?.server;
const localActivitySave = settings?.EXPORT_ACTIVITY_FILES?.value;
const activityWriter = require("../services/activityFileStore.js");
activityWriter.init(userDataPath);

// Builds a Discord RPC activity object from the raw request payload.
function buildActivity(data, now) {
  const { StatusDisplayType } = require("@xhayper/discord-rpc");

  const dataTitle = String(data.title ?? "").trim();
  const rawArtist = String(data.artist ?? "").trim();
  const artistIsIntentionallyEmpty = !rawArtist || rawArtist === "-1";
  let dataArtist = artistIsIntentionallyEmpty ? "" : rawArtist;
  const dataImage = String(data.image ?? "").trim();
  const dataSource = String(data.source ?? "").trim();
  const dataLink = String(data.link ?? "").trim();

  if (!dataArtist && dataSource) dataArtist = dataSource;

  const activitySettings = {
    ...(data.settings && typeof data.settings === "object" ? data.settings : {}),
  };

  const shouldShowArtist = activitySettings.showArtist;
  const shouldShowSource = activitySettings.showSource;

  // FavIcon
  let favIcon = null;
  const showSmallIcon = Boolean(activitySettings.showFavIcon);
  if (showSmallIcon && dataLink) {
    try {
      const { hostname } = new URL(dataLink);
      favIcon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
    } catch {
      // invalid URL - favIcon stays null
    }
  }

  const isWatch = data.mode === "watch";

  // Base activity
  const activity = {
    application_id: CLIENT_ID,
    name: (shouldShowSource && dataSource ? dataSource : shouldShowArtist && dataArtist ? dataArtist : "") || "Web Presence",
    details: dataTitle,
    state: shouldShowArtist ? dataArtist : dataSource,
    type: isWatch ? 3 : 2,
    instance: false,
    // Private metadata (not sent to Discord, used for history)
    _artist: dataArtist,
    _cover: dataImage,
    _source: dataSource,
  };

  // Status Display Type
  const statusDisplayTypeMap = {
    0: typeof StatusDisplayType !== "undefined" ? StatusDisplayType.NAME : 0,
    1: typeof StatusDisplayType !== "undefined" ? StatusDisplayType.STATE : 1,
    2: typeof StatusDisplayType !== "undefined" ? StatusDisplayType.DETAILS : 2,
  };

  const rawDisplayType = Number(activitySettings?.statusDisplayType);
  const validDisplayType = !isNaN(rawDisplayType) && rawDisplayType in statusDisplayTypeMap;
  activity.statusDisplayTypeNumber = validDisplayType ? rawDisplayType : 1;

  if (validDisplayType) {
    activity.statusDisplayType = statusDisplayTypeMap[rawDisplayType];
  } else if (typeof StatusDisplayType !== "undefined" && StatusDisplayType.STATE !== undefined) {
    activity.statusDisplayType = StatusDisplayType.STATE;
  }

  // Large image
  if (activitySettings.customCover && activitySettings.customCoverUrl) {
    activity.largeImageKey = String(activitySettings.customCoverUrl);
  } else if (activitySettings.showCover && dataImage) {
    activity.largeImageKey = dataImage;
  } else if (activitySettings.customPlaceholder && activitySettings.customPlaceholderUrl) {
    activity.largeImageKey = String(activitySettings.customPlaceholderUrl);
  } else {
    activity.largeImageKey = "key-default";
  }

  // Ensure largeImageKey does not exceed Discord's 300-character limit.
  if (activity.largeImageKey.length > 300) {
    activity.largeImageKey = "key-default";
  }

  // Large image text
  if (!artistIsIntentionallyEmpty && activitySettings.showSource && activitySettings.showArtist) {
    activity.largeImageText = dataSource;
  }

  // Small image
  if (!artistIsIntentionallyEmpty && favIcon) {
    activity.smallImageKey = favIcon;
    activity.smallImageText = dataSource;
    activity.largeImageText = "";
  }

  // Buttons
  const existingButtons = Array.isArray(data.buttons) ? data.buttons.filter((btn) => btn?.text && String(btn.text).trim() && isValidUrl(btn.link)) : [];

  const customButtons = [
    activitySettings.customButton1 && activitySettings.customButton1Text?.trim() && isValidUrl(activitySettings.customButton1Link)
      ? { text: activitySettings.customButton1Text, link: activitySettings.customButton1Link }
      : null,
    activitySettings.customButton2 && activitySettings.customButton2Text?.trim() && isValidUrl(activitySettings.customButton2Link)
      ? { text: activitySettings.customButton2Text, link: activitySettings.customButton2Link }
      : null,
  ];

  let mergedButtons;
  if (existingButtons.length === 0) {
    mergedButtons = customButtons.filter(Boolean);
  } else if (existingButtons.length === 1) {
    const firstCustom = customButtons.find(Boolean);
    mergedButtons = firstCustom ? [existingButtons[0], firstCustom] : existingButtons;
  } else {
    mergedButtons = [customButtons[0] ?? existingButtons[0], customButtons[1] ?? existingButtons[1]];
  }

  if (activitySettings.showButtons) {
    const validButtons = mergedButtons
      .filter((btn) => btn?.text && String(btn.text).trim() && isValidUrl(btn.link))
      .slice(0, 2)
      .map((btn) => ({ label: truncate(btn.text, 32), url: String(btn.link) }));

    const sourceButton = isValidUrl(dataLink) ? { label: truncate(`Open on ${dataSource || "Source"}`, 32), url: dataLink } : null;

    if (validButtons.length === 2) {
      activity.buttons = validButtons;
    } else if (validButtons.length === 1 && sourceButton) {
      activity.buttons = [validButtons[0], sourceButton];
    } else if (validButtons.length === 1) {
      activity.buttons = validButtons;
    } else if (sourceButton) {
      activity.buttons = [sourceButton];
    }

    if (isValidUrl(dataLink)) {
      activity.detailsUrl = dataLink;
      activity.largeImageUrl = dataLink;
      activity.smallImageUrl = dataLink;
    }
  }

  // Timestamps
  const position = Number(data.position) || 0;
  const duration = Number(data.duration) || 0;

  if (duration > 0) {
    const nowSeconds = Math.floor(now / 1000);
    activity.startTimestamp = nowSeconds - position;
    if (activitySettings.showTimeLeft) {
      activity.endTimestamp = nowSeconds + (duration - position);
    }
  }

  return { activity, activitySettings };
}

// Send activity to Discord Web bridge
function sendToWebRPC(activity) {
  const clients = state.bridgeClients;
  if (!clients?.size) return;

  const assets = {};

  if (activity.largeImageKey) {
    assets.large_image = activity.largeImageKey;
    assets.large_url = activity.largeImageUrl;
  }
  if (activity.largeImageText) {
    assets.large_text = activity.largeImageText;
  }
  if (activity.smallImageKey) {
    assets.small_image = activity.smallImageKey;
    assets.small_url = activity.smallImageUrl;
  }
  if (activity.smallImageText) {
    assets.small_text = activity.smallImageText;
  }

  const webActivity = {
    application_id: activity.application_id,
    name: activity.name,
    details: activity.details,
    details_url: activity.detailsUrl,
    state: activity.state,
    type: activity.type,
    status_display_type: Number(activity.statusDisplayTypeNumber),
    instance: activity.instance ?? false,
  };

  if (Object.keys(assets).length) {
    webActivity.assets = assets;
  }

  if (activity.startTimestamp) {
    webActivity.timestamps = { start: activity.startTimestamp * 1000 };
    if (activity.endTimestamp) {
      webActivity.timestamps.end = activity.endTimestamp * 1000;
    }
  }

  if (activity.buttons?.length) {
    webActivity.buttons = activity.buttons.map((b) => b.label ?? b);
    const urls = activity.buttons.map((b) => b.url ?? "");
    if (urls.some((u) => u)) {
      webActivity.metadata = { button_urls: urls };
    }
  }

  const payload = JSON.stringify({ activity: webActivity });

  clients.forEach((client) => {
    if (client.readyState === 1) {
      try {
        client.send(payload);
      } catch (err) {
        console.warn("[BRIDGE] Send failed, removing client:", err.message);
        clients.delete(client);
      }
    } else if (client.readyState > 1) {
      clients.delete(client);
    }
  });
}

function clearWebRPC() {
  const clients = state.bridgeClients;
  if (!clients?.size) return;

  const payload = JSON.stringify({ activity: null });

  clients.forEach((client) => {
    if (client.readyState === 1) {
      try {
        client.send(payload);
      } catch (err) {
        console.warn("[BRIDGE] clearWebRPC send failed, removing client:", err.message);
        clients.delete(client);
      }
    } else if (client.readyState > 1) {
      clients.delete(client);
    }
  });
}

// Attempts to set a Discord RPC activity. Handles reconnect on failure.
async function setRpcActivity(activity) {
  state.currentActivity = activity;
  state.lastActivitySeenAt = Date.now();

  // If bridge is active, only send to web
  if (isBridgeConnected()) {
    sendToWebRPC(activity);
    return true;
  }

  sendToWebRPC(activity);

  const client = state.rpcClient;

  if (!isRpcReady(client)) {
    if (!state.bridgeClients?.size) {
      scheduleReconnect(3000, "rpc not ready");
    }
    return false;
  }

  try {
    await client.user.setActivity(activity);
    // Write currentActivity files
    if (localActivitySave) {
      activityWriter.writeActivityFiles(activity).catch((err) => {
        console.log("[ACTIVITY] Error writing activity files: " + err);
      });
    }
    return true;
  } catch (err) {
    console.error("[ACTIVITY] setActivity failed:", err.message);
    state.isRpcConnected = false;
    scheduleReconnect(3000, "setActivity failed");
    return false;
  }
}

// Clears the Discord RPC activity with optional retries.
async function clearRpcActivity({ maxRetries = 1, timeoutMs = 5000 } = {}) {
  if (!state.rpcClient?.user?.clearActivity) return false;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await Promise.race([state.rpcClient.user.clearActivity(), new Promise((_, reject) => setTimeout(() => reject(new Error("Clear timeout")), timeoutMs))]);
      return true;
    } catch (err) {
      const reason = err?.message || err?.stack?.split("\n")[0] || err?.code || "unknown";
      console.warn(`[ACTIVITY] clearActivity failed (attempt ${attempt}/${maxRetries}): ${reason}`);
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  state.isRpcConnected = false;
  return false;
}

// Resets all activity-related state fields to their defaults.
function resetActivityState(historyFilePath) {
  clearWebRPC();
  if (historyFilePath) flushListeningTime(historyFilePath);
  state.currentActivity = null;
  state.lastUpdateAt = null;
  state.lastActivitySeenAt = null;
  state.lastActiveClient = null;
  state.listeningStartTime = null;
  // Remove currentActivity files
  if (localActivitySave) activityWriter.clearActivityFiles();
  wnpClient.clearActivity();
}

// Persists the listening duration for the currently playing track, if any.
function flushListeningTime(historyFilePath) {
  if (!state.currentActivity || !state.listeningStartTime) return;
  const listenedMs = Date.now() - state.listeningStartTime;
  saveListeningTime(state.currentActivity, listenedMs, historyFilePath);
}

// Handles listening time tracking whenever an activity update arrives.
// History entry creation is handled by the plugin via POST /add-history.
function handleListeningTimeUpdate(activity, historyFilePath) {
  const trackChanged = !isSameActivityIgnore(activity, state.currentActivity);

  if (trackChanged) {
    // Flush previous track's listening time before switching
    flushListeningTime(historyFilePath);
    state.listeningStartTime = Date.now();
    return;
  }

  // Same track - start listening timer if not already running
  if (!state.listeningStartTime) {
    state.listeningStartTime = Date.now();
  }
}

module.exports = {
  buildActivity,
  setRpcActivity,
  clearRpcActivity,
  resetActivityState,
  handleListeningTimeUpdate,
  flushListeningTime,
};
