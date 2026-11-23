// Lowercase codes only: the locales processor normalizes `lang` to lowercase
// and rejects a payload whose lang/id disagree with the intake folder.
const TE_SUPPORTED_LANGS = [
  ...new Set(["de", "es", "fr", "ja", "ko", "pl", "ru", "tr", "uk", "vi", "zh-CN", "zh-TW", "pt-BR", "it", "pt", "nl", "id", "ar", "hi"].map(teNormalizeLang)),
];

const TE_LANG_LABEL_FALLBACKS = {
  "pt-br": "Brazilian Portuguese",
  "zh-cn": "Chinese (China)",
  "zh-tw": "Chinese (Taiwan)",
};

// Submit is blocked only by a maintainer's explicit `published:false` override
// in languages.json. A language below the coverage threshold must remain
// submittable, otherwise a new language could never reach publication.
function teSubmissionIsBlocked(entry) {
  return entry?.published === false;
}

function teLangLabel(lang) {
  const normalized = teNormalizeLang(lang);
  if (TE_LANG_LABEL_FALLBACKS[normalized]) return TE_LANG_LABEL_FALLBACKS[normalized];
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(normalized) || normalized;
  } catch (_err) {
    return normalized;
  }
}
