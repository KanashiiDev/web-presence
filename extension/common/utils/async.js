// Delay
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Debounce
function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// Throttle
function throttle(fn, wait) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, args);
    }
  };
}

// Mutex
function createMutex() {
  let lock = Promise.resolve();
  return async (fn) => {
    const unlock = lock;
    let resolveNext;
    lock = new Promise((r) => (resolveNext = r));
    await unlock;
    try {
      return await fn();
    } finally {
      resolveNext();
    }
  };
}
