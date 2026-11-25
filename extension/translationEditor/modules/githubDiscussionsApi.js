// GitHub Discussions data layer for the translation editor.
// All requests use the existing githubContributeService token/client. Nothing
// here runs at startup: every entry point is called from a user action.

const TE_DISC_OWNER = TE_REPO.owner;
const TE_DISC_REPO = TE_REPO.name;
const TE_DISC_PAGE_SIZE = 20;
const TE_DISC_SEARCH_SIZE = 30;
const TE_DISC_KEY_MARKER = "translation-key";
const TE_DISC_KEY_TITLE_PREFIX = "[Translation] ";
const TE_DISC_MARKER_REGEX = /<!--\s*translation-key:\s*(\S+?)\s*-->/;

// Single source of truth for category restrictions.
const TRANSLATION_DISCUSSION_CATEGORY = "Translations Key Related";
const GENERAL_DISCUSSION_CATEGORIES = ["Translations General", "Translations Key Related"];

const teDiscState = {
  repoId: null,
  categories: null,
  accessPromise: null,
  byId: new Map(),
  byKey: new Map(),
  inflight: new Map(),
};

function teResetDiscussionsState() {
  teDiscState.repoId = null;
  teDiscState.categories = null;
  teDiscState.accessPromise = null;
  teDiscState.byId.clear();
  teDiscState.byKey.clear();
  teDiscState.inflight.clear();
}

const TE_DISC_COMMENT_FIELDS = `
  id
  body
  createdAt
  author { login avatarUrl(size: 40) }
  replies(first: 100) {
    nodes {
      id
      body
      createdAt
      author { login avatarUrl(size: 40) }
    }
  }
`;

const TE_DISC_FIELDS = `
  __typename
  id
  number
  title
  body
  url
  createdAt
  author { login avatarUrl(size: 40) }
  category { id name }
  comments(first: 100) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes { ${TE_DISC_COMMENT_FIELDS} }
  }
`;

// The forum list only needs summary fields; comments are fetched on demand
// when a discussion is opened.
const TE_DISC_LIST_FIELDS = `
  __typename
  id
  number
  title
  body
  url
  createdAt
  author { login avatarUrl(size: 40) }
  category { id name }
  comments { totalCount }
`;

const TE_DISC_CATEGORIES_QUERY = `
  query TeDiscCategories($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id
      discussionCategories(first: 100) {
        nodes { id name }
      }
    }
  }
`;

const TE_DISC_LIST_QUERY = `
  query TeDiscList($owner: String!, $repo: String!, $first: Int!, $after: String, $categoryId: ID) {
    repository(owner: $owner, name: $repo) {
      discussions(first: $first, after: $after, categoryId: $categoryId, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        nodes { ${TE_DISC_LIST_FIELDS} }
      }
    }
  }
`;

const TE_DISC_NODE_QUERY = `
  query TeDiscNode($id: ID!) {
    node(id: $id) {
      ... on Discussion {
        ${TE_DISC_FIELDS}
      }
    }
  }
`;

const TE_DISC_SEARCH_QUERY = `
  query TeDiscSearch($query: String!, $first: Int!) {
    search(query: $query, type: DISCUSSION, first: $first) {
      nodes {
        ... on Discussion {
          __typename
          id
          body
          category { name }
        }
      }
    }
  }
`;

const TE_DISC_CREATE_MUTATION = `
  mutation TeDiscCreate($input: CreateDiscussionInput!) {
    createDiscussion(input: $input) {
      discussion { ${TE_DISC_FIELDS} }
    }
  }
`;

const TE_DISC_COMMENT_MUTATION = `
  mutation TeDiscComment($input: AddDiscussionCommentInput!) {
    addDiscussionComment(input: $input) {
      comment {
        id
        body
        createdAt
        author { login avatarUrl(size: 40) }
      }
    }
  }
`;

function teDiscError(code, message, params = null) {
  const error = new Error(message || code);
  error.teDiscCode = code;
  error.teDiscParams = params;
  return error;
}

function teDiscNormalizeError(err) {
  if (err?.teDiscCode) return err;
  const message = String(err?.message || err || "Unknown error");
  const status = err?.status;
  const lower = message.toLowerCase();

  if (status === 401 || /bad credentials|requires authentication/i.test(message)) {
    teInvalidateGithubToken();
    return teDiscError("auth", message);
  }
  if (status === 403 && /not accessible|forbidden|permission/i.test(message)) return teDiscError("permission", message);
  if (status === 429 || /rate limit|secondary rate|abuse/i.test(lower)) return teDiscError("rateLimit", message);
  if (status === 404 && /not found|could not resolve/i.test(message)) return teDiscError("repo", message);
  if (!status && /network|timeout|aborted|failed to fetch|fetch failed/i.test(lower)) return teDiscError("network", message);
  return teDiscError("api", message);
}

function teDiscErrorMessage(err) {
  if (err?.teDiscCode === "api") return i18n.t("translationEditor.discussion.errorGeneric", { error: String(err.message || "") });
  const code = err?.teDiscCode || "api";
  const keyByCode = {
    auth: "errorAuth",
    permission: "errorPermission",
    disabled: "errorDisabled",
    categories: "errorCategories",
    network: "errorNetwork",
    rateLimit: "errorRateLimit",
    repo: "errorRepo",
    missingCategory: "errorMissingCategory",
    categoryNotAllowed: "errorCategoryNotAllowed",
  };
  const suffix = keyByCode[code] || "errorGeneric";
  const key = `translationEditor.discussion.${suffix}`;
  const message = i18n.t(key, err?.teDiscParams || undefined);
  return message === key ? i18n.t("translationEditor.discussion.errorGeneric", { error: String(err?.message || "") }) : message;
}

async function teDiscCall(query, variables = {}, token = null) {
  const authToken = token || (await teGetGithubTokenCached());
  if (!authToken) throw teDiscError("auth", i18n.t("translationEditor.discussion.errorAuth"));
  try {
    return await githubContributeService.graphql(query, variables, authToken);
  } catch (err) {
    throw teDiscNormalizeError(err);
  }
}

// Verifies auth, repository access and that Discussions are enabled. Caches
// the repository node id and categories; concurrent callers share one request.
async function teEnsureDiscussionsAccess() {
  if (teDiscState.repoId && teDiscState.categories) return teDiscState;
  if (teDiscState.accessPromise) return teDiscState.accessPromise;

  const promise = (async () => {
    const token = await teGetGithubTokenCached();
    if (!token) throw teDiscError("auth", i18n.t("translationEditor.discussion.errorAuth"));

    let repoInfo;
    try {
      repoInfo = await githubContributeService.request(`/repos/${TE_DISC_OWNER}/${TE_DISC_REPO}`, {}, token);
    } catch (err) {
      throw teDiscNormalizeError(err);
    }
    if (repoInfo?.permissions && repoInfo.permissions.pull === false) throw teDiscError("permission", i18n.t("translationEditor.discussion.errorPermission"));
    if (!repoInfo?.has_discussions) throw teDiscError("disabled", i18n.t("translationEditor.discussion.errorDisabled"));

    const data = await teDiscCall(TE_DISC_CATEGORIES_QUERY, { owner: TE_DISC_OWNER, repo: TE_DISC_REPO }, token);
    const repository = data?.repository;
    const categories = repository?.discussionCategories?.nodes || [];
    if (!repository?.id || !categories.length) throw teDiscError("categories", i18n.t("translationEditor.discussion.errorCategories"));

    teDiscState.repoId = repository.id;
    teDiscState.categories = categories;
    return teDiscState;
  })();

  teDiscState.accessPromise = promise;
  try {
    return await promise;
  } finally {
    if (teDiscState.accessPromise === promise) teDiscState.accessPromise = null;
  }
}

function teDiscAuthor(author) {
  return { login: author?.login || "unknown", avatarUrl: author?.avatarUrl || "" };
}

function teNormalizeComment(comment) {
  if (!comment) return null;
  return {
    id: comment.id,
    body: comment.body || "",
    createdAt: comment.createdAt,
    author: teDiscAuthor(comment.author),
    replies: (comment.replies?.nodes || []).map(teNormalizeComment).filter(Boolean),
  };
}

function teNormalizeDiscussion(discussion, withDetail = true) {
  if (!discussion) return null;
  return {
    detailLoaded: withDetail,
    id: discussion.id,
    number: discussion.number,
    title: discussion.title || "",
    body: discussion.body || "",
    url: discussion.url || "",
    createdAt: discussion.createdAt,
    author: teDiscAuthor(discussion.author),
    category: discussion.category ? { id: discussion.category.id, name: discussion.category.name } : null,
    commentsCount: discussion.comments?.totalCount ?? 0,
    comments: (discussion.comments?.nodes || []).map(teNormalizeComment).filter(Boolean),
  };
}

function teMarkerFromBody(body) {
  const match = String(body || "").match(TE_DISC_MARKER_REGEX);
  return match ? match[1] : "";
}

function teStripTranslationMarker(body) {
  return String(body || "")
    .replace(new RegExp(TE_DISC_MARKER_REGEX.source, "g"), "")
    .trim();
}

function teBuildTranslationBody(key, message) {
  return `<!-- ${TE_DISC_KEY_MARKER}: ${key} -->\n\n${message}`;
}

function teRememberTranslationDiscussion(key, discussion) {
  if (!discussion?.id) return;
  teDiscState.byKey.set(key, discussion.id);
  teDiscState.byId.set(discussion.id, discussion);
}

function teGetCachedTranslationDiscussion(key) {
  const id = teDiscState.byKey.get(key);
  if (!id) return null;
  const discussion = teDiscState.byId.get(id);
  // A list summary has no comments; never open a panel from one.
  return discussion?.detailLoaded ? discussion : null;
}

// Category selection is centralized here so every component uses the same
// allow-list for both listing and creation.
function teGetGeneralCategories(categories = teDiscState.categories) {
  return (categories || []).filter((category) => GENERAL_DISCUSSION_CATEGORIES.includes(category.name));
}

function teFindCategoryByName(categories, name) {
  return (categories || []).find((category) => category.name === name) || null;
}

function teRequireTranslationCategoryId(categories) {
  const category = teFindCategoryByName(categories, TRANSLATION_DISCUSSION_CATEGORY);
  if (!category)
    throw teDiscError("missingCategory", i18n.t("translationEditor.discussion.errorMissingCategory", { name: TRANSLATION_DISCUSSION_CATEGORY }), {
      name: TRANSLATION_DISCUSSION_CATEGORY,
    });
  return category.id;
}

function teRequireGeneralCategoryId(categories, categoryId) {
  const allowed = teGetGeneralCategories(categories);
  if (!allowed.length) throw teDiscError("categories", i18n.t("translationEditor.discussion.errorCategories"));
  if (categoryId) {
    const selected = allowed.find((category) => category.id === categoryId);
    if (!selected) throw teDiscError("categoryNotAllowed", i18n.t("translationEditor.discussion.errorCategoryNotAllowed"));
    return selected.id;
  }
  return allowed[0].id;
}

// Main forum list. No client-side category/marker filtering: whatever the
// repository returns (including key-specific discussions) is shown. The
// category dropdown still applies an explicit server-side filter when used.
async function teFetchDiscussionList({ categoryId = "", after = null, first = TE_DISC_PAGE_SIZE } = {}) {
  await teEnsureDiscussionsAccess();
  const resolvedCategoryId = categoryId ? teRequireGeneralCategoryId(teDiscState.categories, categoryId) : null;
  const data = await teDiscCall(TE_DISC_LIST_QUERY, { owner: TE_DISC_OWNER, repo: TE_DISC_REPO, first, after, categoryId: resolvedCategoryId });
  const connection = data?.repository?.discussions;
  if (!connection) throw teDiscError("api", i18n.t("translationEditor.discussions.listError", { error: "repository unavailable" }));
  const nodes = (connection.nodes || [])
    .filter((discussion) => discussion?.id)
    .map((discussion) => teNormalizeDiscussion(discussion, false))
    .filter(Boolean);
  nodes.forEach((discussion) => {
    const cached = teDiscState.byId.get(discussion.id);
    // A page summary must never overwrite an already loaded detail.
    if (!cached?.detailLoaded) teDiscState.byId.set(discussion.id, discussion);
  });
  return { nodes, pageInfo: connection.pageInfo || {}, totalCount: connection.totalCount || 0 };
}

async function teFetchDiscussionById(id) {
  const data = await teDiscCall(TE_DISC_NODE_QUERY, { id });
  const node = data?.node;
  if (!node || node.__typename !== "Discussion") return null;
  const discussion = teNormalizeDiscussion(node);
  if (discussion) teDiscState.byId.set(discussion.id, discussion);
  return discussion;
}

// Looks up the single discussion for a translation key. Search results are
// verified against the hidden marker so titles and user text are never used
// for matching. A translation key is never part of a title-matching scheme.
async function teFindTranslationDiscussion(key, { force = false } = {}) {
  if (!force) {
    const cached = teGetCachedTranslationDiscussion(key);
    if (cached) return cached;
  }

  const inflightKey = `key:${key}:${force ? "force" : "cached"}`;
  const pending = teDiscState.inflight.get(inflightKey);
  if (pending) return pending;

  const promise = (async () => {
    await teEnsureDiscussionsAccess();
    const escapedKey = String(key).replace(/["\\]/g, "\\$&");
    const search = `repo:${TE_DISC_OWNER}/${TE_DISC_REPO} in:body "${escapedKey}"`;
    const data = await teDiscCall(TE_DISC_SEARCH_QUERY, { query: search, first: TE_DISC_SEARCH_SIZE });
    const candidates = (data?.search?.nodes || []).filter((node) => node?.__typename === "Discussion");
    const match = candidates.find((node) => teMarkerFromBody(node.body) === key && node.category?.name === TRANSLATION_DISCUSSION_CATEGORY);
    if (!match) return null;
    const discussion = await teFetchDiscussionById(match.id);
    if (discussion) teRememberTranslationDiscussion(key, discussion);
    return discussion;
  })();

  teDiscState.inflight.set(inflightKey, promise);
  try {
    return await promise;
  } finally {
    if (teDiscState.inflight.get(inflightKey) === promise) teDiscState.inflight.delete(inflightKey);
  }
}

async function teCreateTranslationDiscussion(key, message) {
  const access = await teEnsureDiscussionsAccess();
  const categoryId = teRequireTranslationCategoryId(access.categories);
  const data = await teDiscCall(TE_DISC_CREATE_MUTATION, {
    input: {
      repositoryId: access.repoId,
      categoryId,
      title: `${TE_DISC_KEY_TITLE_PREFIX}${key}`,
      body: teBuildTranslationBody(key, message),
    },
  });
  const discussion = teNormalizeDiscussion(data?.createDiscussion?.discussion);
  if (!discussion?.id) throw teDiscError("api", i18n.t("translationEditor.discussion.errorGeneric", { error: "discussion not returned" }));
  teRememberTranslationDiscussion(key, discussion);
  return discussion;
}

// Standalone discussions from the main forum never receive a key marker.
async function teCreateStandaloneDiscussion({ title, categoryId, body }) {
  const access = await teEnsureDiscussionsAccess();
  const resolvedCategoryId = teRequireGeneralCategoryId(access.categories, categoryId);
  const data = await teDiscCall(TE_DISC_CREATE_MUTATION, {
    input: { repositoryId: access.repoId, categoryId: resolvedCategoryId, title, body },
  });
  const discussion = teNormalizeDiscussion(data?.createDiscussion?.discussion);
  if (!discussion?.id) throw teDiscError("api", i18n.t("translationEditor.discussion.errorGeneric", { error: "discussion not returned" }));
  teDiscState.byId.set(discussion.id, discussion);
  return discussion;
}

async function teAddDiscussionComment(discussionId, body, replyToId = null) {
  const data = await teDiscCall(TE_DISC_COMMENT_MUTATION, {
    input: { discussionId, body, ...(replyToId ? { replyToId } : {}) },
  });
  const comment = teNormalizeComment(data?.addDiscussionComment?.comment);
  if (!comment?.id) throw teDiscError("api", i18n.t("translationEditor.discussion.errorGeneric", { error: "comment not returned" }));

  const discussion = teDiscState.byId.get(discussionId);
  if (discussion?.detailLoaded) {
    if (replyToId) {
      const parent = discussion.comments.find((entry) => entry.id === replyToId);
      if (parent) parent.replies.push(comment);
    } else {
      discussion.comments.push(comment);
    }
    discussion.commentsCount += 1;
  }
  return comment;
}
