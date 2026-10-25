const CLIENT_ID = "1366752683628957767";
const RETRY_DELAY = 10000;
const CLIENT_TIMEOUT = 30000;
const AUTO_CLEAR_TIMEOUT = 28000;
const RECONNECT_GRACE_MS = 20000;
const STUCK_TIMEOUT = 18000;
const MAX_CLEAR_RETRIES = 3;

// State for reconnect management
const reconnectState = {
  isReconnecting: false,
  scheduled: false,
  timer: null,
  lastReconnectAt: 0,
  minReconnectInterval: 7000,
  reason: null,

  // Cancel the timer
  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduled = false;
    this.isReconnecting = false;
    this.reason = null;
  },

  // Check if reconnection can be done
  canReconnect() {
    if (this.isReconnecting || this.scheduled) return false;
    return !this.lastReconnectAt || Date.now() - this.lastReconnectAt >= this.minReconnectInterval;
  },

  // Restart reconnecting
  start(reason) {
    if (!this.canReconnect()) return false;

    this.scheduled = true;
    this.reason = reason;
    console.log(`[RPC] Scheduling reconnect: ${reason}`);
    return true;
  },

  // Complete reconnecting
  complete() {
    this.cancel();
    this.lastReconnectAt = Date.now();
  },

  // Reconnecting started
  begin() {
    this.isReconnecting = true;
    this.scheduled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  // Reconnection finished
  end() {
    this.isReconnecting = false;
  },
};

const state = {
  rpcClient: null,
  isRpcConnected: false,
  isConnecting: false,
  connectPromise: null,
  isShuttingDown: false,
  shutdownPromise: null,
  clearRpcInProgress: false,
  connectionEpoch: 0,
  waitingForDiscord: false,
  currentActivity: null,
  lastActiveClient: null,
  lastUpdateAt: null,
  lastActivitySeenAt: null,
  healthCheckInterval: null,
  lastSavedHistoryEntry: null,
  lastActivitySettings: null,
  activityStartTime: null,
  serverInstance: null,
  lastUpdateRequest: null,
  lastClearRpcResult: null,
  serverSettings: {
    showSmallIcon: false,
    logMediaUpdate: false,
  },
  bridgeClients: new Set(),
  bridgeServer: null,
  bridgeHeartbeat: null,
  deadSince: null,
  bridgeTakeover: false, // true while bridge is active owner; blocks RPC reconnect loop
};

function isBridgeConnected() {
  for (const ws of state.bridgeClients) {
    if (ws.readyState === 1) return true;
  }
  return false;
}

function purgeStaleBridgeClients() {
  for (const ws of state.bridgeClients) {
    if (ws.readyState !== 1) {
      state.bridgeClients.delete(ws);
    }
  }
}

function isAnyConnected() {
  return state.isRpcConnected || isBridgeConnected();
}

module.exports = {
  state,
  reconnectState,
  CLIENT_ID,
  RETRY_DELAY,
  CLIENT_TIMEOUT,
  AUTO_CLEAR_TIMEOUT,
  STUCK_TIMEOUT,
  MAX_CLEAR_RETRIES,
  RECONNECT_GRACE_MS,
  isBridgeConnected,
  isAnyConnected,
  purgeStaleBridgeClients,
};
