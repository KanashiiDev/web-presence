// Works only in iframe frames.
// Looks at window.iframeParsers defined by compiledIframeParsers.js,
// runs the matching parser, and sends the data to the main frame via the background.

if (window.top !== window) {
  browser.runtime.sendMessage({ type: "IFRAME_REGISTER" }).catch(() => {});

  window.addEventListener(
    "pagehide",
    () => {
      browser.runtime.sendMessage({ type: "IFRAME_UNREGISTER" }).catch(() => {});
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
        console.warn("JWPlayer error:", e);
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
        console.warn("VideoJS error:", e);
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
        console.warn("Plyr error:", e);
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
        console.warn("Flowplayer error:", e);
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
      } catch {
        return null;
      }
    },
  };

  const playerOrder = ["jwplayer", "videojs", "plyr", "flowplayer", "html5"];

  for (const name of playerOrder) {
    try {
      const result = players[name]?.();
      if (!result) continue;

      if (result.duration == null && result.currentTime == null && !result.isCasting) continue;

      if (result.currentTime != null && result.duration != null) {
        result.currentTime = Math.min(Math.max(0, result.currentTime), result.duration);
      }

      getVideoInfo._lastSuccess = {
        result,
        timestamp: Date.now(),
        source: name,
      };

      return result;
    } catch {}
  }

  const last = getVideoInfo._lastSuccess;
  if (last && Date.now() - last.timestamp < 6000) {
    return structuredClone(last.result);
  }

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

  for (const [key, rule] of Object.entries(fields)) {
    // $video private key: spreads the output of getVideoInfo()
    if (key === "$video") {
      const videoData = resolveRule({ type: "video" });
      if (videoData && typeof videoData === "object") {
        Object.assign(result, videoData);
      }
      continue;
    }

    const val = resolveRule(rule);
    if (val !== null && val !== undefined) {
      result[key] = val;
    }
  }

  // Empty object → null (means no data)
  return Object.keys(result).length > 0 ? result : null;
}

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type !== "FETCH_IFRAME_DATA" || !msg.key) return;

  const { key } = msg;
  const iframeHostname = location.hostname.replace(/^www\./i, "").toLowerCase();

  // Built-in parsers
  const entry = window.iframeParsers?.[key];
  if (entry?.fn) {
    if (entry.match) {
      const matches = [entry.match].flat();
      if (!matches.some((h) => h === "" || iframeHostname.includes(h.toLowerCase()))) return;
    }
    const data = await entry.fn();
    if (data == null) return;
    browser.runtime
      .sendMessage({
        type: "IFRAME_DATA",
        key,
        origin: iframeHostname,
        href: location.href,
        data,
      })
      .catch(() => {});
    return;
  }

  // iframeSelectors DSL
  if (msg.iframeSelectors) {
    const data = resolveIframeSelectors(msg.iframeSelectors, iframeHostname);
    if (data == null) return;
    browser.runtime
      .sendMessage({
        type: "IFRAME_DATA",
        key,
        origin: iframeHostname,
        href: location.href,
        data,
      })
      .catch(() => {});
    return;
  }

  // userAdd / userScript / watchAutoDetect
  const data = getVideoInfo();
  if (data == null) return;
  browser.runtime
    .sendMessage({
      type: "IFRAME_DATA",
      key,
      origin: iframeHostname,
      href: location.href,
      data,
    })
    .catch(() => {});
});
