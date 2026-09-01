/**
 * githubContributeService.js
 * One-click script contribution to the web-presence-activities repo via GitHub API.
 *
 * Auth: GitHub OAuth Device Flow
 *  1. POST github.com/login/device/code → { device_code, user_code, verification_uri }
 *  2. Show user_code to user, open verification_uri in browser
 *  3. Poll github.com/login/oauth/access_token every 5s until authorized
 *  4. Save token to browser.storage.local
 *
 * Contribute flow:
 *  1. Validate token & get authenticated user
 *  2. Fork KanashiiDev/web-presence-activities (idempotent)
 *  3. Sync fork with upstream
 *  4. Create branch: contribute/<script-id>
 *  5. Detect add vs update (check upstream main)
 *  6. Push to activities/<LETTER>/<scriptId>.js
 *  7. Open PR (or return existing open PR)
 */

const GITHUB_CONTRIBUTE = {
  CLIENT_ID: "Ov23liTj2VnvpAYQRPSr",
  SCOPE: "public_repo",
  UPSTREAM_OWNER: "KanashiiDev",
  UPSTREAM_REPO: "web-presence-activities",
  ACTIVITIES_DIR: "activities",
  TOKEN_STORAGE_KEY: "githubContributeToken",
  USER_STORAGE_KEY: "githubContributeUser",
  API_BASE: "https://api.github.com",
  OAUTH_BASE: "https://github.com",
};

class GitHubContributeService {
  // Token storage
  async getToken() {
    const result = await browser.storage.local.get(GITHUB_CONTRIBUTE.TOKEN_STORAGE_KEY);
    return result[GITHUB_CONTRIBUTE.TOKEN_STORAGE_KEY] || null;
  }

  async saveToken(token) {
    await browser.storage.local.set({ [GITHUB_CONTRIBUTE.TOKEN_STORAGE_KEY]: token });
  }

  async clearToken() {
    await browser.storage.local.remove([GITHUB_CONTRIBUTE.TOKEN_STORAGE_KEY, GITHUB_CONTRIBUTE.USER_STORAGE_KEY]);
  }

  // User cache
  async getCachedUser() {
    const result = await browser.storage.local.get(GITHUB_CONTRIBUTE.USER_STORAGE_KEY);
    return result[GITHUB_CONTRIBUTE.USER_STORAGE_KEY] || null;
  }

  async fetchAndCacheUser() {
    const token = await this.getToken();
    if (!token) return null;
    const user = await this._req("/user", {}, token);
    // Only cache what we need - avatar_url and login
    const slim = { login: user.login, avatar_url: user.avatar_url };
    await browser.storage.local.set({ [GITHUB_CONTRIBUTE.USER_STORAGE_KEY]: slim });
    return slim;
  }

  /**
   * Processes the Authors and AuthorsLinks arrays according to the rules:
   * 1. If there is a script in the repo, it initializes the data from there.
   * 2. If it is a new script / no author exists, it directly adds/replaces the account.
   * 3. If there are other authors and the account itself does not exist, it appends it to the end.
   * 4. Performs case-insensitive duplicate checks in all operations.
   */
  processAuthorsAndLinks(script, upstreamInfo, currentUserLogin) {
    // If this script has already been created by someone else in the repo, get the information from the repo
    const source = upstreamInfo || script;
    const authors = this._toStringArray(source.authors);
    const authorsLinks = this._toStringArray(source.authorsLinks);
    // Case-insensitive duplicate cleaning
    const uniqueAuthors = [];
    const uniqueLinks = [];

    authors.forEach((author) => {
      if (author && !uniqueAuthors.some((a) => a.toLowerCase() === author.toLowerCase())) {
        uniqueAuthors.push(author);
      }
    });

    authorsLinks.forEach((link) => {
      if (link && !uniqueLinks.some((l) => l.toLowerCase() === link.toLowerCase())) {
        uniqueLinks.push(link);
      }
    });

    // If the information of the user who will make the request is not in authors and authorsLinks, add it to the end
    if (currentUserLogin) {
      const userLoginLower = currentUserLogin.toLowerCase();
      const userLink = `https://github.com/${currentUserLogin}`;
      const userLinkLower = userLink.toLowerCase();

      const authorExists = uniqueAuthors.some((a) => a.toLowerCase() === userLoginLower);

      if (!authorExists) {
        uniqueAuthors.push(currentUserLogin);

        const linkExists = uniqueLinks.some((l) => l.toLowerCase() === userLinkLower);
        if (!linkExists) {
          uniqueLinks.push(userLink);
        }
      }
    }

    return {
      authors: uniqueAuthors,
      authorsLinks: uniqueLinks,
    };
  }
  _parseVersionFromContent(content) {
    const match = content.match(/version:\s*["']([^"']+)["']/);
    return match ? match[1] : null;
  }

  /**
   * Compares two semver-ish version strings (e.g. "1.2.3").
   * Returns positive if a > b, negative if a < b, 0 if equal.
   */
  _compareVersions(a, b) {
    const parse = (v) =>
      String(v)
        .split(".")
        .map((n) => parseInt(n, 10) || 0);
    const av = parse(a);
    const bv = parse(b);
    const len = Math.max(av.length, bv.length);
    for (let i = 0; i < len; i++) {
      const diff = (av[i] || 0) - (bv[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  // GitHub API helpers
  async _req(path, options = {}, token) {
    const method = (options.method || "GET").toUpperCase();
    const hasBody = options.body != null;

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    };
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${GITHUB_CONTRIBUTE.API_BASE}${path}`, {
      ...options,
      method,
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 403 || res.status === 429) {
      const retryAfter = res.headers.get("Retry-After") || res.headers.get("X-RateLimit-Reset");
      const rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
      if (rateLimitRemaining === "0" || res.status === 429) {
        throw new Error("GitHub API rate limit exceeded. Please wait a moment and try again.");
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));

      // Never include token/auth info in error messages
      let errorMessage = err.message || `GitHub API error ${res.status}`;
      if (err.errors && Array.isArray(err.errors)) {
        const nestedMessages = err.errors
          .map((e) => e.message)
          .filter(Boolean)
          .join("; ");
        if (nestedMessages) {
          errorMessage = `${errorMessage}: ${nestedMessages}`;
        }
      }

      const apiError = new Error(errorMessage);
      apiError.status = res.status;
      throw apiError;
    }

    return res.status === 204 ? null : res.json();
  }

  // Device Flow

  /**
   * Step 1: Request device + user code from GitHub.
   * @returns {{ device_code, user_code, verification_uri, expires_in, interval }}
   */
  async requestDeviceCode() {
    const res = await fetch(`${GITHUB_CONTRIBUTE.OAUTH_BASE}/login/device/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CONTRIBUTE.CLIENT_ID,
        scope: GITHUB_CONTRIBUTE.SCOPE,
      }),
    });

    if (!res.ok) throw new Error(`Device code request failed: ${res.status}`);
    return res.json();
  }

  /**
   * Step 2: Poll until user authorizes or flow expires.
   * @param {string} device_code
   * @param {number} interval - seconds between polls
   * @param {AbortSignal} signal - to cancel polling
   * @returns {string} access_token
   */
  async pollForToken(device_code, interval = 5, signal) {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    while (true) {
      if (signal?.aborted) throw new Error("cancelled");

      await delay(interval * 1000);

      if (signal?.aborted) throw new Error("cancelled");

      const res = await fetch(`${GITHUB_CONTRIBUTE.OAUTH_BASE}/login/oauth/access_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CONTRIBUTE.CLIENT_ID,
          device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data = await res.json();

      if (data.access_token) return data.access_token;

      switch (data.error) {
        case "authorization_pending":
          // Normal - user hasn't approved yet, keep polling
          break;
        case "slow_down":
          // GitHub wants us to slow down - increase interval
          interval += 5;
          break;
        case "expired_token":
          throw new Error("expired");
        case "access_denied":
          throw new Error("denied");
        default:
          if (data.error) throw new Error(data.error);
      }
    }
  }

  // Path helper

  /**
   * Returns the default commit message for a contribute operation.
   * Single source of truth - used by both the confirm modal preview and the actual commit.
   */
  getDefaultCommitMessage(script, isUpdate) {
    return isUpdate ? `fix(scripts): update ${script.title} to v${script.version || "1.0.0"}` : `feat(scripts): add ${script.title} activity`;
  }

  /**
   * Returns true if the upstream script has authors that don't include any of
   * the local script's authors (case-insensitive). Used by the confirm modal
   * to show a "different author" warning.
   */
  isDifferentAuthor(script, upstreamInfo) {
    if (!upstreamInfo?.authors?.length) return false;
    const localAuthors = this._toStringArray(script.authors).map((a) => a.toLowerCase());
    return !upstreamInfo.authors.some((a) => localAuthors.includes(a.toLowerCase()));
  }

  /**
   * activities/<LETTER>/<scriptId>.js
   * Letter = first char of script title uppercased (A-Z or 0-9), else "#".
   */
  getFilePath(script) {
    const title = (script.title || "").trim();
    const first = title[0]?.toUpperCase() || "0";
    const letter = /[A-Z]/.test(first) ? first : /[0-9]/.test(first) ? first : "#";

    const hasSpace = /\s/.test(title);
    const cleaned = title.replace(/\s/g, "");
    const isAllUpper = cleaned === cleaned.toUpperCase();
    const isTitleCase = !hasSpace && title[0] === title[0].toUpperCase() && title.slice(1) === title.slice(1).toLowerCase();

    let fileName;

    if (!hasSpace) {
      fileName = isAllUpper || isTitleCase ? title.toLowerCase() : title;
    } else {
      fileName = title
        .split(/\s+/)
        .map((word, i) => {
          const wordIsAllUpper = word === word.toUpperCase();
          const normalized = wordIsAllUpper ? word.toLowerCase() : word;
          return i === 0 ? normalized.charAt(0).toLowerCase() + normalized.slice(1) : normalized.charAt(0).toUpperCase() + normalized.slice(1);
        })
        .join("");
    }

    fileName = fileName.replace(/[^a-zA-Z0-9]/g, "");
    return `${GITHUB_CONTRIBUTE.ACTIVITIES_DIR}/${letter}/${fileName}.js`;
  }

  /**
   * Normalizes a value that may be a string[], a comma-separated string, or null into a string[].
   * Shared between fetchUpstreamScriptInfo and processAuthorsAndLinks.
   */
  _toStringArray(val) {
    if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
    if (val)
      return String(val)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  }

  /**
   * Fetch and parse root index.json.gz to check duplicate/version info.
   * Returns { filePath, title, version, authors, authorsLinks } or null if not found.
   */
  async fetchUpstreamScriptInfo(script, token) {
    const { UPSTREAM_OWNER, UPSTREAM_REPO } = GITHUB_CONTRIBUTE;
    const filePath = this.getFilePath(script);

    try {
      const response = await fetch(`https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/main/index.json.gz`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) return null;

      let jsonText;
      if (typeof DecompressionStream !== "undefined") {
        const ds = new DecompressionStream("gzip");
        jsonText = await new Response(response.body.pipeThrough(ds)).text();
      } else {
        jsonText = await response.text();
      }

      const indexData = JSON.parse(jsonText);
      if (!Array.isArray(indexData)) return null;

      // Prefer match by stable id; fall back to file path for older entries
      const match = indexData.find((item) => item.id === script.id) || indexData.find((item) => item.file === filePath);

      if (!match) return null;

      return {
        filePath: match.file || filePath,
        title: match.title,
        version: match.version,
        authors: this._toStringArray(match.authors),
        authorsLinks: this._toStringArray(match.authorsLinks),
      };
    } catch (_) {
      return null;
    }
  }

  // Main contribute flow

  /**
   * @param {object} script       - Fully-hydrated script object from storage
   * @param {string} fileContent  - registerParser() formatted .js content
   * @param {string} token        - GitHub OAuth token
   * @param {function} onStatus   - Progress callback (string) for UI updates
   * @returns {{ prUrl: string, isUpdate: boolean }}
   */
  async contribute(script, fileContent, token, onStatus = () => {}, customCommitMessage = null) {
    const { UPSTREAM_OWNER, UPSTREAM_REPO } = GITHUB_CONTRIBUTE;

    if (!script?.id) throw new Error("contribute: script.id is required");
    if (!fileContent) throw new Error("contribute: fileContent is required");
    if (!token) throw new Error("contribute: token is required");

    // 1. Verify the token & Get the logged-in user
    onStatus("validating");
    const user = await this._req("/user", {}, token);
    const forkOwner = user.login;

    // 2. Check if this script already exists in the repo (Upstream check)
    const upstreamInfo = await this.fetchUpstreamScriptInfo(script, token);

    // SPAM PROTECTION: Has the same version + same content already been sent?
    // First process the authors and generate the updated fileContent
    const contributeScript = JSON.parse(JSON.stringify(script));
    const { authors, authorsLinks } = this.processAuthorsAndLinks(contributeScript, upstreamInfo, forkOwner);
    contributeScript.authors = authors;
    contributeScript.authorsLinks = authorsLinks;

    if (typeof window.exportToRegisterParser === "function") {
      fileContent = window.exportToRegisterParser([contributeScript]);
    }

    const filePath = this.getFilePath(contributeScript);
    const fileBaseName = filePath.split("/").pop().replace(".js", "");
    const branchName = `contribute/${fileBaseName.slice(0, 60)}`;

    // 1: Open PR check
    try {
      const existingPrs = await this._req(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls?head=${forkOwner}:${branchName}&state=open`, {}, token);
      if (existingPrs.length > 0) {
        const remoteFile = await this._req(`/repos/${forkOwner}/${UPSTREAM_REPO}/contents/${filePath}?ref=${branchName}`, {}, token).catch(() => null);

        if (remoteFile?.content) {
          const remoteContent = atob(remoteFile.content);

          // Content is the same → skip
          if (remoteContent.trim() === fileContent.trim()) {
            return { prUrl: existingPrs[0].html_url, isUpdate: !!upstreamInfo, skipped: true };
          }

          // Content is different → parse the version in the branch, compare with local
          const branchVersion = this._parseVersionFromContent(remoteContent);
          if (branchVersion) {
            const cmp = this._compareVersions(branchVersion, script.version);
            if (cmp > 0) {
              // Open PR already has a newer version than what we're submitting
              const err = new Error("VERSION_OUTDATED");
              err.branchVersion = branchVersion;
              throw err;
            }
            if (cmp === 0) {
              // Same version, different content (e.g. author list changed) - treat as same
              const err = new Error("VERSION_SAME");
              err.branchVersion = branchVersion;
              throw err;
            }
          }
        }
      }
    } catch (e) {
      // Propagate known sentinel errors; swallow only transient/network failures
      if (e.message === "VERSION_SAME" || e.message === "VERSION_OUTDATED") throw e;
    }

    // 2: Upstream index control (repo scripts)
    if (upstreamInfo && upstreamInfo.version === script.version) {
      try {
        const remoteFile = await this._req(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/contents/${filePath}?ref=main`, {}, token).catch(() => null);

        if (remoteFile?.content) {
          const remoteContent = atob(remoteFile.content);
          if (remoteContent.trim() === fileContent.trim()) {
            // The same content already exists in upstream main and there is no open PR
            // In this case, there is no need to open a PR
            throw new Error("ALREADY_UP_TO_DATE");
          }
        }
      } catch (e) {
        if (e.message === "ALREADY_UP_TO_DATE") throw e;
      }
    }

    // 4. Fork (idempotent)
    onStatus("forking");
    await this._req(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`, { method: "POST", body: {} }, token);
    await this._waitForFork(forkOwner, UPSTREAM_REPO, token);

    // 5. Fetch upstream default branch info, then sync fork
    onStatus("syncing");
    const upstream = await this._req(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}`, {}, token);
    const defaultBranch = upstream.default_branch;
    // Sync first so we get the post-sync HEAD SHA, not a potentially stale one
    try {
      await this._req(`/repos/${forkOwner}/${UPSTREAM_REPO}/merge-upstream`, { method: "POST", body: { branch: defaultBranch } }, token);
    } catch (_) {
      // merge-upstream fails if fork is already up to date on some GitHub versions - safe to ignore
    }
    const upstreamRef = await this._req(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/git/ref/heads/${defaultBranch}`, {}, token);
    const baseSha = upstreamRef.object.sha;

    // 6. Create feature branch (idempotent - skip if already exists)
    onStatus("branching");
    try {
      await this._req(`/repos/${forkOwner}/${UPSTREAM_REPO}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branchName}`, sha: baseSha } }, token);
    } catch (e) {
      if (e.status !== 422 && !e.message.includes("already exists") && !e.message.includes("Reference already exists")) {
        throw e;
      }
    }

    // 7. Check upstream file & Push
    onStatus("checking");
    const contentBase64 = btoa(unescape(encodeURIComponent(fileContent)));
    let existingFileSha = null;
    const isUpdate = !!upstreamInfo;

    try {
      const forkFile = await this._req(`/repos/${forkOwner}/${UPSTREAM_REPO}/contents/${filePath}?ref=${branchName}`, {}, token).catch(async () =>
        this._req(`/repos/${forkOwner}/${UPSTREAM_REPO}/contents/${filePath}?ref=${defaultBranch}`, {}, token),
      );
      existingFileSha = forkFile.sha;
    } catch (_) {}

    onStatus("pushing");
    const defaultCommitMessage = this.getDefaultCommitMessage(contributeScript, isUpdate);
    const commitMessage = customCommitMessage || defaultCommitMessage;

    const commitBody = {
      message: commitMessage,
      content: contentBase64,
      branch: branchName,
    };
    if (existingFileSha) commitBody.sha = existingFileSha;

    await this._req(`/repos/${forkOwner}/${UPSTREAM_REPO}/contents/${filePath}`, { method: "PUT", body: commitBody }, token);

    // 8. Open PR
    onStatus("opening_pr");
    const domains = [contributeScript.domain].flat().filter(Boolean).join(", ");
    const prTitle = commitMessage;
    const prBody = [
      isUpdate ? `## Update Activity: ${contributeScript.title}` : `## New Activity: ${contributeScript.title}`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Domain(s)** | \`${domains}\` |`,
      `| **Version** | \`${contributeScript.version || "1.0.0"}\` |`,
      `| **Author(s)** | ${[contributeScript.authors].flat().filter(Boolean).join(", ")} |`,
      `| **Mode** | ${contributeScript.mode || "listen"} |`,
      `| **Path** | \`${filePath}\` |`,
      contributeScript.description ? `| **Description** | ${contributeScript.description} |` : null,
      ``,
      `---`,
      `*Submitted via Web Presence UserScript Manager*`,
    ]
      .filter((l) => l !== null)
      .join("\n");

    try {
      const pr = await this._req(
        `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`,
        {
          method: "POST",
          body: { title: prTitle, body: prBody, head: `${forkOwner}:${branchName}`, base: defaultBranch },
        },
        token,
      );
      return { prUrl: pr.html_url, isUpdate };
    } catch (e) {
      if (e.message.includes("already exists") || e.message.includes("A pull request already exists")) {
        const existing = await this._req(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls?head=${forkOwner}:${branchName}&state=open`, {}, token);
        if (existing.length) return { prUrl: existing[0].html_url, isUpdate };
      }
      throw e;
    }
  }

  async _waitForFork(owner, repo, token, maxRetries = 8, delayMs = 1500) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this._req(`/repos/${owner}/${repo}`, {}, token);
        return;
      } catch (e) {
        // Propagate auth/permission errors immediately - retrying won't help
        if (e.status === 401 || e.status === 403) throw e;
        // 404 means fork isn't ready yet - keep waiting
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw new Error("Fork is taking too long to initialize. Please try again in a moment.");
  }
}

const githubContributeService = new GitHubContributeService();
