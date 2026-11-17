import { getCSS } from "../../utils.js";

// Chart state factory
export function chartState(historyMode = "listen") {
  return {
    mode: historyMode === "watch" ? "minutes_watch" : "minutes",
    range: "month",
    offset: 0,
    instance: null,
    lastClickedBarIndex: null,
    expandedPlatform: null,
    summaryRowCount: 5,
  };
}

export const HC_COLORS = {
  minutes: { label: "Listening time", cssVar: "--chart-time", fallback: "#4a6a94" },
  songs: { label: "Songs", cssVar: "--chart-songs", fallback: "#44864e" },
  videos: { label: "Songs", cssVar: "--chart-songs", fallback: "#44864e" },
};

export function getHcColor(mode) {
  const cfg = HC_COLORS[mode] ?? HC_COLORS.minutes;
  return {
    label: cfg.label,
    rgb: getCSS(cfg.cssVar, cfg.fallback, "rgb"),
  };
}

export const HC_RANGES = {
  week: {
    barThickness: 32,
    labelFormat: { weekday: "short" },

    getStart(offset = 0) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + offset * 7);
      return d;
    },

    getDayCount() {
      return 7;
    },

    getLabel(offset = 0) {
      const start = HC_RANGES.week.getStart(offset);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const fmt = (d) => d.toLocaleString(navigator.languages?.[0] || navigator.language || "en-US", { day: "numeric", month: "short" });
      return `${fmt(start)} – ${fmt(end)}`;
    },
  },

  month: {
    barThickness: 16,
    labelFormat: { day: "numeric", month: "short" },

    getStart(offset = 0) {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth() + offset, 1);
    },

    getDayCount(offset = 0) {
      const d = new Date();
      const year = d.getFullYear();
      const month = d.getMonth() + offset;
      return new Date(year, month + 1, 0).getDate();
    },

    getLabel(offset = 0) {
      const d = new Date();
      const target = new Date(d.getFullYear(), d.getMonth() + offset, 1);
      return target.toLocaleString(navigator.languages?.[0] || navigator.language || "en-US", { month: "long", year: "numeric" });
    },
  },

  year: {
    barThickness: 22,
    labelFormat: null,

    getStart(offset = 0) {
      return new Date(new Date().getFullYear() + offset, 0, 1);
    },

    getDayCount(offset = 0) {
      const y = new Date().getFullYear() + offset;
      return new Date(y, 1, 29).getMonth() === 1 ? 366 : 365;
    },

    getLabel(offset = 0) {
      return String(new Date().getFullYear() + offset);
    },
  },

  alltime: {
    barThickness: 22,
    labelFormat: null,

    getStart() {
      return new Date(0);
    },

    getDayCount() {
      return Math.ceil((Date.now() - new Date(0).getTime()) / 86_400_000);
    },

    getLabel() {
      return i18n.t("common.allTime");
    },
  },
};
