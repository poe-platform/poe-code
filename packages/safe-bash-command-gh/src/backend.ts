import { bytesToHex, decodeUtf8, encodeUtf8, sha1Sync } from "./crypto-ssh.js";
import { computeDiffBetweenFileMaps } from "./git-vfs.js";
import type {
  GhCheckRun,
  GhComment,
  GhCommitRecord,
  GhConfigState,
  GhGist,
  GhGpgKey,
  GhHttpRequest,
  GhHttpResponse,
  GhHttpTransport,
  GhIssue,
  GhLabel,
  GhLimits,
  GhMilestone,
  GhProject,
  GhPrReview,
  GhPullRequest,
  GhRelease,
  GhRepo,
  GhCodespace,
  GhSecret,
  GhSshKey,
  GhUser,
  GhVariable,
  GhWorkflow,
} from "./types.js";

export class GitHubBackend {
  readonly users = new Map<string, GhUser>();
  readonly repos = new Map<string, GhRepo>();
  readonly gists = new Map<string, GhGist>();
  readonly sshKeys = new Map<number, GhSshKey>();
  readonly gpgKeys = new Map<number, GhGpgKey>();
  readonly orgSecrets = new Map<string, GhSecret>();
  readonly userSecrets = new Map<string, GhSecret>();
  readonly orgVariables = new Map<string, GhVariable>();
  readonly orgs = new Set<string>(["poe-platform", "github"]);
  readonly projects = new Map<number, GhProject>();
  readonly extensions = new Map<string, { readonly name: string; readonly repo: string; readonly version: string }>();
  readonly codespaces = new Map<string, GhCodespace>();
  readonly config: GhConfigState;
  currentUser: string;
  defaultHost: string;
  readonly now: () => Date;

  #nextId = 1000;
  #httpRequests = 0;
  #httpBytes = 0;

  constructor(options: {
    readonly defaultUser?: string | undefined;
    readonly defaultHost?: string | undefined;
    readonly defaultToken?: string | undefined;
    readonly now?: (() => Date) | undefined;
  } = {}) {
    this.currentUser = options.defaultUser ?? "octocat";
    this.defaultHost = options.defaultHost ?? "github.com";
    this.now = options.now ?? (() => new Date("2026-09-28T12:00:00Z"));
    const token = options.defaultToken ?? "gho_default_safe_bash_token_1234567890";
    this.config = {
      gitProtocol: "https",
      editor: "vim",
      prompt: "enabled",
      pager: "",
      httpUnixSocket: "",
      browser: "",
      aliases: {
        co: "pr checkout",
      },
      hosts: {
        [this.defaultHost]: [
          {
            user: this.currentUser,
            oauthToken: token,
            gitProtocol: "https",
            scopes: ["repo", "read:org", "workflow", "gist", "admin:public_key", "admin:gpg_key"],
            active: true,
          },
        ],
      },
    };

    this.users.set(this.currentUser, {
      login: this.currentUser,
      id: 1,
      name: "The Octocat",
      email: `${this.currentUser}@github.com`,
      bio: "GitHub mascot",
      company: "@github",
      type: "User",
    });

    this.ensureRepo(this.currentUser, "Hello-World", {
      description: "My first repository on GitHub!",
      files: {
        "README.md": "# Hello-World\n\nWelcome to Hello-World on GitHub.\n",
        "src/index.ts": 'export const greeting = "Hello, World!";\n',
      },
    });
  }

  nextId(): number {
    return ++this.#nextId;
  }

  isoNow(): string {
    return this.now().toISOString().replace(/\.\d{3}Z$/u, "Z");
  }

  resetUsage(): void {
    this.#httpRequests = 0;
    this.#httpBytes = 0;
  }

  recordHttpCall(requestBytes: number, responseBytes: number, limits: GhLimits): void {
    this.#httpRequests += 1;
    if (this.#httpRequests > limits.maxHttpRequests) {
      throw new Error("gh HTTP request limit exceeded");
    }
    this.#httpBytes += requestBytes + responseBytes;
    if (this.#httpBytes > limits.maxHttpBytes) {
      throw new Error("gh HTTP byte limit exceeded");
    }
  }

  getActiveToken(host = this.defaultHost, env: Readonly<Record<string, string>> = {}): string | undefined {
    if (env.GH_TOKEN) return env.GH_TOKEN;
    if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
    if (host !== "github.com" && env.GH_ENTERPRISE_TOKEN) return env.GH_ENTERPRISE_TOKEN;
    const entries = this.config.hosts[host] ?? [];
    const active = entries.find((e) => e.active) ?? entries[0];
    return active?.oauthToken;
  }

  getActiveUser(host = this.defaultHost): string {
    const entries = this.config.hosts[host] ?? [];
    const active = entries.find((e) => e.active) ?? entries[0];
    return active?.user ?? this.currentUser;
  }

  ensureRepo(
    owner: string,
    name: string,
    init: {
      readonly description?: string | undefined;
      readonly homepageUrl?: string | undefined;
      readonly visibility?: "PUBLIC" | "PRIVATE" | "INTERNAL" | undefined;
      readonly defaultBranch?: string | undefined;
      readonly isFork?: boolean | undefined;
      readonly isTemplate?: boolean | undefined;
      readonly parent?: GhRepo["parent"] | undefined;
      readonly files?: Readonly<Record<string, string>> | undefined;
    } = {}
  ): GhRepo {
    const key = `${owner}/${name}`.toLowerCase();
    const existing = this.repos.get(key);
    if (existing) return existing;

    const defaultBranch = init.defaultBranch ?? "main";
    const initialFiles: Record<string, string> = init.files
      ? { ...init.files }
      : {
          "README.md": `# ${name}\n\n${init.description || `Repository ${owner}/${name}`}\n`,
        };
    const commitOid = bytesToHex(sha1Sync(`commit:${owner}/${name}:${defaultBranch}:${JSON.stringify(initialFiles)}`));
    const ts = this.isoNow();
    const visibility = init.visibility ?? "PUBLIC";

    const defaultLabels: GhLabel[] = [
      { id: this.nextId(), name: "bug", color: "d73a4a", description: "Something isn't working", isDefault: true },
      { id: this.nextId(), name: "documentation", color: "0075ca", description: "Improvements or additions to documentation", isDefault: true },
      { id: this.nextId(), name: "enhancement", color: "a2eeef", description: "New feature or request", isDefault: true },
      { id: this.nextId(), name: "good first issue", color: "7057ff", description: "Good for newcomers", isDefault: true },
      { id: this.nextId(), name: "help wanted", color: "008672", description: "Extra attention is needed", isDefault: true },
    ];
    const labelsMap = new Map<string, GhLabel>();
    for (const lbl of defaultLabels) labelsMap.set(lbl.name.toLowerCase(), lbl);

    const workflowsMap = new Map<number, GhWorkflow>();
    const ciWorkflowId = this.nextId();
    workflowsMap.set(ciWorkflowId, {
      id: ciWorkflowId,
      name: "CI",
      path: ".github/workflows/ci.yml",
      state: "active",
      content: `name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm test\n`,
    });

    const repo: GhRepo = {
      id: this.nextId(),
      name,
      owner: { login: owner },
      nameWithOwner: `${owner}/${name}`,
      description: init.description ?? "",
      homepageUrl: init.homepageUrl ?? "",
      url: `https://${this.defaultHost}/${owner}/${name}`,
      sshUrl: `git@${this.defaultHost}:${owner}/${name}.git`,
      cloneUrl: `https://${this.defaultHost}/${owner}/${name}.git`,
      visibility,
      isPrivate: visibility !== "PUBLIC",
      isFork: init.isFork ?? false,
      isArchived: false,
      isTemplate: init.isTemplate ?? false,
      defaultBranchRef: { name: defaultBranch },
      parent: init.parent ?? null,
      primaryLanguage: { name: "TypeScript" },
      repositoryTopics: [],
      hasIssuesEnabled: true,
      hasWikiEnabled: true,
      hasProjectsEnabled: true,
      hasDiscussionsEnabled: false,
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      autoMergeAllowed: true,
      deleteBranchOnMerge: false,
      stargazerCount: 0,
      forkCount: 0,
      viewerPermission: "ADMIN",
      createdAt: ts,
      updatedAt: ts,
      pushedAt: ts,
      branches: new Map([[defaultBranch, commitOid]]),
      commits: new Map([
        [
          commitOid,
          {
            oid: commitOid,
            messageHeadline: "Initial commit",
            messageBody: "",
            author: { name: owner, email: `${owner}@github.com`, login: owner },
            committedDate: ts,
            parents: [],
            files: { ...initialFiles },
          },
        ],
      ]),
      branchFiles: new Map([[defaultBranch, { ...initialFiles }]]),
      pullRequests: new Map(),
      issues: new Map(),
      labels: labelsMap,
      milestones: new Map(),
      releases: new Map(),
      workflows: workflowsMap,
      workflowRuns: new Map(),
      deployKeys: new Map(),
      secrets: new Map(),
      variables: new Map(),
      caches: new Map(),
      nextNumber: 1,
    };

    this.repos.set(key, repo);
    return repo;
  }

  getRepo(owner: string, name: string): GhRepo | undefined {
    return this.repos.get(`${owner}/${name}`.toLowerCase());
  }

  getOrCreateRepo(owner: string, name: string): GhRepo {
    return this.getRepo(owner, name) ?? this.ensureRepo(owner, name);
  }

  createPullRequest(
    repo: GhRepo,
    params: {
      readonly title: string;
      readonly body?: string | undefined;
      readonly headRefName: string;
      readonly baseRefName?: string | undefined;
      readonly isDraft?: boolean | undefined;
      readonly labels?: readonly string[] | undefined;
      readonly assignees?: readonly string[] | undefined;
      readonly reviewers?: readonly string[] | undefined;
      readonly milestone?: string | undefined;
      readonly project?: string | undefined;
      readonly maintainerCanModify?: boolean | undefined;
      readonly headFiles?: Readonly<Record<string, string>> | undefined;
      readonly commits?: readonly GhCommitRecord[] | undefined;
      readonly headOwner?: string | undefined;
    }
  ): GhPullRequest {
    const baseBranch = params.baseRefName ?? repo.defaultBranchRef.name;
    const headBranch = params.headRefName;
    const baseFiles = repo.branchFiles.get(baseBranch) ?? repo.branchFiles.get(repo.defaultBranchRef.name) ?? {};
    const headFiles =
      params.headFiles ??
      repo.branchFiles.get(headBranch) ?? {
        ...baseFiles,
        [`${headBranch.replace(/[^a-zA-Z0-9._-]/gu, "_")}.md`]: `# ${params.title}\n\n${params.body ?? ""}\n`,
      };

    repo.branchFiles.set(headBranch, { ...headFiles });
    const baseOid =
      repo.branches.get(baseBranch) ??
      bytesToHex(sha1Sync(`base:${repo.nameWithOwner}:${baseBranch}`));
    const headOid =
      params.commits && params.commits.length > 0
        ? params.commits[params.commits.length - 1]!.oid
        : repo.branches.get(headBranch) ??
          bytesToHex(sha1Sync(`head:${repo.nameWithOwner}:${headBranch}:${params.title}:${repo.nextNumber}`));
    repo.branches.set(headBranch, headOid);

    const diffStats = computeDiffBetweenFileMaps(baseFiles, headFiles);
    const prNumber = repo.nextNumber++;
    const ts = this.isoNow();
    const authorLogin = this.getActiveUser();

    const resolvedLabels: GhLabel[] = [];
    for (const labelName of params.labels ?? []) {
      const existing = repo.labels.get(labelName.toLowerCase());
      if (existing) {
        resolvedLabels.push(existing);
      } else {
        const created: GhLabel = {
          id: this.nextId(),
          name: labelName,
          color: "ededed",
          description: "",
        };
        repo.labels.set(labelName.toLowerCase(), created);
        resolvedLabels.push(created);
      }
    }

    const resolvedAssignees = (params.assignees ?? []).map((login) => ({
      login: login === "@me" ? authorLogin : login,
    }));
    const resolvedReviewers = (params.reviewers ?? []).map((login) => ({
      login: login === "@me" ? authorLogin : login,
    }));

    let resolvedMilestone: GhMilestone | null = null;
    if (params.milestone) {
      for (const m of repo.milestones.values()) {
        if (m.title === params.milestone || String(m.number) === params.milestone) {
          resolvedMilestone = m;
          break;
        }
      }
      if (!resolvedMilestone) {
        resolvedMilestone = {
          id: this.nextId(),
          number: repo.milestones.size + 1,
          title: params.milestone,
          description: "",
          state: "open",
        };
        repo.milestones.set(resolvedMilestone.number, resolvedMilestone);
      }
    }

    const prCommits: GhCommitRecord[] =
      params.commits && params.commits.length > 0
        ? [...params.commits]
        : [
            {
              oid: headOid,
              messageHeadline: params.title,
              messageBody: params.body ?? "",
              author: {
                name: authorLogin,
                email: `${authorLogin}@github.com`,
                login: authorLogin,
              },
              committedDate: ts,
              parents: [baseOid],
              files: { ...headFiles },
            },
          ];

    for (const c of prCommits) {
      repo.commits.set(c.oid, c);
    }

    const defaultChecks: GhCheckRun[] = [
      {
        id: this.nextId(),
        name: "build",
        status: "completed",
        conclusion: "success",
        workflowName: "CI",
        detailsUrl: `${repo.url}/actions/runs/1`,
        startedAt: ts,
        completedAt: ts,
        isRequired: true,
        description: "Build succeeded",
      },
      {
        id: this.nextId(),
        name: "test",
        status: "completed",
        conclusion: "success",
        workflowName: "CI",
        detailsUrl: `${repo.url}/actions/runs/1`,
        startedAt: ts,
        completedAt: ts,
        isRequired: true,
        description: "All tests passed",
      },
    ];

    const isDraft = params.isDraft ?? false;
    const pr: GhPullRequest = {
      number: prNumber,
      title: params.title,
      body: params.body ?? "",
      state: "OPEN",
      isDraft,
      url: `${repo.url}/pull/${prNumber}`,
      headRefName: headBranch,
      headRefOid: headOid,
      headRepositoryOwner: { login: params.headOwner ?? repo.owner.login },
      headRepository: { name: repo.name },
      baseRefName: baseBranch,
      baseRefOid: baseOid,
      author: { login: authorLogin },
      assignees: resolvedAssignees,
      labels: resolvedLabels,
      reviewRequests: resolvedReviewers,
      reviews: [],
      reviewDecision: resolvedReviewers.length > 0 ? "REVIEW_REQUIRED" : "",
      comments: [],
      commits: prCommits,
      files: diffStats.files,
      diff: diffStats.diff,
      additions: diffStats.additions,
      deletions: diffStats.deletions,
      changedFiles: diffStats.changedFiles,
      mergeable: "MERGEABLE",
      mergeStateStatus: isDraft ? "DRAFT" : "CLEAN",
      statusCheckRollup: defaultChecks,
      milestone: resolvedMilestone,
      projectItems: params.project ? [{ title: params.project }] : [],
      maintainerCanModify: params.maintainerCanModify ?? true,
      locked: false,
      activeLockReason: null,
      autoMergeRequest: null,
      createdAt: ts,
      updatedAt: ts,
      closedAt: null,
      mergedAt: null,
      mergedBy: null,
      mergeCommit: null,
    };

    repo.pullRequests.set(prNumber, pr);
    return pr;
  }

  resolvePullRequest(
    repo: GhRepo,
    selector: string | undefined,
    currentBranch?: string
  ): GhPullRequest {
    if (selector) {
      const trimmed = selector.trim();
      const urlMatch = /\/pull\/(\d+)/u.exec(trimmed);
      if (urlMatch) {
        const num = Number.parseInt(urlMatch[1]!, 10);
        const pr = repo.pullRequests.get(num);
        if (pr) return pr;
      }
      const numMatch = /^#?(\d+)$/u.exec(trimmed);
      if (numMatch) {
        const num = Number.parseInt(numMatch[1]!, 10);
        const pr = repo.pullRequests.get(num);
        if (pr) return pr;
        throw new Error(`GraphQL: Could not resolve to a PullRequest with the number of ${num}.`);
      }
      // Match by branch name (or owner:branch)
      const branchPart = trimmed.includes(":") ? trimmed.split(":")[1]! : trimmed;
      const byBranch = Array.from(repo.pullRequests.values())
        .reverse()
        .find((p) => p.headRefName === branchPart || p.headRefName === trimmed);
      if (byBranch) return byBranch;
      throw new Error(`no pull requests found for branch "${trimmed}"`);
    }

    if (currentBranch) {
      const byCurrent = Array.from(repo.pullRequests.values())
        .reverse()
        .find((p) => p.headRefName === currentBranch);
      if (byCurrent) return byCurrent;
    }

    const openPrs = Array.from(repo.pullRequests.values()).filter((p) => p.state === "OPEN");
    if (openPrs.length === 1) return openPrs[0]!;
    throw new Error(
      `no pull requests found for branch "${currentBranch ?? "main"}"`
    );
  }

  createIssue(
    repo: GhRepo,
    params: {
      readonly title: string;
      readonly body?: string | undefined;
      readonly labels?: readonly string[] | undefined;
      readonly assignees?: readonly string[] | undefined;
      readonly milestone?: string | undefined;
      readonly project?: string | undefined;
    }
  ): GhIssue {
    const number = repo.nextNumber++;
    const ts = this.isoNow();
    const authorLogin = this.getActiveUser();
    const resolvedLabels: GhLabel[] = [];
    for (const labelName of params.labels ?? []) {
      const existing = repo.labels.get(labelName.toLowerCase()) ?? {
        id: this.nextId(),
        name: labelName,
        color: "ededed",
        description: "",
      };
      repo.labels.set(labelName.toLowerCase(), existing);
      resolvedLabels.push(existing);
    }
    const issue: GhIssue = {
      number,
      title: params.title,
      body: params.body ?? "",
      state: "OPEN",
      stateReason: null,
      url: `${repo.url}/issues/${number}`,
      author: { login: authorLogin },
      assignees: (params.assignees ?? []).map((login) => ({
        login: login === "@me" ? authorLogin : login,
      })),
      labels: resolvedLabels,
      comments: [],
      milestone: null,
      projectItems: params.project ? [{ title: params.project }] : [],
      isPinned: false,
      locked: false,
      activeLockReason: null,
      linkedBranches: [],
      createdAt: ts,
      updatedAt: ts,
      closedAt: null,
    };
    repo.issues.set(number, issue);
    return issue;
  }

  resolveIssue(repo: GhRepo, selector: string): GhIssue {
    const trimmed = selector.trim();
    const urlMatch = /\/issues\/(\d+)/u.exec(trimmed);
    const numStr = urlMatch ? urlMatch[1]! : trimmed.replace(/^#/u, "");
    const num = Number.parseInt(numStr, 10);
    const issue = repo.issues.get(num);
    if (!issue) {
      throw new Error(`GraphQL: Could not resolve to an Issue with the number of ${num || selector}.`);
    }
    return issue;
  }

  async dispatchHttp(
    request: GhHttpRequest,
    customHttp: GhHttpTransport | undefined,
    limits: GhLimits
  ): Promise<GhHttpResponse> {
    if (this.#httpRequests >= limits.maxHttpRequests) {
      throw new Error("gh HTTP request limit exceeded");
    }
    if (this.#httpBytes + request.body.length > limits.maxHttpBytes) {
      throw new Error("gh HTTP byte limit exceeded");
    }
    if (customHttp) {
      this.#httpRequests += 1;
      this.#httpBytes += request.body.length;
      const response = await customHttp(request);
      this.#httpBytes += response.body.length;
      if (this.#httpBytes > limits.maxHttpBytes) {
        throw new Error("gh HTTP byte limit exceeded");
      }
      return response;
    }
    const response = this.handleInternalHttpRequest(request);
    this.recordHttpCall(request.body.length, response.body.length, limits);
    return response;
  }

  handleInternalHttpRequest(request: GhHttpRequest): GhHttpResponse {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/^\/api\/v3/u, "") || "/";
    const method = request.method.toUpperCase();
    const bodyText = request.body.length > 0 ? decodeUtf8(request.body) : "";
    let bodyJson: Record<string, unknown> = {};
    if (bodyText.trim().startsWith("{")) {
      try {
        bodyJson = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        bodyJson = {};
      }
    }

    const jsonResponse = (status: number, payload: unknown, extraHeaders: Record<string, string> = {}): GhHttpResponse => ({
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...extraHeaders,
      },
      body: payload === undefined ? new Uint8Array() : encodeUtf8(JSON.stringify(payload)),
    });

    if (pathname === "/user" && method === "GET") {
      const login = this.getActiveUser();
      const user = this.users.get(login) ?? {
        login,
        id: 1,
        name: login,
        email: `${login}@github.com`,
      };
      return jsonResponse(200, user);
    }

    if (pathname === "/graphql" && method === "POST") {
      const query = String(bodyJson.query ?? "");
      const variables = (bodyJson.variables && typeof bodyJson.variables === "object"
        ? bodyJson.variables
        : {}) as Record<string, unknown>;
      return jsonResponse(200, this.evaluateGraphQl(query, variables));
    }

    // /repos/:owner/:repo/pulls/:number/merge
    const prMergeMatch = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/u.exec(pathname);
    if (prMergeMatch && method === "PUT") {
      const [, owner, repoName, numStr] = prMergeMatch;
      const repo = this.getOrCreateRepo(owner!, repoName!);
      const pr = repo.pullRequests.get(Number(numStr));
      if (!pr) return jsonResponse(404, { message: "Not Found" });
      pr.state = "MERGED";
      pr.mergedAt = this.isoNow();
      pr.mergedBy = { login: this.getActiveUser() };
      const mergeOid = bytesToHex(sha1Sync(`merge:${repo.nameWithOwner}:${pr.number}`));
      pr.mergeCommit = { oid: mergeOid };
      return jsonResponse(200, { sha: mergeOid, merged: true, message: "Pull Request successfully merged" });
    }

    // /repos/:owner/:repo/pulls/:number/reviews
    const prReviewsMatch = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews$/u.exec(pathname);
    if (prReviewsMatch) {
      const [, owner, repoName, numStr] = prReviewsMatch;
      const repo = this.getOrCreateRepo(owner!, repoName!);
      const pr = repo.pullRequests.get(Number(numStr));
      if (!pr) return jsonResponse(404, { message: "Not Found" });
      if (method === "GET") {
        return jsonResponse(200, pr.reviews);
      }
      if (method === "POST") {
        const event = String(bodyJson.event ?? "COMMENT").toUpperCase();
        const state: GhPrReview["state"] =
          event === "APPROVE"
            ? "APPROVED"
            : event === "REQUEST_CHANGES"
              ? "CHANGES_REQUESTED"
              : "COMMENTED";
        const review: GhPrReview = {
          id: this.nextId(),
          author: { login: this.getActiveUser() },
          state,
          body: String(bodyJson.body ?? ""),
          submittedAt: this.isoNow(),
          commitOid: pr.headRefOid,
        };
        pr.reviews.push(review);
        if (state === "APPROVED") pr.reviewDecision = "APPROVED";
        else if (state === "CHANGES_REQUESTED") pr.reviewDecision = "CHANGES_REQUESTED";
        return jsonResponse(200, review);
      }
    }

    // /repos/:owner/:repo/pulls/:number
    const prSingleMatch = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/u.exec(pathname);
    if (prSingleMatch) {
      const [, owner, repoName, numStr] = prSingleMatch;
      const repo = this.getOrCreateRepo(owner!, repoName!);
      const pr = repo.pullRequests.get(Number(numStr));
      if (!pr) return jsonResponse(404, { message: "Not Found" });
      if (method === "GET") {
        return jsonResponse(200, this.toRestPullRequest(repo, pr));
      }
      if (method === "PATCH") {
        if (typeof bodyJson.title === "string") pr.title = bodyJson.title;
        if (typeof bodyJson.body === "string") pr.body = bodyJson.body;
        if (typeof bodyJson.state === "string") {
          pr.state = bodyJson.state.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";
        }
        if (typeof bodyJson.base === "string") pr.baseRefName = bodyJson.base;
        return jsonResponse(200, this.toRestPullRequest(repo, pr));
      }
    }

    // /repos/:owner/:repo/pulls
    const pullsMatch = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/u.exec(pathname);
    if (pullsMatch) {
      const [, owner, repoName] = pullsMatch;
      const repo = this.getOrCreateRepo(owner!, repoName!);
      if (method === "GET") {
        const stateFilter = (url.searchParams.get("state") ?? "open").toLowerCase();
        const prs = Array.from(repo.pullRequests.values())
          .filter((p) => {
            if (stateFilter === "all") return true;
            if (stateFilter === "open") return p.state === "OPEN";
            return p.state === "CLOSED" || p.state === "MERGED";
          })
          .map((p) => this.toRestPullRequest(repo, p));
        return jsonResponse(200, prs);
      }
      if (method === "POST") {
        const created = this.createPullRequest(repo, {
          title: String(bodyJson.title ?? "Pull Request"),
          body: typeof bodyJson.body === "string" ? bodyJson.body : "",
          headRefName: String(bodyJson.head ?? "feature"),
          baseRefName: typeof bodyJson.base === "string" ? bodyJson.base : repo.defaultBranchRef.name,
          isDraft: Boolean(bodyJson.draft),
        });
        return jsonResponse(201, this.toRestPullRequest(repo, created));
      }
    }

    // /repos/:owner/:repo/issues/:number/comments
    const commentsMatch = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/u.exec(pathname);
    if (commentsMatch) {
      const [, owner, repoName, numStr] = commentsMatch;
      const repo = this.getOrCreateRepo(owner!, repoName!);
      const num = Number(numStr);
      const target = repo.pullRequests.get(num) ?? repo.issues.get(num);
      if (!target) return jsonResponse(404, { message: "Not Found" });
      if (method === "GET") return jsonResponse(200, target.comments);
      if (method === "POST") {
        const ts = this.isoNow();
        const comment: GhComment = {
          id: this.nextId(),
          author: { login: this.getActiveUser() },
          body: String(bodyJson.body ?? ""),
          createdAt: ts,
          updatedAt: ts,
          url: `${target.url}#issuecomment-${this.#nextId}`,
        };
        target.comments.push(comment);
        return jsonResponse(201, comment);
      }
    }

    // /repos/:owner/:repo/issues/:number
    const issueSingleMatch = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/u.exec(pathname);
    if (issueSingleMatch) {
      const [, owner, repoName, numStr] = issueSingleMatch;
      const repo = this.getOrCreateRepo(owner!, repoName!);
      const issue = repo.issues.get(Number(numStr));
      if (!issue) return jsonResponse(404, { message: "Not Found" });
      if (method === "GET") return jsonResponse(200, issue);
      if (method === "PATCH") {
        if (typeof bodyJson.title === "string") issue.title = bodyJson.title;
        if (typeof bodyJson.body === "string") issue.body = bodyJson.body;
        if (typeof bodyJson.state === "string") {
          issue.state = bodyJson.state.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";
        }
        return jsonResponse(200, issue);
      }
    }

    // /repos/:owner/:repo/issues
    const issuesMatch = /^\/repos\/([^/]+)\/([^/]+)\/issues$/u.exec(pathname);
    if (issuesMatch) {
      const [, owner, repoName] = issuesMatch;
      const repo = this.getOrCreateRepo(owner!, repoName!);
      if (method === "GET") {
        return jsonResponse(200, Array.from(repo.issues.values()));
      }
      if (method === "POST") {
        const created = this.createIssue(repo, {
          title: String(bodyJson.title ?? "Issue"),
          body: typeof bodyJson.body === "string" ? bodyJson.body : "",
          labels: Array.isArray(bodyJson.labels) ? (bodyJson.labels as string[]) : [],
          assignees: Array.isArray(bodyJson.assignees) ? (bodyJson.assignees as string[]) : [],
        });
        return jsonResponse(201, created);
      }
    }

    // /repos/:owner/:repo/releases
    const releasesMatch = /^\/repos\/([^/]+)\/([^/]+)\/releases$/u.exec(pathname);
    if (releasesMatch) {
      const [, owner, repoName] = releasesMatch;
      const repo = this.getOrCreateRepo(owner!, repoName!);
      if (method === "GET") {
        return jsonResponse(200, Array.from(repo.releases.values()));
      }
      if (method === "POST") {
        const tagName = String(bodyJson.tag_name ?? bodyJson.tagName ?? "v1.0.0");
        const ts = this.isoNow();
        const rel: GhRelease = {
          id: this.nextId(),
          tagName,
          name: String(bodyJson.name ?? tagName),
          body: String(bodyJson.body ?? ""),
          isDraft: Boolean(bodyJson.draft),
          isPrerelease: Boolean(bodyJson.prerelease),
          isLatest: !bodyJson.draft && !bodyJson.prerelease,
          targetCommitish: String(bodyJson.target_commitish ?? repo.defaultBranchRef.name),
          author: { login: this.getActiveUser() },
          createdAt: ts,
          publishedAt: ts,
          url: `${repo.url}/releases/tag/${tagName}`,
          assets: [],
        };
        repo.releases.set(tagName, rel);
        return jsonResponse(201, rel);
      }
    }

    // /repos/:owner/:repo/labels
    const labelsMatch = /^\/repos\/([^/]+)\/([^/]+)\/labels$/u.exec(pathname);
    if (labelsMatch) {
      const [, owner, repoName] = labelsMatch;
      const repo = this.getOrCreateRepo(owner!, repoName!);
      if (method === "GET") {
        return jsonResponse(200, Array.from(repo.labels.values()));
      }
      if (method === "POST") {
        const lbl: GhLabel = {
          id: this.nextId(),
          name: String(bodyJson.name ?? "label"),
          color: String(bodyJson.color ?? "ededed").replace(/^#/u, ""),
          description: String(bodyJson.description ?? ""),
        };
        repo.labels.set(lbl.name.toLowerCase(), lbl);
        return jsonResponse(201, lbl);
      }
    }

    // /repos/:owner/:repo
    const repoSingleMatch = /^\/repos\/([^/]+)\/([^/]+)$/u.exec(pathname);
    if (repoSingleMatch) {
      const [, owner, repoName] = repoSingleMatch;
      if (method === "DELETE") {
        this.repos.delete(`${owner}/${repoName}`.toLowerCase());
        return jsonResponse(204, undefined);
      }
      const repo = this.getOrCreateRepo(owner!, repoName!);
      if (method === "PATCH") {
        if (typeof bodyJson.description === "string") repo.description = bodyJson.description;
        if (typeof bodyJson.homepage === "string") repo.homepageUrl = bodyJson.homepage;
        if (typeof bodyJson.name === "string") {
          this.repos.delete(repo.nameWithOwner.toLowerCase());
          repo.name = bodyJson.name;
          repo.nameWithOwner = `${repo.owner.login}/${repo.name}`;
          repo.url = `https://${this.defaultHost}/${repo.nameWithOwner}`;
          this.repos.set(repo.nameWithOwner.toLowerCase(), repo);
        }
        if (typeof bodyJson.archived === "boolean") repo.isArchived = bodyJson.archived;
        if (typeof bodyJson.private === "boolean") {
          repo.isPrivate = bodyJson.private;
          repo.visibility = bodyJson.private ? "PRIVATE" : "PUBLIC";
        }
      }
      return jsonResponse(200, this.toRestRepo(repo));
    }

    if (pathname === "/user/repos" && method === "GET") {
      return jsonResponse(
        200,
        Array.from(this.repos.values()).map((r) => this.toRestRepo(r))
      );
    }

    if (pathname === "/user/repos" && method === "POST") {
      const owner = this.getActiveUser();
      const name = String(bodyJson.name ?? "new-repo");
      const repo = this.ensureRepo(owner, name, {
        description: typeof bodyJson.description === "string" ? bodyJson.description : "",
        homepageUrl: typeof bodyJson.homepage === "string" ? bodyJson.homepage : "",
        visibility: bodyJson.private ? "PRIVATE" : "PUBLIC",
      });
      return jsonResponse(201, this.toRestRepo(repo));
    }

    if (pathname === "/gists" && method === "GET") {
      return jsonResponse(200, Array.from(this.gists.values()));
    }

    if (pathname === "/user/keys" && method === "GET") {
      return jsonResponse(200, Array.from(this.sshKeys.values()));
    }

    if (pathname === "/user/gpg_keys" && method === "GET") {
      return jsonResponse(200, Array.from(this.gpgKeys.values()));
    }

    return jsonResponse(200, {
      ok: true,
      method,
      path: pathname,
      query: (() => { const q: Record<string, string> = {}; url.searchParams.forEach((v, k) => { q[k] = v; }); return q; })(),
      ...(Object.keys(bodyJson).length > 0 ? { data: bodyJson } : {}),
    });
  }

  evaluateGraphQl(query: string, variables: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const owner = String(variables.owner ?? this.getActiveUser());
    const name = String(variables.name ?? variables.repo ?? "Hello-World");
    const repo = this.getOrCreateRepo(owner, name);
    const viewer = this.users.get(this.getActiveUser()) ?? {
      login: this.getActiveUser(),
      id: 1,
      name: "The Octocat",
      email: `${this.getActiveUser()}@github.com`,
    };

    if (query.includes("viewer")) {
      return {
        data: {
          viewer: {
            login: viewer.login,
            name: viewer.name,
            email: viewer.email,
          },
          repository: this.toGraphQlRepo(repo),
        },
      };
    }

    return {
      data: {
        repository: this.toGraphQlRepo(repo),
      },
    };
  }

  toGraphQlRepo(repo: GhRepo): Record<string, unknown> {
    return {
      id: `R_${repo.id}`,
      databaseId: repo.id,
      name: repo.name,
      nameWithOwner: repo.nameWithOwner,
      description: repo.description,
      url: repo.url,
      sshUrl: repo.sshUrl,
      isPrivate: repo.isPrivate,
      isFork: repo.isFork,
      isArchived: repo.isArchived,
      defaultBranchRef: repo.defaultBranchRef,
      owner: repo.owner,
      pullRequests: {
        nodes: Array.from(repo.pullRequests.values()),
        totalCount: repo.pullRequests.size,
      },
      issues: {
        nodes: Array.from(repo.issues.values()),
        totalCount: repo.issues.size,
      },
    };
  }

  toRestRepo(repo: GhRepo): Record<string, unknown> {
    return {
      id: repo.id,
      name: repo.name,
      full_name: repo.nameWithOwner,
      nameWithOwner: repo.nameWithOwner,
      owner: repo.owner,
      private: repo.isPrivate,
      isPrivate: repo.isPrivate,
      visibility: repo.visibility.toLowerCase(),
      html_url: repo.url,
      url: repo.url,
      clone_url: repo.cloneUrl,
      ssh_url: repo.sshUrl,
      sshUrl: repo.sshUrl,
      description: repo.description,
      homepage: repo.homepageUrl,
      homepageUrl: repo.homepageUrl,
      fork: repo.isFork,
      isFork: repo.isFork,
      archived: repo.isArchived,
      isArchived: repo.isArchived,
      isTemplate: repo.isTemplate,
      default_branch: repo.defaultBranchRef.name,
      defaultBranchRef: repo.defaultBranchRef,
      parent: repo.parent,
      language: repo.primaryLanguage?.name ?? null,
      primaryLanguage: repo.primaryLanguage,
      topics: repo.repositoryTopics.map((t) => t.name),
      repositoryTopics: repo.repositoryTopics,
      has_issues: repo.hasIssuesEnabled,
      hasIssuesEnabled: repo.hasIssuesEnabled,
      has_wiki: repo.hasWikiEnabled,
      hasWikiEnabled: repo.hasWikiEnabled,
      has_projects: repo.hasProjectsEnabled,
      hasProjectsEnabled: repo.hasProjectsEnabled,
      has_discussions: repo.hasDiscussionsEnabled,
      hasDiscussionsEnabled: repo.hasDiscussionsEnabled,
      allow_merge_commit: repo.mergeCommitAllowed,
      mergeCommitAllowed: repo.mergeCommitAllowed,
      allow_squash_merge: repo.squashMergeAllowed,
      squashMergeAllowed: repo.squashMergeAllowed,
      allow_rebase_merge: repo.rebaseMergeAllowed,
      rebaseMergeAllowed: repo.rebaseMergeAllowed,
      allow_auto_merge: repo.autoMergeAllowed,
      autoMergeAllowed: repo.autoMergeAllowed,
      delete_branch_on_merge: repo.deleteBranchOnMerge,
      deleteBranchOnMerge: repo.deleteBranchOnMerge,
      stargazers_count: repo.stargazerCount,
      stargazerCount: repo.stargazerCount,
      forks_count: repo.forkCount,
      forkCount: repo.forkCount,
      viewerPermission: repo.viewerPermission,
      created_at: repo.createdAt,
      createdAt: repo.createdAt,
      updated_at: repo.updatedAt,
      updatedAt: repo.updatedAt,
      pushed_at: repo.pushedAt,
      pushedAt: repo.pushedAt,
    };
  }

  toRestPullRequest(repo: GhRepo, pr: GhPullRequest): Record<string, unknown> {
    return {
      ...pr,
      id: pr.number,
      html_url: pr.url,
      draft: pr.isDraft,
      user: pr.author,
      head: {
        ref: pr.headRefName,
        sha: pr.headRefOid,
        repo: {
          name: pr.headRepository.name,
          full_name: `${pr.headRepositoryOwner.login}/${pr.headRepository.name}`,
          owner: pr.headRepositoryOwner,
        },
      },
      base: {
        ref: pr.baseRefName,
        sha: pr.baseRefOid,
        repo: {
          name: repo.name,
          full_name: repo.nameWithOwner,
          owner: repo.owner,
        },
      },
      merged: pr.state === "MERGED",
    };
  }
}

export function createGitHubBackend(options?: ConstructorParameters<typeof GitHubBackend>[0]): GitHubBackend {
  return new GitHubBackend(options);
}
