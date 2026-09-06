async function buildPortButtons(container) {
  // Port
  const portWrapper = document.createElement("div");
  portWrapper.className = "settings-option port-wrapper";

  const portLabel = document.createElement("label");
  portLabel.textContent = "Port";
  portLabel.dataset.i18n = "settings.port";
  portLabel.setAttribute("for", "portInput");

  const portInput = document.createElement("input");
  portInput.type = "text";
  portInput.id = "portInput";
  portInput.className = "settings-input";

  const { serverPort: storedPort } = await browser.storage.local.get("serverPort");
  portInput.value = storedPort ?? CONFIG.serverPort;

  portInput.addEventListener(
    "input",
    debounce(async () => {
      await browser.storage.local.set({ serverPort: portInput.value });
    }, 300),
  );

  // Apply Button
  const btnApply = document.createElement("span");
  btnApply.appendChild(createSVG(svg_paths.penIconPaths));
  btnApply.className = "port-apply-btn button";
  btnApply.title = i18n.t("settings.apply");

  btnApply.addEventListener("click", async () => {
    btnApply.classList.toggle("spinner");
    try {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      await browser.runtime.sendMessage({
        type: "UPDATE_RPC_PORT",
        data: { newPort: Number(portInput.value) },
      });

      restartExtension(activeTab);
    } catch (err) {
      logError("[Port]: Port update failed:", err);
    } finally {
      btnApply.classList.toggle("spinner");
    }
  });

  portWrapper.append(portLabel, portInput, btnApply);
  container.appendChild(portWrapper);

  // Web Bridge Port
  const webBridgeWrapper = document.createElement("div");
  webBridgeWrapper.className = "settings-option port-wrapper";

  const webBridgeLabel = document.createElement("label");
  webBridgeLabel.textContent = "Discord Web Port";
  webBridgeLabel.dataset.i18n = "settings.discordWebPort";
  webBridgeLabel.setAttribute("for", "discordWebPortInput");

  const webBridgeInput = document.createElement("input");
  webBridgeInput.type = "text";
  webBridgeInput.id = "discordWebPortInput";
  webBridgeInput.className = "settings-input";

  const { discordWebPort: storeddiscordWebPort } = await browser.storage.local.get("discordWebPort");

  webBridgeInput.value = storeddiscordWebPort ?? CONFIG.discordWebPort;

  webBridgeInput.addEventListener(
    "input",
    debounce(async () => {
      await browser.storage.local.set({
        discordWebPort: webBridgeInput.value,
      });
    }, 300),
  );

  const btnWebBridgeApply = document.createElement("span");
  btnWebBridgeApply.appendChild(createSVG(svg_paths.penIconPaths));
  btnWebBridgeApply.className = "port-apply-btn button";
  btnWebBridgeApply.title = i18n.t("settings.apply");

  btnWebBridgeApply.addEventListener("click", async () => {
    btnWebBridgeApply.classList.toggle("spinner");
    try {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      await browser.runtime.sendMessage({
        type: "UPDATE_WEB_BRIDGE_PORT",
        data: { newPort: Number(webBridgeInput.value) },
      });

      restartExtension(activeTab);
    } catch (err) {
      logError("[Web Bridge]: Port update failed:", err);
    } finally {
      btnWebBridgeApply.classList.toggle("spinner");
    }
  });

  webBridgeWrapper.append(webBridgeLabel, webBridgeInput, btnWebBridgeApply);

  container.appendChild(webBridgeWrapper);

  // Extension Mode Select
  const { webOnlyMode: storedWebMode } = await browser.storage.local.get("webOnlyMode");
  const currentMode = storedWebMode === true ? "web-only" : "default";

  const modeWrapper = document.createElement("div");
  modeWrapper.className = "settings-option mode-wrapper";

  const modeLabel = document.createElement("label");
  modeLabel.textContent = "Connection Mode";
  modeLabel.dataset.i18n = "settings.connectionMode";
  modeLabel.setAttribute("for", "connectionModeSelect");

  const modeSelect = document.createElement("select");
  modeSelect.id = "connectionModeSelect";
  modeSelect.className = "settings-select";

  const modeOptions = [
    { value: "default", i18n: "setup.connectionMode.webAndApp" },
    { value: "web-only", i18n: "setup.connectionMode.webOnly" },
  ];

  for (const opt of modeOptions) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = i18n.t(opt.i18n);
    el.dataset.i18n = opt.i18n;
    el.selected = opt.value === currentMode;
    modeSelect.appendChild(el);
  }

  modeWrapper.append(modeLabel, modeSelect);
  portWrapper.insertAdjacentElement("beforebegin", modeWrapper);

  requestAnimationFrame(() => {
    new TomSelect(modeSelect, {
      controlInput: null,
      sortField: false,
      plugins: {
        auto_width: { isExtension: true, maxWidth: 125 },
        simplebar: { isExtension: true },
      },
      async onChange(value) {
        const isWeb = value === "web-only";
        await browser.storage.local.set({ webOnlyMode: isWeb });

        // Enable/disable the port input according to the mode
        portInput.disabled = isWeb;
        webBridgeInput.disabled = isWeb;
        btnApply.classList.toggle("disabled", isWeb);
        btnWebBridgeApply.classList.toggle("disabled", isWeb);

        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        restartExtension(activeTab);
      },
    });

    // If web-only is selected on the first load, disable the port input
    if (currentMode === "web-only") {
      portInput.disabled = true;
      webBridgeInput.disabled = true;
      btnApply.classList.add("disabled");
      btnWebBridgeApply.classList.add("disabled");
    }
  });

  // Port Note
  const portInfo = document.createElement("small");
  portInfo.className = "settings-option-info";
  portInfo.textContent = "You don't need to change the port separately in the application.";
  portInfo.dataset.i18n = "settings.port_info";
  container.appendChild(portInfo);

  // Buttons
  const buttonsWrapper = document.createElement("div");
  buttonsWrapper.className = "settings-option buttons-wrapper";

  const { debugMode: storedDebug } = await browser.storage.local.get("debugMode");
  let debugState = storedDebug ?? CONFIG.debugMode;

  const btnParserManager = createBtn(i18n.t("settings.selectorParserManager"), "selectorParserManager");
  const btnWiki = createBtn("Wiki", "wiki");
  const btnRestart = createBtn(i18n.t("settings.restart"), "restart");
  const btnDebug = createBtn(i18n.t(debugState ? "settings.debug.disable" : "settings.debug.enable"), "debugMode");
  const btnDebugSection = createBtn(i18n.t("settings.debugSection"), "debugSection");
  const btnFactory = createBtn(i18n.t("settings.factory"), "factoryReset");
  const btnBackup = createBtn(i18n.t("settings.backup.title"), "backupSettings");

  const wikiWrap = document.createElement("div");
  wikiWrap.className = "wiki-wrap";
  wikiWrap.append(btnWiki, btnRestart);

  if (debugState === 1) {
    btnDebug.classList.add("active");
    btnDebugSection.classList.add("active");
  }

  // Event listeners
  btnBackup.onclick = () => openSettingsPage("backup");

  btnParserManager.onclick = async () => {
    openselectorParserManager();
  };

  btnWiki.onclick = async () => {
    await browser.tabs.create({ url: "https://github.com/KanashiiDev/web-presence/wiki" });
  };

  btnRestart.onclick = async () => {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    restartExtension(activeTab);
  };

  const debugWrap = document.createElement("div");
  debugWrap.className = "debug-wrap";

  btnDebug.onclick = async () => {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    await toggleDebugMode(activeTab);

    const { debugMode: newStored } = await browser.storage.local.get("debugMode");
    debugState = newStored ?? CONFIG.debugMode;

    const isActive = debugState === 1;
    btnDebug.classList.toggle("active", isActive);
    btnDebugSection.classList.toggle("active", isActive);
    btnDebug.textContent = i18n.t(isActive ? "settings.debug.disable" : "settings.debug.enable");
    restartExtension(activeTab);
  };

  btnDebugSection.onclick = () => openSettingsPage("debug");

  debugWrap.append(btnDebug, btnDebugSection);

  let factoryTimer = null;

  btnFactory.onclick = async () => {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    const result = await factoryReset(activeTab, true);

    if (result?.needConfirm) {
      btnFactory.textContent = i18n.t("settings.factory_confirm");
      btnFactory.classList.add("active");

      clearTimeout(factoryTimer);
      factoryTimer = setTimeout(() => {
        btnFactory.textContent = i18n.t("settings.factory");
        btnFactory.classList.remove("active");
      }, 5000);
    }
  };

  buttonsWrapper.append(btnParserManager, btnBackup, wikiWrap, debugWrap, btnFactory);
  container.append(buttonsWrapper);
}
