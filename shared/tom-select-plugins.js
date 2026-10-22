function applyTsPlugins() {
  // TomSelect - Dropdown Auto Width Plugin
  TomSelect.define("auto_width", function (options = {}) {
    const isExtension = options.isExtension ?? false;
    const hasSimplebar = options.sb ?? true;

    const waitForSimpleBar = (hasSimplebar, el) => {
      return new Promise((resolve) => {
        function check() {
          if (!hasSimplebar) return resolve();
          if (el.querySelector(".simplebar-content-wrapper")) {
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        }
        check();
      });
    };
    const autoResizeTs = (ts, reset) => {
      const control = ts.control;
      const dropdown = ts.dropdown;
      const content = ts.dropdown_content;

      if (reset) {
        content.style.whiteSpace = "";
        dropdown.style.width = "";
        control.style.width = "";
        dropdown.classList.remove("is-overflow");
        return;
      }

      const MAX_WIDTH = options.maxWidth || 220;

      waitForSimpleBar(hasSimplebar, content).then(() => {
        const items = dropdown.querySelectorAll(".option");
        content.style.whiteSpace = "nowrap";
        let maxWidth = control.offsetWidth;

        items.forEach((item) => {
          const width = item.scrollWidth;
          if (width > maxWidth) maxWidth = width;
        });

        const scrollbar = dropdown.querySelector(".simplebar-vertical[style='visibility: visible;']");

        if (scrollbar) dropdown.classList.add("scrollbar-active");
        isExtension ? dropdown.classList.add("is-extension") : dropdown.classList.add("is-server");

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
      });
    };

    this.on("dropdown_open", () => autoResizeTs(this));
    this.on("dropdown_close", () => autoResizeTs(this, true));
  });

  // TomSelect - Simplebar Plugin
  TomSelect.define("simplebar", function (options) {
    const self = this;
    const simpleBars = options.simpleBars || [];
    const isExtension = options.isExtension || false;
    let key = options.key || "";

    self.hook("after", "refreshOptions", async () => {
      const list = self.dropdown_content;
      if (!list) return;

      if (!key) key = list;

      const alreadyInitialized = list.classList.contains("simplebar-initialized") || list.querySelector(".simplebar-content-wrapper");
      if (alreadyInitialized) {
        if (simpleBars[key]) {
          simpleBars[key].recalculate();
        }
        return;
      }
      if (isExtension) {
        await destroySimplebar(key);
      } else if (simpleBars[key]) {
        simpleBars[key].unMount();
        simpleBars[key] = null;
      }

      if (list.scrollHeight > 0) {
        if (isExtension) {
          await activateSimpleBar(list);
        } else {
          simpleBars[key] = new SimpleBar(list);
        }
      }
    });

    self.hook("after", "close", async () => {
      if (isExtension) {
        await destroySimplebar(key);
      } else if (simpleBars[key]) {
        simpleBars[key].unMount();
        simpleBars[key] = null;
      }
    });
  });
}
