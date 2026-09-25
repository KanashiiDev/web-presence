class KeepAliveManager {
  constructor() {
    this.initialized = false;
    this.intervals = [];
    this.oscillators = [];
    this.visibilityOverride = null;
    this.originalVisibility = {};
    this.visibilityHandlers = {};
    this.wakeLock = null;
    this.audioContext = null;
    this.videoElement = null;
    this.peerConnection = null;
    this.dataChannel = null;
    this.rafId = null;
    this.broadcastChannel = null;
    this._db = null;
  }

  log = async (...args) => {
    const stored = await browser.storage.local.get("debugMode");
    const debugMode = stored.debugMode === 1 ? true : typeof CONFIG !== "undefined" ? CONFIG.debugMode : false;

    if (!debugMode) return;

    const prefix = "[WEB-PRESENCE - Keep Alive Manager]";
    if (typeof args[0] === "string" && args[0].includes("%c")) {
      console.info(`%c${prefix}%c ${args[0]}`, "color:#2196f3; font-weight:bold;", "color:#fff;", ...args.slice(1));
    } else {
      console.info(`%c${prefix}`, "color:#2196f3; font-weight:bold;", ...args);
    }
  };

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.initVisibilityOverride();
    this.initWebRTC();
    this.initAudioContext();
    this.initCanvasVideo();
    this.requestWakeLock();
    this.initBroadcastChannel();
    this.initIndexedDB();

    this.log("Keep alive initialized");
  }

  initVisibilityOverride() {
    if (this.visibilityOverride) return;
    this.visibilityOverride = true;

    try {
      this.originalVisibility.hidden = Object.getOwnPropertyDescriptor(document, "hidden");
      this.originalVisibility.visibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });

      this.visibilityHandlers.onBlur = () => {};
      this.visibilityHandlers.onVisibilityChange = () => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => false,
        });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
      };

      window.addEventListener("blur", this.visibilityHandlers.onBlur, true);
      document.addEventListener("visibilitychange", this.visibilityHandlers.onVisibilityChange, true);

      const forceVisible = () => {
        if (!document.body) return;
        document.documentElement.classList.remove("hidden");
        document.body.classList.remove("hidden");
      };

      forceVisible();
      const interval = setInterval(forceVisible, 2000);
      this.intervals.push(interval);
    } catch (e) {
      this.log("Visibility bypass error:", e);
    }
  }

  async initWebRTC() {
    try {
      if (!window.RTCPeerConnection) return;

      const setup = () => {
        this.peerConnection = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
        });

        this.dataChannel = this.peerConnection.createDataChannel("keepalive", {
          ordered: false,
          maxRetransmits: 0,
        });
      };

      setup();

      const pingInterval = setInterval(() => {
        if (!this.dataChannel) return;
        if (this.dataChannel.readyState === "open") {
          try {
            this.dataChannel.send("ping");
          } catch (e) {
            this.log("DataChannel send error:", e.message);
          }
        }
      }, 10000);
      this.intervals.push(pingInterval);

      const reconnectTimer = setInterval(() => {
        if (!this.peerConnection || this.peerConnection.connectionState === "closed" || this.peerConnection.connectionState === "failed") {
          this.peerConnection?.close();
          setup();
        }
      }, 30000);
      this.intervals.push(reconnectTimer);
    } catch (e) {
      this.log("WebRTC initialization error:", e);
    }
  }

  initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

      const setupNodes = () => {
        if (this.oscillators.length > 0) return;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.frequency.value = 1;
        gainNode.gain.value = 0.000001;

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start();
        this.oscillators.push(oscillator);
      };

      const resume = async () => {
        if (!this.audioContext) return;
        if (this.audioContext.state === "suspended") {
          await this.audioContext.resume();
        }
        setupNodes();
      };

      resume().catch(() => {
        const events = ["click", "keydown", "pointerdown", "touchstart"];
        const onGesture = () => {
          resume().catch((e) => this.log("AudioContext resume error:", e));
          events.forEach((evt) => document.removeEventListener(evt, onGesture, true));
        };

        this._audioGestureHandler = onGesture;
        this._audioGestureEvents = events;
        events.forEach((evt) => document.addEventListener(evt, onGesture, { capture: true, once: false }));
      });
    } catch (e) {
      this.log("AudioContext error:", e);
    }
  }

  initCanvasVideo() {
    try {
      this.videoHost = document.createElement("div");
      this.videoHost.setAttribute("aria-hidden", "true");
      this.videoShadowRoot = this.videoHost.attachShadow({ mode: "closed" });
      this.videoElement = document.createElement("video");
      Object.assign(this.videoElement.style, {
        position: "fixed",
        top: "-1000px",
        left: "-1000px",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none",
      });

      this.videoElement.muted = true;
      this.videoElement.loop = true;
      this.videoElement.disablePictureInPicture = true;
      this.videoElement.setAttribute("disablePictureInPicture", "true");

      const exitPiP = () => {
        if (document.pictureInPictureElement === this.videoElement) {
          document.exitPictureInPicture().catch(() => {});
        }
      };

      this.videoElement.addEventListener(
        "enterpictureinpicture",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          exitPiP();
        },
        true,
      );

      this.videoElement.addEventListener(
        "leavepictureinpicture",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        },
        true,
      );

      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");

      const draw = () => {
        ctx.fillStyle = `rgb(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255})`;
        ctx.fillRect(0, 0, 1, 1);
        this.rafId = requestAnimationFrame(draw);
      };

      draw();

      this.videoElement.srcObject = canvas.captureStream(4);
      this.videoShadowRoot.appendChild(this.videoElement);

      const target = document.body || document.documentElement;
      if (target) {
        target.appendChild(this.videoHost);
      } else {
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            const t = document.body || document.documentElement;
            t?.appendChild(this.videoHost);
          },
          { once: true },
        );
      }

      this.videoElement.play().catch(() => {});

      const pipInterval = setInterval(() => exitPiP(), 100);
      this.intervals.push(pipInterval);
    } catch (e) {
      this.log("Canvas video error:", e);
    }
  }

  async requestWakeLock() {
    if (!("wakeLock" in navigator)) return;

    const acquire = async () => {
      try {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => {
          this.wakeLock = null;
        });
      } catch (_) {}
    };

    await acquire();

    document.addEventListener("visibilitychange", async () => {
      if (!this.wakeLock) await acquire();
    });
  }

  initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel("keepalive_channel");

      this.broadcastChannel.onmessage = (e) => {
        if (e.data?.type === "ping") {
          this.broadcastChannel.postMessage({ type: "pong", t: Date.now() });
        }
      };

      const interval = setInterval(() => {
        this.broadcastChannel.postMessage({ type: "ping", t: Date.now() });
      }, 5000);
      this.intervals.push(interval);
    } catch (e) {
      this.log("BroadcastChannel error:", e);
    }
  }

  initIndexedDB() {
    const req = indexedDB.open("KeepAliveDB", 1);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("activity")) {
        db.createObjectStore("activity", { keyPath: "id", autoIncrement: true });
      }
    };

    req.onsuccess = (e) => {
      this._db = e.target.result;

      const interval = setInterval(() => {
        if (!this._db) return;

        try {
          const tx = this._db.transaction("activity", "readwrite");
          const store = tx.objectStore("activity");

          store.add({ ts: Date.now(), r: Math.random() });

          store.getAll().onsuccess = (ev) => {
            const recs = ev.target.result;
            if (recs.length > 8) {
              for (let i = 0; i < recs.length - 8; i++) {
                store.delete(recs[i].id);
              }
            }
          };

          tx.onerror = (e) => this.log("IndexedDB transaction error:", e.target.error);
        } catch (txError) {
          this.log("IndexedDB error:", txError);
        }
      }, 12000);

      this.intervals.push(interval);
    };

    req.onerror = (e) => this.log("IndexedDB open error:", e.target.error);
  }

  destroy() {
    if (!this.initialized) return;
    this.intervals.forEach(clearInterval);
    this.intervals = [];

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }

    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
    });
    this.oscillators = [];

    if (this._audioGestureHandler && this._audioGestureEvents) {
      this._audioGestureEvents.forEach((evt) => document.removeEventListener(evt, this._audioGestureHandler, true));
      this._audioGestureHandler = null;
      this._audioGestureEvents = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.videoElement.remove();
      this.videoElement = null;
    }

    if (this.videoHost) {
      this.videoHost.remove();
      this.videoHost = null;
    }

    this.videoShadowRoot = null;

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    if (this._db) {
      this._db.close();
      this._db = null;
    }

    if (this.visibilityOverride) {
      try {
        if (this.originalVisibility.hidden) {
          Object.defineProperty(document, "hidden", this.originalVisibility.hidden);
        }

        if (this.originalVisibility.visibilityState) {
          Object.defineProperty(document, "visibilityState", this.originalVisibility.visibilityState);
        }

        if (this.visibilityHandlers.onBlur) {
          window.removeEventListener("blur", this.visibilityHandlers.onBlur, true);
        }

        if (this.visibilityHandlers.onVisibilityChange) {
          document.removeEventListener("visibilitychange", this.visibilityHandlers.onVisibilityChange, true);
        }
      } catch (_) {}

      this.originalVisibility = {};
      this.visibilityHandlers = {};
      this.visibilityOverride = null;
    }

    this.initialized = false;
    this.log("Keep alive stopped");
  }
}
