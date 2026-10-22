// Time
const getCurrentTime = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const dateToday = new Date();
const dateYesterday = new Date(new Date().setDate(new Date().getDate() - 1));
const isSameDay = (d1, d2) => d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();

// Date formatting
const userLocale = navigator.languages?.[0] || navigator.language || "en-US";
const dateHourMinute = (time) =>
  time.toLocaleTimeString(userLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: undefined,
  });

const dateFull = (time) =>
  time.toLocaleDateString(userLocale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
