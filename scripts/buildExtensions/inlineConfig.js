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

  inlineUtilsFunctions(["background.js", "common/utils.js", "main.js"], "common/debugLogger.js", [], "start", true);

  // Logs
  inlineUtilsFunctions(["background.js", "mainParser.js"], "common/utils/logging.js", [], "start");

  // Shared
  inlineUtilsFunctions(["common/utils.js", "popup/selector/selector.js"], ["../shared/dialog.js", "../shared/i18n.js"], [], [], "start");

  // Tom Select Plugins
  inlineUtilsFunctions(["common/utils.js"], "../shared/tom-select-plugins.js", [], [], "end");

  // Truncate
  inlineUtilsFunctions(["common/utils.js", "popup/selector/selector.js", "background.js"], "../shared/utils.js", ["truncate"]);

  // Background Utils
  inlineUtilsFunctions("background.js", "common/utils.js", [
    "delay",
    "DEFAULT_PARSER_OPTIONS",
    "parseUrlPattern",
    "regexFromString",
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
    "handlePendingTabReload",
    "restartExtension",
    "toggleDebugMode",
    "factoryResetConfirm",
    "factoryResetTimer",
    "factoryResetTimeout",
    "factoryReset",
    "splitAndTrim",
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
    "extractText",
    "getText",
    "getTextAll",
    "isValidSelectorUrl",
    "getImage",
    "getImageAll",
    "isPartialClassSelector",
    "querySelectorDeep",
    "applyStrip",
    "parseIgnoreSelector",
    "cloneWithoutIgnored",
    "resolveTarget",
    "imageFromElement",
    "generateParserKey",
    "getPlainText",
    "isValidUrl",
    "isDomainMatch",
    "normalizeHost",
    "getSafeText",
    "getSafeHref",
    "delay",
    "DEFAULT_PARSER_OPTIONS",
    "parseUrlPattern",
    "regexFromString",
  ]);

  inlineUtilsFunctions(["mainParser.js", "common/utils.js"], "popup/selector/modules/selectorUtils.js", ["queryWithPartialClass"]);

  // Selector Utils
  inlineUtilsFunctions("popup/selector/selector.js", "common/utils.js", [
    "throttle",
    "normalizeTitleAndArtist",
    "formatLabel",
    "queryWithPartialClass",
    "getPlainText",
    "getIconAsDataUrl",
    "parseRegexArray",
    "svg_paths",
    "svgCache",
    "createSVG",
  ]);

  inlineUtilsFunctions("popup/selector/selector.js", ["common/utils/selector-validation.js"]);

  // Selector Components
  inlineUtilsFunctions("popup/selector/selector.js", [], [], "start", true, { dir: "popup/selector/components" });
  inlineUtilsFunctions("popup/selector/selector.js", [], [], "start", true, { dir: "popup/selector/modules" });

  // Popup Components
  inlineUtilsFunctions("popup/popup.js", [], [], "start", true, { dir: "popup/components" });

  // Build CodeMirror 5
  inlineUtilsFunctions(
    "libs/codemirror/codemirror.js",
    ["libs/codemirror/libs/jshint.js", "libs/codemirror/libs/jshintFilters.js", "libs/codemirror/addons/", "libs/beautify.js"],
    [],
    "end",
    true,
  );

  // User Script Manager
  inlineUtilsFunctions("manager/userScriptManager.js", "manager/components/UseSettingEditor.js", [], "start", true);
  inlineUtilsFunctions(
    "manager/userScriptWorker.js",
    "common/utils.js",
    [
      "getText",
      "getTextAll",
      "isValidSelectorUrl",
      "extractText",
      "getImage",
      "getImageAll",
      "queryWithPartialClass",
      "isPartialClassSelector",
      "querySelectorDeep",
      "applyStrip",
      "parseIgnoreSelector",
      "cloneWithoutIgnored",
      "resolveTarget",
      "imageFromElement",
      "generateParserKey",
      "regexFromString",
    ],
    "_INLINE_UTILS",
  );
  inlineUtilsFunctions("background.js", ["manager/userScriptWorker.js"], []);
  inlineUtilsFunctions("iframeParser.js", ["common/utils.js"], ["isPartialClassSelector", "querySelectorDeep", "queryWithPartialClass"], "start");

  // Background Listeners
  inlineUtilsFunctions("background.js", [], [], "start", true, { dir: "background" });

  // Setting Components
  inlineUtilsFunctions("settings/settings.js", [], [], "start", true, { dir: "settings/components" });
};
