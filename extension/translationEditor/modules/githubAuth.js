let teGithubTokenPromise = null;
let teActiveDeviceFlowClose = null;

function teGetGithubTokenCached() {
  if (!teGithubTokenPromise) teGithubTokenPromise = githubContributeService.getToken();
  return teGithubTokenPromise;
}

// Runs action only when authenticated. Otherwise the existing device-flow
// modal is opened and the action is resumed after a successful login.
async function teRunWhenAuthenticated(action) {
  const token = await teGetGithubTokenCached();
  if (token) {
    await action(token);
    return true;
  }
  await teShowDeviceFlowModal({
    onSuccess: (newToken) => {
      Promise.resolve(action(newToken)).catch((err) => {
        if (typeof logError === "function") logError("[Translation Editor]: resumed action failed", err);
      });
    },
  });
  return false;
}

async function teRefreshGithubAuthBadge() {
  const button = document.getElementById("btnGithubSettings");
  if (!button) return;
  const token = await teGetGithubTokenCached();

  button.classList.toggle("github-connected", !!token);
  button.title = token ? i18n.t("userscript.contribute.oauth.connectedTitle") : i18n.t("userscript.contribute.oauth.title");

  button.querySelector(".github-avatar")?.remove();
  button.querySelector("svg")?.remove();

  if (token) {
    const user = await githubContributeService.getCachedUser();
    if (user?.avatar_url) {
      const avatar = document.createElement("img");
      avatar.className = "github-avatar";
      avatar.src = user.avatar_url;
      avatar.alt = user.login || "";
      avatar.width = 20;
      avatar.height = 20;
      button.appendChild(avatar);
    } else {
      button.appendChild(createSVG(svg_paths.githubIconPaths));
    }
  } else {
    button.appendChild(createSVG(svg_paths.githubIconPaths));
  }
}

async function teOnGithubSettingsClick() {
  const token = await teGetGithubTokenCached();
  if (token) {
    teShowGithubConnectedModal();
  } else {
    await teShowDeviceFlowModal();
  }
}

function teShowGithubConnectedModal() {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.display = "flex";

  const content = document.createElement("div");
  content.className = "modal-content github-connected-content";

  const title = document.createElement("h2");
  title.textContent = i18n.t("userscript.contribute.oauth.connectedTitle");

  const userEl = document.createElement("div");
  userEl.className = "github-connected-user";
  const renderUser = (user) => {
    userEl.replaceChildren();
    if (!user) return;
    const avatar = document.createElement("img");
    avatar.className = "github-avatar";
    avatar.src = user.avatar_url;
    avatar.alt = user.login || "";
    avatar.width = 36;
    avatar.height = 36;
    const name = document.createElement("span");
    name.className = "github-username";
    name.textContent = user.login;
    userEl.append(avatar, name);
  };
  githubContributeService
    .getCachedUser()
    .then(renderUser)
    .catch(() => renderUser(null));

  const buttonRow = document.createElement("div");
  buttonRow.className = "button-group footer-buttons";

  const disconnectBtn = document.createElement("button");
  disconnectBtn.className = "btn btn-action github-disconnect-btn";
  disconnectBtn.textContent = i18n.t("userscript.contribute.oauth.disconnect");

  const reloadBtn = document.createElement("button");
  reloadBtn.className = "btn btn-action";
  reloadBtn.appendChild(createSVG(svg_paths.refreshIconPaths));
  reloadBtn.title = i18n.t("userscript.contribute.oauth.connectedTitle");

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn-action close-btn";
  closeBtn.textContent = i18n.t("common.close");

  reloadBtn.addEventListener("click", async () => {
    reloadBtn.disabled = true;
    try {
      const user = await githubContributeService.fetchAndCacheUser();
      renderUser(user);
      await teRefreshGithubAuthBadge();
      showAlert(i18n.t("common.ok"), "", "tip", { labelOk: i18n.t("common.close") });
    } catch (_err) {
      // Keep the cached user and the modal open; the next reload can retry.
    }
    reloadBtn.disabled = false;
  });

  disconnectBtn.addEventListener("click", async () => {
    await githubContributeService.clearToken();
    teGithubTokenPromise = null;
    teResetDiscussionsState();
    teRefreshGithubAuthBadge();
    modal.remove();
  });

  closeBtn.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  buttonRow.append(disconnectBtn, reloadBtn, closeBtn);
  content.append(title, userEl, buttonRow);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

async function teShowDeviceFlowModal({ onSuccess = null } = {}) {
  // Abort and clean up any previous flow before starting a new one; otherwise
  // two polls and two timer intervals can run at once.
  teActiveDeviceFlowClose?.();
  teActiveDeviceFlowClose = null;
  document.querySelector(".device-flow-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "modal device-flow-modal";
  modal.style.display = "flex";

  const content = document.createElement("div");
  content.className = "modal-content device-flow-content";

  const title = document.createElement("h2");
  title.textContent = i18n.t("userscript.contribute.oauth.title");

  const stateEl = document.createElement("div");
  stateEl.className = "device-flow-state";
  const loadingEl = document.createElement("p");
  loadingEl.className = "contribute-status loading";
  loadingEl.textContent = i18n.t("userscript.contribute.oauth.requesting");
  stateEl.appendChild(loadingEl);

  const buttonRow = document.createElement("div");
  buttonRow.className = "button-group footer-buttons";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn close-btn";
  cancelBtn.textContent = i18n.t("common.cancel");
  const disconnectBtn = document.createElement("button");
  disconnectBtn.className = "btn btn-action github-disconnect-btn";
  disconnectBtn.textContent = i18n.t("userscript.contribute.oauth.disconnect");

  const abortController = new AbortController();
  let timerInterval = null;

  const close = () => {
    abortController.abort();
    if (timerInterval) clearInterval(timerInterval);
    if (teActiveDeviceFlowClose === close) teActiveDeviceFlowClose = null;
    modal.remove();
  };
  teActiveDeviceFlowClose = close;

  disconnectBtn.addEventListener("click", async () => {
    close();
    await githubContributeService.clearToken();
    teGithubTokenPromise = null;
    teResetDiscussionsState();
  });
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });

  buttonRow.append(disconnectBtn, cancelBtn);
  content.append(title, stateEl, buttonRow);
  modal.appendChild(content);
  document.body.appendChild(modal);

  try {
    const { device_code, user_code, verification_uri, interval, expires_in } = await githubContributeService.requestDeviceCode();
    stateEl.replaceChildren();

    const desc = document.createElement("p");
    desc.className = "device-flow-desc";
    desc.textContent = i18n.t("userscript.contribute.oauth.description");
    stateEl.appendChild(desc);

    const codeWrap = document.createElement("div");
    codeWrap.className = "device-flow-code-wrap";
    const codeEl = document.createElement("span");
    codeEl.className = "device-flow-code";
    codeEl.textContent = user_code;
    const copyBtn = document.createElement("button");
    copyBtn.className = "device-flow-copy";
    copyBtn.appendChild(createSVG(svg_paths.copyIconPaths));
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(user_code).then(() => {
        copyBtn.replaceChildren(createSVG(svg_paths.checkIconPaths));
        setTimeout(() => copyBtn.replaceChildren(createSVG(svg_paths.copyIconPaths)), 2000);
      });
    });
    codeWrap.append(codeEl, copyBtn);
    stateEl.appendChild(codeWrap);

    const openBtn = document.createElement("button");
    openBtn.className = "device-flow-open-btn btn confirm-button";
    openBtn.textContent = i18n.t("userscript.contribute.oauth.openGitHub");
    openBtn.addEventListener("click", () => window.open(verification_uri, "_blank", "noopener,noreferrer"));
    stateEl.appendChild(openBtn);

    const waitingEl = document.createElement("p");
    waitingEl.className = "contribute-status loading device-flow-waiting";
    waitingEl.textContent = i18n.t("userscript.contribute.oauth.waiting");
    stateEl.appendChild(waitingEl);

    const timerEl = document.createElement("small");
    timerEl.className = "device-flow-timer";
    stateEl.appendChild(timerEl);

    let secondsLeft = expires_in;
    timerInterval = setInterval(() => {
      secondsLeft--;
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = secondsLeft % 60;
      timerEl.textContent = i18n.t("userscript.contribute.oauth.expires", { count: `${minutes}:${String(seconds).padStart(2, "0")}` });
      if (secondsLeft <= 0) clearInterval(timerInterval);
    }, 1000);

    try {
      const accessToken = await githubContributeService.pollForToken(device_code, interval || 5, abortController.signal, expires_in);
      clearInterval(timerInterval);
      await githubContributeService.saveToken(accessToken);
      teGithubTokenPromise = Promise.resolve(accessToken);
      await githubContributeService.fetchAndCacheUser();
      await teRefreshGithubAuthBadge();
      onSuccess?.(accessToken);

      stateEl.replaceChildren();
      const successEl = document.createElement("p");
      successEl.className = "contribute-status success";
      successEl.textContent = i18n.t("userscript.contribute.oauth.success");
      stateEl.appendChild(successEl);
      setTimeout(() => modal.remove(), 800);
    } catch (pollErr) {
      clearInterval(timerInterval);
      if (pollErr.message === "cancelled") return;
      stateEl.replaceChildren();
      const errorEl = document.createElement("p");
      errorEl.className = "contribute-status error";
      errorEl.textContent =
        pollErr.message === "expired"
          ? i18n.t("userscript.contribute.oauth.expired")
          : pollErr.message === "denied"
            ? i18n.t("userscript.contribute.oauth.denied")
            : pollErr.message;
      stateEl.appendChild(errorEl);

      const retryBtn = document.createElement("button");
      retryBtn.className = "btn confirm-button";
      retryBtn.textContent = i18n.t("setup.permission.grant.retry");
      retryBtn.addEventListener("click", () => {
        modal.remove();
        teShowDeviceFlowModal({ onSuccess });
      });
      stateEl.appendChild(retryBtn);
    }
  } catch (initErr) {
    stateEl.replaceChildren();
    const errorEl = document.createElement("p");
    errorEl.className = "contribute-status error";
    errorEl.textContent = initErr.message;
    stateEl.appendChild(errorEl);
  }
}
