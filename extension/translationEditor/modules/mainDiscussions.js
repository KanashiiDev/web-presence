// General-purpose Discussions section. Loaded only when the user opens the
// Discussions view; nothing here runs during translation editor startup.

const teMainDiscState = {
  categoryId: "",
  nodes: [],
  pageInfo: {},
  cursors: [null],
  page: 1,
  selectedId: null,
  listToken: 0,
  detailToken: 0,
};

// Render into the inner content node: SimpleBar wraps the panel's children,
// so replacing the panel itself would destroy its scroll wrapper.
function teRenderDiscListContent(...nodes) {
  teElements.discListContent.replaceChildren(...nodes);
  activateSimpleBar("discList");
}

function teRenderDiscDetailContent(...nodes) {
  teDestroyCommentListSimpleBar(teElements.discDetailContent);
  teElements.discDetailContent.replaceChildren(...nodes);
}

async function teEnterDiscussionsView() {
  try {
    await teLoadDiscussionCategories();
  } catch (err) {
    teRenderDiscListContent(teDiscStatusNode(teDiscErrorMessage(err), "error"));
    return;
  }
  await teLoadDiscussionsPage({ reset: true });
}

async function teLoadDiscussionCategories() {
  const access = await teEnsureDiscussionsAccess();
  const select = teElements.discCategoryFilter;
  const selected = teMainDiscState.categoryId;
  select.replaceChildren();

  const all = document.createElement("option");
  all.value = "";
  all.textContent = i18n.t("translationEditor.discussions.allCategories");
  select.appendChild(all);

  const allowedCategories = teGetGeneralCategories(access.categories);
  allowedCategories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  });
  select.value = allowedCategories.some((category) => category.id === selected) ? selected : "";
  teMainDiscState.categoryId = select.value;
  teSyncDiscCategorySelect(select.value);
}

async function teLoadDiscussionsPage({ reset = false, after = null } = {}) {
  const token = ++teMainDiscState.listToken;
  teRenderDiscListContent(teDiscStatusNode(i18n.t("translationEditor.discussions.loading"), "loading"));
  teElements.discPagination.replaceChildren();
  try {
    const result = await teFetchDiscussionList({ categoryId: teMainDiscState.categoryId, after });
    if (token !== teMainDiscState.listToken) return false;
    teMainDiscState.nodes = result.nodes;
    teMainDiscState.pageInfo = result.pageInfo;
    if (reset && !after) {
      teMainDiscState.page = 1;
      teMainDiscState.cursors = [null];
    }
    teRenderDiscussionList();
    return true;
  } catch (err) {
    if (token !== teMainDiscState.listToken) return false;
    teRenderDiscListContent(teDiscStatusNode(i18n.t("translationEditor.discussions.listError", { error: teDiscErrorMessage(err) }), "error"));
    return false;
  }
}

async function teGoDiscussionPage(direction) {
  if (direction === "next" && !teMainDiscState.pageInfo.hasNextPage) return;
  if (direction === "prev" && teMainDiscState.page <= 1) return;
  const before = { page: teMainDiscState.page, cursors: [...teMainDiscState.cursors] };
  if (direction === "next") {
    teMainDiscState.cursors.push(teMainDiscState.pageInfo.endCursor);
    teMainDiscState.page += 1;
  } else {
    teMainDiscState.cursors.pop();
    teMainDiscState.page -= 1;
  }
  const loaded = await teLoadDiscussionsPage({ after: teMainDiscState.cursors[teMainDiscState.cursors.length - 1] });
  // A failed load leaves the old list visible; keep pagination state in sync.
  if (!loaded) {
    teMainDiscState.page = before.page;
    teMainDiscState.cursors = before.cursors;
    teRenderDiscussionPagination();
  }
}

function teRenderDiscussionPagination() {
  const pagination = teElements.discPagination;
  pagination.replaceChildren();

  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "btn btn-secondary btn-sm";
  previous.textContent = i18n.t("translationEditor.discussions.prev");
  previous.disabled = teMainDiscState.page <= 1;
  previous.addEventListener("click", () => teGoDiscussionPage("prev"));

  const label = document.createElement("span");
  label.className = "te-disc-page-label";
  label.textContent = i18n.t("translationEditor.discussions.page", { page: teMainDiscState.page });

  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn btn-secondary btn-sm";
  next.textContent = i18n.t("translationEditor.discussions.next");
  next.disabled = !teMainDiscState.pageInfo.hasNextPage;
  next.addEventListener("click", () => teGoDiscussionPage("next"));

  pagination.append(previous, label, next);
}

function teRenderDiscussionList() {
  const rendered = Array.from(teElements.discListContent.querySelectorAll(".te-disc-item"));
  // With zero discussions the rendered list is also empty, so the equality check
  // alone would return early and leave the "loading" status node in place.
  if (
    teMainDiscState.nodes.length &&
    rendered.length === teMainDiscState.nodes.length &&
    teMainDiscState.nodes.every((node, index) => rendered[index].dataset.id === node.id)
  ) {
    rendered.forEach((item, index) => item.classList.toggle("active", teMainDiscState.nodes[index].id === teMainDiscState.selectedId));
    return;
  }

  const items = [];

  if (!teMainDiscState.nodes.length) {
    items.push(teDiscStatusNode(i18n.t("translationEditor.discussions.empty")));
  } else {
    teMainDiscState.nodes.forEach((discussion) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = discussion.id === teMainDiscState.selectedId ? "te-disc-item active" : "te-disc-item";
      item.dataset.id = discussion.id;

      const title = document.createElement("div");
      title.className = "te-disc-item-title";
      title.textContent = discussion.title;

      const meta = document.createElement("div");
      meta.className = "te-disc-item-meta";
      const avatar = teDiscAvatarNode(discussion.author, true);
      if (avatar) meta.appendChild(avatar);
      const metaText = document.createElement("span");
      metaText.textContent = `${teDiscAuthorLogin(discussion.author)} · ${teDiscFormatDate(discussion.createdAt)}`;
      metaText.title = teDiscAbsoluteDate(discussion.createdAt);
      meta.appendChild(metaText);

      const footer = document.createElement("div");
      footer.className = "te-disc-item-footer";

      const count = document.createElement("span");
      count.className = "te-disc-item-count";
      count.textContent = i18n.t("translationEditor.discussions.commentCount", { count: discussion.commentsCount });

      const category = document.createElement("span");
      category.className = "te-disc-item-category";
      category.textContent = `${discussion.category?.name || ""}`;

      footer.append(count, category);

      item.append(title, meta, footer);
      item.addEventListener("click", () => teOpenMainDiscussion(discussion.id));
      items.push(item);
    });
  }

  teRenderDiscListContent(...items);
  teRenderDiscussionPagination();
  if (!teMainDiscState.selectedId) teRenderDiscDetailContent(teDiscStatusNode(i18n.t("translationEditor.discussions.detailEmpty")));
}

async function teOpenMainDiscussion(id) {
  teMainDiscState.selectedId = id;
  teRenderDiscussionList();

  const token = ++teMainDiscState.detailToken;
  const cached = teDiscState.byId.get(id);
  if (cached?.detailLoaded) {
    teRenderMainDetail(cached);
  } else {
    teRenderDiscDetailContent(teDiscStatusNode(i18n.t("translationEditor.discussions.detailLoading"), "loading"));
  }

  try {
    const discussion = await teFetchDiscussionById(id);
    if (token !== teMainDiscState.detailToken) return;
    if (!discussion) {
      teRenderDiscDetailContent(teDiscStatusNode(i18n.t("translationEditor.discussions.detailError", { error: "not found" }), "error"));
      return;
    }
    teRenderMainDetail(discussion);
  } catch (err) {
    if (token !== teMainDiscState.detailToken) return;
    teRenderDiscDetailContent(teDiscStatusNode(i18n.t("translationEditor.discussions.detailError", { error: teDiscErrorMessage(err) }), "error"));
  }
}

function teRenderMainDetail(discussion) {
  const detail = [];

  const header = document.createElement("div");
  header.className = "te-disc-detail-header";
  const title = document.createElement("h3");
  title.textContent = discussion.title;
  header.appendChild(title);

  const category = document.createElement("div");
  category.className = "te-disc-detail-category";
  category.textContent = `${discussion.category?.name || ""}`;

  const meta = document.createElement("div");
  meta.className = "te-disc-detail-meta";
  const avatar = teDiscAvatarNode(discussion.author);
  if (avatar) meta.appendChild(avatar);
  const metaText = document.createElement("span");
  metaText.textContent = `${teDiscAuthorLogin(discussion.author)} · ${teDiscFormatDate(discussion.createdAt)} · `;
  metaText.title = teDiscAbsoluteDate(discussion.createdAt);

  const link = document.createElement("a");
  link.className = "te-disc-external";
  link.href = discussion.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `#${discussion.number}`;
  metaText.appendChild(link);
  meta.appendChild(metaText);
  header.append(category, meta);
  detail.push(header);
  detail.push(teDiscBodyNode(teStripTranslationMarker(discussion.body)));

  let composer = null;
  detail.push(teDiscCommentList(discussion, (comment) => composer?.setReplyTo(comment)));

  composer = teDiscCreateComposer({
    placeholder: i18n.t("translationEditor.discussions.commentPlaceholder"),
    sendLabel: i18n.t("translationEditor.discussions.commentSend"),
    onSend: async (text, replyToId) => {
      await teAddDiscussionComment(discussion.id, text, replyToId);
      const updated = await teFetchDiscussionById(discussion.id);
      if (updated && teMainDiscState.selectedId === discussion.id) teRenderMainDetail(updated);
    },
  });
  detail.push(composer.element);
  teRenderDiscDetailContent(...detail);
  teActivateCommentListSimpleBar(teElements.discDetailContent);
}

function teShowNewDiscussionModal() {
  const body = document.createElement("div");
  body.className = "te-new-discussion";

  const titleLabel = document.createElement("label");
  titleLabel.className = "te-field";
  const titleSpan = document.createElement("span");
  titleSpan.textContent = i18n.t("translationEditor.discussions.newTitle");
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.maxLength = 200;
  titleLabel.append(titleSpan, titleInput);

  const categoryLabel = document.createElement("label");
  categoryLabel.className = "te-field";
  const categorySpan = document.createElement("span");
  categorySpan.textContent = i18n.t("translationEditor.discussions.newCategory");
  const categorySelect = document.createElement("select");
  categoryLabel.append(categorySpan, categorySelect);

  const bodyLabel = document.createElement("label");
  bodyLabel.className = "te-field";
  const bodySpan = document.createElement("span");
  bodySpan.textContent = i18n.t("translationEditor.discussions.newBody");
  const bodyInput = document.createElement("textarea");
  bodyInput.rows = 6;
  bodyLabel.append(bodySpan, bodyInput);

  const status = document.createElement("div");
  status.className = "contribute-status error";
  status.hidden = true;

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "btn btn-primary";
  submit.textContent = i18n.t("translationEditor.discussions.newSubmit");

  body.append(titleLabel, categoryLabel, bodyLabel, status);

  const modal = createContentModal(i18n.t("translationEditor.discussions.new"), body, "te-new-discussion-modal", [submit]);
  teWrapModalClose(modal);
  const close = () => modal.remove();

  const submitDiscussion = async () => {
    const title = titleInput.value.trim();
    const message = bodyInput.value.trim();
    if (!title || !message) return;
    status.hidden = true;
    submit.disabled = true;
    submit.textContent = i18n.t("translationEditor.discussion.sending");
    try {
      await teEnsureDiscussionsAccess();
      const discussion = await teCreateStandaloneDiscussion({ title, categoryId: categorySelect.value, body: message });
      close();
      await teLoadDiscussionsPage({ reset: true });
      teMainDiscState.selectedId = discussion.id;
      await teOpenMainDiscussion(discussion.id);
    } catch (err) {
      status.hidden = false;
      status.textContent = teDiscErrorMessage(err);
    } finally {
      submit.disabled = false;
      submit.textContent = i18n.t("translationEditor.discussions.newSubmit");
    }
  };

  submit.addEventListener("click", async () => {
    const token = await teGetGithubTokenCached();
    if (!token) {
      await teShowDeviceFlowModal({ onSuccess: () => submitDiscussion() });
      return;
    }
    await submitDiscussion();
  });

  teEnsureDiscussionsAccess()
    .then((access) => {
      teGetGeneralCategories(access.categories).forEach((category) => {
        const option = document.createElement("option");
        option.value = category.id;
        option.textContent = category.name;
        categorySelect.appendChild(option);
      });
    })
    .catch((err) => {
      status.hidden = false;
      status.textContent = teDiscErrorMessage(err);
    });

  titleInput.focus();
}
