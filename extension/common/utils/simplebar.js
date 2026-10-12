// SimpleBar instance tracking state
const simpleBarInstances = new WeakMap();
const panelPromises = new WeakMap();
const allPanels = new Set();

// Activate simplebar
async function activateSimpleBar(targets, timeout = 500, interval = 30) {
  if (!Array.isArray(targets)) targets = [targets];

  const results = [];

  for (const target of targets) {
    try {
      let panel;
      let id = null;

      // If it is an HTMLElement, use it directly
      if (target instanceof HTMLElement) {
        panel = target;
        id = panel.id || "(no-id)";
      }
      // If not, treat it as an id string
      else {
        id = String(target).replace(/^#/, "");
        panel = document.getElementById(id);
      }

      if (!panel) {
        results.push({ id, success: false, reason: "not_found" });
        continue;
      }

      // Wait for panel visibility
      const isVisible = await waitFor(() => {
        const style = getComputedStyle(panel);
        return style.display !== "none" && style.visibility !== "hidden" && panel.offsetWidth > 0 && panel.offsetHeight > 0;
      }, 200);

      if (!isVisible) {
        results.push({ id, success: false, reason: "not_visible" });
        continue;
      }

      // Initialize or update SimpleBar
      let instance = simpleBarInstances.get(panel);
      if (instance && typeof instance.recalculate === "function") {
        instance.recalculate();
        await new Promise(requestAnimationFrame);
        results.push({ id, success: true, action: "recalculated" });
      } else {
        // Clear the old instance
        if (instance?.unMount) {
          instance.unMount();
          simpleBarInstances.delete(panel);
          panelPromises.delete(panel);
          panel.dataset.sbInit = "";
        }
        // Create a new instance
        instance = new SimpleBar(panel, { autoHide: false });
        simpleBarInstances.set(panel, instance);
        allPanels.add(panel);
        panel.dataset.sbInit = "1";
        results.push({ id, success: true, action: "initialized" });
      }

      // Update the padding
      await updatePanelPadding(panel, timeout, interval);
    } catch (error) {
      results.push({
        id: typeof target === "string" ? target : target?.id || null,
        success: false,
        reason: "error",
        error: error.message,
      });
    }
  }

  return results;
}

// Destroy Single Simplebar
async function destroySimplebar(panelOrId) {
  if (!panelOrId) return;

  const panel = typeof panelOrId === "string" ? document.getElementById(panelOrId) : panelOrId;
  if (!panel) return;

  const instance = simpleBarInstances.get(panel);
  if (!instance) return;
  instance.unMount?.();
  instance.el.querySelectorAll(":scope > .simplebar-track").forEach((el) => el.remove());

  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 16));

  // Cleanup
  simpleBarInstances.delete(panel);
  panel.dataset.sbInit = "";
  panel.style.paddingRight = "";
  allPanels?.delete?.(panel);
}

// Wait for unmount simplebar
function waitForUnmountSimplebars() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

// Destroy other simplebars except the one with keepId
let destroyingSimplebars = false;
let destroyQueue = Promise.resolve();
async function destroyOtherSimpleBarsQueued(keepId) {
  destroyQueue = destroyQueue.then(() => destroyOtherSimpleBars(keepId));
  return destroyQueue;
}

async function destroyOtherSimpleBars(keepId) {
  if (destroyingSimplebars) return;
  destroyingSimplebars = true;

  try {
    const keepPanel = document.getElementById(keepId);
    const unmountPromises = [];

    allPanels.forEach((panel) => {
      if (panel !== keepPanel) {
        const instance = simpleBarInstances.get(panel);

        const scrollbar = instance.el.querySelectorAll(":scope > .simplebar-track");
        scrollbar.forEach((el) => el.remove());

        instance?.unMount?.();
        unmountPromises.push(waitForUnmountSimplebars());

        simpleBarInstances.delete(panel);
        panelPromises.delete(panel);
        panel.dataset.sbInit = "";
        panel.style.paddingRight = "2px";

        allPanels.delete(panel);
      }
    });

    await Promise.all(unmountPromises);

    if (keepId) {
      const header = document.getElementById("mainHeader");
      header.style.pointerEvents = "none";
      await waitForUnmountSimplebars();
      await new Promise((r) => setTimeout(r, 30));
      header.style.pointerEvents = "";
    }
  } finally {
    destroyingSimplebars = false;
  }
}

// If simplebar is added, update the element's padding
async function updatePanelPadding(panel, timeout = 1000) {
  if (panelPromises.has(panel)) return panelPromises.get(panel);

  const promise = (async () => {
    try {
      const instance = simpleBarInstances.get(panel);
      if (!instance) return { ok: false, reason: "no_instance" };

      instance.recalculate?.();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      const scrollbar = await waitForScrollbar(instance, timeout);

      if (!scrollbar) {
        panel.style.paddingRight = "2px";
        return { ok: false, reason: "scrollbar_not_found" };
      }

      const isVisible = getComputedStyle(scrollbar).visibility === "visible";
      if (!panel.style.transition) {
        panel.style.transition = "padding var(--transition-reduced-fast), min-height var(--transition-reduced-fast)";
      }

      const newPadding = isVisible ? "16px" : "2px";

      if (panel.style.paddingRight === newPadding) {
        return { ok: true, visible: isVisible };
      }

      await new Promise((resolve) => {
        const handler = (e) => {
          if (e.propertyName !== "padding-right") return;
          panel.removeEventListener("transitionend", handler);
          resolve();
        };
        panel.addEventListener("transitionend", handler);
        panel.style.paddingRight = newPadding;
        setTimeout(resolve, 150);
      });

      return { ok: true, visible: isVisible };
    } catch (error) {
      panel.style.paddingRight = "2px";
      return { ok: false, error: error.message };
    } finally {
      panelPromises.delete(panel);
    }
  })();

  panelPromises.set(panel, promise);
  return promise;
}

// Wait for scrollbar to appear
function waitForScrollbar(instance, timeout = 1000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const scrollbar = instance.el.querySelector(":scope > .simplebar-vertical");

    // If scrollbar already exists
    if (scrollbar && scrollbar.offsetHeight > 0) {
      return resolve(scrollbar);
    }

    // Monitor DOM changes with MutationObserver
    const observer = new MutationObserver(() => {
      const currentScrollbar = instance.el.querySelector(":scope > .simplebar-vertical");
      if (currentScrollbar && currentScrollbar.offsetHeight > 0) {
        observer.disconnect();
        resolve(currentScrollbar);
      }

      // Timeout control
      if (Date.now() - startTime > timeout) {
        observer.disconnect();
        resolve(null);
      }
    });

    observer.observe(instance.el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    // Fallback: timeout
    setTimeout(() => {
      observer.disconnect();
      const finalScrollbar = instance.el.querySelector(":scope > .simplebar-vertical");
      resolve(finalScrollbar);
    }, timeout);
  });
}
