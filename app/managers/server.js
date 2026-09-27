const { fork } = require("child_process");
const fs = require("fs");
const { state } = require("../state");
const ConfigManager = require("../scripts/configManagement");
const { log, logStartupTimeout } = require("../scripts/electron-log");
const { logToFile, getServerPath, getLogFilePath, getHistoryFilePath, getDbPath, getConfig, getUserDataPath } = require("../utils");
const updateTrayMenu = () => require("./tray").updateTrayMenu();
const { shell } = require("electron");

// Start
async function startServer() {
  const config = getConfig();

  if (state.serverProcess) {
    log.warn("Found existing server process reference, cleaning up...");
    try {
      state.serverProcess.kill(0);
      log.warn("Existing process is still alive, killing it...");
      state.serverProcess.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 1000));
    } catch (_) {}
    state.serverProcess = null;
  }

  if (state.restartAttempts >= config.MAX_RESTART_ATTEMPTS) {
    log.error("Max restart attempts reached. Please check server configuration.");
    return Promise.reject(new Error("Max restart attempts reached"));
  }

  const serverPath = getServerPath("server.js");
  if (!fs.existsSync(serverPath)) {
    log.error(`Server file not found: ${serverPath}`);
    return Promise.reject(new Error("Server file not found"));
  }

  try {
    if (!config.KEEP_LOGS) fs.writeFileSync(getLogFilePath(), JSON.stringify([], null, 2));
    if (!config.KEEP_HISTORY) fs.writeFileSync(getHistoryFilePath(), JSON.stringify([], null, 2));
  } catch (err) {
    log.warn("Failed to reset log files:", err.message);
  }

  ConfigManager.refreshConfig();
  log.info(`Starting server (attempt ${state.restartAttempts + 1}/${config.MAX_RESTART_ATTEMPTS}) at: ${serverPath}`);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeoutIds = new Set();
    let settled = false;

    const clearAll = () => {
      timeoutIds.forEach(clearTimeout);
      timeoutIds.clear();
      const p = state.serverProcess;
      p?.removeAllListeners("error");
      p?.removeAllListeners("exit");
      p?.removeAllListeners("disconnect");
    };

    const handleSuccess = () => {
      if (settled) return;
      settled = true;
      clearAll();
      state.isServerRunning = true;
      state.serverStartTime = Date.now();
      state.restartAttempts = 0;
      updateTrayMenu();
      updateServerSettings();
      log.info(`Server ready in ${Date.now() - startTime}ms (PID: ${state.serverProcess?.pid})`);
      resolve();
    };

    const handleFailure = (error) => {
      if (settled) return;
      settled = true;
      clearAll();
      if (state.serverProcess?.killed === false) {
        try {
          state.serverProcess.kill("SIGKILL");
        } catch (_) {}
      }
      state.serverProcess = null;
      state.isServerRunning = false;
      log.error(`Server start failed: ${error.message}`);
      reject(error);
    };

    try {
      state.serverProcess = fork(serverPath, [], {
        env: {
          ...process.env,
          PORT: config.PORT,
          NODE_ENV: "production",
          LOG_LEVEL: log.transports.file?.level ?? "debug",
          USERDATA_PATH: getUserDataPath(),
          LOG_FILE_PATH: getLogFilePath(),
          HISTORY_FILE_PATH: getHistoryFilePath(),
          SETTINGS_FILE_PATH: getDbPath(),
          UV_THREADPOOL_SIZE: "4",
          NODE_NO_WARNINGS: "1",
          NODE_DISABLE_COLORS: "1",
        },
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        silent: false,
        detached: false,
        execArgv: ["--optimize-for-size", "--max-old-space-size=256", "--no-warnings"],
      });
      state.serverPid = state.serverProcess.pid;
      state.serverSpawnTime = Date.now();
    } catch (err) {
      log.error("Failed to fork server process:", err);
      return handleFailure(err);
    }

    log.info(`Server process started (PID: ${state.serverProcess.pid})`);

    const readyTimeout = setTimeout(() => {
      const elapsed = Date.now() - startTime;
      log.error(`Server startup timeout after ${elapsed}ms`);
      try {
        logStartupTimeout({ elapsed, serverPath, pid: state.serverProcess?.pid, env: { PORT: config.PORT }, memory: process.memoryUsage(), uptime: process.uptime() });
      } catch (_) {}
      handleFailure(new Error(`Server startup timeout after ${elapsed}ms`));
    }, config.START_TIMEOUT);
    timeoutIds.add(readyTimeout);

    const startupTimeout = setTimeout(() => {
      if (!state.serverProcess || state.serverProcess.killed) {
        handleFailure(new Error("Server process died during startup"));
      }
    }, 5000);
    timeoutIds.add(startupTimeout);

    state.serverProcess.on("message", (msg) => {
      if (msg === "ready") {
        handleSuccess();
      } else if (msg?.type === "OPEN_PATH") {
        shell.openPath(msg.path).then((error) => {
          if (error && process.platform === "linux") {
            require("child_process").exec(`xdg-open "${msg.path}"`);
          } else if (error) {
            log.error("[OPEN_PATH] Failed to open path:", error);
          }
        });
      } else if (msg?.type === "RPC_STATUS") {
        state.isRpcConnected = msg.value;
        updateTrayMenu();
      } else if (msg === "RESTART_SERVER") {
        log.info("Server requested restart");
        restartServer().catch((err) => log.error("Server-requested restart failed:", err));
      } else if (msg === "RESET_CONFIG") {
        ConfigManager.resetConfig();
      }
    });

    const readline = require("readline");

    const rlOut = readline.createInterface({ input: state.serverProcess.stdout, crlfDelay: Infinity });
    rlOut.on("line", (line) => {
      if (!line.trim()) return;
      const output = line.trim();
      log.info("SERVER:", output);
      if (output.includes("EADDRINUSE")) {
        log.error(`Port ${config.PORT} is already in use!`);
        handleFailure(new Error(`Port ${config.PORT} already in use`));
      } else if (output.includes("ECONNREFUSED")) {
        log.warn("RPC connection refused - Discord may not be running");
      }
      logToFile({ message: output, stack: null }, "info");
    });

    const rlErr = readline.createInterface({ input: state.serverProcess.stderr, crlfDelay: Infinity });
    rlErr.on("line", (line) => {
      if (!line.trim()) return;
      const error = line.trim();
      log.error("SERVER ERROR:", error);
      logToFile(error, "error");
      if (error.includes("FATAL") || error.includes("Cannot find module")) {
        handleFailure(new Error(error));
      }
    });

    state.serverProcess.on("error", (err) => {
      log.error("Server process error:", err);
      logToFile(err.stack ?? err.message, "error");
      if (err.code === "ENOENT") log.error("Node.js executable not found!");
      handleFailure(err);
    });

    state.serverProcess.on("exit", (code, signal) => {
      log.info(`Server process exited (code=${code}, signal=${signal})`);
      clearAll();
      state.isServerRunning = false;
      updateTrayMenu();
      if (!signal && !state.isStopping && !settled) {
        log.warn(`Server exited unexpectedly with code ${code}`);
        if (code === 1) {
          handleFailure(new Error("Server failed to start (exit code 1)"));
        } else if (code !== 0) {
          scheduleServerRestart();
        }
      }
      state.serverProcess = null;
    });

    state.serverProcess.on("disconnect", () => log.warn("Server process disconnected"));
  });
}

// Stop
async function stopServer() {
  const config = getConfig();

  if (!state.serverProcess) {
    log.info("No server process to stop.");
    return;
  }
  if (state.isStopping) {
    log.info("Stop already in progress...");
    return state.isStoppingPromise;
  }

  log.info("Stopping server...");
  state.isStopping = true;

  state.isStoppingPromise = new Promise((resolve) => {
    const proc = state.serverProcess;
    const timeoutIds = new Set();
    let resolved = false;

    const safeResolve = () => {
      if (resolved) return;
      resolved = true;
      timeoutIds.forEach(clearTimeout);
      timeoutIds.clear();
      state.serverProcess = null;
      state.isServerRunning = false;
      state.isStopping = false;
      updateTrayMenu();
      const t = setTimeout(() => {
        log.info("Server stopped");
        resolve();
      }, 1000);
      timeoutIds.add(t);
    };

    proc.once("exit", (code, signal) => {
      log.info(`Server process exited (code=${code}, signal=${signal}).`);
      safeResolve();
    });

    try {
      if (!proc.killed) {
        proc.send("shutdown");
      }
    } catch (err) {
      log.warn("Could not send shutdown message:", err.message);
    }

    const gracefulTimeout = setTimeout(() => {
      if (resolved) return;
      log.warn("Graceful shutdown timeout - checking if process still exists...");
      try {
        if (proc?.killed === false && proc.pid === state.serverPid) {
          try {
            proc.kill(0);
            log.warn("Process still alive, sending SIGTERM...");
            proc.kill("SIGTERM");
          } catch (err) {
            log.warn("SIGTERM failed:", err.message);
          }

          const sigTermTimeout = setTimeout(() => {
            if (resolved) return;
            try {
              if (proc?.killed === false && proc.pid === state.serverPid) {
                proc.kill(0);
                log.warn("Process still alive after SIGTERM, forcing SIGKILL...");
                proc.kill("SIGKILL");
              }
            } catch (err) {
              log.warn("Final kill check failed:", err.message);
            }
            safeResolve();
          }, 2000);
          timeoutIds.add(sigTermTimeout);
        } else {
          safeResolve();
        }
      } catch (err) {
        log.warn("Error during process termination:", err.message);
        safeResolve();
      }
    }, config.START_TIMEOUT / 2);
    timeoutIds.add(gracefulTimeout);
  });

  return state.isStoppingPromise;
}

// Restart
async function restartServer() {
  const config = getConfig();

  if (state.isRestarting) {
    log.info("Restart already in progress, waiting...");
    return state.isRestartingPromise ?? Promise.reject(new Error("Restart in progress"));
  }

  state.isRestarting = true;

  state.isRestartingPromise = (async () => {
    const t0 = Date.now();
    let restartTimeout;

    try {
      if (state.restartAttempts >= config.MAX_RESTART_ATTEMPTS) {
        throw new Error(`Max restart attempts (${config.MAX_RESTART_ATTEMPTS}) reached. Manual intervention required.`);
      }

      log.info(`Restarting server... (attempt ${state.restartAttempts + 1}/${config.MAX_RESTART_ATTEMPTS})`);

      const timeoutPromise = new Promise((_, reject) => {
        restartTimeout = setTimeout(() => reject(new Error(`Restart timed out after ${Date.now() - t0}ms`)), config.START_TIMEOUT * 2);
      });

      await Promise.race([
        (async () => {
          try {
            await stopServer();
            log.info("Server stopped successfully");
          } catch (stopErr) {
            log.error("Stop server failed during restart:", stopErr);
            if (state.serverProcess?.killed === false) {
              try {
                state.serverProcess.kill("SIGKILL");
              } catch (_) {}
            }
            state.serverProcess = null;
            throw new Error(`Stop failed: ${stopErr.message}`);
          }

          log.info("Waiting for port to be released...");
          await new Promise((r) => setTimeout(r, 2000));

          try {
            await startServer();
            log.info(`Server restarted successfully in ${Date.now() - t0}ms`);
          } catch (startErr) {
            log.error("Start server failed during restart:", startErr);
            if (state.restartAttempts < config.MAX_RESTART_ATTEMPTS) scheduleServerRestart();
            throw new Error(`Start failed: ${startErr.message}`);
          }
        })(),
        timeoutPromise,
      ]);
    } catch (err) {
      log.error("Restart failed:", err);
      state.isServerRunning = false;
      updateTrayMenu();
      throw err;
    } finally {
      clearTimeout(restartTimeout);
      const duration = Date.now() - t0;
      if (duration < 1000) {
        log.warn(`Restart completed very quickly (${duration}ms), adding cooldown...`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      state.isRestarting = false;
      state.isRestartingPromise = null;
    }
  })();

  return state.isRestartingPromise;
}

// Scheduled Restart
function scheduleServerRestart() {
  const config = getConfig();
  if (state.restartAttempts >= config.MAX_RESTART_ATTEMPTS) {
    log.error("Max restart attempts reached. Manual intervention required.");
    return;
  }
  clearTimeout(state.scheduledRestartTimer);
  if (state.serverProcess?.killed === false) {
    log.info("Cleaning up existing server process before restart");
    stopServer().finally(scheduleActualRestart);
  } else {
    scheduleActualRestart();
  }
}

function scheduleActualRestart() {
  const config = getConfig();
  if (state.restartAttempts >= config.MAX_RESTART_ATTEMPTS) {
    log.error("Max restart attempts reached. Manual intervention required.");
    return;
  }
  state.restartAttempts++;
  const delay = Math.min(config.RESTART_DELAY * Math.pow(1.5, state.restartAttempts - 1), 30_000);
  log.info(`Scheduling server restart in ${delay / 1000}s (attempt ${state.restartAttempts}/${config.MAX_RESTART_ATTEMPTS})`);
  state.scheduledRestartTimer = setTimeout(() => {
    log.info(`Executing scheduled restart (attempt ${state.restartAttempts})...`);
    restartServer().catch((err) => log.error("Scheduled restart failed:", err));
  }, delay);
}

// Settings Sync
function updateServerSettings() {
  const config = getConfig();
  state.serverProcess?.send({ type: "UPDATE_SETTINGS", value: { logMediaUpdate: config.LOG_MEDIA_UPDATE } });
}

module.exports = { startServer, stopServer, restartServer, scheduleServerRestart, updateServerSettings };
