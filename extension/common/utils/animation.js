// Waits for a condition to become true
function waitFor(fn, maxWait = 1000) {
  const start = performance.now();

  return new Promise((resolve, reject) => {
    try {
      if (fn()) return resolve(true);
    } catch (error) {
      return reject(error);
    }

    const tick = () => {
      try {
        if (fn()) return resolve(true);
        if (performance.now() - start >= maxWait) return resolve(false);
        requestAnimationFrame(tick);
      } catch (error) {
        reject(error);
      }
    };

    requestAnimationFrame(tick);
  });
}

function getTransitionDuration(el, property) {
  const style = getComputedStyle(el);
  const props = style.transitionProperty.split(", ");
  const durations = style.transitionDuration.split(", ");
  const index = props.indexOf(property);
  const raw = index !== -1 ? (durations[index] ?? durations[0]) : null;
  if (!raw) return 0;
  return parseFloat(raw) * (raw.includes("ms") ? 1 : 1000);
}

function waitForTransitionEnd(el, property) {
  if (!el || !shouldAnimate?.()) return Promise.resolve();

  const duration = getTransitionDuration(el, property);
  if (duration === 0) return Promise.resolve();

  const adaptive = Math.max(duration * 1.3, 300);

  return new Promise((resolve) => {
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      el.removeEventListener("transitionend", handler);
      resolve();
    };

    const handler = ({ target, propertyName }) => {
      if (target === el && propertyName === property) finish();
    };

    el.addEventListener("transitionend", handler);
    const timer = setTimeout(finish, adaptive);
  });
}

async function smoothScrollTo(element, target, baseDuration = 300) {
  if (!element || typeof element.scrollTop !== "number") {
    return Promise.reject(new Error("Invalid scroll element"));
  }

  if (!shouldAnimate?.()) {
    element.scrollTop = target;
    return;
  }

  const start = element.scrollTop;
  const change = target - start;
  const distance = Math.abs(change);

  if (distance < 2) {
    element.scrollTop = target;
    return;
  }

  const durationMs = Math.min(baseDuration, Math.max(100, distance / 0.5));
  const startTime = performance.now();

  const easeOutCubic = (t) => 1 - (1 - t) ** 3;

  return new Promise((resolve) => {
    const animate = (now) => {
      const progress = Math.min((now - startTime) / durationMs, 1);
      element.scrollTop = Math.round(start + change * easeOutCubic(progress));

      if (progress < 1 && element.isConnected) {
        requestAnimationFrame(animate);
      } else {
        element.scrollTop = target;
        resolve();
      }
    };

    requestAnimationFrame(animate);
  });
}

async function scrollToElementPosition(target, container) {
  if (!target || !container) return;

  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  await smoothScrollTo(container, container.scrollTop + offset);
}
