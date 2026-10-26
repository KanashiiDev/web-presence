const state = {
  updateTimer: null,
  lastUpdateTime: null,
  isUpdating: false,
  activeTab: false,
  isConnected: null,
  lastRawPosition: null,
  lastPrintedLog: null,
  lastUpdateStatus: null,
  lastSeekDetected: 0,
  lastPauseState: null,
  pendingUpdateReason: null,
  lastBlockedLog: null,
  isFirstUpdate: true,
  lastPrintedLogs: {},
  hostMatch: false,
};

const CONSTANTS = {
  ACTIVE_INTERVAL: CONFIG?.activeInterval ?? 5000,
  NORMAL_UPDATE_INTERVAL: CONFIG?.idleInterval ?? 10000,
  SEEK_CHECK_INTERVAL: 5000,
  MIN_SEEK_COOLDOWN: 3000,
};

const keepAliveManager = new KeepAliveManager();

// Start watching tab activity changes
function startWatching() {
  if (state.isUpdating || state.updateTimer) {
    logInfo("[main] startWatching called but already active");
    return;
  }

  logInfo("%c╔═════════════════════════════════════════╗", "color:#4caf50; font-weight:bold;");
  logInfo("%c║      WEB PRESENCE STARTED WATCHING      ║", "color:#4caf50; font-weight:bold;");
  logInfo("%c╚═════════════════════════════════════════╝", "color:#4caf50; font-weight:bold;");

  state.activeTab = true;
  state.lastRawPosition = null;
  state.lastSeekDetected = 0;
  mainLoop();
}

// Stop watching tab activity changes
function stopWatching() {
  logInfo("%c╔═════════════════════════════════════════╗", "color:#ff5252; font-weight:bold;");
  logInfo("%c║      WEB PRESENCE STOPPED WATCHING      ║", "color:#ff5252; font-weight:bold;");
  logInfo("%c╚═════════════════════════════════════════╝", "color:#ff5252; font-weight:bold;");

  clearTimeout(state.updateTimer);
  state.updateTimer = null;
  state.isUpdating = false;
  state.activeTab = false;
  state.lastRawPosition = null;
  state.lastSeekDetected = 0;
  rpcState.reset();
}

// Schedule the next update based on activity
function scheduleNextUpdate(interval = CONSTANTS.ACTIVE_INTERVAL, reason = "") {
  if (!state.activeTab) {
    logInfo("[main:scheduleNextUpdate]: tab not active, skipping");
    return;
  }

  if (state.updateTimer) {
    if (!state.hostMatch === false) {
      logOnce(`[main:scheduleNextUpdate]: update timer rescheduling - reason: ${reason || "reschedule"}`, "updateTimer");
    }
    clearTimeout(state.updateTimer);
    state.updateTimer = null;
  }

  state.updateTimer = setTimeout(() => {
    state.updateTimer = null;
    if (state.activeTab) mainLoop();
  }, interval);
}

// Main loop to check for activity changes and update RPC
async function mainLoop() {
  if (state.isUpdating) return;
  state.isUpdating = true;

  let hostMatch;
  try {
    hostMatch = await waitForHostname();
    if (!hostMatch) {
      if (rpcState.lastActivity?.lastUpdated) await handleNoActivity();
      if (keepAliveManager.initialized) keepAliveManager.destroy();
      scheduleNextUpdate(CONSTANTS.ACTIVE_INTERVAL, "HOST_NOT_MATCH");
      return;
    }
    if (!keepAliveManager.initialized) keepAliveManager.init();

    const activity = await safeGetActivityInfo();
    window._lastParsedActivity = activity && activity !== "blocked" ? activity : null;

    if (!activity || activity === "blocked" || (!activity.title && !activity.artist)) {
      if (!activity) logOnce("[main]: no activity info", "RPC");
      if (rpcState.lastActivity?.lastUpdated) await handleNoActivity();
      state.lastRawPosition = null;
      return;
    }

    if (!state.lastUpdateTime) state.lastUpdateTime = Date.now();
    if (!state.lastSeekDetected) state.lastSeekDetected = Date.now();

    // Activity change detection
    const isChanged = rpcState.isActivityChanged(activity);
    if (isChanged) {
      rpcState.reset();
      state.lastRawPosition = 0;
      state.isFirstUpdate = true;
    }

    // Seed position once
    const isValidPlaybackPos = isValidNumber(activity.position) && activity.position > 0;
    if (state.lastRawPosition === null && isValidPlaybackPos) {
      state.lastRawPosition = activity.position;
    }

    // Derived state flags
    const hasValidDuration = isValidNumber(activity.duration) && activity.duration > 0;
    const hasValidPosition = isValidNumber(activity.position) && activity.position >= 0;

    const progress =
      activity.progress !== undefined ? activity.progress : hasValidDuration && hasValidPosition ? Math.min(100, (activity.position / activity.duration) * 100) : null;

    const timeSinceLastUpdate = Date.now() - (state.lastUpdateTime || Date.now());

    // Audible Check
    let audibleCheck = null;
    try {
      audibleCheck = await browser.runtime.sendMessage({ type: "IS_TAB_AUDIBLE" });
    } catch (_) {}

    const isPlayingAudio = !!activity.isPlaying;
    const isAudible = !!audibleCheck?.audible;

    // Playing Detection
    let playerPlaying;

    if (isAudible) {
      playerPlaying = true;
    } else if (activity.isPlaying !== undefined) {
      playerPlaying = activity.isPlaying;
    } else {
      playerPlaying = false;
    }

    const { isSeeking, isPaused: rawIsPaused } = rpcState.analyzePlayback(activity.position, activity.duration, playerPlaying);
    const isPaused = isAudible ? false : rawIsPaused;

    const rawPositionDiff = isValidNumber(activity.position) && isValidNumber(state.lastRawPosition) ? Math.abs(activity.position - state.lastRawPosition) : 0;
    const isRadioOrStream = !isValidNumber(activity.duration) || activity.duration <= 0;

    const seekJustDetected = isSeeking;
    if (seekJustDetected) {
      state.lastSeekDetected = Date.now();
    }

    // Update Rules
    let shouldUpdate = false;
    let updateReason = "";

    if (!rpcState.lastActivity || isChanged) {
      shouldUpdate = true;
      updateReason = isChanged ? "Activity Changed" : "First Update";
      state.pendingUpdateReason = null;
    } else {
      if (isSeeking) state.pendingUpdateReason = "Seek Detected";

      if (state.lastPauseState === null) {
        state.lastPauseState = isPaused;
      } else if (isPaused !== state.lastPauseState) {
        if (state.pendingUpdateReason !== "Seek Detected") {
          state.pendingUpdateReason = isPaused ? "Paused" : "Resumed";
        }
      }

      if (timeSinceLastUpdate >= CONSTANTS.ACTIVE_INTERVAL) {
        if (state.pendingUpdateReason) {
          shouldUpdate = true;
          updateReason = state.pendingUpdateReason;
          state.pendingUpdateReason = null;
        } else if (!isPaused && timeSinceLastUpdate > CONSTANTS.NORMAL_UPDATE_INTERVAL) {
          shouldUpdate = true;
          updateReason = "Normal Progress";
        } else if (!isPaused && rawPositionDiff > 5) {
          shouldUpdate = true;
          updateReason = "Seek Detected";
        }
      } else {
        updateReason = `Cooldown Active (${Math.ceil((CONSTANTS.ACTIVE_INTERVAL - timeSinceLastUpdate) / 1000)}s left)`;
      }
    }

    state.lastPauseState = isPaused;

    if (!playerPlaying) {
      if (rpcState.lastActivity?.lastUpdated) await handleNoActivity();
      state.lastUpdateStatus = "skipped";
      state.isUpdating = false;
      shouldUpdate = false;
    }

    if (!shouldUpdate) {
      if (state.lastUpdateStatus !== "skipped") {
        logInfo(
          `[main]: %cSkipping update:%c ${updateReason || "Normal Progress"} (Δpos: ${rawPositionDiff}s, Δtime: ${timeSinceLastUpdate / 1000}s)`,
          "color:#ff9800; font-weight:bold;",
          "color:#fff;",
        );
      }
      // Keep lastRawPosition in sync even when skipping
      if (isValidNumber(activity.position)) state.lastRawPosition = activity.position;
      state.lastUpdateStatus = "skipped";
      return;
    }

    const updatedProgress = isValidNumber(progress) ? Math.max(progress, 1) : 0;

    if (state.isConnected) {
      logInfo(`[main]: %cRPC Update triggered by:%c ${updateReason}`, "color:#4caf50; font-weight:bold;", "color:#fff;");
    }

    const didUpdate = await processRPCUpdate(activity, updatedProgress);

    if (didUpdate && isValidNumber(activity.position)) {
      state.lastRawPosition = activity.position;
      state.lastUpdateTime = state.isFirstUpdate ? Date.now() - CONSTANTS.NORMAL_UPDATE_INTERVAL : Date.now();
      state.isFirstUpdate = false;
      state.lastUpdateStatus = "updated";
    } else {
      state.lastUpdateStatus = "failed";
    }

    if (!state.isConnected) return;

    // State Log
    const lastSeekSeconds = state.lastSeekDetected ? Math.floor((Date.now() - state.lastSeekDetected) / 1000) : "Never";

    let statusLabel = "SONG";
    let statusMode = 0;
    if (activity?.mode === "watch" && isRadioOrStream) {
      statusLabel = "STREAM";
      statusMode = 1;
    } else if (activity?.mode === "watch") {
      statusLabel = "VIDEO";
    } else if (activity?.mode === "play") {
      statusLabel = "PLAYING";
    } else if (isRadioOrStream) {
      statusLabel = "RADIO";
      statusMode = 1;
    }

    const positionText = statusMode ? statusLabel : `Pos: ${activity.position} / ${activity.duration}`;
    const positionColor = statusMode ? "#e91e63" : "#6db9f8";

    const colors = {
      title: "#d8b800",
      artist: "#b99e00",
      header: "#999",
      value: "#fff",
      success: "#4caf50",
      warning: "#ff9800",
      error: "#f44336",
      info: "#2196f3",
      accent1: "#cc00f0ff",
      accent2: "#00e1ffff",
      accent3: "#ff5722",
      neutral: "#7d7d7dff",
    };

    const sections = [
      {
        title: "Current Track",
        lines: [
          [`${activity.title}`, colors.title, colors.neutral],
          [`${activity.artist}`, colors.artist, colors.neutral],
          [positionText, positionColor, colors.neutral],
          [`Δ: ${rawPositionDiff}s`, colors.accent2, colors.neutral],
          [`Δt: ${timeSinceLastUpdate / 1000}s`, colors.accent2, colors.neutral],
        ],
      },
      {
        title: "Status",
        lines: [
          [statusLabel, colors.info, colors.neutral],
          [`Paused: ${isPaused}`, isPaused ? colors.warning : colors.success, colors.neutral],
          [`Changed: ${isChanged}`, isChanged ? colors.info : colors.neutral, colors.neutral],
          [`Seeking: ${isSeeking}`, isSeeking ? colors.warning : colors.neutral, colors.neutral],
          [`Pending Action: ${state.pendingUpdateReason || "None"}`, state.pendingUpdateReason ? colors.warning : colors.neutral, colors.neutral],
        ],
      },
      {
        title: "Playback",
        lines: [
          [`Valid Duration: ${hasValidDuration}`, hasValidDuration ? colors.success : colors.error, colors.neutral],
          [`Valid Position: ${hasValidPosition}`, hasValidPosition ? colors.success : colors.error, colors.neutral],
          [`Progress: ${progress?.toFixed(2)}`, colors.accent1, colors.neutral],
          [`Has Only Duration Mode: ${rpcState.hasOnlyDuration}`, rpcState.hasOnlyDuration ? colors.info : colors.neutral],
          [`Remaining Mode: ${rpcState.isRemainingMode}`, rpcState.isRemainingMode ? colors.info : colors.neutral],
        ],
      },
      {
        title: "Seek Detection",
        lines: [
          [`Expected: ${timeSinceLastUpdate / 1000}s`, colors.accent1, colors.neutral],
          [`Actual: ${activity.position - (rpcState.lastValidPosition || 0)}s`, colors.accent1, colors.neutral],
          [`Deviation: ${Math.abs(activity.position - (rpcState.lastValidPosition || 0) - timeSinceLastUpdate / 1000)?.toFixed(3)}s`, colors.accent1, colors.neutral],
          [`Last Seek: ${lastSeekSeconds}s`, colors.neutral, colors.neutral],
        ],
      },
    ];

    // Activity Debug Log
    if (typeof pushMemoryLog === "function") {
      pushMemoryLog("info", "main", {
        // Track
        title: activity.title,
        artist: activity.artist,
        source: activity.source ?? null,
        // Playback state
        status: statusLabel,
        paused: isPaused,
        seeking: isSeeking,
        changed: isChanged,
        playing: playerPlaying,
        audible: isAudible,
        // Position
        position: isValidNumber(activity.position) ? activity.position : null,
        duration: isValidNumber(activity.duration) ? activity.duration : null,
        progress: isValidNumber(progress) ? +progress.toFixed(2) : null,
        positionDiff: +rawPositionDiff.toFixed(3),
        // Timing
        timeSinceUpdate: +(timeSinceLastUpdate / 1000).toFixed(2),
        lastSeekAgo: state.lastSeekDetected ? +((Date.now() - state.lastSeekDetected) / 1000).toFixed(1) : null,
        // Update decision
        shouldUpdate,
        updateReason: updateReason || null,
        pendingReason: state.pendingUpdateReason ?? null,
        updateStatus: state.lastUpdateStatus ?? null,
        // RPC
        connected: !!state.isConnected,
      });
    }

    const stored = await browser.storage.local.get("debugMode");
    const debugMode = stored.debugMode === 1 ? true : CONFIG.debugMode;
    if (!debugMode || state.lastUpdateStatus === "skipped") return;

    let logMessage = "";
    const styles = [];

    sections.forEach((section, sectionIndex) => {
      logMessage += `%c${section.title}%c\n`;
      styles.push(`font-weight: bold; color: ${colors.header};`, "");

      section.lines.forEach((line, lineIndex) => {
        const isLastInSection = lineIndex === section.lines.length - 1;
        const isLastSection = sectionIndex === sections.length - 1;
        const separator = isLastInSection ? (isLastSection ? "" : "\n\n") : " | ";
        logMessage += `%c${line[0]}%c${separator}`;
        styles.push(`color: ${line[1]};`, line[2] ? `color: ${line[2]};` : "");
      });
    });

    console.groupCollapsed(
      `%c[WEB-PRESENCE - INFO] [main]: %c${statusLabel}%c | %c${activity.title.substring(0, 120)}${activity.title.length > 120 ? "..." : ""}%c | %c${activity.artist.substring(0, 120)}${
        activity.artist.length > 120 ? "..." : ""
      }%c | Paused: %c${isPaused}%c | Seek: %c${isSeeking}%c | Δ: %c${rawPositionDiff}s`,
      "color:#2196f3; font-weight:bold;",
      `font-weight:bold; color:${isRadioOrStream ? "#e91e63" : "#4caf50"}`,
      "",
      `color:${colors.title}`,
      "",
      `color:${colors.artist}`,
      "",
      isPaused ? "color:#ff9800" : "color:#4caf50",
      "",
      isSeeking ? "color:#ff9800" : "color:#666",
      "",
      rawPositionDiff > (updateReason === "Normal Progress" ? 8 : 4) ? "color:#f44336" : "color:#4caf50",
    );
    console.log(logMessage, ...styles);
    console.groupEnd();
  } catch (e) {
    logError("[main]: mainLoop error:", e);
    logError("[main]: Stack trace:", e.stack);
  } finally {
    state.isUpdating = false;
    scheduleNextUpdate(CONSTANTS.ACTIVE_INTERVAL, "MAIN_LOOP");
  }
}

// Process the RPC update and handle connection

async function processRPCUpdate(activity, progress) {
  const rpcHealth = await isRpcConnected();

  if (!rpcHealth?.ok) {
    if (state.isConnected === true) {
      logInfo(rpcHealth?.reason ? `[main]: RPC health check failed: ${rpcHealth.reason}` : "[main]: 🔌 RPC CONNECTION LOST!");
    } else if (state.isConnected === null) {
      logInfo(rpcHealth?.reason ? `[main]: RPC health check failed: ${rpcHealth.reason}` : "[main]: RPC not connected");
    }

    state.isConnected = false;
    return false;
  }

  try {
    const res = await browser.runtime.sendMessage({
      type: "UPDATE_RPC",
      data: {
        ...sanitizeActivityForRPC(activity, progress),
        lastUpdated: Date.now(),
      },
    });

    if (res?.ok) {
      if (!state.isConnected) {
        logInfo("[main]: RPC CONNECTION ESTABLISHED!");
      }

      state.isConnected = true;
      rpcState.updateLastActivity(activity, progress);
      logInfo("[main]: Rich Presence Updated Successfully!");
      return true;
    }

    if (res?.waiting) {
      logInfo("[main]: RPC waiting (tab not audible yet)");
      return false;
    }

    logInfo("[main]: unexpected response state:", res?.ok !== undefined ? `ok=${res.ok}, waiting=${res.waiting}` : String(res).slice(0, 200));

    return false;
  } catch (e) {
    logError("[main]: RPC update failed:", e);
    logError("[main]: Stack trace:", e.stack);
    return false;
  }
}

// Check if RPC is connected
async function isRpcConnected() {
  try {
    return await browser.runtime.sendMessage({ type: "IS_RPC_CONNECTED" });
  } catch {
    return { ok: false };
  }
}

// Handle scenario when no activity is playing
let clearingRpc = false;

async function handleNoActivity() {
  if (clearingRpc) return;
  clearingRpc = true;

  try {
    logInfo(`[main]:%c No activity is currently playing - clearing RPC...`, "color:#ff9800; font-weight:bold;");
    await browser.runtime.sendMessage({ type: "CLEAR_RPC" });
    rpcState.reset();
    window._lastParsedActivity = null;
    logOnce("[main]: RPC cleared successfully", "RPC");
  } catch (e) {
    logError("[main:handleNoActivity]: failed to clear RPC:", e);
    rpcState.reset();
  } finally {
    clearingRpc = false;
  }
}

// Safely get activity info with error handling and caching
async function safeGetActivityInfo() {
  try {
    if (typeof window.getActivityInfo === "function") {
      return await window.getActivityInfo();
    }
    return null;
  } catch (e) {
    logError("[main:safeGetActivityInfo]:", e);
    return null;
  }
}

function logOnce(msg, group = "default") {
  const cleanMsg = typeof msg === "string" ? msg : String(msg);
  if (cleanMsg !== state.lastPrintedLogs[group]) {
    logInfo(cleanMsg);
    state.lastPrintedLogs[group] = cleanMsg;
  }
}

async function waitForHostname() {
  while (true) {
    if (typeof browser === "undefined" || !browser.runtime?.sendMessage) {
      return false;
    }

    try {
      const res = await browser.runtime.sendMessage({
        type: "IS_HOSTNAME_MATCH",
      });

      if (res?.ok) {
        state.hostMatch = res?.match !== false;
        logOnce(res?.match || "[main]: Hostname Match!", "hostmatch");
        return true;
      }

      state.hostMatch = false;
      logOnce(`${res?.error?.message || "[main]: Hostname mismatch"}`, "hostmatch");
      return false;
    } catch (e) {
      if (e?.message?.includes("Extension context invalidated")) {
        logError("[main]: waitForHostname extension context invalidated, stopping");
        return false;
      }

      logOnce(`[main]: waitForHostname error: ${String(e?.message).slice(0, 160)}`, "waitForHostname");
      await delay(CONSTANTS.ACTIVE_INTERVAL);
    }
  }
}

function isValidNumber(v) {
  return typeof v === "number" && isFinite(v);
}

function sanitizeActivityForRPC(activity, progress) {
  return {
    ...activity,
    position: isValidNumber(activity.position) ? activity.position : undefined,
    duration: isValidNumber(activity.duration) ? activity.duration : undefined,
    progress: isValidNumber(progress) ? progress : undefined,
  };
}

async function applyLocalCustomCSS() {
  const { port } = await browser.runtime.sendMessage({
    type: "GET_RPC_PORT",
  });

  const serverHref = `http://localhost:${port}/`;
  if (location.href === serverHref) {
    await applyColorSettings(0);
    await applyBackgroundSettings(0);
    await applyThemeSettings();
  }
}

// Initialize the extension
function init() {
  if (window._MUSIC_RPC_LOADED_ || window.top !== window.self) return;
  window._MUSIC_RPC_LOADED_ = true;

  logInfo("%c╔═════════════════════════════════════════════════╗", "color:#2196f3; font-weight:bold;");
  logInfo("%c║            WEB PRESENCE INITIALIZING            ║", "color:#2196f3; font-weight:bold;");
  logInfo("%c╚═════════════════════════════════════════════════╝", "color:#2196f3; font-weight:bold;");

  async function waitForParserSystem() {
    if (window.__parserSystemReady) return;
    await new Promise((resolve) => {
      window.addEventListener("parser-ready", resolve, { once: true });
      setTimeout(resolve, 8000);
    });
  }

  const start = async () => {
    await waitForParserSystem();
    registerRuntimeMessageListener();
    startWatching();
  };

  // Discord Web RPC Bridge
  if (location.origin === "https://discord.com") {
    browser.runtime.sendMessage({ type: "INJECT_BRIDGE" });
  }

  if (location.href.includes("http://localhost")) applyLocalCustomCSS();
  if (document.readyState !== "loading") start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });

  window.addEventListener("beforeunload", () => {
    if (state.lastUpdateStatus) logInfo("[main:beforeunload]: beforeunload triggered - stopping...");
    stopWatching();
  });
}

// Listen for messages from the background script
function messageHandler(message, sender, sendResponse) {
  if (message.type === "PING_FOR_DATA") {
    const cached = window._lastParsedActivity;
    const response = cached?.title && cached?.artist ? cached : null;
    sendResponse(response);
    return true;
  }

  if (message.action === "reloadPage") location.reload();

  if (location.origin === "https://discord.com" && message.type === "FORWARD_TO_MAIN") {
    window.postMessage({ type: "WEB_PRESENCE_UPDATE", detail: message.payload }, location.origin);
    return true;
  }
}

function registerRuntimeMessageListener() {
  try {
    browser.runtime.onMessage.removeListener(messageHandler);
  } catch (_) {}

  try {
    browser.runtime.onMessage.addListener(messageHandler);
  } catch (e) {
    logError("[main:registerRuntimeMessageListener]: failed to add listener:", e);
    return;
  }
}

init();
