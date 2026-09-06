/**
 * Registers all inline utility function mappings.
 * Called from the build script after `inlineUtilsFunctions` is defined.
 *
 * @param {Function} inlineUtilsFunctions - The registration function from build.js
 */
module.exports = function registerInlines(inlineUtilsFunctions) {
  // CONFIG
  inlineUtilsFunctions(["background.js", "common/utils.js", "mainParser.js"], "config.js", [], "start", true);

  inlineUtilsFunctions(["background.js"], "activityLibrary/service.js", [], "start", true);
  inlineUtilsFunctions(["background.js", "common/utils.js", "main.js"], "common/debugLogger.js", [], "start");

  // Shared
  inlineUtilsFunctions(["common/utils.js", "popup/selector/selector.js"], ["../shared/dialog.js", "../shared/i18n.js"], [], [], "start");

  // Tom Select Plugins
  inlineUtilsFunctions(["common/utils.js"], "../shared/tom-select-plugins.js", [], [], "end");

  // Truncate
  inlineUtilsFunctions(["common/utils.js", "popup/selector/selector.js", "background.js"], "../shared/utils.js", ["truncate"]);

  // Logs
  inlineUtilsFunctions(["background.js", "mainParser.js"], "common/utils.js", [
    "getDebugMode",
    "_writeDebugLog",
    "logInfo",
    "logWarn",
    "errorFilter",
    "shouldIgnore",
    "logError",
    "delay",
    "DEFAULT_PARSER_OPTIONS",
    "parseUrlPattern",
  ]);

  // Background Utils
  inlineUtilsFunctions("background.js", "common/utils.js", [
    "normalizeHost",
    "normalize",
    "normalizeTitleAndArtist",
    "getCurrentTime",
    "openIndexedDB",
    "createMutex",
    "findMatchingParsersForUrl",
    "generateParserKey",
    "fetchWithTimeout",
    "getSenderTab",
    "isAllowedDomain",
    "isValidUrl",
    "isDomainMatch",
    "sendAction",
    "restartExtension",
    "toggleDebugMode",
    "factoryResetConfirm",
    "factoryResetTimer",
    "factoryResetTimeout",
    "factoryReset",
  ]);

  // Main Utils
  inlineUtilsFunctions("main.js", "common/utils.js", [
    "debounce",
    "getColorSettings",
    "saveStyleAttrs",
    "applyThemeSettings",
    "applyBackgroundSettings",
    "applyColorSettings",
    "isGradient",
    "parseGradient",
    "extractGradientColors",
    "generateForegroundScaleGradients",
    "generateForegroundScale",
    "getCSSThemeDefault",
    "getDefaultCSSValue",
    "getColorVariant",
  ]);

  // Main Parser Utils
  inlineUtilsFunctions("mainParser.js", "common/utils.js", [
    "extractTimeParts",
    "parseTime",
    "formatTime",
    "getTimestamps",
    "processPlaybackInfo",
    "getText",
    "getTextAll",
    "isValidSelectorUrl",
    "getImage",
    "getImageAll",
    "querySelectorDeep",
    "applyStrip",
    "parseIgnoreSelector",
    "cloneWithoutIgnored",
    "generateParserKey",
    "getPlainText",
    "isValidUrl",
    "isDomainMatch",
    "normalizeHost",
    "getSafeText",
    "getSafeHref",
  ]);

  inlineUtilsFunctions(["mainParser.js", "common/utils.js"], "popup/selector/modules/selectorUtils.js", ["queryWithPartialClass"]);

  // Selector Utils
  inlineUtilsFunctions("popup/selector/selector.js", "common/utils.js", [
    "throttle",
    "normalizeTitleAndArtist",
    "formatLabel",
    "querySelectorDeep",
    "queryWithPartialClass",
    "getPlainText",
    "getIconAsDataUrl",
    "parseRegexArray",
    "svg_paths",
    "svgCache",
    "createSVG",
  ]);

  // Selector Components
  inlineUtilsFunctions("popup/selector/selector.js", [], [], "start", true, { dir: "popup/selector/components" });
  inlineUtilsFunctions("popup/selector/selector.js", [], [], "start", true, { dir: "popup/selector/modules" });

  // Popup Components
  inlineUtilsFunctions("popup/popup.js", [], [], "start", true, { dir: "popup/components" });

  // Build CodeMirror 5
  inlineUtilsFunctions("libs/codemirror/codemirror.js", ["libs/codemirror/libs/jshint.js", "libs/codemirror/addons/", "libs/beautify.js"], [], "end", true);

  // User Script Manager
  inlineUtilsFunctions("manager/userScriptManager.js", "manager/components/UseSettingEditor.js", [], "start", true);
  inlineUtilsFunctions(
    "manager/userScriptWorker.js",
    "common/utils.js",
    [
      "getText",
      "getTextAll",
      "isValidSelectorUrl",
      "getImage",
      "getImageAll",
      "queryWithPartialClass",
      "querySelectorDeep",
      "applyStrip",
      "parseIgnoreSelector",
      "cloneWithoutIgnored",
      "generateParserKey",
    ],
    "_INLINE_UTILS",
  );
  inlineUtilsFunctions("background.js", ["manager/userScriptWorker.js"], []);
  inlineUtilsFunctions("iframeParser.js", ["common/utils.js"], ["querySelectorDeep", "queryWithPartialClass"], "start");

  // Background Listeners
  inlineUtilsFunctions("background.js", [], [], "start", true, { dir: "background" });

  // Setting Components
  inlineUtilsFunctions("settings/settings.js", [], [], "start", true, { dir: "settings/components" });
};
