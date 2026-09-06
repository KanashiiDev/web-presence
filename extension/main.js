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
};

const CONSTANTS = {
  ACTIVE_INTERVAL: CONFIG?.activeInterval ?? 5000,
  NORMAL_UPDATE_INTERVAL: CONFIG?.idleInterval ?? 10000,
  SEEK_CHECK_INTERVAL: 5000,
  MIN_SEEK_COOLDOWN: 3000,
};

const keepAliveManager = new KeepAliveManager();

// Start watching tab activity and song changes
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

// Stop watching tab activity and song changes
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
  keepAliveManager.destroy();
}

// Schedule the next update based on activity
function scheduleNextUpdate(interval = CONSTANTS.ACTIVE_INTERVAL, log) {
  if (!state.activeTab) {
    logInfo("[main:scheduleNextUpdate]: tab not active, skipping");
    return;
  }

  if (state.updateTimer) {
    logInfo("[main:scheduleNextUpdate]: clearing existing timer");
    clearTimeout(state.updateTimer);
    state.updateTimer = null;
  }

  if (!log) {
    logInfo(`[main:scheduleNextUpdate]: %cNext Update Check Scheduled:%c ${interval / 1000} seconds later.`, "color:#999; font-weight:bold;", "color:#4caf50;");
  }

  state.updateTimer = setTimeout(() => {
    state.updateTimer = null;
    if (state.activeTab) mainLoop();
  }, interval);
}

// Main loop to check for song changes and update RPC
async function mainLoop() {
  if (state.isUpdating) return;
  const hostMatch = await waitForHostname();
  if (!hostMatch) {
    scheduleNextUpdate(CONSTANTS.ACTIVE_INTERVAL, true);
    return;
  }

  try {
    const song = await safeGetSongInfo();
    window._lastParsedSong = song && song !== "blocked" ? song : null;

    if (!song || song === "blocked" || (!song.title && !song.artist)) {
      if (!song) logInfo("[main]: no song info");
      if (rpcState.lastActivity?.lastUpdated) await handleNoSong();
      state.lastRawPosition = null;
      return;
    }

    state.isUpdating = true;

    if (!state.lastUpdateTime) state.lastUpdateTime = Date.now();
    if (!state.lastSeekDetected) state.lastSeekDetected = Date.now();

    // Song change detection
    const isChanged = rpcState.isSongChanged(song);
    if (isChanged) {
      rpcState.reset();
      state.lastRawPosition = 0;
      state.isFirstUpdate = true;
    }

    // Seed position once
    const isValidPlaybackPos = isValidNumber(song.position) && song.position > 0;
    if (state.lastRawPosition === null && isValidPlaybackPos) {
      state.lastRawPosition = song.position;
    }

    // Derived state flags
    const hasValidDuration = isValidNumber(song.duration) && song.duration > 0;
    const hasValidPosition = isValidNumber(song.position) && song.position >= 0;

    const progress = song.progress !== undefined ? song.progress : hasValidDuration && hasValidPosition ? Math.min(100, (song.position / song.duration) * 100) : null;

    const timeSinceLastUpdate = Date.now() - (state.lastUpdateTime || Date.now());

    // Audible Check
    let audibleCheck = null;
    try {
      audibleCheck = await browser.runtime.sendMessage({ type: "IS_TAB_AUDIBLE" });
    } catch (_) {}

    const isPlayingAudio = !!song.isPlaying;
    const isAudible = !!audibleCheck?.audible;

    // Playing Detection
    let playerPlaying;

    if (isAudible) {
      playerPlaying = true;
    } else if (song.isPlaying !== undefined) {
      playerPlaying = song.isPlaying;
    } else {
      playerPlaying = false;
    }

    const { isSeeking, isPaused: rawIsPaused } = rpcState.analyzePlayback(song.position, song.duration, playerPlaying);
    const isPaused = isAudible ? false : rawIsPaused;

    const rawPositionDiff = isValidNumber(song.position) && isValidNumber(state.lastRawPosition) ? Math.abs(song.position - state.lastRawPosition) : 0;
    const isRadioOrStream = !isValidNumber(song.duration) || song.duration <= 0;

    const seekJustDetected = isSeeking;
    if (seekJustDetected) {
      state.lastSeekDetected = Date.now();
    }

    // Update Rules
    let shouldUpdate = false;
    let updateReason = "";

    if (!rpcState.lastActivity || isChanged) {
      shouldUpdate = true;
      updateReason = isChanged ? "Song Changed" : "First Update";
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
      if (rpcState.lastActivity?.lastUpdated) await handleNoSong();
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
      if (isValidNumber(song.position)) state.lastRawPosition = song.position;
      state.lastUpdateStatus = "skipped";
      return;
    }

    const updatedProgress = isValidNumber(progress) ? Math.max(progress, 1) : 0;

    if (state.isConnected) {
      logInfo(`[main]: %cRPC Update triggered by:%c ${updateReason}`, "color:#4caf50; font-weight:bold;", "color:#fff;");
    }

    const didUpdate = await processRPCUpdate(song, updatedProgress);

    if (didUpdate && isValidNumber(song.position)) {
      state.lastRawPosition = song.position;
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
    if (song?.mode === "watch" && isRadioOrStream) {
      statusLabel = "STREAM";
      statusMode = 1;
    } else if (song?.mode === "watch") {
      statusLabel = "VIDEO";
    } else if (isRadioOrStream) {
      statusLabel = "RADIO";
      statusMode = 1;
    }

    const positionText = statusMode ? statusLabel : `Pos: ${song.position} / ${song.duration}`;
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
          [`${song.title}`, colors.title, colors.neutral],
          [`${song.artist}`, colors.artist, colors.neutral],
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
          [`Actual: ${song.position - (rpcState.lastValidPosition || 0)}s`, colors.accent1, colors.neutral],
          [`Deviation: ${Math.abs(song.position - (rpcState.lastValidPosition || 0) - timeSinceLastUpdate / 1000)?.toFixed(3)}s`, colors.accent1, colors.neutral],
          [`Last Seek: ${lastSeekSeconds}s`, colors.neutral, colors.neutral],
        ],
      },
    ];

    // Activity Debug Log
    if (typeof pushMemoryLog === "function") {
      pushMemoryLog("info", "main", {
        // Track
        title: song.title,
        artist: song.artist,
        source: song.source ?? null,
        // Playback state
        status: statusLabel,
        paused: isPaused,
        seeking: isSeeking,
        changed: isChanged,
        playing: playerPlaying,
        audible: isAudible,
        // Position
        position: isValidNumber(song.position) ? song.position : null,
        duration: isValidNumber(song.duration) ? song.duration : null,
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
      `%c[WEB-PRESENCE - INFO] [main]: %c${statusLabel}%c | %c${song.title.substring(0, 120)}${song.title.length > 120 ? "..." : ""}%c | %c${song.artist.substring(0, 120)}${
        song.artist.length > 120 ? "..." : ""
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
    scheduleNextUpdate(CONSTANTS.ACTIVE_INTERVAL, hostMatch);
  }
}

// Process the RPC update and handle connection
async function processRPCUpdate(song, progress) {
  const rpcHealth = await isRpcConnected();

  // Skip health check dependency if running in web-only mode
  if (rpcHealth?.mode !== "web-only" && !rpcHealth?.ok) {
    if (state.isConnected) {
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
        ...sanitizeSongForRPC(song, progress),
        lastUpdated: Date.now(),
      },
    });

    if (res?.ok) {
      if (!state.isConnected) {
        logInfo("[main]: RPC CONNECTION ESTABLISHED!");
      }
      state.isConnected = true;

      if (!keepAliveManager.initialized) {
        keepAliveManager.init();
      }
      rpcState.updateLastActivity(song, progress);
      logInfo("[main]: Rich Presence Updated Successfully!");
      return true;
    } else if (res?.waiting) {
      logInfo("[main]: RPC waiting (tab not audible yet)");
      if (keepAliveManager.initialized) keepAliveManager.destroy();
      return false;
    } else {
      logInfo("[main]: unexpected response state:", res);
      if (keepAliveManager.initialized) keepAliveManager.destroy();
      return false;
    }
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

// Handle scenario when no song is playing
let clearingRpc = false;

async function handleNoSong() {
  if (clearingRpc) return;
  clearingRpc = true;

  try {
    logInfo(`[main]:%c No song is currently playing - clearing RPC...`, "color:#ff9800; font-weight:bold;");
    await browser.runtime.sendMessage({ type: "CLEAR_RPC" });
    rpcState.reset();
    keepAliveManager.destroy();
    window._lastParsedSong = null;
    logInfo("[main]: RPC cleared successfully");
  } catch (e) {
    logError("[main:handleNoSong]: failed to clear RPC:", e);
    rpcState.reset();
    keepAliveManager.destroy();
  } finally {
    clearingRpc = false;
  }
}

// Safely get song info with error handling and caching
async function safeGetSongInfo() {
  try {
    if (typeof window.getSongInfo === "function") {
      return await window.getSongInfo();
    }
    return null;
  } catch (e) {
    logError("[main:safeGetSongInfo]:", e);
    return null;
  }
}

function logOnce(msg) {
  if (msg !== state.lastPrintedLog) {
    logInfo(msg);
    state.lastPrintedLog = msg;
  }
}

async function waitForHostname() {
  while (true) {
    try {
      const res = await browser.runtime.sendMessage({
        type: "IS_HOSTNAME_MATCH",
      });
      if (res?.ok) {
        logOnce(res?.match || "[main]: Hostname Match!");
        return true;
      }
      logOnce(`${res?.error?.message || "[main]: Hostname mismatch"}`);
      return false;
    } catch (e) {
      logError("[main]: waitForHostname error:", e);
      await delay(CONSTANTS.ACTIVE_INTERVAL);
    }
  }
}

function isValidNumber(v) {
  return typeof v === "number" && isFinite(v);
}

function sanitizeSongForRPC(song, progress) {
  return {
    ...song,
    position: isValidNumber(song.position) ? song.position : undefined,
    duration: isValidNumber(song.duration) ? song.duration : undefined,
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
      setTimeout(resolve, 10000);
    });
  }

  const start = async () => {
    await waitForParserSystem();

    if (typeof window.getSongInfo !== "function") {
      logError("[main:init]: getSongInfo not available, aborting");
      return;
    }

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
    const cached = window._lastParsedSong;
    const response = cached?.title && cached?.artist ? cached : null;
    sendResponse(response);
    return true;
  }

  if (message.type === "RESTART_LOOP") {
    state.lastUpdateTime = 0;
    scheduleNextUpdate(CONSTANTS.ACTIVE_INTERVAL, true);
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
