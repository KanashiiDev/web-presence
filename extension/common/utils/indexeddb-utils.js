function getPlainText(text) {
  if (typeof text !== "string") return text;
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/^[.#]/.test(trimmed)) return null;

  const firstWord = trimmed.split(/[\s.#\[>+~:"'`]/)[0].toLowerCase();
  if (!firstWord) return null;

  try {
    const el = document.createElement(firstWord);
    const isKnownTag = el.constructor !== HTMLUnknownElement && el.constructor !== HTMLElement;
    if (isKnownTag) return null;
  } catch {}

  return trimmed;
}

function uint8ToBase64(uint8) {
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

function encodeValue(value) {
  if (value instanceof Uint8Array) {
    return { __type: "uint8array", data: uint8ToBase64(value) };
  }
  if (value instanceof ArrayBuffer) {
    return { __type: "arraybuffer", data: uint8ToBase64(new Uint8Array(value)) };
  }
  return value;
}

function decodeValue(value) {
  if (value?.__type === "uint8array") {
    const binary = atob(value.data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr;
  }
  if (value?.__type === "arraybuffer") {
    const binary = atob(value.data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr.buffer;
  }
  return value;
}

function openIndexedDB(DB_NAME, STORE_NAME, DB_VERSION) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: null });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => {
      logError("[IndexedDB]: IndexedDB open error:", e.target.error);
      reject(e.target.error);
    };
  });
}

async function exportIndexedDB(dbName) {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const storeNames = [...db.objectStoreNames];

  if (storeNames.length === 0) {
    db.close();
    return {};
  }

  const tx = db.transaction(storeNames, "readonly");
  const result = {};

  await Promise.all(
    storeNames.map((storeName) => {
      const store = tx.objectStore(storeName);
      return new Promise((res, rej) => {
        const keysReq = store.getAllKeys();
        const valsReq = store.getAll();

        let keys, vals;
        const tryResolve = () => {
          if (keys === undefined || vals === undefined) return;
          const entries = {};
          keys.forEach((key, i) => {
            entries[key] = encodeValue(vals[i]);
          });
          result[storeName] = entries;
          res();
        };

        keysReq.onsuccess = () => {
          keys = keysReq.result;
          tryResolve();
        };
        valsReq.onsuccess = () => {
          vals = valsReq.result;
          tryResolve();
        };
        keysReq.onerror = valsReq.onerror = () => rej(keysReq.error ?? valsReq.error);
      });
    }),
  );

  db.close();
  return result;
}

async function importIndexedDB(dbName, data) {
  if (!data || Object.keys(data).length === 0) return;

  await new Promise((res, rej) => {
    const del = indexedDB.deleteDatabase(dbName);
    del.onsuccess = res;
    del.onerror = () => rej(del.error);
  });

  await new Promise((resolve, reject) => {
    const openReq = indexedDB.open(dbName);

    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      for (const storeName of Object.keys(data)) {
        db.createObjectStore(storeName);
      }
    };

    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction(Object.keys(data), "readwrite");

      for (const [storeName, entries] of Object.entries(data)) {
        const store = tx.objectStore(storeName);
        for (const [key, value] of Object.entries(entries)) {
          store.put(decodeValue(value), key);
        }
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };

    openReq.onerror = () => reject(openReq.error);
  });
}

async function getIconAsDataUrl() {
  const iconUrl = browser.runtime.getURL("icons/128x128.png");
  const response = await fetch(iconUrl);
  const blob = await response.blob();

  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
