const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const BUILDS_DIR = path.join(ROOT, "extensionBuilds");

const DEFAULT_TARGETS = ["chrome", "firefox"];

/**
 * Source files that define the extension logging API.
 *
 * The audit derives the tracked identifier set from these files instead of hard-coding a
 * list, so the watch list cannot silently drift away from the implementation. Any top-level
 * declaration in these files becomes a tracked identifier that must resolve in every
 * execution scope that references it.
 */
const LOGGING_API_SOURCES = ["extension/common/utils/logging.js", "extension/common/debugLogger.js"];

/**
 * Identifiers that always exist in a browser/extension realm.
 *
 * Only consulted for tracked identifiers, so the list stays small and focused: it exists to
 * avoid reporting a tracked name that happens to collide with a platform global.
 */
const KNOWN_GLOBALS = new Set(
  [
    "window",
    "document",
    "console",
    "browser",
    "chrome",
    "globalThis",
    "self",
    "top",
    "parent",
    "frames",
    "location",
    "navigator",
    "history",
    "localStorage",
    "sessionStorage",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "Worker",
    "SharedWorker",
    "Blob",
    "File",
    "FileReader",
    "FormData",
    "Headers",
    "Request",
    "Response",
    "URL",
    "URLSearchParams",
    "TextEncoder",
    "TextDecoder",
    "atob",
    "btoa",
    "crypto",
    "CustomEvent",
    "Event",
    "MessageEvent",
    "MutationObserver",
    "IntersectionObserver",
    "ResizeObserver",
    "performance",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "queueMicrotask",
    "structuredClone",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "getComputedStyle",
    "matchMedia",
    "Notification",
    "postMessage",
    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Symbol",
    "BigInt",
    "Promise",
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "Date",
    "Math",
    "JSON",
    "RegExp",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Proxy",
    "Reflect",
    "Intl",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "NodeList",
    "HTMLCollection",
    "DocumentFragment",
    "ShadowRoot",
    "MutationRecord",
    "Headers",
    "AbortController",
    "AbortSignal",
    "Image",
    "Audio",
    "Video",
    "MediaQueryList",
    "Storage",
    "Uint8Array",
    "Int8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float32Array",
    "Float64Array",
    "ArrayBuffer",
    "DataView",
    "SharedArrayBuffer",
    "importScripts",
  ].join(" "),
);

module.exports = { ROOT, BUILDS_DIR, DEFAULT_TARGETS, LOGGING_API_SOURCES, KNOWN_GLOBALS };
