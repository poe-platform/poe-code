import { type CommandRunner, defaultCommandRunner } from "./command.js";
import type { GitHubCliOptions } from "./gh.js";
import {
  type GitHubApiResponse,
  GitHubRateLimitError,
  type GitHubRateLimitStatus,
  githubResetAt,
  nextGitHubEndpoint,
  parseGitHubApiResponse,
  rateLimitReason
} from "./github-api.js";
export { GitHubRateLimitError, type GitHubRateLimitStatus } from "./github-api.js";

export type ReviewHistoryKind = "review_comment" | "review_body" | "pr_comment";

export interface ReviewHistoryComment {
  repo: string;
  pullRequestNumber: number;
  pullRequestTitle: string;
  pullRequestUrl: string;
  authorLogin: string;
  createdAt: string;
  kind: ReviewHistoryKind;
  body: string;
  path?: string;
  line?: number;
  diffHunk?: string;
}

export interface FetchReviewHistoryOptions extends GitHubCliOptions {
  username: string;
  repos: readonly string[];
  since?: string | Date;
  maxComments?: number;
  onRateLimit?: (status: GitHubRateLimitStatus) => void | Promise<void>;
}

interface ApiPage {
  items: Record<string, unknown>[];
  nextEndpoint: string | null;
}

interface PullRequestMetadata {
  number: number;
  title: string;
  url: string;
}

function parseObject(value: unknown, action: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${action} output: expected a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseArray(value: unknown, action: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${action} output: expected a JSON array`);
  }
  return value.map((item) => parseObject(item, action));
}

function text(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function integer(record: Record<string, unknown>, key: string): number | null {
  return typeof record[key] === "number" && Number.isInteger(record[key]) ? record[key] : null;
}

function authorLogin(record: Record<string, unknown>): string | null {
  const user = record.user;
  return user && typeof user === "object" && !Array.isArray(user)
    ? text(user as Record<string, unknown>, "login")
    : null;
}

function pullRequestNumber(record: Record<string, unknown>): number | null {
  const direct = integer(record, "number");
  if (direct) {
    return direct;
  }
  for (const key of ["pull_request_url", "issue_url", "html_url"]) {
    const value = text(record, key);
    const match = value?.match(/\/(?:pulls|pull|issues)\/(\d+)(?:\/|$)/);
    if (match) {
      return Number.parseInt(match[1] ?? "", 10);
    }
  }
  return null;
}

function pullRequestUrl(repo: string, record: Record<string, unknown>, number: number): string {
  const pullRequest = record.pull_request;
  if (pullRequest && typeof pullRequest === "object" && !Array.isArray(pullRequest)) {
    const htmlUrl = text(pullRequest as Record<string, unknown>, "html_url");
    if (htmlUrl) return htmlUrl;
  }
  const htmlUrl = text(record, "html_url");
  return htmlUrl?.includes("/pull/") ? htmlUrl : `https://github.com/${repo}/pull/${number}`;
}

function validRepo(repo: string): boolean {
  return (
    repo.split("/").length === 2 &&
    repo
      .split("/")
      .every(
        (part) =>
          /^[A-Za-z0-9_.-]+$/.test(part) && part.normalize("NFKC") === part && !part.startsWith(".")
      )
  );
}

function appendQuery(endpoint: string, values: Record<string, string>): string {
  const query = new URLSearchParams(values);
  return `${endpoint}?${query.toString()}`;
}

function asIsoDate(value: string | Date | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid review-history since timestamp: ${String(value)}`);
  }
  return date.toISOString();
}

function isAtOrAfter(value: string | null, since: string | undefined): boolean {
  if (!since) return true;
  if (!value) return false;
  return new Date(value).getTime() >= new Date(since).getTime();
}

function rawCreatedAt(record: Record<string, unknown>, kind: ReviewHistoryKind): string | null {
  return kind === "review_body"
    ? (text(record, "submitted_at") ?? text(record, "created_at"))
    : (text(record, "created_at") ?? text(record, "submitted_at"));
}

function createdAt(record: Record<string, unknown>, kind: ReviewHistoryKind): string | null {
  const value = rawCreatedAt(record, kind);
  if (!value) {
    return null;
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid GitHub review-history ${kind} timestamp: ${value}`);
  }
  return timestamp.toISOString();
}

function dedupeRepos(repos: readonly string[]): string[] {
  const deduped = new Map<string, string>();
  for (const repo of repos) {
    const key = repo.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, repo);
    }
  }
  return [...deduped.values()];
}

class ReviewHistoryFetcher {
  private readonly runner: CommandRunner;
  private readonly username: string;
  private readonly since?: string;
  private readonly pullRequests = new Map<string, PullRequestMetadata>();
  private readonly nonPullRequests = new Set<string>();
  private rateLimit: Omit<
    GitHubRateLimitStatus,
    "repo" | "resumeEndpoint" | "partialResults"
  > | null = null;
  emitted = 0;

  constructor(private readonly options: FetchReviewHistoryOptions) {
    this.runner = options.runner ?? defaultCommandRunner;
    this.username = options.username.trim().toLowerCase();
    this.since = asIsoDate(options.since);
  }

  private async ensureRateLimit(repo: string, resumeEndpoint: string) {
    if (!this.rateLimit) {
      return;
    }
    const status: GitHubRateLimitStatus = {
      repo,
      ...this.rateLimit,
      resumeEndpoint,
      partialResults: this.emitted
    };
    await this.options.onRateLimit?.(status);
    throw new GitHubRateLimitError(status);
  }

  private observeRateLimit(response: GitHubApiResponse): void {
    const reason = rateLimitReason(response);
    this.rateLimit = reason
      ? {
          limit: response.rateLimitLimit,
          remaining: response.rateLimitRemaining,
          resetAt: githubResetAt(response),
          retryAfter: response.retryAfter,
          reason
        }
      : null;
  }

  private async request(repo: string, endpoint: string): Promise<GitHubApiResponse> {
    await this.ensureRateLimit(repo, endpoint);
    const result = this.runner("gh", ["api", "--include", endpoint], {
      cwd: this.options.cwd
    });
    let parsed: GitHubApiResponse | null = null;
    try {
      parsed = parseGitHubApiResponse(result.stdout);
      this.observeRateLimit(parsed);
    } catch (error) {
      if (result.code === 0) {
        throw error;
      }
    }
    if (result.code !== 0 || (parsed?.statusCode ?? 500) >= 400) {
      await this.ensureRateLimit(repo, endpoint);
      throw new Error(result.stderr.trim() || result.stdout.trim() || "gh api failed");
    }
    if (!parsed) {
      throw new Error("Invalid gh api output: expected included response");
    }
    return parsed;
  }

  private async page(repo: string, endpoint: string): Promise<ApiPage> {
    const response = await this.request(repo, endpoint);
    return {
      items: parseArray(response.body, "gh api"),
      nextEndpoint: nextGitHubEndpoint(response)
    };
  }

  private async object(repo: string, endpoint: string): Promise<Record<string, unknown>> {
    return parseObject((await this.request(repo, endpoint)).body, "gh api");
  }

  private matchesAuthor(record: Record<string, unknown>): boolean {
    return authorLogin(record)?.toLowerCase() === this.username;
  }

  private matchesSince(record: Record<string, unknown>, kind: ReviewHistoryKind): boolean {
    return isAtOrAfter(createdAt(record, kind), this.since);
  }

  private rememberPullRequest(
    repo: string,
    record: Record<string, unknown>
  ): PullRequestMetadata | null {
    const number = pullRequestNumber(record);
    if (!number) {
      return null;
    }
    const metadata = {
      number,
      title: text(record, "title") ?? "",
      url: pullRequestUrl(repo, record, number)
    };
    this.pullRequests.set(`${repo}#${number}`, metadata);
    return metadata;
  }

  private async getPullRequest(repo: string, number: number): Promise<PullRequestMetadata> {
    const key = `${repo}#${number}`;
    const cached = this.pullRequests.get(key);
    if (cached) {
      return cached;
    }
    const metadata = this.rememberPullRequest(
      repo,
      await this.object(repo, `repos/${repo}/pulls/${number}`)
    );
    if (!metadata) {
      throw new Error(`Invalid pull request metadata for ${repo}#${number}`);
    }
    return metadata;
  }

  private normalize(
    repo: string,
    pullRequest: PullRequestMetadata,
    record: Record<string, unknown>,
    kind: ReviewHistoryKind
  ): ReviewHistoryComment | null {
    const login = authorLogin(record);
    const timestamp = createdAt(record, kind);
    const body = text(record, "body");
    if (!login || !timestamp || body === null || (kind === "review_body" && !body.trim())) {
      return null;
    }
    const normalized: ReviewHistoryComment = {
      repo,
      pullRequestNumber: pullRequest.number,
      pullRequestTitle: pullRequest.title,
      pullRequestUrl: pullRequest.url,
      authorLogin: login,
      createdAt: timestamp,
      kind,
      body
    };
    const path = text(record, "path");
    const line = integer(record, "line") ?? integer(record, "original_line");
    const diffHunk = text(record, "diff_hunk");
    if (path) normalized.path = path;
    if (line !== null) normalized.line = line;
    if (diffHunk) normalized.diffHunk = diffHunk;
    return normalized;
  }

  async *reviewComments(repo: string): AsyncGenerator<ReviewHistoryComment> {
    let endpoint: string | null = appendQuery(`repos/${repo}/pulls/comments`, {
      per_page: "100",
      ...(this.since ? { since: this.since } : {})
    });
    while (endpoint) {
      const page = await this.page(repo, endpoint);
      for (const record of page.items) {
        if (!this.matchesAuthor(record) || !this.matchesSince(record, "review_comment")) {
          continue;
        }
        const number = pullRequestNumber(record);
        if (!number) continue;
        const normalized = this.normalize(
          repo,
          await this.getPullRequest(repo, number),
          record,
          "review_comment"
        );
        if (normalized) yield normalized;
      }
      endpoint = page.nextEndpoint;
    }
  }

  async *reviewBodies(repo: string): AsyncGenerator<ReviewHistoryComment> {
    let endpoint: string | null = appendQuery(`repos/${repo}/pulls`, {
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: "100"
    });
    let pastSince = false;
    while (endpoint && !pastSince) {
      const page = await this.page(repo, endpoint);
      for (const pullRecord of page.items) {
        const updatedAt = text(pullRecord, "updated_at");
        if (updatedAt && !isAtOrAfter(updatedAt, this.since)) {
          pastSince = true;
          break;
        }
        const pullRequest = this.rememberPullRequest(repo, pullRecord);
        if (!pullRequest) continue;
        let reviewsEndpoint: string | null = appendQuery(
          `repos/${repo}/pulls/${pullRequest.number}/reviews`,
          { per_page: "100" }
        );
        while (reviewsEndpoint) {
          const reviews = await this.page(repo, reviewsEndpoint);
          for (const record of reviews.items) {
            if (!this.matchesAuthor(record) || !this.matchesSince(record, "review_body")) continue;
            const normalized = this.normalize(repo, pullRequest, record, "review_body");
            if (normalized) yield normalized;
          }
          reviewsEndpoint = reviews.nextEndpoint;
        }
      }
      endpoint = page.nextEndpoint;
    }
  }

  async *pullRequestComments(repo: string): AsyncGenerator<ReviewHistoryComment> {
    let endpoint: string | null = appendQuery(`repos/${repo}/issues/comments`, {
      per_page: "100",
      ...(this.since ? { since: this.since } : {})
    });
    while (endpoint) {
      const page = await this.page(repo, endpoint);
      for (const record of page.items) {
        if (!this.matchesAuthor(record) || !this.matchesSince(record, "pr_comment")) {
          continue;
        }
        const number = pullRequestNumber(record);
        if (!number) continue;
        const key = `${repo}#${number}`;
        if (this.nonPullRequests.has(key)) continue;
        let pullRequest = this.pullRequests.get(key) ?? null;
        if (!pullRequest) {
          const issue = await this.object(repo, `repos/${repo}/issues/${number}`);
          if (!issue.pull_request) {
            this.nonPullRequests.add(key);
            continue;
          }
          pullRequest = this.rememberPullRequest(repo, issue);
        }
        if (!pullRequest) continue;
        const normalized = this.normalize(repo, pullRequest, record, "pr_comment");
        if (normalized) yield normalized;
      }
      endpoint = page.nextEndpoint;
    }
  }
}

export async function* fetchReviewHistory(
  options: FetchReviewHistoryOptions
): AsyncGenerator<ReviewHistoryComment> {
  if (!options.username.trim()) {
    throw new Error("GitHub review-history username is required.");
  }
  if (
    options.maxComments !== undefined &&
    (!Number.isInteger(options.maxComments) || options.maxComments < 1)
  ) {
    throw new Error("Review-history maxComments must be a positive integer.");
  }
  const repos = dedupeRepos(options.repos);
  for (const repo of repos) {
    if (!validRepo(repo)) {
      throw new Error(`Invalid GitHub repository name: ${repo}`);
    }
  }
  const fetcher = new ReviewHistoryFetcher(options);
  for (const repo of repos) {
    for (const source of [
      fetcher.reviewComments(repo),
      fetcher.reviewBodies(repo),
      fetcher.pullRequestComments(repo)
    ]) {
      for await (const comment of source) {
        fetcher.emitted += 1;
        yield comment;
        if (options.maxComments && fetcher.emitted >= options.maxComments) {
          return;
        }
      }
    }
  }
}
