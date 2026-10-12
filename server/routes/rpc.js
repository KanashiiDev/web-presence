const { Router } = require("express");
const { getCurrentTime } = require("../../shared/utils.js");
const { state, CLIENT_TIMEOUT, MAX_CLEAR_RETRIES, isAnyConnected, isBridgeConnected } = require("../rpc/state.js");
const { isSameActivity } = require("../utils.js");
const { connectRPC, scheduleReconnect } = require("../rpc/client.js");
const { buildActivity, setRpcActivity, clearRpcActivity, resetActivityState, handleListeningTimeUpdate } = require("../rpc/activity.js");

function createRpcRouter(historyFilePath) {
  const router = Router();
  const RATE_LIMIT_MS = 2000;

  // POST /update-rpc
  router.post("/update-rpc", async (req, res) => {
    const now = Date.now();

    // Rate-limit: 2s between updates
    if (state.lastUpdateAt && now - state.lastUpdateAt < RATE_LIMIT_MS) {
      return res.status(429).json({ error: "Too many updates" });
    }
    state.lastUpdateAt = now;

    try {
      const { data, clientId } = req.body ?? {};
      if (!data || typeof data !== "object") {
        return res.status(400).json({ error: "Invalid data object" });
      }

      state.lastUpdateRequest = data;
      const incomingId = String(clientId ?? "unknown");

      // Client ownership check
      if (state.lastActiveClient) {
        const ownerElapsed = now - (state.lastActiveClient.timestamp ?? 0);
        if (ownerElapsed < CLIENT_TIMEOUT && state.lastActiveClient.clientId !== incomingId) {
          // Another client is active and hasn't timed out yet
          return res.json({ success: true, message: "Another Client is Active" });
        }
      }

      // Try the Discord App connection - but if there is a bridge, continue even if it fails
      const discordConnected = await connectRPC();
      if (!discordConnected && !isBridgeConnected()) {
        return res.status(500).json({ error: "RPC connection failed" });
      }

      // This client becomes the owner (new, same, or prior owner timed out)
      state.lastActiveClient = { clientId: incomingId, timestamp: now };

      // No status -> clear activity
      if (!data.status) {
        if (discordConnected) {
          try {
            await clearRpcActivity({ maxRetries: 1, timeoutMs: 5000 });
          } catch (err) {
            console.warn("[UPDATE-RPC] Failed to clear activity:", err.message);
            state.isRpcConnected = false;
          }
        }
        resetActivityState(historyFilePath);
        state.lastActivitySeenAt = now;
        return res.json({ success: true, action: "cleared" });
      }

      const { activity, activitySettings } = buildActivity(data, now);

      state.serverSettings.showSmallIcon = Boolean(activitySettings.showFavIcon);

      if (state.serverSettings.logMediaUpdate && !isSameActivity(activity, state.currentActivity)) {
        console.log(`[RPC] Updated: ${activity.details} - ${getCurrentTime()}`);
      }

      // Listening time tracking
      handleListeningTimeUpdate(activity, historyFilePath);

      // Deduplicate identical consecutive activities
      const settingsChanged = JSON.stringify(activitySettings) !== JSON.stringify(state.lastActivitySettings || {});
      const isSame = isSameActivity(activity, state.currentActivity) && !settingsChanged;
      if (!isSame) {
        const ok = await setRpcActivity(activity);
        state.lastActivitySettings = activitySettings;
        // If the bridge is connected, consider it successful even if ok=false (Discord App may be closed)
        if (!ok && !isBridgeConnected()) {
          return res.status(503).json({ error: "RPC client not ready" });
        }
      }

      state.lastActivitySeenAt = now;
      return res.json({ success: true, action: isSame ? "unchanged" : "updated" });
    } catch (err) {
      console.error("[UPDATE-RPC] Error:", err);
      return res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  // GET /update-rpc
  router.get("/update-rpc", (_req, res) => {
    if (!state.lastUpdateRequest) {
      return res.json({ message: "No update-rpc request has been made yet." });
    }
    res.json({ ...state.lastUpdateRequest });
  });

  // POST /clear-rpc
  router.post("/clear-rpc", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "Invalid request body" });
      }
      const { clientId } = req.body;
      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId is required and must be a string" });
      }

      if (state.clearRpcInProgress) {
        return res.json({ success: false, inProgress: true, message: "Clear operation already in progress" });
      }

      state.clearRpcInProgress = true;

      try {
        const hadActivity = state.currentActivity !== null;
        resetActivityState(historyFilePath);

        let clearSuccess = false;
        const connected = await connectRPC();

        if (connected) {
          if (hadActivity || state.rpcClient?.user) {
            clearSuccess = await clearRpcActivity({ maxRetries: MAX_CLEAR_RETRIES, timeoutMs: 5000 });
            if (!clearSuccess) {
              console.error("[CLEAR-RPC] Clear failed - marking as disconnected");
              state.isRpcConnected = false;
              if (!state.isConnecting) scheduleReconnect(2000, "clear-rpc: clear failed");
            }
          } else {
            clearSuccess = true;
          }
        } else if (isBridgeConnected()) {
          // If there is a bridge, consider it successfully cleared
          clearSuccess = true;
        }

        const response = { success: true, cleared: clearSuccess, reconnected: !clearSuccess };
        state.lastClearRpcResult = response;
        return res.json(response);
      } finally {
        state.clearRpcInProgress = false;
      }
    } catch (err) {
      console.error("[CLEAR-RPC] Error:", err);
      state.clearRpcInProgress = false;
      return res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  // GET /clear-rpc
  router.get("/clear-rpc", (_req, res) => {
    if (!state.lastClearRpcResult) {
      return res.json({ message: "No clear-rpc request has been made yet." });
    }
    res.json(state.lastClearRpcResult);
  });

  // GET /activity
  router.get("/activity", (_req, res) => {
    res.json({
      activity: state.currentActivity,
      rpcConnected: isAnyConnected(),
      discordConnected: state.isRpcConnected,
      bridgeConnected: isBridgeConnected(),
      lastUpdateRequest: state.lastUpdateRequest,
    });
  });

  return router;
}

module.exports = { createRpcRouter };
