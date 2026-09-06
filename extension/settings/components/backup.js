async function initBackupButtons() {
  // Export Button
  document.getElementById("exportBtn").onclick = async () => {
    try {
      const storageDump = await browser.storage.local.get(null);
      const historyDump = await exportIndexedDB("HistoryDB");
      const now = new Date();
      const pad = (n) => n.toString().padStart(2, "0");
      const dateString = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      const fullBackup = {
        time: now.toISOString(),
        storage: storageDump,
        indexedDB: {
          HistoryDB: historyDump,
        },
      };

      const blob = new Blob([JSON.stringify(fullBackup, null, 2)], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `web-presence-backup-${dateString}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showAlert(i18n.t("backup.export.complete"));
    } catch (err) {
      showAlert("Export failed: " + err.message);
    }
  };

  // Import Button
  document.getElementById("importBtn").onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";

    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const storageToRestore = data.storage;

        if (!storageToRestore || typeof storageToRestore !== "object") {
          throw new Error("Invalid storage data");
        }
        // storage
        await browser.storage.local.clear();
        await browser.storage.local.set(storageToRestore);
        // indexedDB
        if (data.indexedDB?.HistoryDB) {
          await importIndexedDB("HistoryDB", data.indexedDB.HistoryDB);
        }
        browser.runtime.reload();
      } catch (err) {
        showAlert("Import failed: " + (err.message || err));
      }
    };

    input.click();
  };

  // Sync History Button
  const syncBtn = document.getElementById("syncBtn");
  const { webOnlyMode: storedWebMode } = await browser.storage.local.get("webOnlyMode");
  const currentConnectionMode = storedWebMode === true ? "web-only" : "default";

  if (currentConnectionMode !== "web-only") {
    syncBtn.style.display = "";
    syncBtn.addEventListener("click", async () => {
      const originalText = syncBtn.textContent;

      try {
        syncBtn.textContent = i18n.t("backup.sync");
        syncBtn.disabled = true;

        const result = await sendAction("syncHistory");

        if (result.ok) {
          syncBtn.textContent = i18n.t("backup.synced", { count: result.count });
        } else {
          syncBtn.textContent = `Failed: ${result.error}`;
        }
      } catch (error) {
        syncBtn.textContent = `Error: ${error.message}`;
      } finally {
        setTimeout(() => {
          syncBtn.textContent = originalText;
          syncBtn.disabled = false;
        }, 3000);
      }
    });
  }
}
