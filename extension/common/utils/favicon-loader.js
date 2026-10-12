// Load all favicons
async function loadFavIcons(icons, concurrency = 3, delayMs = 150, slowAfter = 8) {
  if (!icons?.length) return;

  const queue = Array.from(icons);
  let loadedCount = 0;

  function loadSingleIcon(icon, domain) {
    return new Promise((resolve) => {
      if (!domain) return resolve();

      const rawDomain = Array.isArray(domain) ? domain[0] : domain;
      const cleanDomain = (rawDomain || "").replace(/^\*\./, "");
      const primaryDomain = cleanDomain.split(",")[0].trim();
      const proxyUrl = `https://favicons.seadfeng.workers.dev/${primaryDomain}.ico`;
      const googleUrl = `https://www.google.com/s2/favicons?domain=${primaryDomain}&sz=32`;
      const fallback = browser.runtime.getURL("icons/48x48.png");

      const finish = () => {
        icon.onload = null;
        icon.onerror = null;
        icon.classList.remove("hidden-visibility");
        icon.parentElement?.classList.remove("spinner");
        resolve();
      };

      icon.onload = finish;

      icon.onerror = () => {
        if (icon.src === proxyUrl) {
          icon.src = googleUrl;
        } else {
          if (icon.src !== fallback) {
            icon.onerror = finish;
            icon.src = fallback;
          } else {
            finish();
          }
        }
      };

      icon.src = proxyUrl;
      if (icon.complete && icon.naturalWidth !== 0) {
        finish();
      }
    });
  }

  async function worker() {
    while (queue.length > 0) {
      const icon = queue.shift();
      if (icon == null) return;

      const domain = icon.dataset?.src;
      await loadSingleIcon(icon, domain);

      const slowdown = ++loadedCount > slowAfter ? delayMs * 2 : delayMs;
      await delay(slowdown + Math.random() * 60);
    }
  }

  const safeConcurrency = Math.min(concurrency, queue.length);
  await Promise.all(Array.from({ length: safeConcurrency }, worker));
}
