const STORAGE_KEY = "userScriptsList";

// URL pattern validation and normalization
class PatternValidator {
  // Regex string → JS RegExp object
  static toRegex(pattern) {
    if (!pattern) return /.*/;
    try {
      let cleanPattern = pattern.trim();
      if (cleanPattern.startsWith("/") && cleanPattern.endsWith("/")) {
        cleanPattern = cleanPattern.slice(1, -1);
      } else if (cleanPattern.startsWith("/") && cleanPattern.endsWith("/i")) {
        cleanPattern = cleanPattern.slice(1, -2);
        return new RegExp(cleanPattern, "i");
      }

      return new RegExp(cleanPattern);
    } catch (err) {
      console.warn("Invalid regex pattern:", pattern, err);
      return /.*/;
    }
  }

  // Input string → list of normalized patterns
  static normalizePatterns(patterns) {
    if (!patterns) return [];
    if (typeof patterns === "string") patterns = patterns.split(/\s*,\s*/);

    return patterns
      .map((p) => {
        const trimmed = p.trim();
        if (!trimmed) return "";

        if (trimmed.startsWith("/") && (trimmed.endsWith("/") || trimmed.endsWith("/i"))) {
          return trimmed;
        }
        return `/${trimmed}/`;
      })
      .filter(Boolean);
  }

  // Return the pattern list as regex and normalized list
  static processPatterns(patterns) {
    const list = this.normalizePatterns(patterns);
    const regexList = [];
    const invalidPatterns = [];

    for (const p of list) {
      try {
        const r = this.toRegex(p);
        regexList.push(r);
      } catch (err) {
        invalidPatterns.push(p);
        regexList.push(/.*/);
      }
    }

    return {
      regexList,
      normalizedList: list,
      invalidPatterns,
    };
  }
}

// Storage management
class ScriptStorage {
  constructor(storageKey) {
    this.storageKey = storageKey;
  }

  async getScripts() {
    try {
      const result = await browser.storage.local.get(this.storageKey);
      return result[this.storageKey] || [];
    } catch (error) {
      logError("[userScriptWorker]: Failed to get scripts from storage:", error);
      return [];
    }
  }

  async saveScripts(scripts) {
    try {
      await browser.storage.local.set({ [this.storageKey]: scripts });
    } catch (error) {
      logError("[userScriptWorker]: Failed to save scripts to storage:", error);
      throw error;
    }
  }
}

// UserScript management
class UserScriptManager {
  constructor() {
    this.storage = new ScriptStorage(STORAGE_KEY);
    this.validator = PatternValidator;
    this.registeredScripts = new Map();
  }

  buildTrackDataScript(script) {
    const { normalizedList } = PatternValidator.processPatterns(script.urlPatterns);

    return `
    // AUTO-GENERATED-UTILS
    // _INLINE_UTILS
    function normalizeTrackData(input) {
      const seen = new WeakSet();

      function clean(value, path) {
        path = path || "root";

        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          return value;
        }

        if (typeof value === "undefined") return null;

        if (
          value instanceof Node ||
          value instanceof Window ||
          value instanceof Document ||
          value instanceof HTMLCollection ||
          value instanceof NodeList ||
          value instanceof Element
        ) {
          if (${script.debug}) {
            console.warn("Dropped DOM value at:", path);
          }
          return null;
        }

        if (typeof value === "object") {
          if (seen.has(value)) return null;
          seen.add(value);
        }

        if (Array.isArray(value)) {
          return value.map((v, i) => clean(v, path + "[" + i + "]"));
        }

        if (typeof value === "object") {
          const out = {};
          for (const key in value) {
            const nextPath = path + "." + key;
            const v = clean(value[key], nextPath);
            if (v !== undefined) out[key] = v;
          }
          return out;
        }

        return null;
      }

      return clean(input, "root");
    }
    // MAIN
    (async function() {
      const trackState = {};

      setTimeout(async () => {
        const __userScriptUsedSettings = [];
        function useSetting(key, label, type, defaultValue) {
          __userScriptUsedSettings.push({ key, label, type, defaultValue });
          return new Promise((resolve, reject) => {
            const requestId = \`useSetting_\${Date.now()}_\${Math.random()}\`;
            function handleResponse(event) {
              if (event.source !== window) return;
              const msg = event.data;
              if (!msg || msg.type !== "USER_SCRIPT_USE_SETTING_RESPONSE" || msg.requestId !== requestId) return;
              window.removeEventListener("message", handleResponse);
              resolve(msg.value);
            }
            window.addEventListener("message", handleResponse);

            window.postMessage({
              type: "USER_SCRIPT_USE_SETTING_REQUEST",
              requestId,
              id: "${script.id}",
              key,
              label,
              inputType: type,
              defaultValue
            }, "*");

            setTimeout(() => reject(new Error("useSetting timeout")), 5000);
          });
        }
        function clearActivity() {
          __clearCalled = true;
          window.postMessage({
            type: "USER_SCRIPT_CLEAR_ACTIVITY",
            id: "${script.id}",
            domain: "${Array.isArray(script.domain) ? script.domain[0] : script.domain}",
          }, "*");
        }
        function getIframeData() {
          return new Promise((resolve) => {
            const requestId = \`iframeData_\${Date.now()}_\${Math.random()}\`;

            function handleResponse(event) {
              if (event.source !== window) return;
              const msg = event.data;
              if (!msg || msg.type !== "USER_SCRIPT_IFRAME_DATA_RESPONSE" || msg.requestId !== requestId) return;
              window.removeEventListener("message", handleResponse);
              resolve(msg.data || null);
            }

            window.addEventListener("message", handleResponse);

            window.postMessage({
              type: "USER_SCRIPT_IFRAME_DATA_REQUEST",
              requestId,
              id: "${script.id}",
              iframeSelectors: ${JSON.stringify(script.iframeSelectors || null)},
            }, "*");

            setTimeout(() => resolve(null), 12000);
          });
        }
        // update trackData
        async function updateTrackData() {
          var __clearCalled = false;
          try {
            // UserScript
            ${script.code || ""}
            if (typeof __clearCalled !== "undefined" && __clearCalled) return;
            // update trackState
            trackState.title = typeof title === "string" ? title : (title == null ? null : String(title));
            trackState.artist = typeof artist === "string" ? artist : (artist == null ? null : String(artist));
            trackState.image = typeof image === "string" ? image : (image == null ? null : String(image));
            trackState.source = typeof source === "string" ? source : (source == null ? null : String(source));
            trackState.songUrl = typeof songUrl === "string" ? songUrl : (songUrl == null ? null : String(songUrl));
            trackState.link = trackState.songUrl ?? (typeof link === "undefined" ? null : (typeof link === "string" ? link : String(link)));
            trackState.timePassed = typeof timePassed === "number" || typeof timePassed === "string" ? timePassed : null;
            trackState.duration = typeof duration === "number" || typeof duration === "string" ? duration : null;
            trackState.buttons = typeof buttons !== "undefined" && Array.isArray(buttons) ? buttons : null;
            trackState.isPlaying = typeof isPlaying !== "undefined" ? Boolean(isPlaying) : null;

            // Track Data
            const trackData = {
              id: "${script.id}",
              version: "${script.version || "1.0.0"}",
              domain: "${Array.isArray(script.domain) ? script.domain[0] : script.domain}",
              domains: ${JSON.stringify(Array.isArray(script.domain) ? script.domain : [script.domain])},
              authors: ${JSON.stringify(script.authors || [])},
              authorsLinks: ${JSON.stringify(script.authorsLinks || [])},
              homepage: "${script.homepage || ""}",
              description: "${script.description || ""}",
              urlPatterns: ${JSON.stringify(normalizedList)},
              title: "${script.title || "Unknown"}",
              mode: "${script.mode || "listen"}",
              watchAutoDetect: "${script.watchAutoDetect || "disable"}",
              iframeSelectors: ${JSON.stringify(script.iframeSelectors || null)},
              isLibraryActivity: ${Boolean(script.storeScriptId)},
              song: normalizeTrackData({ ...trackState })
            };

            // Debug Mode
            if (${script.debug} && trackData) {
              const now = new Date();
              const timeString = \`\${String(now.getHours()).padStart(2,'0')}:\${String(now.getMinutes()).padStart(2,'0')}:\${String(now.getSeconds()).padStart(2,'0')}\`;
              console.groupCollapsed(\`%c Web Presence - USERSCRIPT DEBUG [%c\${timeString}%c]: %c\${trackData.title}\`,
                "color: #7bd583ff; font-weight: bold; font-size: 14px;",
                "color: #cfa600ff; font-weight: bold; font-size: 14px;",
                "color: #7bd583ff; font-weight: bold; font-size: 14px;",
                "color: #efefefff; font-weight: bold; font-size: 14px;"
              );
              console.log("%cScript Information:", "color: #ffb86c; font-weight: bold; font-size: 13px;");
              console.log("  • Title:       ", trackData.title);
              console.log("  • Domain:      ", trackData.domain);
              console.log("  • Url Patterns:", trackData.urlPatterns || "—");
              console.log("  • Mode:        ", trackData.mode);
              const song = trackData.song;
              console.log("%cSong Information:", "color: #8be9fd; font-weight: bold; font-size: 13px;");
              console.log("  • Title:      ", song.title || "Unknown");
              console.log("  • Artist:     ", song.artist || "Unknown");
              console.log("  • Source:     ", song.source || "Unknown");
              console.log("  • Song URL:   ", song.link || "N/A");
              console.log("  • Image:      ", song.image || "Default Image");
              console.log("  • Duration:   ", "${script.watchAutoDetect}" === "enable" ? "Auto-Detect" : song.duration ?? "N/A");
              console.log("  • Time Passed:", "${script.watchAutoDetect}" === "enable" ? "Auto-Detect" : song.timePassed ?? "N/A");
              console.log("  • isPlaying:  ", "${script.watchAutoDetect}" === "enable" ? "Auto-Detect" : song.isPlaying ?? "N/A");
              console.log("  • Buttons:    ", song.buttons ?? "N/A");
              console.groupEnd();
            }

            window.postMessage({ type: "USER_SCRIPT_TRACK_DATA", data: { ...trackData, iframeSelectors: ${JSON.stringify(script.iframeSelectors || null)},}}, "*");
          } catch (error) {
            const now = new Date();
            const timeString = \`\${String(now.getHours()).padStart(2,'0')}:\${String(now.getMinutes()).padStart(2,'0')}:\${String(now.getSeconds()).padStart(2,'0')}\`;
            console.groupCollapsed(\`%c Web Presence - USERSCRIPT ERROR [%c\${timeString}%c]: %cTracking Failed\`,
              "color: #ff5555ff; font-weight: bold; font-size: 14px;",
              "color: #cfa600ff; font-weight: bold; font-size: 14px;",
              "color: #ff5555ff; font-weight: bold; font-size: 14px;",
              "color: #efefefff; font-weight: bold; font-size: 14px;"
            );
            console.log("%cError Details:", "color: #ff5555; font-weight: bold; font-size: 13px;");
            console.log("  • Message :", error.message || String(error));
            if (error.stack) console.log("  • Stack   :", error.stack);
            console.groupEnd();
          }
        }
        await updateTrackData();
        setInterval(updateTrackData, 4000);
      }, 100);
    })();
    `;
  }

  resolveWorld(code) {
    const lines = code.split("\n");
    const userScriptIndex = lines.findIndex((line) => line.trim().startsWith("// UserScript"));
    if (userScriptIndex === -1) {
      return "USER_SCRIPT";
    }
    const headerSlice = lines.slice(userScriptIndex, userScriptIndex + 5).join("\n");
    const match = headerSlice.match(/\/\/\s*@world\s+(main|isolated)/);
    if (!match) return "USER_SCRIPT";
    return match[1] === "main" ? "MAIN" : "USER_SCRIPT";
  }

  async registerUserScript(script) {
    try {
      if (!script.id) {
        script.id = generateParserKey(script.domain, script.urlPatterns, script.authors || []);
      }
      const manifest = browser.runtime.getManifest();
      const isMV3 = manifest.manifest_version === 3;

      const domains = (Array.isArray(script.domain) ? script.domain : [script.domain]).filter(Boolean);

      const matches = domains.flatMap((d) => {
        const cleanDomain = d.replace(/^www\./, "");

        if (d.startsWith("*.")) {
          return [`*://${cleanDomain}/*`, `*://*.${cleanDomain}/*`];
        } else {
          return [`*://${cleanDomain}/*`, `*://www.${cleanDomain}/*`];
        }
      });

      const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
      const isEnabled = parserEnabledState[`enable_${script.id}`] !== false;

      if (!isEnabled) return { ok: true, skipped: true, reason: "Script is disabled" };

      const trackingCode = this.buildTrackDataScript(script);

      if (!browser.userScripts?.register) throw new Error("No compatible userscript API available");

      let registeredUserScript = null;

      if (isMV3) {
        registeredUserScript = await browser.userScripts.register([
          {
            id: script.id,
            js: [{ code: trackingCode }],
            matches,
            runAt: script.runAt || "document_end",
            world: this.resolveWorld(trackingCode),
          },
        ]);
        this.registeredScripts.set(script.id, registeredUserScript);
      }

      return { ok: true, registrationId: script.id, raw: registeredUserScript };
    } catch (error) {
      logError("[userScriptWorker]: Failed to register user script:", error);
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async unregisterUserScript(script, skipStorageUpdate = false) {
    if (!script?.id) return { ok: true, skipped: true, reason: "No script ID provided" };

    try {
      const manifest = browser.runtime.getManifest();
      const isMV3 = manifest.manifest_version === 3;

      if (isMV3) {
        const existingScripts = await browser.userScripts.getScripts();
        const scriptExists = existingScripts.some((s) => s.id === script.id);

        if (!scriptExists) {
          return { ok: true, skipped: true, reason: "Script not registered" };
        }
        await browser.userScripts.unregister({ ids: [script.id] });
      }

      const registeredUserScript = this.registeredScripts.get(script.id);
      if (registeredUserScript) await registeredUserScript.unregister();

      this.registeredScripts.delete(script.id);

      if (!skipStorageUpdate) {
        const scripts = await this.storage.getScripts();
        const scriptIndex = scripts.findIndex((s) => s.id === script.id);
        if (scriptIndex >= 0) {
          scripts[scriptIndex].registered = false;
          await this.storage.saveScripts(scripts);
        }
      }

      await this.delay(50);
      return { ok: true };
    } catch (error) {
      if (!error.message.includes("Nonexistent script ID")) {
        logError("[userScriptWorker]: Failed to unregister user script:", error);
      }
      return { ok: true };
    }
  }

  async registerAllScripts() {
    const scripts = await this.storage.getScripts();
    const { parserEnabledState = {} } = await browser.storage.local.get("parserEnabledState");
    const results = { successful: [], failed: [], disabled: [] };

    for (const script of scripts) {
      try {
        if (!script.id) script.id = generateParserKey(script.domain, script.urlPatterns, script.authors || []);

        if (parserEnabledState[`enable_${script.id}`] === undefined) {
          parserEnabledState[`enable_${script.id}`] = true;
        }

        await this.unregisterUserScript(script, true);

        if (parserEnabledState[`enable_${script.id}`] === false) {
          script.registered = false;
          results.disabled.push(script.id);
          continue;
        }

        await this.delay(50);
        const registrationResult = await this.registerUserScript(script);

        if (registrationResult.ok && !registrationResult.skipped) {
          script.registered = true;
          results.successful.push(script.id);
        } else if (registrationResult.skipped) {
          results.disabled.push(script.id);
        } else {
          script.registered = false;
          results.failed.push({ id: script.id, error: registrationResult.error });
        }
      } catch (error) {
        logError(`[userScriptWorker]: Error processing script ${script.id}:`, error);
        script.registered = false;
        results.failed.push({ id: script.id, error: error.message });
      }
    }

    await this.storage.saveScripts(scripts);
    return results;
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export main functionality
const scriptManager = new UserScriptManager();
