const { Client } = require("@xhayper/discord-rpc");
const { notifyRpcStatus } = require("../utils.js");
const { state, reconnectState, CLIENT_ID, RETRY_DELAY, isBridgeConnected } = require("./state.js");

// Returns true only when the RPC client is fully operational.
function isRpcReady(client) {
  return !!(state.isRpcConnected && client?.user && !client.destroyed);
}

// Error logging - deduplicate consecutive identical messages
let _lastLoggedError = null;
function shouldLogError(msg) {
  if (_lastLoggedError === msg) return false;
  _lastLoggedError = msg;
  return true;
}

// Destroy client with a hard timeout
async function destroyClient(client) {
  if (!client) return;
  client.removeAllListeners();
  try {
    await Promise.race([client.destroy(), new Promise((_, reject) => setTimeout(() => reject(new Error("Destroy timeout")), 5000))]);
  } catch (err) {
    console.warn("[RPC] destroy error:", err.message);
  }
  if (state.rpcClient === client) state.rpcClient = null;
}

// Full state reset + destroy old client
async function hardResetClient() {
  const old = state.rpcClient;
  state.rpcClient = null;
  state.isRpcConnected = false;
  state.connectPromise = null;
  await destroyClient(old);
}

async function hardReset() {
  await hardResetClient();
  state.isConnecting = false;
}

// Execute a single reconnect attempt
async function executeReconnect() {
  if (state.isConnecting || state.isShuttingDown) return false;

  // If the bridge is connected, skip reconnecting to Discord App
  if (isBridgeConnected()) {
    console.log("[RPC] Skip reconnect - bridge is active");
    return false;
  }

  reconnectState.begin();
  try {
    await hardReset();

    // Re-check after hardReset - bridge may have connected while we were resetting
    if (isBridgeConnected()) {
      console.log("[RPC] Skip reconnect after reset - bridge became active");
      return false;
    }

    const ok = await connectRPC();

    // Bridge may have connected while connectRPC() was running
    if (!ok && isBridgeConnected()) {
      console.log("[RPC] Skip reconnect - bridge became active during connect");
      return false;
    }

    if (!ok) throw new Error("Discord not reachable");
    return true;
  } catch (err) {
    console.error("[RPC] Reconnect failed:", err.message);
    return false;
  } finally {
    reconnectState.end();
    reconnectState.complete();
  }
}

// Schedule a debounced reconnect
function scheduleReconnect(delay = 3000, reason = "unknown") {
  if (state.isShuttingDown) return;
  if (state.bridgeTakeover) {
    console.log(`[RPC] Skip schedule - bridge takeover active (${reason})`);
    return;
  }

  // If the bridge is connected, do not enter the reconnect loop
  if (isBridgeConnected()) {
    console.log(`[RPC] Skip schedule - bridge is active (${reason})`);
    return;
  }

  if (state.isConnecting) {
    console.log(`[RPC] Skip schedule - already connecting (${reason})`);
    return;
  }
  if (reconnectState.isReconnecting) {
    console.log(`[RPC] Skip schedule - already reconnecting (${reason})`);
    return;
  }

  // Use reconnectState.start() so canReconnect() + minReconnectInterval are enforced
  if (!reconnectState.start(reason)) {
    console.log(`[RPC] Skip schedule - canReconnect check failed (${reason})`);
    return;
  }

  console.log(`[RPC] Schedule reconnect in ${delay}ms (${reason})`);

  reconnectState.timer = setTimeout(async () => {
    reconnectState.timer = null;
    reconnectState.scheduled = false;
    await executeReconnect();
  }, delay);
}

// Cancel any pending reconnect
function cancelReconnect() {
  if (reconnectState.timer) {
    clearTimeout(reconnectState.timer);
    reconnectState.timer = null;
  }
  reconnectState.scheduled = false;
  reconnectState.isReconnecting = false;
  reconnectState.reason = null;
}

// Wire up client lifecycle events for a given epoch
function setupClientEvents(client, epoch) {
  client.setMaxListeners(20);
  let hadReady = false;

  client.once("ready", () => {
    if (epoch !== state.connectionEpoch) return;
    hadReady = true;
    state.isRpcConnected = true;
    state.isConnecting = false;
    cancelReconnect();
    notifyRpcStatus(true);
    console.log("[RPC] Connected successfully");
  });

  const handleDisconnect = (reason) => {
    if (epoch !== state.connectionEpoch) return;
    if (!hadReady) return;
    state.isRpcConnected = false;
    state.isConnecting = false;
    notifyRpcStatus(false);
    if (!state.isShuttingDown) scheduleReconnect(3000, reason);
  };

  client.on("disconnected", () => handleDisconnect("disconnected"));
  client.on("close", () => handleDisconnect("close"));

  client.on("error", (err) => {
    if (epoch !== state.connectionEpoch) return;
    if (!hadReady) return;
    state.isRpcConnected = false;

    const isFatal =
      err.message?.includes("ENOENT") ||
      err.message?.includes("ECONNRESET") ||
      err.message?.includes("EPIPE") ||
      err.message?.includes("ECONNREFUSED") ||
      err.message?.includes("socket");

    if (isFatal && !state.isShuttingDown) scheduleReconnect(3000, "fatal error");
  });
}

async function createClient(epoch) {
  await hardResetClient();
  const client = new Client({ clientId: CLIENT_ID, useSteam: false, reconnect: false });
  state.rpcClient = client;
  setupClientEvents(client, epoch);
  return client;
}

// Hands control over to the Discord Web bridge.
async function disconnectForBridge() {
  cancelReconnect();
  const old = state.rpcClient;
  state.rpcClient = null;
  state.isRpcConnected = false;
  state.isConnecting = false;
  state.connectPromise = null;
  state.connectionEpoch++;
  state.bridgeTakeover = true;
  await destroyClient(old);
  console.log("[RPC] Disconnected - bridge took over");
}

// Connects the RPC client. Retries indefinitely until shutdown.
async function connectRPC() {
  // If the Bridge is connected, there is no need for the Discord App connection
  if (isBridgeConnected()) return false;

  if (state.isRpcConnected && isRpcReady(state.rpcClient)) return true;
  if (state.isConnecting) return false;
  state.connectPromise ??= _connect();
  try {
    return await state.connectPromise;
  } finally {
    state.connectPromise = null;
  }
}

// Internal retry loop
async function _connect() {
  if (state.isConnecting) return false;
  if (state.bridgeTakeover) return false;

  state.isConnecting = true;
  state.connectionEpoch++;
  const currentEpoch = state.connectionEpoch;
  let attempt = 0;

  while (!state.isShuttingDown) {
    // If the bridge is connected, stop the Discord App loop
    if (isBridgeConnected() || state.bridgeTakeover) {
      state.isConnecting = false;
      return false;
    }

    attempt++;
    if (currentEpoch !== state.connectionEpoch) return false;

    try {
      const client = await createClient(currentEpoch);
      if (currentEpoch !== state.connectionEpoch) return false;

      if (attempt === 1) {
        console.log(state.waitingForDiscord ? "[RPC] Waiting for Discord..." : "[RPC] Connecting to Discord...");
      }

      if (!state.waitingForDiscord) state.waitingForDiscord = true;

      await Promise.race([client.login(), new Promise((_, reject) => setTimeout(() => reject(new Error("Login timeout")), RETRY_DELAY))]);

      if (currentEpoch !== state.connectionEpoch) return false;

      // Brief settle delay to let the "ready" event fire
      await new Promise((r) => setTimeout(r, 200));

      if (client !== state.rpcClient) throw new Error("Stale client");

      state.isRpcConnected = true;
      return true;
    } catch (err) {
      state.isRpcConnected = false;
      await hardResetClient();

      if (shouldLogError(err.message)) {
        console.error("[RPC] Connect fail:", err.message);
        if (err.message?.includes("ENOENT")) {
          console.error("[RPC] Discord IPC socket not found - is Discord running?");
        } else if (err.message?.includes("ECONNREFUSED")) {
          console.error("[RPC] Discord refused connection - try restarting Discord");
        } else if (err.message?.includes("timed out")) {
          console.error("[RPC] Login timed out - Discord may be busy");
        }
      }

      if (state.isShuttingDown) break;
      if (currentEpoch !== state.connectionEpoch) return false;

      await new Promise((r) => setTimeout(r, RETRY_DELAY));
    }
  }

  return false;
}

module.exports = {
  isRpcReady,
  createClient,
  connectRPC,
  scheduleReconnect,
  cancelReconnect,
  destroyClient,
  executeReconnect,
  disconnectForBridge,
};
