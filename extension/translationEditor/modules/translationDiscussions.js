// Per-translation-key Discussion integration. Strictly lazy: a network
// request happens only after the user clicks a key's Discussion button.

let teTranslationPanelId = 0;
let teTranslationPanel = null;

// The shared modal removes itself on overlay clicks. Capture the click before
// it reaches that handler and ask for confirmation instead, using the existing
// dialog component.
function teGuardTranslationModalClose(modal, body) {
  let confirming = false;

  const onOutsideClick = (event) => {
    if (event.target !== modal || !modal.isConnected || confirming) return;
    event.stopPropagation();
    event.preventDefault();
    confirming = true;
    showConfirm("", {
      type: "warn",
      heading: i18n.t("translationEditor.discussion.closeConfirmHeading"),
      body: "",
      labelOk: i18n.t("common.close"),
    })
      .then((confirmed) => {
        if (confirmed) modal.remove();
      })
      .catch(() => {})
      .finally(() => {
        confirming = false;
      });
  };

  document.addEventListener("click", onOutsideClick, true);
  const remove = modal.remove.bind(modal);
  modal.remove = () => {
    document.removeEventListener("click", onOutsideClick, true);
    teDestroyCommentListSimpleBar(body);
    if (teTranslationPanel?.element === modal) teTranslationPanel = null;
    remove();
  };
}

function teDiscussionButtonLabel(key) {
  const discussion = teGetCachedTranslationDiscussion(key);
  return discussion ? i18n.t("translationEditor.discussion.buttonCount", { count: discussion.commentsCount }) : i18n.t("translationEditor.discussion.button");
}

function teCreateDiscussionButton(row) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "te-discussion-btn btn btn-sm";
  button.textContent = teDiscussionButtonLabel(row.key);
  button.title = i18n.t("translationEditor.discussion.buttonTitle", { key: row.key });
  button.addEventListener("click", () => {
    teRunWhenAuthenticated(() => teOpenTranslationDiscussion(row.key)).catch((err) => {
      if (typeof logError === "function") logError("[Translation Editor]: discussion panel failed", err);
    });
  });
  return button;
}

// Updates only the currently rendered button for this key. Never touches
// other rows or fetches other keys.
function teRefreshDiscussionButton(key) {
  const element = teTable.rendered.get(key);
  const button = element?.querySelector?.(".te-discussion-btn");
  if (!button) return;
  button.textContent = teDiscussionButtonLabel(key);
}

async function tePostTranslationMessage(key, text, knownDiscussion) {
  let discussion = knownDiscussion;
  if (!discussion) {
    // Single forced re-check immediately before creating: another user may
    // have created the discussion since the panel's initial lookup.
    discussion = await teFindTranslationDiscussion(key, { force: true });
  }

  if (discussion) {
    await teAddDiscussionComment(discussion.id, text);
    // teAddDiscussionComment already updated the cached object; only use the
    // re-fetch when it succeeds, otherwise we would double-count the comment.
    const updated = await teFetchDiscussionById(discussion.id);
    const result = updated || discussion;
    teRememberTranslationDiscussion(key, result);
    return result;
  }

  return teCreateTranslationDiscussion(key, text);
}

async function teOpenTranslationDiscussion(key) {
  if (teTranslationPanel?.element?.isConnected) teTranslationPanel.element.remove();
  const panelId = ++teTranslationPanelId;

  const body = document.createElement("div");
  body.className = "te-translation-disc-body";
  body.appendChild(teDiscStatusNode(i18n.t("translationEditor.discussion.loading"), "loading"));

  const modal = createContentModal(i18n.t("translationEditor.discussion.title"), body, "te-translation-disc-modal");
  teWrapModalClose(modal);
  teGuardTranslationModalClose(modal, body);
  teTranslationPanel = { id: panelId, element: modal, key };

  const render = (discussion) => {
    if (panelId !== teTranslationPanelId || !modal.isConnected) return;
    // Unmount the old comment list's SimpleBar before detaching its DOM.
    teDestroyCommentListSimpleBar(body);
    body.replaceChildren();

    if (discussion) {
      const header = document.createElement("div");
      header.className = "te-translation-disc-header";

      const heading = document.createElement("div");
      heading.className = "te-translation-disc-heading";
      heading.textContent = key;

      const meta = document.createElement("div");
      meta.className = "te-translation-disc-meta";

      const avatar = teDiscAvatarNode(discussion.author);
      if (avatar) meta.appendChild(avatar);

      const author = document.createElement("div");
      author.className = "te-disc-disc-author";
      author.textContent = `${teDiscAuthorLogin(discussion.author)}`;

      meta.appendChild(author);

      const link = document.createElement("a");
      link.className = "te-disc-external";
      link.href = discussion.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `#${discussion.number}`;

      const metaText = document.createElement("span");
      metaText.textContent = `· ${teDiscFormatDate(discussion.createdAt)} · `;
      metaText.title = teDiscAbsoluteDate(discussion.createdAt);

      metaText.appendChild(link);
      meta.appendChild(metaText);

      header.append(heading, meta);

      const original = document.createElement("div");
      original.append(teDiscBodyNode(teStripTranslationMarker(discussion.body)));
      header.appendChild(original);
      body.appendChild(header);
    } else {
      body.appendChild(teDiscStatusNode(i18n.t("translationEditor.discussion.empty")));
    }

    let composer = null;
    const comments = document.createElement("div");
    comments.className = "te-translation-disc-section te-translation-disc-comments-section";
    const commentBody = teDiscCommentList(discussion || { commentsCount: 0, comments: [] }, (comment) => composer?.setReplyTo(comment));
    comments.appendChild(commentBody);
    body.appendChild(comments);
    teActivateCommentListSimpleBar(body);

    composer = teDiscCreateComposer({
      placeholder: i18n.t("translationEditor.discussion.placeholder"),
      sendLabel: i18n.t("translationEditor.discussion.send"),
      onSend: async (text) => {
        const result = await tePostTranslationMessage(key, text, discussion);
        if (panelId === teTranslationPanelId && modal.isConnected) render(result);
        teRefreshDiscussionButton(key);
      },
    });

    const composerSection = document.createElement("div");
    composerSection.className = "te-translation-disc-section te-translation-disc-composer-section";
    composerSection.appendChild(composer.element);
    body.appendChild(composerSection);
  };

  try {
    const discussion = await teFindTranslationDiscussion(key);
    if (panelId !== teTranslationPanelId || !modal.isConnected) return;
    render(discussion);
    teRefreshDiscussionButton(key);
  } catch (err) {
    if (panelId !== teTranslationPanelId || !modal.isConnected) return;
    teDestroyCommentListSimpleBar(body);
    body.replaceChildren(teDiscStatusNode(i18n.t("translationEditor.discussion.error", { error: teDiscErrorMessage(err) }), "error"));
  }
}
