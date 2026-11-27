const TE_PR_CACHE_KEY = "translationPrCache";
const TE_PR_CACHE_TTL_MS = 60 * 1000;
const TE_PR_POLL_CACHE_KEY = "translationPrPollState";
const TE_UPSTREAM_OWNER = TE_REPO.owner;
const TE_UPSTREAM_REPO = TE_REPO.name;

// Rate-limit aware polling. Values come from x-ratelimit-remaining headers of
// the list/poll requests; low remaining quota stretches the next poll.
let teRateLimitRemaining = null;
const TE_RATE_LIMIT_LOW = 60;

function teObserveRateLimit(response) {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  if (Number.isFinite(remaining)) teRateLimitRemaining = remaining;
}

function teRateLimitIsLow() {
  return teRateLimitRemaining !== null && teRateLimitRemaining < TE_RATE_LIMIT_LOW;
}

function teRateLimitPollDelay() {
  if (teRateLimitRemaining !== null && teRateLimitRemaining < 10) return 120000;
  if (teRateLimitIsLow()) return 60000;
  return 0;
}

// A rejected token is used at most once: invalidate it, then retry anonymous.
// `send` either returns a Response or throws an error carrying `status`, so the
// raw-fetch and service-request call sites share one policy.
async function teRequestWithTokenRetry(send, token, onInvalidate = null) {
  if (!token) return send(null);
  let unauthorized = false;
  let response = null;
  try {
    response = await send(token);
  } catch (err) {
    if (err?.status !== 401) throw err;
    unauthorized = true;
  }
  if (!unauthorized && response?.status !== 401) return response;
  teInvalidateGithubToken();
  if (onInvalidate) onInvalidate();
  return send(null);
}

// Direct API read so 304/ETag and rate-limit headers are observable. A revoked
// token is invalidated and the single request is retried anonymously.
async function teApiRequest(path, { etag = null, token = null } = {}) {
  const authToken = token || (await githubContributeService.getToken());
  const send = async (useToken) => {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (useToken) headers.Authorization = `Bearer ${useToken}`;
    if (etag) headers["If-None-Match"] = etag;
    const response = await fetchWithTimeout(`https://api.github.com${path}`, { headers, cache: "no-store" }, 10000);
    teObserveRateLimit(response);
    return response;
  };
  return teRequestWithTokenRetry(send, authToken);
}

async function teFetchPrJson(head, relativePath) {
  const owner = head.repo?.owner?.login;
  const repo = head.repo?.name;
  if (!owner || !repo || !head.sha) throw new Error("PR head is no longer available");
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${head.sha}/${relativePath}`;
  const response = await fetchWithTimeout(url, {}, 10000);
  if (!response.ok) throw new Error(`PR file ${url}: HTTP ${response.status}`);
  return response.json();
}

async function teFetchPrFile(head, lang, namespace) {
  return teFetchPrJson(head, `locales/${lang}/${namespace}.json`);
}

// Editor-generated PRs contain immutable submission files, not locale files.
// Reading their `changes` lets pending-key detection see other contributors'
// in-flight translations instead of treating every submission PR as empty.
async function teFetchPrSubmission(head, lang, id) {
  return teFetchPrJson(head, `submissions/${lang}/${id}.json`);
}

let teFetchOpenPrsInflight = null;
let tePrFetchPartial = false;

/** True when the last PR fetch had at least one failed request. */
function teOpenPrsHadPartialFailure() {
  return tePrFetchPartial;
}

// GitHub list endpoints return at most 100 items per page. Truncating the list
// hides pending submissions and their result comments on busy repositories.
async function teForEachPage(path, fetchPage, onPage) {
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= 20; page += 1) {
    const pagePath = `${path}${separator}page=${page}&per_page=100`;
    const items = await fetchPage(pagePath);
    if (!Array.isArray(items)) return;
    onPage(items, pagePath);
    if (items.length < 100) return;
  }
}

async function teRequestAllPages(request, path) {
  const all = [];
  await teForEachPage(
    path,
    (pagePath) => request(pagePath),
    (items) => all.push(...items),
  );
  return all;
}

// Bounded parallelism: one list request plus a few concurrent PR/file fetches,
// not 10+ serial round trips. Concurrent callers share the same in-flight work.
async function teMapWithLimit(items, limit, mapper) {
  const result = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

// A merged PR disappears from the "open" list immediately, while the processor
// still needs a few seconds to apply it and publish the result. Treat recently
// merged PRs as pending until their result comments appear, so other users do
// not see those keys as available during that window.
const TE_MERGED_PR_LOCK_MS = 5 * 60 * 1000;

// Conditional list fetch with per-page ETags. A 304 means that page is
// unchanged, so callers can reuse its cached data and skip per-PR requests.
async function teFetchListWithEtag(path, cacheState) {
  cacheState.etags = cacheState.etags || {};
  cacheState.pages = cacheState.pages || {};
  const all = [];
  let sawModified = false;
  await teForEachPage(
    path,
    async (pagePath) => {
      const etag = cacheState.etags[pagePath] || null;
      const response = await teApiRequest(pagePath, { etag });
      if (response.status === 304 && Array.isArray(cacheState.pages[pagePath])) return cacheState.pages[pagePath];
      sawModified = true;
      if (!response.ok) {
        const err = new Error(`GitHub API ${response.status} for ${pagePath}`);
        err.status = response.status;
        throw err;
      }
      const data = await response.json();
      if (!Array.isArray(data)) return null;
      cacheState.etags[pagePath] = response.headers.get("ETag") || etag;
      cacheState.pages[pagePath] = data;
      return data;
    },
    (items) => all.push(...items),
  );
  return { data: all, unchanged: !sawModified };
}

async function teFetchOpenPrsLive(cacheState = {}) {
  const token = await githubContributeService.getToken();
  // A rejected token stays rejected for this fetch: one 401, then anonymous.
  let usableToken = token;
  const request = (path) =>
    teRequestWithTokenRetry(
      (useToken) => githubContributeService.request(path, {}, useToken),
      usableToken,
      () => {
        usableToken = null;
      },
    );
  const base = `/repos/${TE_UPSTREAM_OWNER}/${TE_UPSTREAM_REPO}`;
  const requestAll = (path) => teRequestAllPages(request, path);
  tePrFetchPartial = false;
  const [openResult, closedResult] = await Promise.all([
    teFetchListWithEtag(`${base}/pulls?state=open`, cacheState),
    teFetchListWithEtag(`${base}/pulls?state=closed&sort=updated&direction=desc`, cacheState),
  ]);
  // Both lists are unchanged: reuse the previously computed entries and skip
  // every per-PR files/comments request.
  if (openResult.unchanged && closedResult.unchanged) {
    return { unchanged: true, data: null, cacheState };
  }
  const openPulls = openResult.data;
  const closedPulls = closedResult.data;
  const now = Date.now();
  const pulls = [...openPulls, ...closedPulls.filter((pull) => pull.merged_at && now - Date.parse(pull.merged_at) < TE_MERGED_PR_LOCK_MS)];
  const prResults = await teMapWithLimit(pulls, 4, async (pull) => {
    try {
      const merged = !!pull.merged_at;
      // After a squash merge the PR head ref can be deleted. The merge commit
      // always contains the submission file exactly as the PR added it.
      const fileHead = merged && pull.merge_commit_sha ? { ...pull.head, sha: pull.merge_commit_sha } : pull.head;
      const files = await requestAll(`${base}/pulls/${pull.number}/files`);
      const entries = {};
      const localeFiles = files
        .map((file) => file.filename.match(/^locales\/([^/]+)\/([^/]+)\.json$/))
        .filter(Boolean)
        .map((match) => ({ lang: match[1], namespace: match[2] }));

      await teMapWithLimit(localeFiles, 4, async ({ lang, namespace }) => {
        try {
          entries[`${lang}/${namespace}`] = teFlattenTranslations(await teFetchPrFile(fileHead, lang, namespace));
        } catch (_err) {
          // Skip files whose PR head is unavailable; other files in the PR are still usable.
        }
      });

      const submissionFiles = files
        .map((file) => file.filename.match(/^submissions\/([a-z]{2,3}(?:-[a-z0-9]+)*)\/([A-Za-z0-9][A-Za-z0-9_-]{7,63})\.json$/i))
        .filter(Boolean)
        .map((match) => ({ lang: match[1].toLowerCase(), id: match[2] }));

      if (merged) {
        const ids = submissionFiles.map((entry) => entry.id);
        if (!ids.length) return null;
        const comments = await requestAll(`${base}/issues/${pull.number}/comments`);
        // Only the processor's own comments can release the pending lock. A
        // forged marker from another author must not make keys look available.
        const processorBodies = (comments || []).filter((comment) => comment?.user?.login === TE_RESULT_BOT_LOGIN).map((comment) => String(comment.body || ""));
        const processed = ids.every((id) => processorBodies.some((body) => body.includes(`<!-- submission-result:${id} -->`)));
        // Result posted: processing finished, the PR is no longer a lock.
        if (processed) return null;
      }

      await teMapWithLimit(submissionFiles, 4, async ({ lang, id }) => {
        try {
          const payload = await teFetchPrSubmission(fileHead, lang, id);
          const ns = payload?.ns;
          if (!ns || !["extension", "server", "shared"].includes(ns) || !payload.changes) return;
          const values = {};
          for (const [key, change] of Object.entries(payload.changes)) {
            if (typeof change?.value === "string") values[key] = change.value;
          }
          if (!Object.keys(values).length) return;
          const fileKey = `${lang}/${ns}`;
          entries[fileKey] = { ...(entries[fileKey] || {}), ...values };
        } catch (_err) {
          // An unavailable PR head must not hide the rest of the PR.
        }
      });

      if (!Object.keys(entries).length) return null;
      return { number: pull.number, title: pull.title, html_url: pull.html_url, created_at: pull.created_at, user: pull.user?.login || "", entries };
    } catch (_err) {
      // One unavailable PR must not erase pending state for every other PR.
      tePrFetchPartial = true;
      return null;
    }
  });

  const result = prResults.filter(Boolean);
  result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return { unchanged: false, data: result, cacheState };
}

async function teInvalidateOpenPrsCache() {
  try {
    await browser.storage.local.remove(TE_PR_CACHE_KEY);
  } catch (_err) {
    // Storage failures only make the next read fall back to the live API.
  }
}

function teFetchOpenPrs(cacheState) {
  if (!teFetchOpenPrsInflight) {
    teFetchOpenPrsInflight = teFetchOpenPrsLive(cacheState).finally(() => {
      teFetchOpenPrsInflight = null;
    });
  }
  return teFetchOpenPrsInflight;
}

async function teLoadOpenPrs(forceRefresh = false) {
  const stored = await browser.storage.local.get(TE_PR_CACHE_KEY);
  const cached = stored[TE_PR_CACHE_KEY];
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < TE_PR_CACHE_TTL_MS) return cached.data;

  const cacheState = {
    etags: cached?.etags || {},
    pages: cached?.pages || {},
  };
  const fetched = await teFetchOpenPrs(cacheState);
  const data = fetched.unchanged && cached?.data ? cached.data : fetched.data;
  await browser.storage.local.set({
    [TE_PR_CACHE_KEY]: { fetchedAt: Date.now(), data, etags: fetched.cacheState.etags, pages: fetched.cacheState.pages },
  });
  return data;
}

// Lightweight poll guard: one conditional /pulls/<n> request. A 304 means the
// contributor's PR did not change, so the full list must not be refreshed.
async function teCheckPolledPr(prNumber) {
  if (!prNumber) return { changed: true };
  const stored = await browser.storage.local.get(TE_PR_POLL_CACHE_KEY);
  const state = stored[TE_PR_POLL_CACHE_KEY] || { etag: null, snapshot: null };
  const path = `/repos/${TE_UPSTREAM_OWNER}/${TE_UPSTREAM_REPO}/pulls/${prNumber}`;
  const response = await teApiRequest(path, { etag: state.etag });
  if (response.status === 304 && state.snapshot) return { changed: false, fromCache: true, pr: state.snapshot };
  if (response.status === 404) {
    await browser.storage.local.remove(TE_PR_POLL_CACHE_KEY);
    return { changed: true };
  }
  if (!response.ok) return { changed: false, error: true };
  const pr = await response.json();
  const snapshot = { state: pr.state, merged: !!pr.merged_at, head: pr.head?.sha || null };
  const changed = !state.snapshot || JSON.stringify(snapshot) !== JSON.stringify(state.snapshot);
  await browser.storage.local.set({
    [TE_PR_POLL_CACHE_KEY]: { etag: response.headers.get("ETag") || state.etag, snapshot },
  });
  return { changed, pr };
}

// The processor posts the outcome as a PR comment carrying a stable marker.
// There is no result file to poll and no archive to accumulate.
const TE_RESULT_BACKOFF = new Map();

async function teFetchSubmissionResultComment(id, prNumber, token) {
  if (!prNumber) return null;
  const key = `${prNumber}:${id}`;
  const now = Date.now();
  if (now < (TE_RESULT_BACKOFF.get(key) || 0)) return null;

  const path = `/repos/${TE_REPO.owner}/${TE_REPO.name}/issues/${prNumber}/comments?per_page=100`;

  let response;
  try {
    // A revoked token must not keep failing silently forever. Passing the
    // token explicitly keeps the batch's one-token snapshot semantics.
    response = await teApiRequest(path, { token });
  } catch (_err) {
    TE_RESULT_BACKOFF.set(key, now + 60000);
    return null;
  }

  if (response.status === 403 || response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const reset = Number(response.headers.get("X-RateLimit-Reset"));
    let delay = 60000;
    if (Number.isFinite(retryAfter) && retryAfter > 0) delay = retryAfter * 1000;
    else if (Number.isFinite(reset) && reset > 0) delay = Math.max(0, Math.round(reset - Date.now() / 1000)) * 1000;
    TE_RESULT_BACKOFF.set(key, now + Math.min(Math.max(delay, 15000), 300000));
    return null;
  }
  if (!response.ok) {
    TE_RESULT_BACKOFF.set(key, now + 60000);
    return null;
  }

  let comments;
  try {
    comments = await response.json();
  } catch (_err) {
    TE_RESULT_BACKOFF.set(key, now + 60000);
    return null;
  }
  const marker = `<!-- submission-result:${id} -->`;
  // Fail closed: a marker from any other author is not a processor result.
  const matched = (comments || []).find((comment) => comment?.user?.login === TE_RESULT_BOT_LOGIN && String(comment?.body || "").includes(marker));
  if (matched) return { body: String(matched.body || ""), forged: false };
  const forged = (comments || []).find((comment) => comment?.user?.login !== TE_RESULT_BOT_LOGIN && String(comment?.body || "").includes(marker));
  return forged ? { body: null, forged: true } : null;
}

function teParseSubmissionResult(body) {
  // Read the status only after our marker; text elsewhere in the comment is
  // untrusted and must not be interpreted as a processor verdict.
  const text = String(body || "");
  const markerAt = text.indexOf("<!-- submission-result:");
  const scoped = markerAt >= 0 ? text.slice(markerAt) : "";
  const match = /Status:\s*\*\*([^*]+)\*\*/.exec(scoped);
  return {
    status: match ? match[1].trim() : "unknown",
    detail: text,
  };
}

async function teLoadSubmissionResults(submissions) {
  const token = await githubContributeService.getToken();
  const unique = [];
  const seen = new Set();
  for (const entry of submissions || []) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push({ id, prNumber: typeof entry === "string" ? null : entry?.prNumber });
  }
  const results = await Promise.all(
    unique.map(async ({ id, prNumber }) => {
      try {
        const found = await teFetchSubmissionResultComment(id, prNumber, token);
        if (!found) return null;
        if (found.forged) {
          return { id, result: { status: "unverified", detail: "Result comment could not be verified" } };
        }
        return { id, result: teParseSubmissionResult(found.body) };
      } catch (_err) {
        return null;
      }
    }),
  );
  return results.filter(Boolean);
}

function teApplyPrState(rows, lang, namespace, openPrs) {
  const fileKey = `${lang}/${namespace}`;

  rows.forEach((row) => {
    row.prPending = false;
    row.prNumber = null;
    row.prUrl = "";
    row.prValue = "";
    row.prConflicts = [];
    row.status = teComputeStatus(row);
  });

  openPrs.forEach((pr) => {
    const values = pr.entries[fileKey];
    if (!values) return;
    rows.forEach((row) => {
      const value = values[row.key];
      if (typeof value !== "string" || !value || value === row.originalTarget) return;
      if (!row.prPending) {
        row.prPending = true;
        row.prNumber = pr.number;
        row.prUrl = pr.html_url;
        row.prValue = value;
      } else {
        row.prConflicts.push({ number: pr.number, html_url: pr.html_url });
      }
      row.status = teComputeStatus(row);
    });
  });
}
