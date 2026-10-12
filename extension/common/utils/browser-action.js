// Send Action to background with retry
async function sendAction(action, payload = {}) {
  for (let retry = 0; retry < 10; retry++) {
    try {
      const response = await browser.runtime.sendMessage({ action, ...payload });

      // If no response
      if (response === undefined) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      if (response && typeof response === "object" && "ok" in response) {
        return response;
      }

      return { ok: true, data: response };
    } catch (err) {
      const msg = err?.message || "";

      if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: "No response after retries" };
}

// Get Sender Tab
async function getSenderTab(sender) {
  if (sender?.tab?.id) return sender.tab;
  logWarn("[background]: getSenderTab - sender.tab missing");
  return null;
}

// Handle pending tab reload
const handlePendingTabReload = async () => {
  try {
    const { _pendingReloadTabId, _pendingTargetUrl } = await browser.storage.local.get(["_pendingReloadTabId", "_pendingTargetUrl"]);
    if (!_pendingReloadTabId && !_pendingTargetUrl) return;

    await browser.storage.local.remove(["_pendingReloadTabId", "_pendingTargetUrl"]);
    logInfo("[background]: pending actions detected, processing...");

    // 1. Refresh tabs
    if (_pendingReloadTabId) {
      const tabIds = Array.isArray(_pendingReloadTabId) ? _pendingReloadTabId : [_pendingReloadTabId];
      await Promise.allSettled(tabIds.map((id) => browser.tabs.reload(id).catch(() => {})));
      logInfo("[background]: tabs reloaded");
    }

    // 2. If there is a target URL, find any open tabs with the same URL, close them, and open a new one
    if (_pendingTargetUrl) {
      const existingTabs = await browser.tabs.query({ url: _pendingTargetUrl });
      if (existingTabs.length > 0) {
        const closePromiseList = existingTabs.map((t) => browser.tabs.remove(t.id).catch(() => {}));
        await Promise.allSettled(closePromiseList);
        logInfo("[background]: existing matching tabs closed");
      }

      await browser.tabs.create({ url: _pendingTargetUrl });
      logInfo("[background]: target URL opened:", _pendingTargetUrl);
    }
  } catch (err) {
    logError("[background]: handlePendingTabReload error:", err);
  }
};
