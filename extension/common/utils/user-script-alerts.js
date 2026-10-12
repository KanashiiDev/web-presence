function getCurrentStyleAttributes() {
  const styleAttrs = {};
  const rootStyles = document.body.style;

  for (const name of rootStyles) {
    rootStyles.getPropertyValue(name) && (styleAttrs[name] = rootStyles.getPropertyValue(name));
  }

  return styleAttrs;
}

function parseTemplate(str, boldMap = {}, codeMap = {}) {
  const nodes = [];
  const parts = str.split(/(\{bold_\w+\}|\{code_\w+\}|\n)/);

  for (const part of parts) {
    if (!part) continue;

    if (part === "\n") {
      nodes.push(document.createElement("br"));
    } else if (part.startsWith("{bold_")) {
      const key = part.slice(1, -1);
      const text = boldMap[key] ?? part;
      nodes.push(createBold(text));
    } else if (part.startsWith("{code_")) {
      const key = part.slice(1, -1);
      const text = codeMap[key] ?? part;
      nodes.push(createCode(text));
    } else {
      nodes.push(document.createTextNode(part));
    }
  }

  return nodes;
}

// If mv3 and the user have not granted userscript permission, show a warning.
function createMv3PermissionAlert(config) {
  const wrapper = document.createElement("div");
  wrapper.id = "mv3Alert";

  const box = document.createElement("div");
  box.className = "box";

  // Title
  const title = document.createElement("h2");
  title.textContent = `⚠️ ${i18n.t("userscript.apiWarn.title")} ⚠️`;

  // Intro
  const intro = document.createElement("p");
  intro.append(...parseTemplate(i18n.t("userscript.apiWarn.intro"), { bold_api: i18n.t("userscript.apiWarn.introApi") }));

  // Why section
  const whyTitle = document.createElement("h4");
  whyTitle.textContent = i18n.t("userscript.apiWarn.whyTitle");

  const whyText = document.createElement("p");
  whyText.textContent = i18n.t("userscript.apiWarn.whyText");

  // Fix section
  const fixTitle = document.createElement("h4");
  fixTitle.textContent = i18n.t("userscript.apiWarn.fixTitle");

  const fixWrap = document.createElement("div");
  fixWrap.className = "mv3-fixWrap";

  const fixText = document.createElement("ol");
  fixText.className = "mv3-fixText";

  // Step 1
  const fixStep1 = document.createElement("li");
  fixStep1.append(...parseTemplate(i18n.t("userscript.apiWarn.fixStep1")));

  // Step 2
  const fixStep2 = document.createElement("li");
  fixStep2.append(document.createTextNode(i18n.t("userscript.apiWarn.fixStep2")));

  // Step 3
  const fixStep3 = document.createElement("li");
  fixStep3.append(document.createTextNode(i18n.t(config.type === "chrome" ? "userscript.apiWarn.fixStep3" : "userscript.apiWarn.fixStep3-moz")));

  // Step 3.5 (Firefox)
  const fixStep3_moz = document.createElement("li");
  fixStep3_moz.append(document.createTextNode(i18n.t("userscript.apiWarn.fixStep3.5-moz")));

  const fixStep4 = document.createElement("li");
  fixStep4.append(...parseTemplate(i18n.t("userscript.apiWarn.fixStep4"), {}, { code_permission: config.permissionLabel }));

  // Step 5
  const fixStep5 = document.createElement("li");
  fixStep5.append(document.createTextNode(i18n.t("userscript.apiWarn.fixStep5")));

  const fixImage = document.createElement("img");
  fixImage.className = "mv3-fixImage";
  fixImage.src = config.image;

  fixText.append(fixStep1, fixStep2, fixStep3, ...(config.type === "firefox" ? [fixStep3_moz] : []), fixStep4, fixStep5);
  fixWrap.append(fixText, fixImage);

  box.append(title, intro, document.createElement("br"), whyTitle, whyText, document.createElement("br"), fixTitle, fixWrap);
  wrapper.appendChild(box);
  return wrapper;
}

function createBold(text) {
  const b = document.createElement("b");
  b.textContent = text;
  return b;
}

function createCode(text) {
  const code = document.createElement("code");
  code.textContent = text;
  return code;
}

async function checkUserScriptsPermission() {
  const BROWSER_CONFIG = {
    chrome: {
      type: "chrome",
      extensionPage: "chrome://extensions/",
      permissionLabel: i18n.t("userscript.apiWarn.chromePermission"),
      image: browser.runtime.getURL("assets/chrome-userscript.png"),
      showPermissionAndDataStep: false,
    },
    firefox: {
      type: "firefox",
      extensionPage: "about:addons",
      permissionLabel: i18n.t("userscript.apiWarn.firefoxPermission"),
      image: browser.runtime.getURL("assets/firefox-userscript.png"),
      showPermissionAndDataStep: true,
    },
  };

  const manifest = browser.runtime.getManifest();
  if (manifest.manifest_version !== 3) return false;

  if (!browser.userScripts) {
    const browserType = detectBrowser();
    const config = BROWSER_CONFIG[browserType];
    if (document.getElementById("mv3Alert")) return false;
    document.body.appendChild(createMv3PermissionAlert(config));
    return false;
  }
  return true;
}

// Open Selector Parser Manager
async function openselectorParserManager(id) {
  await openExtensionPage("manager/selectorParserManager.html", {
    storage: { managerContext: { target: id } },
  });
}

// Open User Script Manager
async function openUserScriptManager(id) {
  await openExtensionPage("manager/userScriptManager.html", {
    storage: { managerContext: { target: id } },
  });
}
