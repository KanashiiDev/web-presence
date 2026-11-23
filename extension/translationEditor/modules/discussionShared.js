// Shared presentation helpers for the two GitHub Discussions experiences in
// the translation editor. No network calls live here.

// markdown-it is loaded as a UMD global by the page. Raw HTML stays disabled
// so GitHub content cannot inject markup into the extension page.
const teDiscMarkdown = typeof markdownit === "function" ? markdownit({ html: false, linkify: true, breaks: true }) : null;
let teDiscMarkdownLinksReady = false;

// Top-level statements are dropped by the inliner, so the renderer override is
// applied lazily from teDiscBodyNode instead of at module load time.
function teEnsureDiscMarkdownLinks() {
  if (!teDiscMarkdown || teDiscMarkdownLinksReady) return;
  teDiscMarkdownLinksReady = true;
  // Remote images in markdown would leak information about the extension user
  // to arbitrary hosts; discussion text does not need them.
  teDiscMarkdown.disable("image");
  const defaultLinkOpen = teDiscMarkdown.renderer.rules.link_open || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  teDiscMarkdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, index, options, env, self);
  };
}

function teDiscStatusNode(text, variant = "") {
  const element = document.createElement("div");
  element.className = variant ? `contribute-status ${variant}` : "contribute-status";
  element.textContent = text;
  return element;
}

function teDiscAbsoluteDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function teDiscFormatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return typeof relativeTime === "function" ? relativeTime(value) : date.toLocaleDateString();
}

function teDiscAuthorLogin(author) {
  if (typeof author === "string") return author || "unknown";
  return author?.login || "unknown";
}

function teDiscAvatarNode(author, small = false) {
  const url = typeof author === "string" ? "" : author?.avatarUrl;
  if (!url) return null;
  const image = document.createElement("img");
  image.className = small ? "te-disc-avatar te-disc-avatar-sm" : "te-disc-avatar";
  image.src = url;
  image.alt = "";
  image.width = small ? 18 : 22;
  image.height = small ? 18 : 22;
  image.loading = "lazy";
  return image;
}

function teDiscBodyNode(text) {
  const body = document.createElement("div");
  body.className = "te-disc-body";
  const content = String(text || "");
  if (teDiscMarkdown) {
    teEnsureDiscMarkdownLinks();
    body.innerHTML = teDiscMarkdown.render(content);
    return body;
  }
  content
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .forEach((paragraph) => {
      const element = document.createElement("p");
      element.textContent = paragraph;
      body.appendChild(element);
    });
  return body;
}

function teDiscCommentNode(comment, onReply, isReply = false) {
  const item = document.createElement("div");
  item.className = isReply ? "te-disc-comment is-reply" : "te-disc-comment";

  const meta = document.createElement("div");
  meta.className = "te-disc-comment-meta";
  const avatar = teDiscAvatarNode(comment.author, true);
  if (avatar) meta.appendChild(avatar);
  const author = document.createElement("span");
  author.className = "te-disc-comment-author";
  author.textContent = teDiscAuthorLogin(comment.author);
  const time = document.createElement("time");
  time.className = "te-disc-comment-time";
  time.textContent = `· ${teDiscFormatDate(comment.createdAt)}`;
  time.title = teDiscAbsoluteDate(comment.createdAt);
  meta.append(author, time);
  item.appendChild(meta);
  item.appendChild(teDiscBodyNode(comment.body));

  if (!isReply && typeof onReply === "function") {
    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "te-disc-reply-btn";
    replyButton.textContent = i18n.t("translationEditor.discussion.reply");
    replyButton.addEventListener("click", () => onReply(comment));
    item.appendChild(replyButton);
  }

  (comment.replies || []).forEach((reply) => item.appendChild(teDiscCommentNode(reply, onReply, true)));
  return item;
}

function teDiscCommentList(discussion, onReply) {
  const wrap = document.createElement("div");
  wrap.className = "te-disc-comments";

  const commentList = document.createElement("div");
  commentList.className = "te-disc-comment-list";

  const heading = document.createElement("div");
  heading.className = "te-disc-comments-title";
  heading.textContent = i18n.t("translationEditor.discussion.comments", { count: discussion.commentsCount });
  wrap.appendChild(heading);

  if (!discussion.comments.length) {
    commentList.appendChild(teDiscStatusNode(i18n.t("translationEditor.discussion.noComments")));
  } else {
    discussion.comments.forEach((comment) => commentList.appendChild(teDiscCommentNode(comment, onReply)));
  }
  wrap.appendChild(commentList);
  return wrap;
}

// The comment list exists in both the forum detail and the translation modal.
// Always address the concrete element, never a shared id, otherwise
// getElementById resolves whichever one appears first in the document.
function teDestroyCommentListSimpleBar(container) {
  const list = container?.querySelector?.(".te-disc-comment-list");
  if (list) destroySimplebar(list);
}

function teActivateCommentListSimpleBar(container) {
  const list = container?.querySelector?.(".te-disc-comment-list");
  if (list) activateSimpleBar(list);
}

// Moves the generated close button into its own full-width action footer.
function teWrapModalClose(modal) {
  const closeButton = modal?.querySelector(".close-btn");
  if (!closeButton || closeButton.parentElement?.classList.contains("te-disc-modal-footer")) return;
  const footer = document.createElement("div");
  footer.className = "te-disc-modal-footer";
  closeButton.replaceWith(footer);
  footer.appendChild(closeButton);
}

// Composer shared by the forum detail view and the translation-key panel.
// It supports Write/Preview modes and an explicit reply context.
// onSend(text, replyToId) may return a promise; errors are shown inline.
function teDiscCreateComposer({ placeholder, sendLabel, onSend }) {
  const element = document.createElement("div");
  element.className = "te-disc-composer";

  const tabs = document.createElement("div");
  tabs.className = "te-disc-editor-tabs";
  tabs.setAttribute("role", "tablist");

  const writeTab = document.createElement("button");
  writeTab.type = "button";
  writeTab.className = "te-disc-editor-tab active";
  writeTab.textContent = i18n.t("translationEditor.discussion.tab.write");
  writeTab.setAttribute("role", "tab");

  const previewTab = document.createElement("button");
  previewTab.type = "button";
  previewTab.className = "te-disc-editor-tab";
  previewTab.textContent = i18n.t("translationEditor.discussion.tab.preview");
  previewTab.setAttribute("role", "tab");

  tabs.append(writeTab, previewTab);

  const replyContext = document.createElement("div");
  replyContext.className = "te-disc-reply-context";
  replyContext.hidden = true;
  const replyLabel = document.createElement("span");
  replyLabel.className = "te-disc-reply-context-label";
  const cancelReply = document.createElement("button");
  cancelReply.type = "button";
  cancelReply.className = "te-disc-reply-cancel";
  cancelReply.textContent = i18n.t("translationEditor.discussion.cancelReply");
  replyContext.append(replyLabel, cancelReply);

  const replyBody = document.createElement("div");
  replyBody.className = "te-disc-editor-body";

  const textarea = document.createElement("textarea");
  textarea.className = "te-disc-textarea";
  textarea.placeholder = placeholder;
  textarea.rows = 4;

  const preview = document.createElement("div");
  preview.className = "te-disc-preview";
  preview.hidden = true;

  const error = document.createElement("div");
  error.className = "contribute-status error";
  error.hidden = true;

  const row = document.createElement("div");
  row.className = "te-disc-composer-row";
  const send = document.createElement("button");
  send.type = "button";
  send.className = "btn btn-primary btn-sm";
  send.textContent = sendLabel;
  row.appendChild(send);

  let replyToId = null;
  let mode = "write";

  const renderPreview = () => {
    preview.replaceChildren();
    if (!textarea.value.trim()) {
      const empty = document.createElement("div");
      empty.className = "te-disc-preview-empty";
      empty.textContent = i18n.t("translationEditor.discussion.preview.empty");
      preview.appendChild(empty);
      return;
    }
    preview.appendChild(teDiscBodyNode(textarea.value));
  };

  const setMode = (next) => {
    mode = next;
    writeTab.classList.toggle("active", mode === "write");
    previewTab.classList.toggle("active", mode === "preview");
    writeTab.setAttribute("aria-selected", String(mode === "write"));
    previewTab.setAttribute("aria-selected", String(mode === "preview"));
    textarea.hidden = mode !== "write";
    preview.hidden = mode !== "preview";
    if (mode === "preview") renderPreview();
  };

  const resetReply = () => {
    replyToId = null;
    replyContext.hidden = true;
    replyLabel.textContent = "";
    textarea.placeholder = placeholder;
    send.textContent = sendLabel;
  };

  cancelReply.addEventListener("click", resetReply);
  writeTab.addEventListener("click", () => setMode("write"));
  previewTab.addEventListener("click", () => setMode("preview"));
  textarea.addEventListener("input", () => {
    if (mode === "preview") renderPreview();
  });

  let busy = false;
  let busyGeneration = 0;
  const submit = async () => {
    if (busy) return;
    const text = textarea.value.trim();
    if (!text) return;
    const generation = ++busyGeneration;
    busy = true;
    send.disabled = true;
    try {
      const token = await teGetGithubTokenCached();
      if (!token) {
        let resume = false;
        await teShowDeviceFlowModal({
          onSuccess: () => {
            resume = true;
          },
        });
        if (resume && busyGeneration === generation) {
          busy = false;
          await submit();
        }
        return;
      }
      error.hidden = true;
      send.textContent = i18n.t("translationEditor.discussion.sending");
      await onSend(text, replyToId);
      textarea.value = "";
      if (mode === "preview") renderPreview();
      resetReply();
    } catch (err) {
      error.hidden = false;
      error.textContent = teDiscErrorMessage(err);
    } finally {
      if (busyGeneration === generation) {
        busy = false;
        send.disabled = false;
        send.textContent = replyToId ? i18n.t("translationEditor.discussion.reply") : sendLabel;
      }
    }
  };

  send.addEventListener("click", submit);

  replyBody.append(textarea, preview, error, row);

  element.append(tabs, replyContext, replyBody);

  return {
    element,
    focus: () => {
      if (mode !== "write") setMode("write");
      textarea.focus();
    },
    setReplyTo(comment) {
      replyToId = comment?.id || null;
      replyLabel.textContent = i18n.t("translationEditor.discussion.replyingTo", { author: teDiscAuthorLogin(comment?.author) });
      replyContext.hidden = !comment;
      if (mode !== "write") setMode("write");
      textarea.placeholder = comment ? i18n.t("translationEditor.discussion.replyPlaceholder") : placeholder;
      send.textContent = comment ? i18n.t("translationEditor.discussion.reply") : sendLabel;
      textarea.focus();
    },
  };
}
