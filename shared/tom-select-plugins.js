function applyTsPlugins() {
  // TomSelect - Dropdown Auto Width Plugin
  TomSelect.define("auto_width", function (options = {}) {
    const self = this;
    const isExtension = options.isExtension ?? false;
    const hasSimplebar = options.sb ?? true;
    const MAX_WIDTH = options.maxWidth || 220;
    const FALLBACK_MS = options.fallbackMs || 400;

    let token = 0; // increases with every open/close/refresh, cancels previous operations
    let pendingReady = null; // listener waiting for simplebar_ready
    let fallbackTimer = null;

    const clearPending = () => {
      if (pendingReady) {
        self.off("simplebar_ready", pendingReady);
        pendingReady = null;
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const autoResizeTs = (ts, reset) => {
      const control = ts.control;
      const dropdown = ts.dropdown;
      const content = ts.dropdown_content;

      token++;
      clearPending();

      if (reset) {
        content.style.whiteSpace = "";
        dropdown.style.width = "";
        control.style.width = "";
        dropdown.classList.remove("is-overflow", "scrollbar-active", "is-extension", "is-server");
        return;
      }

      const myToken = token;

      const run = () => {
        // do nothing if it is canceled or the dropdown is closed
        if (myToken !== token || !ts.isOpen) return;

        const items = dropdown.querySelectorAll(".option");
        content.style.whiteSpace = "nowrap";

        let maxWidth = control.offsetWidth;
        items.forEach((item) => {
          const width = item.scrollWidth;
          if (width > maxWidth) maxWidth = width;
        });

        const scrollbar = dropdown.querySelector(".simplebar-vertical[style='visibility: visible;']");

        if (scrollbar) dropdown.classList.add("scrollbar-active");
        else dropdown.classList.remove("scrollbar-active");

        dropdown.classList.add(isExtension ? "is-extension" : "is-server");

        const offset = scrollbar && !isExtension ? scrollbar.offsetWidth + 10 : 4;
        let finalWidth = maxWidth + offset;

        if (finalWidth > MAX_WIDTH) {
          dropdown.classList.add("is-overflow");
          content.style.whiteSpace = "";
          finalWidth = MAX_WIDTH;
        } else {
          dropdown.classList.remove("is-overflow");
        }

        dropdown.style.width = finalWidth + "px";
        control.style.width = finalWidth + "px";
      };

      // Run directly if SimpleBar is not used
      if (!hasSimplebar) {
        run();
        return;
      }

      // If SimpleBar is being used: always wait for simplebar_ready.
      // (The old wrapper might still be in the DOM, so don't rely on DOM check.)
      pendingReady = () => {
        clearPending();
        requestAnimationFrame(run);
      };
      self.on("simplebar_ready", pendingReady);

      // Backup: If SimpleBar never becomes ready, the width should still be set
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (pendingReady) {
          self.off("simplebar_ready", pendingReady);
          pendingReady = null;
        }
        run();
      }, FALLBACK_MS);
    };

    self.on("dropdown_open", () => autoResizeTs(self));
    self.on("dropdown_close", () => autoResizeTs(self, true));

    // Recalculate the width if the list changes with Search/load
    self.hook("after", "refreshOptions", () => {
      if (self.isOpen) autoResizeTs(self);
    });

    self.on("destroy", clearPending);
  });

  // TomSelect - Simplebar Plugin
  TomSelect.define("simplebar", function (options = {}) {
    const self = this;
    const isExtension = options.isExtension || false;
    const simpleBars = options.simpleBars || {};
    const storeKey = options.key || self.inputId;

    // init/teardown runs in order: a new setup does not start before the teardown finishes
    let chain = Promise.resolve();
    const enqueue = (fn) => {
      chain = chain.then(fn).catch((_) => {});
      return chain;
    };

    const hasWrapper = (list) => !!list.querySelector(":scope > .simplebar-wrapper");
    let initQueued = false;

    const init = async (attempt = 0) => {
      initQueued = false;
      if (!self.isOpen) return;
      const list = self.dropdown_content;
      if (!list) return;

      if (isExtension) {
        // If there is an instance but the DOM has been removed: clear the stale instance
        if (simpleBarInstances.get(list) && !hasWrapper(list)) {
          await destroySimplebar(list);
        }

        // Trigger auto_width as soon as the instance is ready (padding is not awaited)
        const earlyReady = () => {
          if (self.isOpen) self.trigger("simplebar_ready");
        };

        const res = await activateSimpleBar(list, 200, 30, earlyReady);
        const ok = res?.[0]?.success;

        if (!ok && attempt < 2 && self.isOpen) {
          // failure due to visibility/timing: wait for a frame and try again
          await new Promise(requestAnimationFrame);
          return init(attempt + 1);
        }
        return; // ready has already been triggered with earlyReady
      }

      // Server mode
      const inst = simpleBars[storeKey];
      if (inst && !hasWrapper(list)) {
        try {
          inst.unMount();
        } catch (e) {}
        delete simpleBars[storeKey];
      }
      if (simpleBars[storeKey]) simpleBars[storeKey].recalculate();
      else simpleBars[storeKey] = new SimpleBar(list);

      if (self.isOpen) self.trigger("simplebar_ready");
    };

    const teardown = async () => {
      if (isExtension) {
        await destroySimplebar(self.dropdown_content);
      } else if (simpleBars[storeKey]) {
        try {
          simpleBars[storeKey].unMount();
        } catch (e) {}
        delete simpleBars[storeKey];
      }
    };

    const queueInit = () => {
      if (initQueued) return; // reduce consecutive refreshOptions to a single init
      initQueued = true;
      enqueue(() => init());
    };

    self.on("dropdown_open", queueInit);
    self.hook("after", "refreshOptions", () => {
      if (self.isOpen) queueInit();
    });
    self.on("dropdown_close", () => enqueue(teardown));

    // Automatically reinitialize if TomSelect rewrites the content and removes the wrapper

    const observer = new MutationObserver(() => {
      const list = self.dropdown_content;
      if (self.isOpen && list && !hasWrapper(list)) queueInit();
    });
    self.on("initialize", () => {
      observer.observe(self.dropdown_content, { childList: true });
    });
    self.on("destroy", () => observer.disconnect());
  });
}
