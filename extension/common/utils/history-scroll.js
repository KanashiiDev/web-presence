// Shared factory for history-panel infinite scroll. The popup render pipeline
// and the settings filter history controller previously shipped two
// near-identical copies of this logic with drifted constants (500 vs 700 ms
// release-to-load delay, 200 ms load cooldown vs none).
//
// Callers pass async abstracts ({ panel, isAllLoaded, renderMore }); the
// factory wires the SimpleBar scroll element, drag handling (release-to-load
// hint via showPopupMessage), rAF-throttled scroll listener and cleanup.
// Returns the cleanup function, or null when the panel has no SimpleBar
// instance.
async function createHistoryScroll({ panel, isAllLoaded, renderMore, loaderDelayMs = 500, loadCooldownMs = 200, popupFooterSelector = "body > footer" }) {
  const sbInstance = simpleBarInstances.get(panel);
  if (!sbInstance) return null;

  const scrollElement = sbInstance.getScrollElement?.() || panel.querySelector(".simplebar-content-wrapper") || panel.querySelector(".simplebar-content") || panel;

  const BOTTOM_TOLERANCE = 100;

  let isLoading = false;
  let lastScrollTop = scrollElement.scrollTop;
  let rafId = null;
  let isDragging = false;
  let dragStartTime = 0;
  let popupShown = false;
  let observer = null;
  let draggingInterval = null;

  const checkNearBottom = (tolerance = BOTTOM_TOLERANCE) => {
    return scrollElement.scrollTop + scrollElement.clientHeight >= scrollElement.scrollHeight - tolerance;
  };

  const waitForStableScroll = (timeout = 400) => {
    return new Promise((resolve) => {
      let lastPos = scrollElement.scrollTop;
      let stableCount = 0;

      const check = setInterval(() => {
        if (scrollElement.scrollTop === lastPos) {
          if (++stableCount >= 3) {
            clearInterval(check);
            resolve();
          }
        } else {
          lastPos = scrollElement.scrollTop;
          stableCount = 0;
        }
      }, 40);

      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, timeout);
    });
  };

  const tryLoad = async () => {
    if (isAllLoaded() || !(scrollElement.scrollHeight > scrollElement.clientHeight + 1) || !checkNearBottom() || isLoading || isDragging) {
      return;
    }

    isLoading = true;
    try {
      await renderMore();
    } catch (e) {
      logError("[history-scroll]: render error:", e);
    } finally {
      setTimeout(() => {
        isLoading = false;
      }, loadCooldownMs);
    }
  };

  const showReleaseHint = () => {
    showPopupMessage(i18n.t("popupMessage.releaseToLoadHistory"), "warning", null, 0, popupFooterSelector);
  };

  const hideReleaseHint = () => {
    if (popupShown) {
      hidePopupMessage();
      popupShown = false;
    }
  };

  const stopDraggingInterval = () => {
    if (draggingInterval) {
      clearInterval(draggingInterval);
      draggingInterval = null;
    }
  };

  const handleDragEnd = async () => {
    await waitForStableScroll(400);
    if (checkNearBottom(50)) await tryLoad();
  };

  const updateDraggingState = () => {
    const wasDragging = isDragging;
    isDragging = panel.classList.contains("simplebar-dragging") || !!sbInstance.el?.classList?.contains("simplebar-dragging");

    if (isDragging && !wasDragging) {
      // Drag started
      dragStartTime = Date.now();
      popupShown = false;

      if (isAllLoaded()) return;

      draggingInterval = setInterval(() => {
        if (!isDragging || isAllLoaded()) {
          stopDraggingInterval();
          return;
        }

        if (checkNearBottom()) {
          if (Date.now() - dragStartTime >= loaderDelayMs && !popupShown) {
            showReleaseHint();
            popupShown = true;
          }
        } else {
          dragStartTime = Date.now();
          hideReleaseHint();
        }
      }, 100);
    } else if (!isDragging && wasDragging) {
      // Drag ended
      stopDraggingInterval();
      hideReleaseHint();
      if (!isAllLoaded()) handleDragEnd();
    }
  };

  const scrollListener = () => {
    updateDraggingState();

    if (isDragging || scrollElement.scrollTop === lastScrollTop) return;
    lastScrollTop = scrollElement.scrollTop;

    if (rafId) return;

    rafId = requestAnimationFrame(async () => {
      rafId = null;
      await tryLoad();
    });
  };

  scrollElement.addEventListener("scroll", scrollListener, { passive: true });

  observer = new MutationObserver(updateDraggingState);
  observer.observe(panel, {
    attributes: true,
    attributeFilter: ["class"],
  });

  const cleanup = () => {
    scrollElement.removeEventListener("scroll", scrollListener);
    stopDraggingInterval();
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    hideReleaseHint();
  };

  return cleanup;
}
