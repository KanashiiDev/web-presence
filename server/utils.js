const fs = require("fs");

function notifyRpcStatus(isRpcConnected) {
  if (process.send) {
    process.send({ type: "RPC_STATUS", value: isRpcConnected });
  }
}

function detectElectronMode() {
  if (process.env.ELECTRON_MODE !== undefined) {
    return process.env.ELECTRON_MODE === "true";
  }
  if (process.versions.electron) {
    return true;
  }
  if (process.type === "renderer" || process.type === "browser") {
    return true;
  }
  if (process.env.APPIMAGE) {
    return true;
  }
  if (process.execPath.includes("/.mount_") || process.execPath.includes(".AppImage")) {
    return true;
  }
  try {
    if (require.main && (require.main.filename.includes("electron") || require.main.filename.includes("app.asar"))) {
      return true;
    }
  } catch (_) {
    // Continue in case of error
  }
  if (typeof window !== "undefined" && window.process && window.process.type) {
    return true;
  }
  return false;
}

function isSameActivity(a, b) {
  return a && b && a.details === b.details && a.state === b.state && a.startTimestamp === b.startTimestamp && a.endTimestamp === b.endTimestamp;
}

function isSameActivityIgnore(a, b) {
  return a && b && a.details === b.details && a.state === b.state;
}

function saveActivityTime(activity, elapsedMs, historyFilePath) {
  if (!activity || !activity.details || !activity.state || elapsedMs < 0) {
    return;
  }

  // Do not save the activity if it has been played for less than 27 seconds or more than 24 hours
  if (elapsedMs < 27000 || elapsedMs > 86400000) {
    return;
  }

  let history = [];

  if (fs.existsSync(historyFilePath)) {
    const data = fs.readFileSync(historyFilePath, "utf8");
    try {
      history = JSON.parse(data);
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }

  // Find the last record and update it
  const lastIndex = history.length - 1;
  if (lastIndex >= 0) {
    const last = history[lastIndex];
    const sameTitle = last.title === activity.details;
    const sameArtist = last.artist === activity.state;

    if (sameTitle && sameArtist) {
      // Same activity - add activity time
      history[lastIndex].total_listened_ms = (last.total_listened_ms || 0) + elapsedMs;
      try {
        fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), "utf8");
      } catch (err) {
        console.error("[HISTORY] Write failed:", err);
        return false;
      }
    }
  }
}

function mergeHistories(serverHistory = [], browserHistory = []) {
  // Combine both arrays
  const merged = [...browserHistory, ...serverHistory];
  if (merged.length === 0) return [];

  // Sort by date (oldest first, newest last)
  merged.sort((a, b) => a.date - b.date);

  // Remove duplicates and merge consecutive same activities
  const unique = [];
  const seenFull = new Set();

  for (const entry of merged) {
    // Skip invalid entries
    if (!entry || !entry.title || !entry.artist || !entry.source || !entry.date) continue;

    // Skip exact duplicates
    const fullKey = `${entry.title}_${entry.artist}_${entry.source}_${entry.date}`;
    if (seenFull.has(fullKey)) continue;

    const prev = unique[unique.length - 1];

    if (prev && prev.title === entry.title && prev.artist === entry.artist && prev.source === entry.source) {
      // Consecutive same activity → prefer the one with total_listened_ms, otherwise newer
      const prevMs = prev.total_listened_ms || 0;
      const entryMs = entry.total_listened_ms || 0;

      if (entryMs > 0 || prevMs === 0) {
        unique[unique.length - 1] = entry;
      }
    } else {
      unique.push(entry);
    }

    seenFull.add(fullKey);
  }

  return unique;
}

module.exports = {
  saveActivityTime,
  isSameActivity,
  isSameActivityIgnore,
  mergeHistories,
  notifyRpcStatus,
  detectElectronMode,
};
