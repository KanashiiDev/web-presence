const { state, reconnectState, AUTO_CLEAR_TIMEOUT, CLIENT_TIMEOUT, STUCK_TIMEOUT, RECONNECT_GRACE_MS, isBridgeConnected } = require("../rpc/state.js");
const { scheduleReconnect } = require("../rpc/client.js");
const { clearRpcActivity, resetActivityState } = require("../rpc/activity.js");

function clientLooksAlive() {
  const alive = !!(state.rpcClient && !state.rpcClient.destroyed && state.isRpcConnected);
  if (alive) state.deadSince = null;
  return alive;
}

function isReconnecting() {
  return state.isConnecting || reconnectState.isReconnecting || reconnectState.scheduled;
}

function startHealthCheckTimer(historyFilePath) {
  stopHealthCheckTimer();
  state.healthCheckInterval = setInterval(() => tick(historyFilePath), STUCK_TIMEOUT);
}

function stopHealthCheckTimer() {
  if (state.healthCheckInterval) {
    clearInterval(state.healthCheckInterval);
    state.healthCheckInterval = null;
  }
}

async function safeClear() {
  try {
    return await Promise.race([clearRpcActivity({ maxRetries: 1, timeoutMs: 4000 }), new Promise((resolve) => setTimeout(() => resolve(false), 4500))]);
  } catch {
    return false;
  }
}

// Trigger a reconnect if the client appears dead and nothing is already in progress
function maybeReconnect(reason) {
  if (clientLooksAlive()) return;

  if (isBridgeConnected()) return;

  if (state.bridgeTakeover) return;

  if (state.isConnecting || reconnectState.isReconnecting || reconnectState.scheduled) return;

  const now = Date.now();
  if (!state.deadSince) {
    state.deadSince = now;
    return;
  }

  if (now - state.deadSince >= RECONNECT_GRACE_MS) {
    state.deadSince = null;
    scheduleReconnect(2000, reason);
  }
}

async function tick(historyFilePath) {
  if (state.isShuttingDown || isReconnecting()) return;

  if (isBridgeConnected() || state.bridgeTakeover) {
    state.deadSince = null;
    return;
  }

  try {
    const now = Date.now();

    // Auto-clear stale activity - skip entirely if bridge is active
    if (state.currentActivity !== null && state.lastActivitySeenAt && now - state.lastActivitySeenAt > AUTO_CLEAR_TIMEOUT) {
      if (isBridgeConnected()) return;
      await safeClear();
      resetActivityState(historyFilePath);
      maybeReconnect("health: dead after stale clear");
      return;
    }

    // Client ownership timeout - skip entirely if bridge is active
    if (state.lastActiveClient?.timestamp && now - state.lastActiveClient.timestamp > CLIENT_TIMEOUT) {
      if (isBridgeConnected()) return;
      await safeClear();
      resetActivityState(historyFilePath);
      if (!clientLooksAlive()) {
        maybeReconnect("health: dead after timeout");
      }
      return;
    }

    // Client gone: check with the grace period
    if (!clientLooksAlive() && !state.isConnecting && !reconnectState.isReconnecting && !reconnectState.scheduled) {
      maybeReconnect("health: client dead");
      return;
    }

    if (state.rpcClient?.user?.clearActivity && !isReconnecting()) {
      const ok = await safeClear();
      if (!ok) {
        maybeReconnect("health: liveness probe failed");
      }
    }
  } catch (err) {
    console.error("[HEALTH] error:", err.message);
    if (!isReconnecting() && !state.isConnecting) scheduleReconnect(3000, "health: exception");
  }
}

module.exports = {
  startHealthCheckTimer,
  stopHealthCheckTimer,
};
