// Helper to split time strings like "5:47 / 6:57".
function extractTimeParts(input) {
  if (typeof input !== "string" || !input.includes("/")) return [null, null];
  const parts = input.split("/");
  if (parts.length !== 2) return [null, null];
  const [start, end] = parts;
  const s = start.trim();
  const e = end.trim();
  if (!s || !e) return [null, null];
  return [s, e];
}

// Helper to convert mm:ss to seconds.
function parseTime(timeInput) {
  if (typeof timeInput === "number" && isFinite(timeInput)) {
    return timeInput < 0 ? -Math.floor(-timeInput) : Math.floor(timeInput);
  }

  if (typeof timeInput !== "string") return null;

  let s = timeInput.trim();
  if (s === "") return null;
  // catch any short/long dash/minus character
  const neg = /^[-–—]/.test(s);
  s = s.replace(/^[-–—]+/, "");

  const parts = s.split(":").reverse();
  let hasValid = false;
  const seconds = parts.reduce((acc, part, i) => {
    if (acc === null) return null;
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0) return null;
    hasValid = true;
    return acc + n * Math.pow(60, i);
  }, 0);

  if (seconds === null || !hasValid) return null;

  return neg ? -seconds : seconds;
}

// Helper to convert seconds to mm:ss format.
function formatTime(seconds) {
  if (typeof seconds === "string") {
    seconds = parseTime(seconds);
  }

  if (seconds === null || !isFinite(seconds) || typeof seconds !== "number") return "00:00";

  const neg = seconds < 0;
  seconds = Math.abs(Math.floor(seconds));

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  let formatted;
  if (hrs > 0) {
    formatted = `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  } else {
    formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return (neg ? "-" : "") + formatted;
}

// Helper to get timestamps
function getTimestamps(currentPosition, totalDuration, options = { returnEnd: true }) {
  if (currentPosition == null || totalDuration == null || isNaN(currentPosition) || isNaN(totalDuration) || totalDuration <= 0) {
    return {};
  }

  const now = Date.now();

  // Start is "now"
  const startTimestamp = now;

  if (options.returnEnd) {
    // End is "now + remaining time"
    const remaining = totalDuration - currentPosition;
    return {
      startTimestamp,
      endTimestamp: startTimestamp + Math.max(0, remaining) * 1000,
    };
  } else {
    return { startTimestamp };
  }
}
