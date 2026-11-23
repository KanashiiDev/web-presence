const TE_PR_CACHE_KEY = "translationPrCache";
const TE_PR_CACHE_TTL_MS = 5 * 60 * 1000;
const TE_UPSTREAM_OWNER = TE_REPO.owner;
const TE_UPSTREAM_REPO = TE_REPO.name;

async function teFetchPrFile(head, lang, namespace) {
  const owner = head.repo?.owner?.login;
  const repo = head.repo?.name;
  if (!owner || !repo || !head.sha) throw new Error("PR head is no longer available");
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${head.sha}/locales/${lang}/${namespace}.json`;
  const response = await fetchWithTimeout(url, {}, 10000);
  if (!response.ok) throw new Error(`PR file ${url}: HTTP ${response.status}`);
  return response.json();
}

// Editor-generated PRs contain immutable submission files, not locale files.
// Reading their `changes` lets pending-key detection see other contributors'
// in-flight translations instead of treating every submission PR as empty.
async function teFetchPrSubmission(head, lang, id) {
  const owner = head.repo?.owner?.login;
  const repo = head.repo?.name;
  if (!owner || !repo || !head.sha) throw new Error("PR head is no longer available");
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${head.sha}/submissions/${lang}/${id}.json`;
  const response = await fetchWithTimeout(url, {}, 10000);
  if (!response.ok) throw new Error(`PR file ${url}: HTTP ${response.status}`);
  return response.json();
}

let teFetchOpenPrsInflight = null;

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

async function teFetchOpenPrsLive() {
  const token = await githubContributeService.getToken();
  // A rejected token stays rejected for this fetch: one 401, then anonymous.
  let usableToken = token;
  const request = async (path) => {
    try {
      return await githubContributeService.request(path, {}, usableToken);
    } catch (err) {
      if (usableToken && err.status === 401) {
        usableToken = null;
        return githubContributeService.request(path, {}, null);
      }
      throw err;
    }
  };
  const base = `/repos/${TE_UPSTREAM_OWNER}/${TE_UPSTREAM_REPO}`;
  const pulls = await request(`${base}/pulls?state=open&per_page=100`);
  const prResults = await teMapWithLimit(pulls, 4, async (pull) => {
    const files = await request(`${base}/pulls/${pull.number}/files?per_page=100`);
    const entries = {};
    const localeFiles = files
      .map((file) => file.filename.match(/^locales\/([^/]+)\/([^/]+)\.json$/))
      .filter(Boolean)
      .map((match) => ({ lang: match[1], namespace: match[2] }));

    await teMapWithLimit(localeFiles, 4, async ({ lang, namespace }) => {
      try {
        entries[`${lang}/${namespace}`] = teFlattenTranslations(await teFetchPrFile(pull.head, lang, namespace));
      } catch (_err) {
        // Skip files whose PR head is unavailable; other files in the PR are still usable.
      }
    });

    const submissionFiles = files
      .map((file) => file.filename.match(/^submissions\/([a-z]{2,3}(?:-[a-z0-9]+)*)\/([A-Za-z0-9][A-Za-z0-9_-]{7,63})\.json$/i))
      .filter(Boolean)
      .map((match) => ({ lang: match[1].toLowerCase(), id: match[2] }));

    await teMapWithLimit(submissionFiles, 4, async ({ lang, id }) => {
      try {
        const payload = await teFetchPrSubmission(pull.head, lang, id);
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
  });

  const result = prResults.filter(Boolean);
  result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return result;
}

function teFetchOpenPrs() {
  if (!teFetchOpenPrsInflight) {
    teFetchOpenPrsInflight = teFetchOpenPrsLive().finally(() => {
      teFetchOpenPrsInflight = null;
    });
  }
  return teFetchOpenPrsInflight;
}

async function teLoadOpenPrs(forceRefresh = false) {
  const stored = await browser.storage.local.get(TE_PR_CACHE_KEY);
  const cached = stored[TE_PR_CACHE_KEY];
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < TE_PR_CACHE_TTL_MS) return cached.data;

  const data = await teFetchOpenPrs();
  await browser.storage.local.set({ [TE_PR_CACHE_KEY]: { fetchedAt: Date.now(), data } });
  return data;
}

// The processor posts the outcome as a PR comment carrying a stable marker.
// There is no result file to poll and no archive to accumulate.
async function teFetchSubmissionResultComment(id, prNumber, token) {
  if (!prNumber) return null;
  const path = `/repos/${TE_REPO.owner}/${TE_REPO.name}/issues/${prNumber}/comments?per_page=100`;
  const comments = await githubContributeService.request(path, {}, token);
  const marker = `<!-- submission-result:${id} -->`;
  const matched = (comments || []).find((comment) => String(comment?.body || "").includes(marker));
  return matched?.body || null;
}

function teParseSubmissionResult(body) {
  const match = /Status:\s*\*\*([^*]+)\*\*/.exec(body || "");
  return {
    status: match ? match[1].trim() : "unknown",
    detail: String(body || ""),
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
        const body = await teFetchSubmissionResultComment(id, prNumber, token);
        return body ? { id, result: teParseSubmissionResult(body) } : null;
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
