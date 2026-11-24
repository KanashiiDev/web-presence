// Immutable key-level submissions for web-presence-locales.
// One submission file per language/namespace, added to a fork branch and sent
// as a pull request. No translation file is ever overwritten from the editor.

const TE_SUBMIT_OWNER = TE_REPO.owner;
const TE_SUBMIT_REPO = TE_REPO.name;
const TE_SUBMIT_BRANCH_PREFIX = "translations/";
const TE_SUBMISSION_SCHEMA_VERSION = 1;
const TE_SUBMISSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const TE_SUBMISSION_SHA1_RE = /^[a-f0-9]{40}$/i;
const TE_SUBMISSION_HASH_RE = /^[a-f0-9]{64}$/i;
const TE_SUBMISSION_MAX_CHANGES = 5000;
const TE_SUBMISSION_MAX_VALUE = 20000;
const TE_SUBMISSION_MAX_BYTES = 512 * 1024;

function teMakeSubmissionId(lang, ns) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${teNormalizeLang(lang)}-${ns}-${stamp}-${suffix}`;
}

function teSubmissionPayloadIsValid(payload) {
  if (!payload || payload.schemaVersion !== TE_SUBMISSION_SCHEMA_VERSION) return false;
  if (typeof payload.id !== "string" || !TE_SUBMISSION_ID_RE.test(payload.id)) return false;
  const lang = teNormalizeLang(payload.lang);
  if (!TE_LANG_RE.test(lang) || TE_RESERVED_SUBMISSION_DIRS.has(lang)) return false;
  if (typeof payload.ns !== "string" || !TE_NS_RE.test(payload.ns)) return false;
  if (!TE_SUBMISSION_SHA1_RE.test(payload.baseCommit || "")) return false;
  if (!payload.source || !TE_SUBMISSION_SHA1_RE.test(payload.source.commit || "")) return false;
  if (!payload.changes || typeof payload.changes !== "object") return false;
  const keys = Object.keys(payload.changes);
  if (!keys.length || keys.length > TE_SUBMISSION_MAX_CHANGES) return false;
  return keys.every((key) => {
    const change = payload.changes[key];
    return (
      !!change &&
      typeof change.value === "string" &&
      change.value.length <= TE_SUBMISSION_MAX_VALUE &&
      !teValueIsUnsafe(change.value) &&
      TE_SUBMISSION_HASH_RE.test(change.baseTargetHash || "") &&
      TE_SUBMISSION_HASH_RE.test(change.sourceHash || "")
    );
  });
}

// Defense in depth: never let an editor bug create a file outside the intake
// folder or a payload whose lang/id disagree with its path.
function teAssertSubmissionPathIsSafe(submission) {
  if (!submission || typeof submission.path !== "string" || !TE_SUBMISSION_PATH_RE.test(submission.path)) {
    throw new Error("Invalid submission path");
  }
  const lang = teNormalizeLang(submission.lang);
  const expectedPrefix = `submissions/${lang}/`;
  if (!submission.path.startsWith(expectedPrefix)) throw new Error("Submission path does not match its language");
  if (!submission.path.endsWith(`/${submission.id}.json`)) throw new Error("Submission path does not match its id");
  if (!submission.id.startsWith(`${lang}-`)) throw new Error("Submission id does not match its language");
  if (submission.namespace && !TE_NS_RE.test(submission.namespace)) throw new Error("Invalid submission namespace");
  if (submission.payload) {
    if (teNormalizeLang(submission.payload.lang) !== lang) throw new Error("Payload language does not match its path");
    if (submission.payload.id !== submission.id) throw new Error("Payload id does not match its path");
  }
}

// Builds the exact schema consumed by web-presence-locales/tools/lib/submission.js.
async function teBuildSubmission({ lang, ns, changes, baseCommit, sourceCommit }) {
  const accepted = {};
  for (const change of changes) {
    // baseTargetHash is the hash of the target we are patching, not of the new
    // value. A match means the draft was already applied, so skip it.
    const submittedHash = await teHashTarget(change.target, change.key);
    // An unchanged value is normally a no-op, except when the contributor is
    // re-acknowledging it against a changed English source. That refreshes the
    // metadata hash without touching the translation file.
    if (!change.reconfirm && submittedHash === change.baseTargetHash) continue;
    // Use the hash of the source we actually loaded for this preview. A stale
    // hash from an old draft must never silently drop a correct translation;
    // the processor re-checks freshness authoritatively at apply time.
    const sourceHash = change.currentSourceHash || change.sourceHash;
    accepted[change.key] = { value: change.target, baseTargetHash: change.baseTargetHash, sourceHash };
  }
  if (!Object.keys(accepted).length) return null;

  const normalizedLang = teNormalizeLang(lang);
  const id = teMakeSubmissionId(normalizedLang, ns);
  const payload = {
    schemaVersion: TE_SUBMISSION_SCHEMA_VERSION,
    id,
    lang: normalizedLang,
    ns,
    baseCommit,
    source: { commit: sourceCommit },
    changes: accepted,
  };
  if (!teSubmissionPayloadIsValid(payload)) throw new Error("Generated submission does not match the locales schema");
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  if (new TextEncoder().encode(content).length > TE_SUBMISSION_MAX_BYTES) throw new Error("Submission is too large");
  const submission = { id, lang: normalizedLang, namespace: ns, path: `submissions/${normalizedLang}/${id}.json`, content, payload, keys: Object.keys(accepted) };
  teAssertSubmissionPathIsSafe(submission);
  return submission;
}

// Returns the tree and parent to build the next commit on. Reusing the existing
// branch tree keeps previously submitted languages in the same PR.
async function teGetBranchBase(forkOwner, branchName, baseSha, baseTreeSha, token) {
  const refPath = `/repos/${forkOwner}/${TE_SUBMIT_REPO}/git/refs/heads/${branchName}`;
  let existing = null;
  try {
    existing = await githubContributeService.request(refPath, {}, token);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  if (!existing?.object?.sha) return { refExists: false, parentSha: baseSha, baseTreeSha };
  const parentSha = existing.object.sha;
  try {
    const parentCommit = await githubContributeService.request(`/repos/${forkOwner}/${TE_SUBMIT_REPO}/git/commits/${parentSha}`, {}, token);
    return { refExists: true, parentSha, baseTreeSha: parentCommit?.tree?.sha || baseTreeSha };
  } catch (_err) {
    return { refExists: true, parentSha, baseTreeSha };
  }
}

async function teAssertSubmissionPathsFree(forkOwner, branchName, submissions, token) {
  for (const submission of submissions) {
    try {
      await githubContributeService.request(`/repos/${forkOwner}/${TE_SUBMIT_REPO}/contents/${submission.path}?ref=${branchName}`, {}, token);
      throw new Error(`Submission already exists: ${submission.id}`);
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }
}

async function teSubmitSubmissions({ submissions, title, body, token, onStatus = () => {} }) {
  if (!submissions.length) throw new Error("No submissions to send");
  submissions.forEach(teAssertSubmissionPathIsSafe);
  onStatus("validating");
  const user = await githubContributeService.request("/user", {}, token);
  const forkOwner = user.login;
  const branchName = `${TE_SUBMIT_BRANCH_PREFIX}${forkOwner}`;

  const openPrs = await githubContributeService.request(`/repos/${TE_SUBMIT_OWNER}/${TE_SUBMIT_REPO}/pulls?head=${forkOwner}:${branchName}&state=open`, {}, token);

  onStatus("forking");
  await githubContributeService.request(`/repos/${TE_SUBMIT_OWNER}/${TE_SUBMIT_REPO}/forks`, { method: "POST", body: {} }, token);
  await githubContributeService.waitForFork(forkOwner, TE_SUBMIT_REPO, token);

  onStatus("syncing");
  const upstream = await githubContributeService.request(`/repos/${TE_SUBMIT_OWNER}/${TE_SUBMIT_REPO}`, {}, token);
  const baseBranch = upstream.default_branch;
  try {
    await githubContributeService.request(`/repos/${forkOwner}/${TE_SUBMIT_REPO}/merge-upstream`, { method: "POST", body: { branch: baseBranch } }, token);
  } catch (err) {
    if (err.status !== 409 && err.status !== 404 && err.status !== 422) throw err;
  }
  const baseRef = await githubContributeService.request(`/repos/${TE_SUBMIT_OWNER}/${TE_SUBMIT_REPO}/git/ref/heads/${baseBranch}`, {}, token);
  const baseSha = baseRef.object.sha;
  const baseCommit = await githubContributeService.request(`/repos/${TE_SUBMIT_OWNER}/${TE_SUBMIT_REPO}/git/commits/${baseSha}`, {}, token);

  onStatus("branching");
  const branchBase = await teGetBranchBase(forkOwner, branchName, baseSha, baseCommit.tree.sha, token);
  if (branchBase.refExists) await teAssertSubmissionPathsFree(forkOwner, branchName, submissions, token);

  // Build every Git object first. The branch ref moves only after the commit exists.
  const treeEntries = [];
  for (const submission of submissions) {
    const blob = await githubContributeService.request(
      `/repos/${forkOwner}/${TE_SUBMIT_REPO}/git/blobs`,
      { method: "POST", body: { content: submission.content, encoding: "utf-8" } },
      token,
    );
    treeEntries.push({ path: submission.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const tree = await githubContributeService.request(
    `/repos/${forkOwner}/${TE_SUBMIT_REPO}/git/trees`,
    { method: "POST", body: { base_tree: branchBase.baseTreeSha, tree: treeEntries } },
    token,
  );
  const lang = submissions[0].lang;
  const commit = await githubContributeService.request(
    `/repos/${forkOwner}/${TE_SUBMIT_REPO}/git/commits`,
    { method: "POST", body: { message: `locale(submission): ${lang}`, tree: tree.sha, parents: [branchBase.parentSha] } },
    token,
  );

  const refPath = `/repos/${forkOwner}/${TE_SUBMIT_REPO}/git/refs/heads/${branchName}`;
  if (branchBase.refExists) {
    await githubContributeService.request(refPath, { method: "PATCH", body: { sha: commit.sha, force: true } }, token);
  } else {
    await githubContributeService.request(
      `/repos/${forkOwner}/${TE_SUBMIT_REPO}/git/refs`,
      { method: "POST", body: { ref: `refs/heads/${branchName}`, sha: commit.sha } },
      token,
    );
  }

  onStatus("opening_pr");
  if (openPrs.length) return { prUrl: openPrs[0].html_url, prNumber: openPrs[0].number, updated: true };

  try {
    const pr = await githubContributeService.request(
      `/repos/${TE_SUBMIT_OWNER}/${TE_SUBMIT_REPO}/pulls`,
      { method: "POST", body: { title, body, head: `${forkOwner}:${branchName}`, base: baseBranch } },
      token,
    );
    return { prUrl: pr.html_url, prNumber: pr.number, updated: false };
  } catch (err) {
    if (/already exists/i.test(err.message)) {
      const existing = await githubContributeService.request(`/repos/${TE_SUBMIT_OWNER}/${TE_SUBMIT_REPO}/pulls?head=${forkOwner}:${branchName}&state=open`, {}, token);
      if (existing.length) return { prUrl: existing[0].html_url, prNumber: existing[0].number, updated: true };
    }
    throw err;
  }
}
