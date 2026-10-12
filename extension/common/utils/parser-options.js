// Default Parser Options
const DEFAULT_PARSER_OPTIONS = {
  showArtist: { type: "checkbox", value: true },
  showSource: { type: "checkbox", value: true },
  showCover: { type: "checkbox", value: true },
  showTimeLeft: { type: "checkbox", value: true },
  showButtons: { type: "checkbox", value: true },
  showFavIcon: { type: "checkbox", value: false },
  saveHistory: { type: "checkbox", value: true },
  customCover: { type: "checkbox", value: false },
  customCoverUrl: { type: "text", value: "" },
  customButton1: { type: "checkbox", value: false },
  customButton1Text: { type: "text", value: "" },
  customButton1Link: { type: "text", value: "" },
  customButton2: { type: "checkbox", value: false },
  customButton2Text: { type: "text", value: "" },
  customButton2Link: { type: "text", value: "" },
  customPlaceholder: { type: "checkbox", value: false },
  customPlaceholderUrl: { type: "text", value: "" },
};

function applyParserOptionLabels() {
  for (const key of Object.keys(DEFAULT_PARSER_OPTIONS)) {
    DEFAULT_PARSER_OPTIONS[key].label = i18n.t(`parserOptions.${key}`);
  }
}
