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
  if (state.isShuttingDown) return;

  try {
    const now = Date.now();

    // Auto-clear stale activity - runs regardless of bridge state
    if (state.currentActivity !== null && state.lastActivitySeenAt && now - state.lastActivitySeenAt > AUTO_CLEAR_TIMEOUT) {
      await safeClear();
      resetActivityState(historyFilePath);
      if (!clientLooksAlive()) {
        maybeReconnect("health: dead after stale clear");
      }
      return;
    }

    // Client ownership timeout - runs regardless of bridge state
    if (state.lastActiveClient?.timestamp && now - state.lastActiveClient.timestamp > CLIENT_TIMEOUT) {
      await safeClear();
      resetActivityState(historyFilePath);
      state.lastActiveClient = null;
      if (!clientLooksAlive()) {
        maybeReconnect("health: dead after timeout");
      }
      return;
    }

    // Bridge-connected: no need for dead-client reconnect logic (bridge handles Discord connectivity)
    if (isBridgeConnected() || state.bridgeTakeover) {
      state.deadSince = null;
      return;
    }

    // Only schedule a reconnect when not already in progress and client is dead
    if (!isReconnecting() && !clientLooksAlive()) {
      maybeReconnect("health: client dead");
      return;
    }
  } catch (err) {
    console.error("[HEALTH] error:", err.message);
    if (!isReconnecting()) scheduleReconnect(3000, "health: exception");
  }
}

module.exports = {
  startHealthCheckTimer,
  stopHealthCheckTimer,
};
