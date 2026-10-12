// Create a platform dropdown with options
function createPlatformDropdown(label, options, manifestVersion) {
  const container = document.createElement("div");
  container.classList.add("setup-link-dropdown-container");

  const button = document.createElement("a");
  button.textContent = label;
  button.classList.add("setup-link", "setup-link-dropdown-toggle");
  container.appendChild(button);

  const dropdown = document.createElement("div");
  dropdown.classList.add("setup-dropdown");
  container.appendChild(dropdown);

  options.forEach((option) => {
    const dropdownLink = document.createElement("a");
    dropdownLink.href = option.url.replace(/{version}/g, manifestVersion);
    dropdownLink.textContent = option.label;
    dropdownLink.target = "_blank";
    dropdownLink.rel = "noopener noreferrer";
    dropdownLink.classList.add("setup-dropdown-item");
    dropdown.appendChild(dropdownLink);
  });

  // Toggle dropdown
  let leaveTimeout;

  const showDropdown = () => {
    clearTimeout(leaveTimeout);
    dropdown.classList.add("show");
  };

  const hideDropdown = () => {
    leaveTimeout = setTimeout(() => {
      dropdown.classList.remove("show");
    }, 100);
  };

  container.addEventListener("click", showDropdown);
  container.addEventListener("mouseleave", hideDropdown);
  dropdown.addEventListener("mouseenter", showDropdown);
  dropdown.addEventListener("mouseleave", hideDropdown);

  return container;
}

// Show initial setup dialog
async function fetchLatestVersion() {
  try {
    const res = await fetch("https://api.github.com/repos/KanashiiDev/web-presence/releases/latest", { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const version = data.tag_name?.replace(/^v/, "") ?? null;
    if (version) return version;
  } catch (e) {
    logInfo("GitHub version could not be retrieved, fallback is being used:", e);
  }

  return browser.runtime.getManifest().version;
}

async function showInitialSetupDialog(appendBody, isSetupAlreadyDone, loadingOverlay) {
  const version = await fetchLatestVersion();
  if (loadingOverlay) loadingOverlay.remove();

  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.id = "setupAlert";

    const dialog = document.createElement("div");
    dialog.className = "setup-dialog";

    const content = document.createElement("div");
    content.className = "setup-dialog-content";

    // Step 1: Mode Selection Wrapper
    const stepOneContainer = document.createElement("div");

    const modeHeader = document.createElement("h2");
    modeHeader.textContent = i18n.t("setup.connectionMode.header");
    stepOneContainer.appendChild(modeHeader);

    const modeText = document.createElement("p");
    modeText.textContent = i18n.t("setup.connectionMode.message");
    stepOneContainer.appendChild(modeText);

    const modeContainer = document.createElement("div");
    modeContainer.className = "setup-mode-container";

    const btnWebOnly = document.createElement("button");
    btnWebOnly.type = "button";
    btnWebOnly.textContent = i18n.t("setup.connectionMode.webOnly");
    btnWebOnly.className = "setup-mode-btn";

    const btnWebAndApp = document.createElement("button");
    btnWebAndApp.type = "button";
    btnWebAndApp.textContent = i18n.t("setup.connectionMode.webAndApp");
    btnWebAndApp.className = "setup-mode-btn";

    modeContainer.appendChild(btnWebOnly);
    modeContainer.appendChild(btnWebAndApp);
    stepOneContainer.appendChild(modeContainer);
    content.appendChild(stepOneContainer);

    // Step 2: Application Download Section
    const downloadSection = document.createElement("div");
    downloadSection.style.display = "none";

    const contentHeader = document.createElement("h2");
    contentHeader.textContent = i18n.t("setup.companion.header");
    downloadSection.appendChild(contentHeader);

    const contentText = document.createElement("p");
    contentText.textContent = i18n.t("setup.companion.message");
    downloadSection.appendChild(contentText);

    const contentLinkContainer = document.createElement("div");
    contentLinkContainer.classList.add("setup-link-container");
    downloadSection.appendChild(contentLinkContainer);

    // Windows Dropdown
    const windowsOptions = [
      {
        label: "Installer (EXE)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x64-installer.exe`,
      },
      {
        label: "Portable (ZIP)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x64.zip`,
      },
    ];
    contentLinkContainer.appendChild(createPlatformDropdown("Windows", windowsOptions, version));

    // Linux Dropdown
    const linuxOptions = [
      {
        label: "AppImage (x64)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x86_64.AppImage`,
      },
      {
        label: "DEB (x64)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-amd64.deb`,
      },
      {
        label: "RPM (x64)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x86_64.rpm`,
      },
      {
        label: "TAR.ZST (x64)",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-x64.pkg.tar.zst`,
      },
      {
        label: "More",
        url: `https://github.com/KanashiiDev/web-presence#installation-guide`,
      },
    ];
    contentLinkContainer.appendChild(createPlatformDropdown("Linux", linuxOptions, version));

    // MacOS Dropdown
    const macOptions = [
      {
        label: "Universal",
        url: `https://github.com/KanashiiDev/web-presence/releases/download/{version}/web-presence-{version}-universal.dmg`,
      },
    ];
    contentLinkContainer.appendChild(createPlatformDropdown("MacOS", macOptions, version));

    const contentNote = document.createElement("p");
    contentNote.textContent = i18n.t("setup.companion.provider");
    contentNote.classList.add("setup-note");
    downloadSection.appendChild(contentNote);

    const contentNote2 = document.createElement("p");
    const noteText = document.createTextNode(i18n.t("setup.companion.provider.link"));
    const noteLink = document.createElement("a");
    noteLink.href = "https://github.com/KanashiiDev/web-presence/releases/latest";
    noteLink.target = "_blank";
    noteLink.rel = "noopener noreferrer";
    noteLink.textContent = "GitHub Releases";
    noteLink.classList.add("setup-link-github");
    noteLink.classList.add("setup-note-link");

    contentNote2.appendChild(noteText);
    contentNote2.appendChild(noteLink);
    downloadSection.appendChild(contentNote2);

    const confirmButton = document.createElement("button");
    confirmButton.id = "confirmSetup";
    confirmButton.textContent = i18n.t("setup.companion.installed");
    downloadSection.appendChild(confirmButton);
    content.appendChild(downloadSection);
    dialog.appendChild(content);

    if (appendBody) wrapper.appendChild(dialog);
    const appendTarget = appendBody ? wrapper : dialog;
    const contentDiv = appendBody ? document.body : document.querySelector(".content");
    contentDiv.appendChild(appendTarget);
    document.documentElement.classList.add("setup-dialog-open");

    const cleanup = () => {
      contentDiv.removeChild(appendTarget);
      document.documentElement.classList.remove("setup-dialog-open");
    };

    // If the web-only mode is selected, restart the extension for it to work correctly
    const restartUrl = appendBody ? browser.runtime.getURL(`activityLibrary/library.html?setup=1`) : null;
    const showRestartWaitingScreen = async () => {
      content.innerHTML = "";
      const restartContainer = document.createElement("div");
      restartContainer.className = "setup-restarting-container";

      const spinner = createSpinner();
      restartContainer.appendChild(spinner);

      const restartText = document.createElement("p");
      restartContainer.appendChild(restartText);
      content.appendChild(restartContainer);

      let secondsLeft = 5;
      const noticeKey = appendBody ? "setup.restartingNoticePage" : "setup.restartingNoticeManual";

      const updateMessage = () => {
        restartText.textContent = i18n.t(noticeKey, { seconds: secondsLeft });
      };

      updateMessage();
      await new Promise((res) => {
        const interval = setInterval(() => {
          secondsLeft -= 1;
          if (secondsLeft > 0) {
            updateMessage();
          } else {
            clearInterval(interval);
            res();
          }
        }, 1000);
      });
    };

    // Event Listeners
    btnWebOnly.addEventListener("click", async (e) => {
      e.preventDefault();

      stepOneContainer.remove();
      const webOnlySection = document.createElement("div");
      webOnlySection.className = "setup-webonly-section";

      const infoText = document.createElement("p");
      infoText.textContent = i18n.t("setup.connectionMode.webOnlyNotice");
      webOnlySection.appendChild(infoText);

      const btnOk = document.createElement("button");
      btnOk.type = "button";
      btnOk.textContent = i18n.t("common.ok");
      btnOk.className = "setup-mode-btn";
      webOnlySection.appendChild(btnOk);

      content.appendChild(webOnlySection);

      btnOk.addEventListener("click", async () => {
        await browser.storage.local.set({
          webOnlyMode: true,
          initialSetupDone: true,
        });
        await showRestartWaitingScreen();
        cleanup();
        resolve();
        await restartExtension(false, restartUrl);
      });
    });

    btnWebAndApp.addEventListener("click", async (e) => {
      e.preventDefault();
      if (isSetupAlreadyDone) {
        await browser.storage.local.set({
          webOnlyMode: false,
        });
        cleanup();
        resolve();
      } else {
        stepOneContainer.remove();
        downloadSection.style.display = "block";
      }
    });

    confirmButton.addEventListener("click", async (e) => {
      e.preventDefault();
      await browser.storage.local.set({
        webOnlyMode: false,
        initialSetupDone: true,
      });
      cleanup();
      resolve();
    });
  });
}

// Show host permission dialog
async function showHostPermissionDialog(appendBody, loadingOverlay) {
  if (loadingOverlay) loadingOverlay.remove();
  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.id = "setupAlert";

    const dialog = document.createElement("div");
    dialog.className = "setup-dialog";

    const content = document.createElement("div");
    content.className = "setup-dialog-content";

    const contentHeader = document.createElement("h2");
    contentHeader.textContent = i18n.t("setup.permission.header");
    content.appendChild(contentHeader);

    const contentText = document.createElement("p");
    contentText.textContent = i18n.t("setup.permission.message");
    content.appendChild(contentText);

    const contentNote = document.createElement("p");
    contentNote.textContent = i18n.t("setup.permission.note");
    contentNote.classList.add("setup-note");
    content.appendChild(contentNote);

    const buttons = document.createElement("div");
    buttons.className = "setup-dialog-buttons";

    const grantButton = document.createElement("button");
    grantButton.id = "grantPermission";
    grantButton.textContent = i18n.t("setup.permission.grant");

    buttons.appendChild(grantButton);
    content.appendChild(buttons);
    dialog.appendChild(content);

    if (appendBody) wrapper.appendChild(dialog);
    const appendTarget = appendBody ? wrapper : dialog;
    const contentDiv = appendBody ? document.body : document.querySelector(".content");
    contentDiv.appendChild(appendTarget);

    document.documentElement.classList.add("setup-dialog-open", "permission");

    let requested = false;

    grantButton.addEventListener("click", async () => {
      if (requested) return;
      requested = true;

      try {
        const granted = await browser.permissions.request({
          origins: ["*://*/*"],
        });

        if (granted) {
          resolve(granted);
          if (!appendBody) window.close();
        }
      } catch (err) {
        console.error("Permission request failed:", err);
        resolve(false);
        if (!appendBody) window.close();
      } finally {
        if (appendBody) location.reload();
      }
    });
  });
}
