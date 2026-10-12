// Restart Extension
async function restartExtension(onlyActiveTab = false, targetUrl = null) {
  try {
    let reloadTabIds = [];
    if (onlyActiveTab) {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (activeTab?.id) reloadTabIds = [activeTab.id];
    } else {
      const { parserList = [] } = await browser.storage.local.get("parserList");
      const domains = parserList.flatMap((p) => (Array.isArray(p.domain) ? p.domain : [p.domain])).filter(Boolean);
      const tabs = await browser.tabs.query({});
      for (const t of tabs) {
        if (!t.url) continue;
        try {
          const url = new URL(t.url);
          const hostname = url.hostname.replace(/^www\./, "");
          if (domains.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
            reloadTabIds.push(t.id);
          }
        } catch {}
      }
    }

    const pendingData = {};
    if (reloadTabIds.length > 0) pendingData._pendingReloadTabId = reloadTabIds;
    if (targetUrl) pendingData._pendingTargetUrl = targetUrl;

    if (Object.keys(pendingData).length > 0) {
      await browser.storage.local.set(pendingData);
    }

    if (typeof _dbPromise !== "undefined" && _dbPromise) {
      try {
        const db = await _dbPromise;
        db.close();
        await new Promise((r) => setTimeout(r, 50));
      } catch (_) {}
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    browser.runtime.reload();
  } catch (err) {
    logError("[restartExtension]: Restart the extension error:", err);
    console.error("[restartExtension] Failed, manual reload may be needed");
  }
}

// Toggle Debug Mode
async function toggleDebugMode() {
  try {
    const stored = (await browser.storage.local.get("debugMode")).debugMode;
    const current = stored ?? CONFIG.debugMode;
    const newValue = current === 0 ? 1 : 0;

    await browser.storage.local.set({ debugMode: newValue });
    CONFIG.debugMode = newValue;
    await restartExtension();
  } catch (err) {
    logError("[toggleDebugMode]: Toggle Debug Mode error:", err);
  }
}

// Factory Reset
let factoryResetConfirm = false;
let factoryResetTimer = null;
const factoryResetTimeout = 5000;

async function factoryReset(tab) {
  if (!factoryResetConfirm) {
    factoryResetConfirm = true;

    if (factoryResetTimer) {
      clearTimeout(factoryResetTimer);
    }

    factoryResetTimer = setTimeout(() => {
      factoryResetConfirm = false;
      factoryResetTimer = null;
    }, factoryResetTimeout);

    return { needConfirm: true };
  }

  // Factory Reset Action
  factoryResetConfirm = false;
  if (factoryResetTimer) {
    clearTimeout(factoryResetTimer);
    factoryResetTimer = null;
  }

  try {
    await browser.storage.local.clear();
    if (tab && tab.id) await browser.tabs.reload(tab.id);
    await restartExtension();
  } catch (err) {
    logError("[factoryReset]: Reset to Defaults error:", err);
  }
}
