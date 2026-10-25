// Works only in iframe frames.
// runs the matching parser, and sends the data to the main frame via the background.

function safeSendMessage(msg) {
  try {
    return browser.runtime.sendMessage(msg).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}
// Self-contained iframe logger
//
// Logs persist via browser.runtime.sendMessage({ action: "debug_log" })
// -> background.js -> debugLogger.js -> IndexedDB.
function _iframeLogState() {
  const key = "__WP_IFRAME_LOG_STATE__";
  if (!Object.prototype.hasOwnProperty.call(globalThis, key) || !globalThis[key]) {
    globalThis[key] = { debugMode: false, initialized: false, listenerBound: false, pendingLoad: null };
  }
  return globalThis[key];
}

async function _iframeLoadDebugMode() {
  const state = _iframeLogState();
  if (state.pendingLoad) return state.pendingLoad;
  state.pendingLoad = (async () => {
    try {
      const stored = await browser.storage.local.get("debugMode");
      state.debugMode = stored?.debugMode === 1 || stored?.debugMode === true;
    } catch {
      state.debugMode = false;
    }
    state.initialized = true;
    state.pendingLoad = null;
    return state.debugMode;
  })();
  return state.pendingLoad;
}

function _iframeBindStorageListener() {
  const state = _iframeLogState();
  if (state.listenerBound) return;
  try {
    if (typeof browser !== "undefined" && browser.storage?.onChanged?.addListener) {
      browser.storage.onChanged.addListener((changes) => {
        if (changes && Object.prototype.hasOwnProperty.call(changes, "debugMode")) {
          state.debugMode = changes.debugMode?.newValue === 1 || changes.debugMode?.newValue === true;
        }
      });
      state.listenerBound = true; // only marked once the listener really exists
    }
  } catch {}
}

function _iframeGetDebugMode() {
  const state = _iframeLogState();
  if (!state.initialized) {
    _iframeLoadDebugMode().catch(() => {});
  }
  return state.debugMode;
}

function _iframeLog(level, event, data) {
  if (level !== "error" && !_iframeGetDebugMode()) return;
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const message = { event: event, ctx: "iframeParser", origin: location.hostname.replace(/^www\./i, "").toLowerCase() };
  for (const key of Object.keys(payload)) message[key] = payload[key];
  const levelText = level === "error" ? "ERROR" : level === "warn" ? "WARN" : "INFO";
  const logLine = `[web-presence - ${levelText}] [iframeParser:${event}] ${message.origin}`;
  if (level === "error") {
    console.error(logLine, message);
  } else if (level === "warn") {
    console.log(logLine, message);
  } else {
    console.log(`%c${logLine}`, "color:#2196f3; font-weight:bold;", message);
  }
  safeSendMessage({
    action: "debug_log",
    level: level,
    source: "iframe",
    args: [`[iframeParser:${event}]`, JSON.stringify(message)],
  }).catch(() => {});
}

// ---- state-transition logging (per frame, per parser key) ----
//
// Polls run every CONFIG.activeInterval (5s by default), so log only state changes.
// Each iframe has its own globalThis; states are keyed by parser key and cleared on pagehide.
const _iframeLogStates = (globalThis.__WP_IFRAME_LOG_STATES__ ??= Object.create(null));

function _iframeClearLogStates(scopeKey) {
  if (typeof scopeKey === "string" && Object.prototype.hasOwnProperty.call(_iframeLogStates, scopeKey)) {
    delete _iframeLogStates[scopeKey];
    return;
  }
  for (const key of Object.keys(_iframeLogStates)) delete _iframeLogStates[key];
}

// Exclude volatile values (time, fallback age, pause state) to avoid false
// state changes on every poll and preserve repeated-message counting.
function _iframeNormalizeObservation(observation) {
  return {
    mode: typeof observation?.mode === "string" ? observation.mode : "unknown",
    hasResult: observation?.hasResult === true,
    source: typeof observation?.source === "string" ? observation.source : null,
    duration: Number.isFinite(observation?.duration) ? Math.round(observation.duration) : null,
    isCasting: observation?.isCasting === true,
    fallback: observation?.fallback === true,
    shape: typeof observation?.shape === "string" ? observation.shape : null,
  };
}

function _iframeSameObservation(a, b) {
  return (
    !!a &&
    !!b &&
    a.mode === b.mode &&
    a.hasResult === b.hasResult &&
    a.source === b.source &&
    a.duration === b.duration &&
    a.isCasting === b.isCasting &&
    a.fallback === b.fallback &&
    a.shape === b.shape
  );
}

function _iframeObservationContext(observation) {
  const context = { key: observation.key, mode: observation.mode };
  if (observation.source) context.source = observation.source;
  if (observation.duration != null) context.duration = observation.duration;
  if (observation.isCasting) context.isCasting = true;
  if (observation.fallback) context.fallback = true;
  if (observation.shape) context.shape = observation.shape;
  return context;
}

/**
 * Log one record per state change; drop repeats from console and IndexedDB.
 *
 * Track live timing separately from observation state, since cached results may
 * outlive the video by one fallback window:
 *   liveSince      - start of the current live run; silence doesn't move it
 *   lastLiveAt     - timestamp of the latest live observation
 *   lastLiveHeldMs - duration of the last live run
 *
 * On "video disappeared", heldMs = lastLiveAt - liveSince, excluding the gap
 * between the last live poll and detection of disappearance.
 */
function _iframeObserve(key, observation) {
  const current = _iframeNormalizeObservation(observation);
  const now = Date.now();
  const state = (_iframeLogStates[key] ??= { previous: null, liveSince: null, lastLiveAt: null, lastLiveHeldMs: null });

  const isLive = current.hasResult && !current.fallback;
  if (isLive && state.liveSince == null) state.liveSince = now;
  if (isLive) state.lastLiveAt = now;

  if (_iframeSameObservation(state.previous, current)) return; // same state: stay silent

  const previous = state.previous;
  const context = _iframeObservationContext({ ...current, key });

  // Close the live run when live data stops, measured at the last live observation.
  if (!isLive && state.liveSince != null) {
    state.lastLiveHeldMs = state.lastLiveAt != null ? state.lastLiveAt - state.liveSince : null;
    state.liveSince = null;
    state.lastLiveAt = null;
  }

  if (!previous) {
    _iframeLog("info", current.hasResult ? "iframe: video ready" : "iframe: no video", context);
  } else if (!previous.hasResult && current.hasResult) {
    _iframeLog("info", "iframe: video appeared", context);
  } else if (previous.hasResult && !current.hasResult) {
    const disappeared = { ...context, previousSource: previous.source };
    if (state.lastLiveHeldMs != null) disappeared.heldMs = state.lastLiveHeldMs;
    _iframeLog("info", "iframe: video disappeared", disappeared);
  } else if (previous.source !== current.source) {
    _iframeLog("info", "iframe: video source changed", { ...context, previousSource: previous.source });
  } else if (previous.fallback !== current.fallback) {
    _iframeLog("info", current.fallback ? "iframe: falling back to last known result" : "iframe: fresh results resumed", context);
  } else {
    _iframeLog("info", "iframe: video state changed", {
      ...context,
      previous: {
        source: previous.source,
        duration: previous.duration,
        isCasting: previous.isCasting,
        fallback: previous.fallback,
        shape: previous.shape,
      },
    });
  }

  state.previous = current;
}

// Initialize debug mode early (single storage read, refreshed by the change listener)
_iframeBindStorageListener();
_iframeLoadDebugMode().catch(() => {});

if (window.top !== window) {
  safeSendMessage({ type: "IFRAME_REGISTER" });

  window.addEventListener(
    "pagehide",
    () => {
      _iframeClearLogStates();
      safeSendMessage({ type: "IFRAME_UNREGISTER" });
    },
    { once: true },
  );
}

function getVideoInfo() {
  const isValidDuration = (d) => Number.isFinite(d) && d > 0;

  const getRectArea = (el) => {
    const r = el?.getBoundingClientRect?.();
    return r ? r.width * r.height : 0;
  };

  const isHiddenEl = (el) => {
    if (!el) return true;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return true;
    if (parseFloat(style.opacity) === 0) return true;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return true;
    if (rect.bottom < -100 || rect.right < -100) return true;

    return false;
  };

  function detectCasting(videoEl) {
    try {
      if (querySelectorDeep(".jw-flag-casting")) return true;

      const castSelectors = [".casting", ".is-casting", ".cast-active", "[data-casting='true']", ".chromecast-active", ".airplay-active"];

      for (const s of castSelectors) {
        if (querySelectorDeep(s)) return true;
      }

      if (typeof window.jwplayer === "function") {
        const jwState = window.jwplayer?.()?.getState?.();
        if (jwState === "casting") return true;
      }

      if (videoEl?.remote?.state === "connected") return true;
      if (videoEl?.webkitCurrentPlaybackTargetIsWireless === true) return true;

      return false;
    } catch {
      return false;
    }
  }

  function normalizePaused(paused, isCasting) {
    return isCasting ? false : (paused ?? true);
  }

  function scoreCandidate({ isPlaying, isCasting, isAd, isFloating, isHidden, duration, area }) {
    if (isHidden) return -99999;

    let score = 0;

    if (isAd) score -= 8000;
    if (isFloating) score -= 5000;

    if (isPlaying || isCasting) score += 10000;

    if (duration > 30) score += 500;
    if (duration > 120) score += 500;

    score += Math.min(area / 100, 2000);

    return score;
  }

  function parseTimeString(timeStr) {
    try {
      if (typeof timeStr !== "string") return null;
      const trimmed = timeStr.trim();
      if (!trimmed || trimmed === "--:--" || trimmed === "-:-") return null;
      const parts = trimmed.split(":").map(Number);
      if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return null;
    } catch {
      return null;
    }
  }

  function safeParseFloat(val) {
    try {
      const n = parseFloat(val);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  const players = {
    jwplayer: () => {
      try {
        if (typeof window.jwplayer === "function") {
          const player = window.jwplayer();
          if (player?.getState) {
            const state = player.getState();
            const isCasting = state === "casting" || !!querySelectorDeep(".jw-flag-casting");

            if (state === "idle" && !isCasting) return null;

            let duration = null;
            let currentTime = null;

            if (isCasting) {
              const containers = querySelectorDeep(".jwplayer", document, true);

              let bestContainer = null;
              let bestArea = -1;

              for (const c of containers) {
                const area = getRectArea(c);
                if (area > bestArea) {
                  bestArea = area;
                  bestContainer = c;
                }
              }

              if (bestContainer) {
                const sliderEl = bestContainer.querySelector(".jw-slider-time");

                currentTime =
                  parseTimeString(bestContainer.querySelector(".jw-text-elapsed")?.textContent) ??
                  (sliderEl ? safeParseFloat(sliderEl.getAttribute("aria-valuenow")) : null);

                duration =
                  parseTimeString(bestContainer.querySelector(".jw-text-duration")?.textContent) ??
                  (sliderEl ? safeParseFloat(sliderEl.getAttribute("aria-valuemax")) : null);
              }
            } else {
              duration = player.getDuration?.();
              currentTime = player.getPosition?.() ?? null;
            }

            return {
              duration: isValidDuration(duration) ? duration : null,
              currentTime: isValidDuration(currentTime) ? currentTime : null,
              paused: !(state === "playing" || isCasting),
              isCasting,
              source: "jwplayer",
            };
          }
        }

        // DOM fallback
        const containers = querySelectorDeep(".jwplayer", document, true);
        if (!containers.length) return null;

        let bestContainer = null;
        let bestScore = -Infinity;

        for (const container of containers) {
          const classList = container.classList;
          const stateClass = [...classList].find((c) => c.startsWith("jw-state-"));
          const state = stateClass?.replace("jw-state-", "");

          const sliderEl = container.querySelector(".jw-slider-time");
          const duration = sliderEl ? (safeParseFloat(sliderEl.getAttribute("aria-valuemax")) ?? 0) : 0;

          const isCasting = classList.contains("jw-flag-casting");

          const score = scoreCandidate({
            isPlaying: state === "playing",
            isCasting,
            isAd: classList.contains("jw-flag-ads"),
            isFloating: classList.contains("jw-floating"),
            isHidden: isHiddenEl(container),
            duration,
            area: getRectArea(container),
          });

          if (score > bestScore) {
            bestScore = score;
            bestContainer = container;
          }
        }

        if (!bestContainer) return null;

        const classList = bestContainer.classList;
        const stateClass = [...classList].find((c) => c.startsWith("jw-state-"));
        const state = stateClass?.replace("jw-state-", "");
        const isCasting = classList.contains("jw-flag-casting");

        if (state === "idle" && !isCasting) return null;

        const sliderEl = bestContainer.querySelector(".jw-slider-time");

        const currentTime =
          parseTimeString(bestContainer.querySelector(".jw-text-elapsed")?.textContent) ?? (sliderEl ? safeParseFloat(sliderEl.getAttribute("aria-valuenow")) : null);

        const duration =
          parseTimeString(bestContainer.querySelector(".jw-text-duration")?.textContent) ?? (sliderEl ? safeParseFloat(sliderEl.getAttribute("aria-valuemax")) : null);

        if (!isValidDuration(duration) && currentTime == null && !isCasting) return null;

        return {
          duration: isValidDuration(duration) ? duration : null,
          currentTime: isValidDuration(currentTime) ? currentTime : null,
          paused: state !== "playing",
          isCasting,
          source: "jwplayer-dom",
          area: getRectArea(bestContainer),
        };
      } catch (e) {
        console.log("JWPlayer error:", e);
        return null;
      }
    },

    videojs: () => {
      try {
        const vjsPlayers = window.videojs?.players;
        if (vjsPlayers && typeof vjsPlayers === "object") {
          let best = null;
          let bestScore = -Infinity;

          for (const id in vjsPlayers) {
            try {
              const player = vjsPlayers[id];
              if (!player || typeof player.readyState !== "function") continue;
              if (player.readyState() <= 0) continue;

              const el = player.el_;
              const isCasting = detectCasting(el?.querySelector("video"));

              const score = scoreCandidate({
                isPlaying: !player.paused?.(),
                isCasting,
                isAd: !!player.ads?.isInAdMode?.(),
                isFloating: !!el?.classList.contains("vjs-floating"),
                isHidden: isHiddenEl(el),
                duration: player.duration?.() ?? 0,
                area: getRectArea(el),
              });

              if (score > bestScore) {
                bestScore = score;
                best = { player, isCasting };
              }
            } catch {
              continue;
            }
          }

          if (best) {
            return {
              duration: isValidDuration(best.player.duration?.()) ? best.player.duration() : null,
              currentTime: best.player.currentTime?.() ?? null,
              paused: normalizePaused(best.player.paused?.(), best.isCasting),
              isCasting: best.isCasting,
              source: "videojs",
              area: getRectArea(best),
            };
          }
        }

        // DOM fallback
        const containers = querySelectorDeep(".video-js", document, true);
        if (!containers.length) return null;

        let bestContainer = null;
        let bestScore = -Infinity;

        for (const container of containers) {
          const classList = container.classList;
          const isPlaying = classList.contains("vjs-playing");
          const hasStarted = classList.contains("vjs-has-started");
          if (!isPlaying && !hasStarted) continue;

          const videoEl = container.querySelector("video");
          const isCasting = detectCasting(videoEl);

          const videoDuration = videoEl ? safeParseFloat(videoEl.duration) : null;
          const domDuration =
            parseTimeString(container.querySelector(".vjs-duration-display")?.textContent) ??
            parseTimeString(container.querySelector(".vjs-remaining-time-display")?.textContent);

          const duration = isValidDuration(videoDuration) ? videoDuration : (domDuration ?? 0);

          const score = scoreCandidate({
            isPlaying,
            isCasting,
            isAd: classList.contains("vjs-ad-playing") || classList.contains("vjs-ima-ad-container"),
            isFloating: classList.contains("vjs-floating"),
            isHidden: isHiddenEl(container),
            duration,
            area: getRectArea(container),
          });

          if (score > bestScore) {
            bestScore = score;
            bestContainer = container;
          }
        }

        if (!bestContainer) return null;

        const videoEl = bestContainer.querySelector("video");
        const isCasting = detectCasting(videoEl);
        const classList = bestContainer.classList;

        const videoDuration = videoEl ? safeParseFloat(videoEl.duration) : null;
        const videoCurrentTime = videoEl ? safeParseFloat(videoEl.currentTime) : null;

        const domCurrentTime = parseTimeString(bestContainer.querySelector(".vjs-current-time-display")?.textContent);
        const domDuration =
          parseTimeString(bestContainer.querySelector(".vjs-duration-display")?.textContent) ??
          parseTimeString(bestContainer.querySelector(".vjs-remaining-time-display")?.textContent);

        const duration = isValidDuration(videoDuration) ? videoDuration : domDuration;
        const currentTime = videoCurrentTime ?? domCurrentTime;

        if (!isValidDuration(duration) && currentTime == null && !isCasting) return null;

        return {
          duration: isValidDuration(duration) ? duration : null,
          currentTime,
          paused: normalizePaused(!classList.contains("vjs-playing"), isCasting),
          isCasting,
          source: "videojs-dom",
          area: getRectArea(bestContainer),
        };
      } catch (e) {
        console.log("VideoJS error:", e);
        return null;
      }
    },

    plyr: () => {
      try {
        const list = window.Plyr?.setup?.() || window.plyrPlayers || [];

        if (Array.isArray(list) && list.length > 0) {
          let best = null;
          let bestScore = -Infinity;

          for (const p of list) {
            try {
              if (!p) continue;

              const el = p.elements?.container;
              const isCasting = detectCasting(p.media);

              const score = scoreCandidate({
                isPlaying: !p.paused,
                isCasting,
                isAd: !!p.ads?.playing,
                isFloating: !!el?.classList.contains("plyr--floating"),
                isHidden: isHiddenEl(el),
                duration: p.duration ?? 0,
                area: getRectArea(el),
              });

              if (score > bestScore) {
                bestScore = score;
                best = { p, isCasting };
              }
            } catch {
              continue;
            }
          }

          if (best) {
            return {
              duration: isValidDuration(best.p.duration) ? best.p.duration : null,
              currentTime: best.p.currentTime ?? null,
              paused: normalizePaused(best.p.paused, best.isCasting),
              isCasting: best.isCasting,
              source: "plyr",
              area: getRectArea(best),
            };
          }
        }

        // DOM fallback
        const containers = querySelectorDeep(".plyr", document, true);
        if (!containers.length) return null;

        let bestContainer = null;
        let bestScore = -Infinity;

        for (const container of containers) {
          const classList = container.classList;
          const isPlaying = classList.contains("plyr--playing");

          const mediaEl = container.querySelector("video, audio");
          const isCasting = detectCasting(mediaEl instanceof HTMLVideoElement ? mediaEl : null);

          const seekInput = container.querySelector('.plyr__progress input[type="range"]');
          const seekDuration = seekInput ? safeParseFloat(seekInput.max) : null;
          const seekCurrentTime = seekInput ? safeParseFloat(seekInput.value) : null;

          const mediaDuration = mediaEl ? safeParseFloat(mediaEl.duration) : null;
          const mediaCurrentTime = mediaEl ? safeParseFloat(mediaEl.currentTime) : null;

          const duration = isValidDuration(mediaDuration) ? mediaDuration : isValidDuration(seekDuration) ? seekDuration : 0;

          const score = scoreCandidate({
            isPlaying,
            isCasting,
            isAd: classList.contains("plyr--ads"),
            isFloating: classList.contains("plyr--floating"),
            isHidden: isHiddenEl(container),
            duration,
            area: getRectArea(container),
          });

          if (score > bestScore) {
            bestScore = score;
            bestContainer = container;
          }
        }

        if (!bestContainer) return null;

        const classList = bestContainer.classList;
        const mediaEl = bestContainer.querySelector("video, audio");
        const isCasting = detectCasting(mediaEl instanceof HTMLVideoElement ? mediaEl : null);

        const seekInput = bestContainer.querySelector('.plyr__progress input[type="range"]');
        const seekDuration = seekInput ? safeParseFloat(seekInput.max) : null;
        const seekCurrentTime = seekInput ? safeParseFloat(seekInput.value) : null;

        const mediaDuration = mediaEl ? safeParseFloat(mediaEl.duration) : null;
        const mediaCurrentTime = mediaEl ? safeParseFloat(mediaEl.currentTime) : null;

        const duration = isValidDuration(mediaDuration) ? mediaDuration : seekDuration;
        const currentTime = mediaCurrentTime ?? seekCurrentTime;

        if (!isValidDuration(duration) && currentTime == null && !isCasting) return null;

        return {
          duration: isValidDuration(duration) ? duration : null,
          currentTime,
          paused: normalizePaused(!classList.contains("plyr--playing"), isCasting),
          isCasting,
          source: "plyr-dom",
          area: getRectArea(bestContainer),
        };
      } catch (e) {
        console.log("Plyr error:", e);
        return null;
      }
    },

    flowplayer: () => {
      try {
        const fpContainers = querySelectorDeep(".flowplayer", document, true);
        if (!fpContainers.length) return null;

        let best = null;
        let bestScore = -Infinity;

        for (const c of fpContainers) {
          try {
            const player = typeof window.flowplayer === "function" ? window.flowplayer(c) : null;

            if (player) {
              const isCasting = detectCasting(c.querySelector("video"));

              const score = scoreCandidate({
                isPlaying: !!player.playing,
                isCasting,
                isAd: !!player.advertising,
                isFloating: c.classList.contains("fp-floating"),
                isHidden: isHiddenEl(c),
                duration: player.video?.duration ?? 0,
                area: getRectArea(c),
              });

              if (score > bestScore) {
                bestScore = score;
                best = { player, isCasting, el: c, usedApi: true };
              }
            } else {
              const videoEl = c.querySelector("video");
              const isCasting = detectCasting(videoEl);
              const classList = c.classList;

              const isPlaying = classList.contains("is-playing") || classList.contains("fp-state-playing");
              const videoDuration = videoEl ? safeParseFloat(videoEl.duration) : null;

              const score = scoreCandidate({
                isPlaying,
                isCasting,
                isAd: classList.contains("is-ad") || classList.contains("fp-state-wait"),
                isFloating: classList.contains("fp-floating"),
                isHidden: isHiddenEl(c),
                duration: videoDuration ?? 0,
                area: getRectArea(c),
              });

              if (score > bestScore) {
                bestScore = score;
                best = { player: null, isCasting, el: c, usedApi: false };
              }
            }
          } catch {
            continue;
          }
        }

        if (!best) return null;

        if (best.usedApi && best.player) {
          return {
            duration: isValidDuration(best.player.video?.duration) ? best.player.video.duration : null,
            currentTime: best.player.video?.time ?? null,
            paused: normalizePaused(!best.player.playing, best.isCasting),
            isCasting: best.isCasting,
            source: "flowplayer",
            area: getRectArea(best),
          };
        }

        // DOM fallback
        const container = best.el;
        const classList = container.classList;
        const videoEl = container.querySelector("video");
        const isCasting = best.isCasting;

        const duration = videoEl ? safeParseFloat(videoEl.duration) : null;
        const currentTime = videoEl ? safeParseFloat(videoEl.currentTime) : null;

        if (!isValidDuration(duration) && currentTime == null && !isCasting) return null;

        const isPlaying = classList.contains("is-playing") || classList.contains("fp-state-playing");

        return {
          duration: isValidDuration(duration) ? duration : null,
          currentTime,
          paused: normalizePaused(!isPlaying, isCasting),
          isCasting,
          source: "flowplayer-dom",
        };
      } catch (e) {
        console.log("Flowplayer error:", e);
        return null;
      }
    },

    html5: () => {
      try {
        const videos = querySelectorDeep("video", document, true);

        let best = null;
        let bestScore = -Infinity;

        for (const v of videos) {
          if (!(v instanceof HTMLVideoElement)) continue;

          const parent = v.closest("[class]");
          const classes = parent ? [...parent.classList] : [];

          const isCasting = detectCasting(v);

          const score = scoreCandidate({
            isPlaying: !v.paused,
            isCasting,
            isAd: classes.some((c) => /ad|ads|advertisement|preroll/i.test(c)),
            isFloating: classes.some((c) => /float|pip|mini/i.test(c)),
            isHidden: isHiddenEl(v),
            duration: v.duration ?? 0,
            area: getRectArea(v),
          });

          if (score > bestScore) {
            bestScore = score;
            best = v;
          }
        }

        if (!best) return null;

        const isCasting = detectCasting(best);

        return {
          duration: isValidDuration(best.duration) ? best.duration : null,
          currentTime: best.currentTime,
          paused: normalizePaused(best.paused, isCasting),
          isCasting,
          source: "html5",
          area: getRectArea(best),
        };
      } catch (err) {
        _iframeLog("error", "html5: error", { error: err?.message });
        return null;
      }
    },
  };

  const playerOrder = ["jwplayer", "videojs", "plyr", "flowplayer", "html5"];

  // Which players were tried and what they returned, kept for the transition record
  // instead of one log line per player per poll cycle.
  const chain = [];

  for (const name of playerOrder) {
    try {
      const result = players[name]?.();
      if (!result) {
        chain.push(`${name}:null`);
        continue;
      }

      if (result.duration == null && result.currentTime == null && !result.isCasting) {
        chain.push(`${name}:empty`);
        continue;
      }

      if (result.currentTime != null && result.duration != null) {
        result.currentTime = Math.min(Math.max(0, result.currentTime), result.duration);
      }

      chain.push(`${name}:ok`);

      getVideoInfo._lastSuccess = {
        result,
        timestamp: Date.now(),
        source: name,
      };
      getVideoInfo._lastChain = chain.join("|");
      getVideoInfo._lastProvenance = "live";

      return result;
    } catch (err) {
      chain.push(`${name}:throw`);
      _iframeLog("error", "getVideoInfo: player error", { name, error: err?.message });
      continue;
    }
  }

  getVideoInfo._lastChain = chain.join("|");

  const last = getVideoInfo._lastSuccess;
  if (last && Date.now() - last.timestamp < 6000) {
    getVideoInfo._lastProvenance = "cache";
    return structuredClone(last.result);
  }

  getVideoInfo._lastProvenance = "none";
  return null;
}

function resolveRule(rule) {
  if (!rule || typeof rule !== "object") return null;

  try {
    switch (rule.type) {
      // video
      // Returns the entire output of getVideoInfo().
      // When the caller sees the "$video" key, it spreads this.
      case "video":
        return getVideoInfo();

      // exists
      // Boolean(querySelector(selector))
      case "exists": {
        const el = querySelectorDeep(rule.selector);
        return Boolean(el);
      }

      // not
      // !Boolean(querySelector(selector))
      case "not": {
        const el = querySelectorDeep(rule.selector);
        return !el;
      }

      // text
      // element.textContent (optional trim)
      case "text": {
        const el = querySelectorDeep(rule.selector);
        if (!el) return null;
        const val = el.textContent ?? "";
        return rule.trim !== false ? val.trim() : val;
      }

      // attr
      // element.getAttribute(attr)
      case "attr": {
        const el = querySelectorDeep(rule.selector);
        return el?.getAttribute(rule.attr) ?? null;
      }

      // aria
      // The aria-* shortcut for attr (parseFloat is not applied, returns raw string)
      case "aria": {
        const el = querySelectorDeep(rule.selector);
        return el?.getAttribute(rule.attr) ?? null;
      }

      // src
      // img/video/audio src property
      case "src": {
        const el = querySelectorDeep(rule.selector);
        return el?.src ?? null;
      }

      // href
      // anchor href property (absolute URL)
      case "href": {
        const el = querySelectorDeep(rule.selector);
        return el?.href ?? null;
      }

      // number
      // parseFloat(textContent)
      case "number": {
        const el = querySelectorDeep(rule.selector);
        if (!el) return null;
        const n = parseFloat(el.textContent);
        return Number.isFinite(n) ? n : null;
      }

      // time
      // "MM:SS" or "HH:MM:SS" → seconds (number)
      case "time": {
        const el = querySelectorDeep(rule.selector);
        if (!el) return null;
        const text = el.textContent?.trim() ?? "";
        if (!text || text === "--:--" || text === "-:-") return null;
        const parts = text.split(":").map(Number);
        if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return null;
      }

      // classContains
      // element.classList.contains(class)
      case "classContains": {
        const el = querySelectorDeep(rule.selector);
        if (!el) return false;
        const classes = Array.isArray(rule.class) ? rule.class : [rule.class];
        return classes.every((c) => el.classList.contains(c));
      }

      // dataset
      // element.dataset[key]
      case "dataset": {
        const el = querySelectorDeep(rule.selector);
        return el?.dataset?.[rule.key] ?? null;
      }

      // meta
      // <meta property="og:title"> or <meta name="og:title"> → content
      case "meta": {
        const el = document.querySelector(`meta[property='${rule.name}'], meta[name='${rule.name}']`);
        return el?.content ?? null;
      }

      // count
      // querySelectorAll(selector).length
      case "count": {
        const els = document.querySelectorAll(rule.selector);
        return els.length;
      }

      // prop
      // window global access: "jwplayer.getPosition" →
      // window.jwplayer.getPosition() (if it's a function, it calls it)
      case "prop": {
        if (!rule.path) return null;
        const parts = rule.path.split(".");
        let obj = window;
        for (const part of parts) {
          if (obj == null) return null;
          obj = obj[part];
        }
        if (typeof obj === "function") {
          try {
            return obj();
          } catch {
            return null;
          }
        }
        return obj ?? null;
      }

      // or
      // returns the first non-null result in the rules array
      case "or": {
        if (!Array.isArray(rule.rules)) return null;
        for (const r of rule.rules) {
          const val = resolveRule(r);
          if (val !== null && val !== undefined && val !== "") return val;
        }
        return null;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Takes the `iframeSelectors` object, runs all fields,
 * returns an iframeData-compatible object.
 *
 * @param {Object} iframeSelectors - { match?, fields: { [key]: FieldRule } }
 * @param {string} iframeHostname  - the hostname of the current iframe
 * @returns {Object|null}
 */
function resolveIframeSelectors(iframeSelectors, iframeHostname) {
  if (!iframeSelectors || typeof iframeSelectors !== "object") return null;

  // match filter
  if (iframeSelectors.match) {
    const allowed = [iframeSelectors.match].flat();
    const matched = allowed.some((h) => h === "" || iframeHostname.includes(h.toLowerCase()));
    if (!matched) return null;
  }

  const fields = iframeSelectors.fields;
  if (!fields || typeof fields !== "object") return null;

  const result = {};
  let resolvedCount = 0;

  for (const [key, rule] of Object.entries(fields)) {
    // $video private key: spreads the output of getVideoInfo()
    if (key === "$video") {
      const videoData = resolveRule({ type: "video" });
      if (videoData && typeof videoData === "object") {
        Object.assign(result, videoData);
        resolvedCount++;
      }
      continue;
    }

    const val = resolveRule(rule);
    if (val !== null && val !== undefined) {
      result[key] = val;
      resolvedCount++;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type !== "FETCH_IFRAME_DATA" || !msg.key) return;

  const { key } = msg;
  const iframeHostname = location.hostname.replace(/^www\./i, "").toLowerCase();

  // Only the state transition for `key` is logged (see _iframeObserve); the raw request
  // arrival would repeat every CONFIG.activeInterval cycle for a settled iframe.

  // iframeSelectors DSL
  if (msg.iframeSelectors) {
    const data = resolveIframeSelectors(msg.iframeSelectors, iframeHostname);
    if (data == null) {
      _iframeObserve(key, { mode: "dsl", hasResult: false, shape: "null" });
      return;
    }
    _iframeObserve(key, {
      mode: "dsl",
      hasResult: true,
      source: typeof data.source === "string" ? data.source : "iframeSelectors",
      duration: data.duration,
      isCasting: data.isCasting === true,
      shape: `keys=${Object.keys(data).length}`,
    });
    safeSendMessage({
      type: "IFRAME_DATA",
      key,
      origin: iframeHostname,
      href: location.href,
      data,
    }).catch((err) => _iframeLog("error", "Failed to send IFRAME_DATA", { key, error: err?.message }));
    return;
  }

  // userAdd / userScript watchAutoDetect
  // `fallback` reflects THIS call's provenance: "cache" only while getVideoInfo is serving
  // the last known result because the current DOM has nothing. It is not a time window, so
  // it flips back as soon as a real player result returns.
  const data = getVideoInfo();
  if (data == null) {
    _iframeObserve(key, {
      mode: "fallback",
      hasResult: false,
      shape: getVideoInfo._lastChain ? `chain=${getVideoInfo._lastChain}` : null,
    });
    return;
  }
  _iframeObserve(key, {
    mode: "fallback",
    hasResult: true,
    source: data.source ?? null,
    duration: data.duration,
    isCasting: data.isCasting === true,
    fallback: getVideoInfo._lastProvenance === "cache",
    shape: getVideoInfo._lastChain ? `chain=${getVideoInfo._lastChain}` : null,
  });
  safeSendMessage({
    type: "IFRAME_DATA",
    key,
    origin: iframeHostname,
    href: location.href,
    data,
  }).catch((err) => _iframeLog("error", "Failed to send IFRAME_DATA", { key, error: err?.message }));
});
