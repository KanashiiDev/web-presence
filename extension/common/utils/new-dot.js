// New-dot system: red indicators for newly added features.
//
// Only leaf features store seen state; parent dots are derived from unseen
// descendants. Dots appear only for users who installed before a feature
// shipped and haven't used it. Missing installVersion is treated as existing
// user; fresh installs never see dots for existing features.
//
// Storage:
//   - `newDotSeen`: "id#version" -> true. Increment version to re-announce.
//   - `newDotInstallVersion`: manifest version at first install.
//
// Elements are matched via CSS selectors in the registry. Call
// initNewDots() after DOM ready, and again after rendering dynamic UI.
// Missing elements are silently skipped.
//
// Clicking a leaf marks it as seen. For alternate entry points, call
// markNewDotSeen(id) when the feature is used.
//

const NEW_DOT_STORAGE_KEY = "newDotSeen";
const NEW_DOT_INSTALL_VERSION_KEY = "newDotInstallVersion";
const NEW_DOT_SR_LABEL = "New";

// Feature registry.
//  - `id`       stable identifier across releases.
//  - `version`  bump to re-announce the feature.
//  - `since`    exact manifest version when shipped. Users installing at or
//               after this version never see the dot.
//  - `selector` CSS selector of the clickable feature element.
//  - `parents`  parent surfaces that show a dot while this feature is unseen.
// Remove entries once the feature no longer needs announcing.
const NEW_DOT_FEATURES = [
  {
    id: "lastfm",
    version: 1,
    since: "3.4.0",
    selector: "#lastfmSettings",
    parents: ["settings"],
  },
  {
    id: "activityPriority",
    version: 1,
    since: "3.3.0",
    selector: "#activityPriority",
    parents: ["settings"],
  },
];

// Container entry points: parent key -> selector. Written once; does not grow
// when features are added.
const NEW_DOT_PARENT_SELECTORS = {
  settings: "#settingsToggle",
};

const newDotRegistry = new Map(NEW_DOT_FEATURES.map((feature) => [feature.id, feature]));
// Mounted dots: { element, kind: "leaf" | "parent", id }
let newDotMounts = [];
let newDotStorageListenerBound = false;
let newDotRefreshQueued = false;
// Serializes writes within one page so read-modify-write on the map can't interleave.
let newDotWriteQueue = Promise.resolve();

// logError may live in another script; never let the error path itself throw.
function newDotLog(...args) {
  if (typeof logError === "function") logError(...args);
  else console.error(...args);
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

function newDotCompareVersions(a, b) {
  const pa = String(a)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

// Call once from the background script on a fresh install. Never overwrites an
// existing value, so it is safe to call more than once.
async function newDotRecordInstall() {
  try {
    const stored = await browser.storage.local.get(NEW_DOT_INSTALL_VERSION_KEY);
    if (stored[NEW_DOT_INSTALL_VERSION_KEY]) return;
    await browser.storage.local.set({
      [NEW_DOT_INSTALL_VERSION_KEY]: browser.runtime.getManifest().version,
    });
  } catch (error) {
    newDotLog("[newDot]: Failed to record install version:", error);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Storage map entry key including the announce version.
function newDotFeatureKey(feature) {
  return `${feature.id}#${feature.version ?? 1}`;
}

// Reads the seen map and install version in a single storage call.
// Returns null on failure so callers show nothing rather than stale dots.
async function newDotReadState() {
  try {
    const stored = await browser.storage.local.get([NEW_DOT_STORAGE_KEY, NEW_DOT_INSTALL_VERSION_KEY]);
    return {
      seenMap: stored[NEW_DOT_STORAGE_KEY] ?? {},
      installVersion: stored[NEW_DOT_INSTALL_VERSION_KEY] ?? null,
    };
  } catch (error) {
    newDotLog("[newDot]: Failed to read state:", error);
    return null;
  }
}

function newDotIsFeatureUnseen(state, feature) {
  if (!state) return false;
  if (state.seenMap[newDotFeatureKey(feature)] === true) return false;

  // Installed at or after the feature shipped: it was never "new" to them.
  if (state.installVersion && feature.since && newDotCompareVersions(state.installVersion, feature.since) >= 0) {
    return false;
  }
  return true;
}

// A parent surface shows a dot while any registered child feature under it is unseen.
function newDotIsParentUnseen(state, parentKey) {
  for (const feature of newDotRegistry.values()) {
    if (feature.parents.includes(parentKey) && newDotIsFeatureUnseen(state, feature)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Only force relative positioning when the host is static; leave positioned hosts untouched.
function newDotHostNeedsPositioning(element) {
  try {
    return getComputedStyle(element).position === "static";
  } catch (_) {
    return false;
  }
}

function newDotCreateElement() {
  const dot = document.createElement("span");
  dot.className = "new-dot";

  // Visually hidden label so screen-reader users also learn something is new.
  const label = document.createElement("span");
  label.textContent = NEW_DOT_SR_LABEL;
  label.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
  dot.appendChild(label);
  return dot;
}

// Repaints one mount according to state.
function newDotSetShown(mount, shown) {
  const existingDot = mount.element.querySelector(":scope > .new-dot");

  if (shown && !existingDot) {
    if (newDotHostNeedsPositioning(mount.element)) mount.element.classList.add("new-dot-host");
    mount.element.appendChild(newDotCreateElement());
    return;
  }

  if (!shown && existingDot) {
    existingDot.remove();
    mount.element.classList.remove("new-dot-host");
  }
}

// Repaints every mounted dot from a single storage read. Calls made in the same
// tick (e.g. many mounts at page load) are coalesced into one read.
function refreshNewDot() {
  if (newDotRefreshQueued) return;
  newDotRefreshQueued = true;

  queueMicrotask(() => {
    newDotRefreshQueued = false;

    newDotReadState()
      .then((state) => {
        // Drop mounts whose elements left the DOM so the list can't grow forever.
        newDotMounts = newDotMounts.filter((mount) => mount.element.isConnected);

        for (const mount of newDotMounts) {
          if (mount.kind === "leaf") {
            const feature = newDotRegistry.get(mount.id);
            if (!feature) continue;
            newDotSetShown(mount, newDotIsFeatureUnseen(state, feature));
          } else {
            newDotSetShown(mount, newDotIsParentUnseen(state, mount.id));
          }
        }
      })
      .catch((error) => newDotLog("[newDot]: Failed to refresh mounted dots:", error));
  });
}

function newDotBindStorageListener() {
  if (newDotStorageListenerBound) return;
  newDotStorageListenerBound = true;

  // Keeps every open page (popup, options, ...) in sync live.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes[NEW_DOT_STORAGE_KEY] || changes[NEW_DOT_INSTALL_VERSION_KEY])) {
      refreshNewDot();
    }
  });
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

function newDotMount(element, kind, id) {
  if (!element) return null;

  newDotBindStorageListener();

  const duplicate = newDotMounts.find((mount) => mount.element === element && mount.kind === kind && mount.id === id);
  if (duplicate) return duplicate;

  if (kind === "leaf") {
    if (!newDotRegistry.has(id)) {
      newDotLog("[newDot]: mountNewDot called for unknown feature id:", id);
      return null;
    }
    // Capture phase so dismissal survives stopPropagation in feature handlers.
    element.addEventListener(
      "click",
      () => {
        markNewDotSeen(id);
      },
      true,
    );
  }

  const mount = { element, kind, id };
  newDotMounts.push(mount);
  refreshNewDot();
  return mount;
}

// Mounts a leaf feature element: the dot stays until the user clicks it.
function mountNewDot(element, featureId) {
  return newDotMount(element, "leaf", featureId);
}

// Mounts a container entry point: the dot shows while any child feature under
// `parentKey` is unseen. Never dismissed by its own click, only at the leaf.
function mountNewDotParent(element, parentKey) {
  return newDotMount(element, "parent", parentKey);
}

// Binds every registry feature and parent surface to its element by selector.
// Safe to call repeatedly (duplicate mounts are ignored).
function initNewDots(root = document) {
  for (const feature of newDotRegistry.values()) {
    if (!feature.selector) continue;
    const element = root.querySelector(feature.selector);
    if (element) mountNewDot(element, feature.id);
  }

  for (const [parentKey, selector] of Object.entries(NEW_DOT_PARENT_SELECTORS)) {
    const element = root.querySelector(selector);
    if (element) mountNewDotParent(element, parentKey);
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

async function isFeatureUnseen(featureId) {
  const feature = newDotRegistry.get(featureId);
  if (!feature) {
    newDotLog("[newDot]: isFeatureUnseen called for unknown feature id:", featureId);
    return false;
  }
  return newDotIsFeatureUnseen(await newDotReadState(), feature);
}

// Runs a read-modify-write on the seen map, one at a time within this page.
// A failed step never blocks the ones after it.
function newDotUpdateSeenMap(mutate) {
  const run = async () => {
    const state = await newDotReadState();
    if (!state) return;

    const seenMap = { ...state.seenMap };
    if (!mutate(seenMap, state)) return; // nothing changed

    try {
      await browser.storage.local.set({ [NEW_DOT_STORAGE_KEY]: seenMap });
    } catch (error) {
      newDotLog("[newDot]: Failed to persist seen state:", error);
      return;
    }
    refreshNewDot();
  };

  newDotWriteQueue = newDotWriteQueue.then(run, run);
  return newDotWriteQueue;
}

// Marks a leaf feature as seen. Also call this when the feature is used via a
// path other than clicking the mounted element.
function markNewDotSeen(featureId) {
  const feature = newDotRegistry.get(featureId);
  if (!feature) {
    newDotLog("[newDot]: markNewDotSeen called for unknown feature id:", featureId);
    return Promise.resolve();
  }

  return newDotUpdateSeenMap((seenMap, state) => {
    // Nothing to persist if the user would not see a dot anyway (e.g. fresh install).
    if (!newDotIsFeatureUnseen(state, feature)) return false;
    seenMap[newDotFeatureKey(feature)] = true;
    return true;
  });
}

// Dismisses every registered feature at once ("mark all as read").
function markAllNewDotSeen() {
  return newDotUpdateSeenMap((seenMap) => {
    let changed = false;
    for (const feature of newDotRegistry.values()) {
      const key = newDotFeatureKey(feature);
      if (seenMap[key] !== true) {
        seenMap[key] = true;
        changed = true;
      }
    }
    return changed;
  });
}
