const path = require("path");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const { detectElectronMode, notifyRpcStatus } = require("./utils.js");
const IS_ELECTRON = detectElectronMode();
process.env.ELECTRON_MODE = IS_ELECTRON ? "true" : "false";

const { state, isAnyConnected, isBridgeConnected, purgeStaleBridgeClients } = require("./rpc/state.js");
const { connectRPC, destroyClient, cancelReconnect, scheduleReconnect, disconnectForBridge } = require("./rpc/client.js");
const { resetActivityState } = require("./rpc/activity.js");
const { startHealthCheckTimer, stopHealthCheckTimer } = require("./services/healthCheck.js");
const { sendReady } = require("./services/electron.js");
const wnpClient = require("./services/wnpClient.js");
const { createRpcRouter } = require("./routes/rpc.js");
const { createHistoryRouter } = require("./routes/history.js");
const { createSettingsRouter, readSettings } = require("./routes/settings.js");
const crypto = require("crypto");

// Singleton Guard
if (global.__SERVER_INSTANCE_RUNNING__) {
  console.error("[SERVER] Already running in this process!");
  process.exit(1);
}
global.__SERVER_INSTANCE_RUNNING__ = true;
process.on("exit", () => {
  global.__SERVER_INSTANCE_RUNNING__ = false;
});

// Environment
const PORT = IS_ELECTRON ? Number(process.env.PORT) || 3000 : 3000;
const settingsFilePath = process.env.SETTINGS_FILE_PATH;
const logFilePath = process.env.LOG_FILE_PATH;
const historyFilePath = process.env.HISTORY_FILE_PATH;
const settings = readSettings(settingsFilePath)?.settings?.server;

// Proxy token - generated once per server start
const PROXY_TOKEN = crypto.randomBytes(24).toString("hex");
const MAX_PROXY_RESPONSE_SIZE = 10 * 1024 * 1024;
const PROXY_REQUEST_TIMEOUT_MS = 10_000;

// Token comparison using crypto.timingSafeEqual (lengths checked first to avoid throwing)
function tokensMatch(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Verify caller is our own dashboard (exact origin match, no startsWith)
function isLocalOrigin(req) {
  const src = req.get("Origin") || req.get("Referer") || "";
  if (!src) return false;
  try {
    return new URL(src).origin === `http://localhost:${PORT}`;
  } catch {
    return false;
  }
}

// WebNowPlaying Check
const wnpAdapters = ["WNP_RAINMETER_SUPPORT", "WNP_OBS_SUPPORT"];
const wnpSupport = wnpAdapters.some((key) => settings[key]?.value === true);
const activeWnpSupports = Object.entries(settings)
  .filter(([key, val]) => wnpAdapters.includes(key) && val.value === true)
  .map(([key]) => key);

console.log("[SERVER] Starting Web Presence Server");
console.log(`[SERVER] Port: ${PORT} | Electron: ${process.env.ELECTRON_MODE} | ` + `Platform: ${process.platform} | Node: ${process.version}`);

// Express App
const app = express();
const publicPath = path.join(__dirname, "public");
const sharedPath = path.join(__dirname, "..", "shared");
const localesPath = path.join(__dirname, "..", "locales");

app.use(express.static(publicPath));
app.use("/shared", express.static(sharedPath));
app.use("/locales", express.static(localesPath));
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedPrefixes = ["http://localhost:", "http://127.0.0.1:", "chrome-extension://", "moz-extension://"];
    if (allowedPrefixes.some((prefix) => origin.startsWith(prefix))) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};
app.use(cors(corsOptions));

// DNS rebinding protection - reject requests with an unexpected Host header
app.use((req, res, next) => {
  const host = req.get("Host") || "";
  if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) {
    return res.status(400).send("Invalid Host");
  }
  next();
});
app.use("/sync-history", express.json({ limit: "50mb" }));
app.use("/delete-history-entries", express.json({ limit: "50mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ limit: "2mb", extended: true }));

// Routes
app.use("/", createRpcRouter(historyFilePath));
app.use("/", createHistoryRouter(historyFilePath, logFilePath));
app.use("/", createSettingsRouter(settingsFilePath));

app.get("/", (_req, res) => res.sendFile(path.join(publicPath, "index.html")));

app.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    rpcConnected: isAnyConnected(),
    discordConnected: state.isRpcConnected,
    bridgeConnected: isBridgeConnected(),
    bridgeClients: state.bridgeClients.size,
    reconnectScheduled: state.reconnectState?.scheduled || false,
    isConnecting: state.isConnecting,
    lastActiveClient: state.lastActiveClient
      ? {
          clientId: state.lastActiveClient.clientId,
          activeSince: new Date(state.lastActiveClient.timestamp).toISOString(),
          secondsAgo: Math.floor((Date.now() - state.lastActiveClient.timestamp) / 1000),
        }
      : null,
  }),
);

app.get("/status", (_req, res) =>
  res.json({
    status: "ok",
    rpcConnected: isAnyConnected(),
    discordConnected: state.isRpcConnected,
    bridgeConnected: isBridgeConnected(),
    electronMode: process.env.ELECTRON_MODE,
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
  }),
);

// Strip CORS headers so other origins cannot read our responses.
// The dashboard is same-origin (http://localhost:PORT), so no CORS header is needed.
function stripCors(res) {
  res.removeHeader("Access-Control-Allow-Origin");
  res.removeHeader("Access-Control-Allow-Credentials");
}

// GET /proxy-token - returns the runtime token for the same-origin dashboard
app.get("/proxy-token", (req, res) => {
  stripCors(res);
  if (!isLocalOrigin(req)) {
    return res.status(403).send("Forbidden");
  }
  res.set("Cache-Control", "no-store");
  res.json({ token: PROXY_TOKEN });
});

// GET /proxy/:token - image proxy for html2canvas (token in path, html2canvas appends ?url=)
app.get("/proxy/:token", async (req, res) => {
  stripCors(res);

  // Origin check - only our own dashboard may call this
  if (!isLocalOrigin(req)) {
    return res.status(403).send("Forbidden");
  }

  // Token check - constant-time comparison
  if (!tokensMatch(req.params.token, PROXY_TOKEN)) {
    return res.status(403).send("Forbidden");
  }

  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res.status(400).send("Missing url");
  }

  // Parse and validate the target URL
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return res.status(400).send("Invalid URL");
  }

  // Only HTTPS
  if (target.protocol !== "https:") {
    return res.status(403).send("Forbidden");
  }

  // No embedded credentials
  if (target.username || target.password) {
    return res.status(403).send("Forbidden");
  }

  // Cheap host checks - reject localhost, *.local, IPv4 literals, IPv6 literals
  const hostname = target.hostname;
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    return res.status(403).send("Forbidden");
  }
  if (/^[\d.]+$/.test(hostname)) {
    return res.status(403).send("Forbidden");
  }
  if (hostname.includes(":")) {
    // contains ":" → IPv6 literal (or bracketed form)
    return res.status(403).send("Forbidden");
  }

  // Fetch - redirect: "error" rejects any redirect, removing the need for a manual redirect loop
  let response;
  try {
    response = await fetch(target, {
      redirect: "error",
      signal: AbortSignal.timeout(PROXY_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[PROXY]", err.message);
    return res.status(502).send("Bad gateway");
  }

  if (!response.ok) {
    console.error("[PROXY] Upstream status:", response.status);
    return res.status(502).send("Bad gateway");
  }

  // Content-type check - image only, no SVG
  const contentType = response.headers.get("content-type") || "";
  if (!/^image\/(png|jpe?g|gif|webp|avif)(;|$)/i.test(contentType)) {
    return res.status(415).send("Unsupported media type");
  }

  // Size check via content-length header (early rejection)
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_PROXY_RESPONSE_SIZE) {
    return res.status(413).send("Payload too large");
  }

  // Read full body and verify actual size
  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error("[PROXY]", err.message);
    return res.status(502).send("Bad gateway");
  }

  if (buffer.length > MAX_PROXY_RESPONSE_SIZE) {
    return res.status(413).send("Payload too large");
  }

  res.set("Content-Type", contentType);
  res.set("Content-Length", String(buffer.length));
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.send(buffer);
});

// Shutdown
async function shutdown() {
  if (state.isShuttingDown) return state.shutdownPromise;
  state.isShuttingDown = true;

  state.shutdownPromise = (async () => {
    console.log("[SERVER] Shutdown initiated...");

    try {
      // Close Bridge WS
      if (state.bridgeServer) {
        state.bridgeServer.close();
        state.bridgeServer = null;
        state.bridgeClients.clear();
      }

      cancelReconnect();
      stopHealthCheckTimer();
      if (wnpSupport) wnpClient.stop();
      resetActivityState(historyFilePath);

      // Clean up RPC client
      if (state.rpcClient) {
        console.log("[SERVER] Clearing RPC activity...");
        try {
          await state.rpcClient.user?.clearActivity();
        } catch (_) {
          // Ignore during shutdown
        }

        console.log("[SERVER] Destroying RPC client...");
        await destroyClient(state.rpcClient);
        state.rpcClient = null;
        state.isConnecting = false;
        state.isRpcConnected = false;
        state.waitingForDiscord = false;
      }

      // Close HTTP server
      if (state.serverInstance) {
        console.log("[SERVER] Closing HTTP server...");

        // Close all sockets
        state.serverInstance.closeIdleConnections?.();

        await new Promise((resolve) => {
          let resolved = false;

          const safeResolve = () => {
            if (resolved) return;
            resolved = true;
            resolve();
          };

          // Try graceful close
          state.serverInstance.close((err) => {
            if (err && err.code !== "ERR_SERVER_NOT_RUNNING") {
              console.warn("HTTP close error:", err.message);
            }
            safeResolve();
          });

          // Timeout protection - prevents hanging on keep-alive connections
          setTimeout(() => {
            console.warn("HTTP close timeout, forcing exit");
            safeResolve();
          }, 5000);
        });

        state.serverInstance = null;
      }

      console.log("[SERVER] Cleanup complete");
    } catch (err) {
      console.error("[SERVER] Shutdown error:", err.message);
    } finally {
      // Send a signal to the parent process
      if (process.send) {
        try {
          process.send("shutdown-complete");
        } catch (_) {}
      }

      process.exitCode = 0;
      setImmediate(() => process.exit());
    }
  })();

  return state.shutdownPromise;
}

// Process Signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (err) => {
  console.error("[SERVER] Uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[SERVER] Unhandled rejection:", reason);
  process.exit(1);
});
process.on("exit", (code) => {
  if (code !== 0) console.log("[SERVER] Exit with code:", code);
});

if (IS_ELECTRON) {
  process.on("message", (msg) => {
    if (msg === "shutdown") {
      shutdown();
      return;
    }
    if (msg?.type === "UPDATE_SETTINGS") {
      state.serverSettings = { ...state.serverSettings, ...msg.value };
    }
  });
}

// Start Server
const HOST = "127.0.0.1";
state.serverInstance = app.listen(PORT, HOST, () => {
  console.log(`[SERVER] Running on http://${HOST}:${PORT}`);
  sendReady();

  // Bridge WebSocket - For Discord Web
  if (settings.DISCORD_WEB_SUPPORT?.value) {
    const bridgeWss = new WebSocketServer({ host: "127.0.0.1", port: settings?.DISCORD_WEB_PORT?.value || 1337 });
    state.bridgeServer = bridgeWss;

    bridgeWss.on("connection", (ws) => {
      ws.on("message", async (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch (err) {
          console.warn("[BRIDGE] Malformed message received:", err.message);
          return;
        }

        if (msg.type === "INIT_BRIDGE" && msg.origin === "https://discord.com") {
          console.log("[BRIDGE] Discord Web connected");
          state.bridgeClients.add(ws);
          notifyRpcStatus(true);

          // If Discord App RPC is active, hand control over to the bridge
          if (state.isRpcConnected || state.rpcClient) {
            console.log("[BRIDGE] RPC client active - handing off to bridge");
            await disconnectForBridge();
          }
        }
      });

      ws.on("close", () => {
        const wasRegistered = state.bridgeClients.has(ws);
        state.bridgeClients.delete(ws);
        // Purge any other stale sockets that slipped through
        purgeStaleBridgeClients();
        // Only act if this ws had been registered via INIT_BRIDGE
        if (wasRegistered && !isBridgeConnected()) {
          state.bridgeTakeover = false;
          scheduleReconnect(1000, "bridge: all clients disconnected");
          notifyRpcStatus(false);
        }
      });

      ws.on("error", (err) => {
        console.warn("[BRIDGE] Client error:", err.message);
        const wasRegistered = state.bridgeClients.has(ws);
        state.bridgeClients.delete(ws);
        purgeStaleBridgeClients();
        // Only act if this ws had been registered via INIT_BRIDGE
        if (wasRegistered && !isBridgeConnected()) {
          state.bridgeTakeover = false;
          scheduleReconnect(1000, "bridge: client error, no clients remain");
        }
      });
    });

    bridgeWss.on("error", (err) => {
      console.error("[BRIDGE] Server error:", err.message);
    });

    console.log(`[BRIDGE] Web bridge listening on ws://127.0.0.1:${settings?.DISCORD_WEB_PORT?.value || 1337}`);
  }
  connectRPC().catch(() => {});

  startHealthCheckTimer(historyFilePath);
  if (wnpSupport) wnpClient.start(activeWnpSupports);
});

state.serverInstance.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[SERVER] FATAL: Port ${PORT} already in use - another instance may be running`);
  } else {
    console.error("[SERVER] Fatal error:", err.message);
  }
  process.exit(1);
});
