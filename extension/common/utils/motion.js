// Motion Preference
const MotionPreference = {
  SYSTEM: "system",
  ALWAYS: "always",
  NEVER: "never",
};

let cachedMotion = MotionPreference.SYSTEM;
const motionKey = "motionPreference";

async function setMotionPreference(value) {
  if (!Object.values(MotionPreference).includes(value)) return;
  await browser.storage.local.set({ [motionKey]: value });
  cachedMotion = value;
  setMotionClass();
}

function setMotionClass() {
  document.documentElement.classList.toggle("reduced-motion", !shouldAnimate());
}

async function initMotionPreference() {
  const result = await browser.storage.local.get(motionKey);
  cachedMotion = result[motionKey] ?? MotionPreference.ALWAYS;
  setMotionClass();
}

function shouldAnimate() {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  switch (cachedMotion) {
    case MotionPreference.ALWAYS:
      return true;
    case MotionPreference.NEVER:
      return false;
    case MotionPreference.SYSTEM:
    default:
      return !prefersReduced;
  }
}
