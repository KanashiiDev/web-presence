class KeepAliveManager {
  static PORT = "wp-keepalive";
  static CMD = "wp-ka:cmd";
  static EVT = "wp-ka:evt";
  static TICK_INTERVAL_MS = 1000;
  static HEARTBEAT_EVERY = 16;
  static MIN_HEARTBEAT_GAP_MS = 15000;

  constructor() {
    this.initialized = false;
    this.running = false;
    this.port = null;
    this.retry = 0;
    this.retryTimer = null;
    this.mainActive = false;
    this.ticks = 0;
    this.timer = null;
    this.lastHeartbeatAt = 0;
    this.handlers = new Set();

    this._onMainEvent = (e) => {
      this.mainActive = e.detail === "active";
    };
  }

  log = async (...args) => {
    const stored = await browser.storage.local.get("debugMode");
    const debugMode = stored.debugMode === 1 ? true : typeof CONFIG !== "undefined" ? CONFIG.debugMode : false;

    if (!debugMode) return;

    const prefix = "[WEB-PRESENCE - Keep Alive Manager]:";
    if (typeof args[0] === "string" && args[0].includes("%c")) {
      console.info(`%c${prefix}%c ${args[0]}`, "color:#2196f3; font-weight:bold;", "color:#fff;", ...args.slice(1));
    } else {
      console.info(`%c${prefix}`, "color:#2196f3; font-weight:bold;", ...args);
    }
  };

  onTick(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  init() {
    if (this.initialized || window.top !== window) return;

    this.initialized = true;
    this.running = true;

    window.addEventListener(KeepAliveManager.EVT, this._onMainEvent);

    if (this.connect()) {
      this.sendToMain("enable");
      this.startTimer();
      this.log("KeepAlive started.");
    }
  }

  destroy() {
    if (!this.initialized) return;

    this.initialized = false;
    this.running = false;

    clearTimeout(this.retryTimer);

    this.sendToMain("disable");

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    window.removeEventListener(KeepAliveManager.EVT, this._onMainEvent);

    this.port?.disconnect();
    this.port = null;
    this.handlers.clear();

    this.log("KeepAlive stopped.");
  }

  connect() {
    if (!this.initialized) return false;

    if (!browser.runtime?.id) {
      this.log("Extension runtime context invalid. Destroying manager.");
      this.destroy();
      return false;
    }

    try {
      this.log(`Connecting to background port: ${KeepAliveManager.PORT}`);
      this.port = browser.runtime.connect({ name: KeepAliveManager.PORT });
      this.retry = 0;
    } catch (err) {
      this.log("Failed to connect to background port:", err);
      this.destroy();
      return false;
    }

    this.port.onMessage.addListener((msg) => this.onBackground(msg));
    this.port.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      this.log("Background port disconnected.");
      this.port = null;
      if (!this.initialized) return;
      const delay = Math.min(1000 * 2 ** this.retry++, 30000);
      this.log(`Scheduling reconnect attempt in ${delay}ms (Attempt #${this.retry})`);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    });

    this.log("Port connected successfully.");
    this.port.postMessage({ type: "init", running: this.running });
    return true;
  }

  onBackground(msg) {
    if (msg?.type !== "ping") return;

    this.heartbeat("alarm");
    this.handlers.forEach((fn) => fn());

    try {
      this.port.postMessage({ type: "pong", mainActive: this.mainActive, t: Date.now() });
    } catch (err) {
      this.log("Failed to send pong:", err);
    }
  }

  sendToMain(cmd) {
    window.dispatchEvent(new CustomEvent(KeepAliveManager.CMD, { detail: cmd }));
  }

  checkMain(source) {
    this.sendToMain("ping");

    if (this.running && !this.mainActive) {
      this.log(`MAIN visibility override inactive (via ${source}), re-enabling.`);
      this.sendToMain("enable");
    }
  }

  heartbeat(source = "timer") {
    if (!this.port) return;
    this.checkMain(source);

    const now = Date.now();
    if (now - this.lastHeartbeatAt < KeepAliveManager.MIN_HEARTBEAT_GAP_MS) return;
    this.lastHeartbeatAt = now;

    try {
      this.port.postMessage({ type: "heartbeat", source, mainActive: this.mainActive, t: now });
    } catch (err) {
      this.log("Failed to send heartbeat message:", err);
    }
  }

  startTimer() {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.ticks++;
      if (this.ticks % KeepAliveManager.HEARTBEAT_EVERY === 0) {
        this.heartbeat("timer");
      }
      this.handlers.forEach((fn) => fn());
    }, KeepAliveManager.TICK_INTERVAL_MS);
  }
}
