function teIsFlatLocale(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return true;
  return Object.values(data).every((value) => typeof value === "string");
}

function teSetTranslationValue(obj, key, value, flat = null) {
  const useFlat = flat ?? (Object.prototype.hasOwnProperty.call(obj, key) || teIsFlatLocale(obj));
  if (useFlat) {
    obj[key] = value;
    return;
  }
  const parts = key.split(".");
  let node = obj;
  for (let index = 0; index < parts.length - 1; index++) {
    if (!node[parts[index]] || typeof node[parts[index]] !== "object") node[parts[index]] = {};
    node = node[parts[index]];
  }
  node[parts[parts.length - 1]] = value;
}

function teDeleteTranslationValue(obj, key, flat = null) {
  const useFlat = flat ?? (Object.prototype.hasOwnProperty.call(obj, key) || teIsFlatLocale(obj));
  if (useFlat) {
    delete obj[key];
    return;
  }
  const parts = key.split(".");
  let node = obj;
  for (let index = 0; index < parts.length - 1; index++) {
    if (!node[parts[index]] || typeof node[parts[index]] !== "object") return;
    node = node[parts[index]];
  }
  delete node[parts[parts.length - 1]];
}

function teSerializeLocale(rawText, obj) {
  const multiline = /^\{\s*\r?\n/.test(rawText) || rawText.trim() === "{}";
  const indentMatch = rawText.match(/^\{\r?\n([ \t]+)/);
  const indent = multiline ? indentMatch?.[1] || "  " : null;
  const newline = rawText.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailingNewline = rawText.trim() === "{}" || /\r?\n\s*$/.test(rawText);
  return JSON.stringify(obj, null, indent) + (hasTrailingNewline ? newline : "");
}
