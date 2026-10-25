const fs = require("fs");
const { Router } = require("express");
const { mergeHistories } = require("../utils.js");

function createHistoryRouter(historyFilePath, logFilePath) {
  const router = Router();

  // POST /add-history
  // Called by the extension to add a new history entry.
  // The server only appends the entry; activity time is tracked separately.
  router.post("/add-history", (req, res) => {
    const { title, artist, image, source, link, date, mode } = req.body ?? {};

    if (!title || typeof title !== "string" || !artist || typeof artist !== "string") {
      return res.status(400).json({ error: "title and artist are required strings" });
    }

    fs.readFile(historyFilePath, "utf8", (readErr, data) => {
      let history = [];
      if (!readErr && data) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) history = parsed;
        } catch (e) {
          console.error("[HISTORY] Parse error:", e.message);
        }
      }

      // Skip if identical to the last entry
      const last = history[history.length - 1];
      if (last && last.title === title.trim() && last.artist === artist.trim()) {
        return res.json({ success: true, action: "skipped" });
      }

      const entry = {
        title: title.trim(),
        artist: artist.trim(),
        image: typeof image === "string" ? image.trim() : "",
        source: typeof source === "string" ? source.trim() : "",
        link: typeof link === "string" ? link.trim() : "",
        date,
        mode: typeof mode === "string" ? mode.trim() : "listen",
        total_listened_ms: 0,
      };

      history.push(entry);

      fs.writeFile(historyFilePath, JSON.stringify(history, null, 2), "utf8", (writeErr) => {
        if (writeErr) {
          return res.status(500).json({ error: "History save failed: " + writeErr.message });
        }
        res.json({ success: true, action: "added" });
      });
    });
  });

  // GET /history
  router.get("/history", (_req, res) => {
    try {
      const history = fs.existsSync(historyFilePath) ? JSON.parse(fs.readFileSync(historyFilePath, "utf-8")) : [];
      res.json(history);
    } catch (err) {
      console.error("[HISTORY] Read error:", err.message);
      res.status(500).json({ error: "Failed to read history" });
    }
  });

  // POST /sync-history
  router.post("/sync-history", (req, res) => {
    const { history } = req.body;
    if (!Array.isArray(history)) {
      return res.status(400).json({ error: "Invalid history data" });
    }

    fs.readFile(historyFilePath, "utf8", (readErr, data) => {
      let serverHistory = [];
      if (!readErr && data) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) serverHistory = parsed;
        } catch (e) {
          console.error("[HISTORY] Parse error:", e.message);
        }
      }

      const merged = mergeHistories(serverHistory, history);
      const historyData = JSON.stringify(merged, null, 2);

      fs.writeFile(historyFilePath, historyData, "utf8", (writeErr) => {
        if (writeErr) {
          return res.status(500).json({ error: "History save failed: " + writeErr.message });
        }
        res.json({
          success: true,
          message: "History synced successfully",
          count: merged.length,
          serverHistory: merged,
        });
      });
    });
  });

  // POST /delete-history-entries
  router.post("/delete-history-entries", (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "Invalid entries data" });
    }

    fs.readFile(historyFilePath, "utf8", (readErr, data) => {
      let serverHistory = [];
      if (!readErr && data) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) serverHistory = parsed;
        } catch (e) {
          console.error("[HISTORY] Parse error:", e.message);
        }
      }

      const TOLERANCE_MS = 60 * 2000;

      const isMatchingEntry = (serverEntry, deleteEntry) => {
        if (serverEntry.title?.trim() !== deleteEntry.title?.trim()) return false;
        if (serverEntry.artist?.trim() !== deleteEntry.artist?.trim()) return false;
        const timeDiff = Math.abs(new Date(serverEntry.date) - new Date(deleteEntry.date));
        return timeDiff <= TOLERANCE_MS;
      };

      const filtered = serverHistory.filter((serverEntry) => !entries.some((deleteEntry) => isMatchingEntry(serverEntry, deleteEntry)));

      fs.writeFile(historyFilePath, JSON.stringify(filtered, null, 2), "utf8", (writeErr) => {
        if (writeErr) {
          return res.status(500).json({ error: "Delete failed: " + writeErr.message });
        }
        res.json({ success: true, deleted: serverHistory.length - filtered.length });
      });
    });
  });

  // GET /logs
  router.get("/logs", (_req, res) => {
    try {
      const logs = fs.existsSync(logFilePath) ? JSON.parse(fs.readFileSync(logFilePath, "utf-8")) : [];
      res.json(logs);
    } catch (err) {
      console.error("[LOGS] Read error:", err.message);
      res.status(500).json({ error: "Failed to read logs" });
    }
  });

  return router;
}

module.exports = { createHistoryRouter };
