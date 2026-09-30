// Page Visibility override
(() => {
  if (window.top !== window) return;
  if (window.WP_VISIBILITY_OVERRIDE_ACTIVE) return;
  window.WP_VISIBILITY_OVERRIDE_ACTIVE = true;

  const CMD = "wp-ka:cmd";
  const EVT = "wp-ka:evt";
  let active = false;

  const docProto = Document.prototype;

  const originals = {};
  ["hidden", "visibilityState", "webkitHidden", "webkitVisibilityState"].forEach((k) => {
    originals[k] = Object.getOwnPropertyDescriptor(docProto, k);
  });
  const originalHasFocus = Document.prototype.hasFocus;

  const nativeToString = Function.prototype.toString;
  const fakeNative = new WeakMap();
  Function.prototype.toString = new Proxy(nativeToString, {
    apply(target, thisArg, args) {
      if (fakeNative.has(thisArg)) return fakeNative.get(thisArg);
      return Reflect.apply(target, thisArg, args);
    },
  });

  const makeGetter = (name, value) => {
    const fn = { [`get ${name}`]: () => value }[`get ${name}`];
    fakeNative.set(fn, `function get ${name}() { [native code] }`);
    return fn;
  };

  const define = (prop, value) => {
    try {
      Object.defineProperty(docProto, prop, {
        configurable: true,
        enumerable: true,
        get: makeGetter(prop, value),
      });
    } catch {
      // The page prototype may have locked with configurable:false; pass silently
    }
  };

  const dispatchSynthetic = (target, type) => {
    const evt = new Event(type);
    Object.defineProperty(evt, "__wpSynthetic", { value: true });
    target.dispatchEvent(evt);
  };

  const notifyPageVisible = () => {
    dispatchSynthetic(document, "visibilitychange");
    dispatchSynthetic(document, "webkitvisibilitychange");
    dispatchSynthetic(window, "focus");
  };

  const BLOCKED_DOC = ["visibilitychange", "webkitvisibilitychange"];
  const blockDocEvent = (e) => {
    if (!active || e.__wpSynthetic) return;
    e.stopImmediatePropagation();
  };
  const blockWindowBlurEvent = (e) => {
    if (!active || e.__wpSynthetic) return;
    if (e.target === window) e.stopImmediatePropagation();
  };

  BLOCKED_DOC.forEach((t) => window.addEventListener(t, blockDocEvent, true));
  document.addEventListener("visibilitychange", blockDocEvent, true);
  window.addEventListener("blur", blockWindowBlurEvent, true);
  document.addEventListener("freeze", blockDocEvent, true);

  document.addEventListener(
    "resume",
    () => {
      if (!active) return;
      notifyPageVisible();
    },
    true,
  );

  const enable = () => {
    if (active) return;
    active = true;

    define("hidden", false);
    define("webkitHidden", false);
    define("visibilityState", "visible");
    define("webkitVisibilityState", "visible");

    const fakeHasFocus = function hasFocus() {
      return true;
    };
    fakeNative.set(fakeHasFocus, "function hasFocus() { [native code] }");
    Document.prototype.hasFocus = fakeHasFocus;

    notifyPageVisible();
  };

  const disable = () => {
    if (!active) return;
    active = false;

    Object.entries(originals).forEach(([k, d]) => {
      if (d) Object.defineProperty(docProto, k, d);
    });
    Document.prototype.hasFocus = originalHasFocus;

    dispatchSynthetic(document, "visibilitychange");
    dispatchSynthetic(document, "webkitvisibilitychange");
  };

  window.addEventListener(CMD, (e) => {
    if (e.detail === "enable") enable();
    else if (e.detail === "disable") disable();
    window.dispatchEvent(new CustomEvent(EVT, { detail: active ? "active" : "inactive" }));
  });
})();
