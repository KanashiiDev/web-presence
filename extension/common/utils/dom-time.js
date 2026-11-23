function relativeTime(dateValue) {
  if (dateValue == null || dateValue === "") return "—";

  let past = typeof dateValue === "number" ? dateValue : NaN;

  if (isNaN(past)) {
    const asNum = Number(dateValue);
    if (!isNaN(asNum) && asNum > 0) {
      past = asNum;
    } else {
      const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
      past = isNaN(d.getTime()) ? NaN : d.getTime();
    }
  }

  if (!past || isNaN(past)) return "—";

  const s = Math.floor((Date.now() - past) / 1000);
  if (s < 0 || s < 45) return i18n.t("time.just_now");
  if (s < 90) return i18n.t("time.minute_ago.one", { count: 1 });
  if (s < 3600) return i18n.t("time.minute_ago.other", { count: Math.floor(s / 60) });

  const mins = Math.floor(s / 60);
  if (mins < 90) return i18n.t("time.hour_ago.one", { count: 1 });
  if (mins < 1440) return i18n.t("time.hour_ago.other", { count: Math.floor(mins / 60) });

  const days = Math.floor(mins / 1440);
  if (days === 1) return i18n.t("time.yesterday");
  if (days < 7) return i18n.t("time.days_ago", { count: days });

  const weeks = Math.floor(days / 7);
  if (weeks === 1) return i18n.t("time.week_ago.one", { count: 1 });
  if (weeks < 5) return i18n.t("time.week_ago.other", { count: weeks });

  const months = Math.floor(days / 30.4);
  if (months === 1) return i18n.t("time.month_ago.one", { count: 1 });
  if (months < 12) return i18n.t("time.month_ago.other", { count: months });

  const years = Math.floor(months / 12);
  if (years === 1) return i18n.t("time.year_ago.one", { count: 1 });
  return i18n.t("time.year_ago.other", { count: years });
}
