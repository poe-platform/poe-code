import { type CommandRunner, defaultCommandRunner } from "./command.js";
import {
  type GitHubApiResponse,
  GitHubRateLimitError,
  nextGitHubEndpoint,
  parseGitHubApiResponse,
  rateLimitStatus
} from "./github-api.js";
import { parseGitHubPullRequestRef } from "./pr-url.js";

export interface GitHubCliOptions {
  cwd?: string;
  runner?: CommandRunner;
}

function requirePullRequestRef(prUrl: string) {
  const ref = parseGitHubPullRequestRef(prUrl);
  if (!ref) {
    throw new Error(`GitHub PR URL is required: ${prUrl}`);
  }
  return ref;
}

function runGh(args: string[], options: GitHubCliOptions & { input?: string } = {}) {
  const runner = options.runner ?? defaultCommandRunner;
  return runner("gh", args, { cwd: options.cwd, input: options.input });
}

function runGhOrThrow(args: string[], options: GitHubCliOptions & { input?: string } = {}): string {
  const result = runGh(args, options);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "gh failed");
  }
  return result.stdout;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function parseGhAvailableFields(stderr: string): string[] {
  const fields: string[] = [];
  let capture = false;
  for (const line of stderr.split(/\r?\n/)) {
    if (line.toLowerCase().includes("available fields")) {
      capture = true;
      continue;
    }
    if (!capture) {
      continue;
    }
    const cleaned = line.trim().replace(/^-/, "").trim();
    fields.push(...cleaned.split(/[\s,]+/).filter(Boolean));
  }
  return dedupe(fields);
}

function parseJsonRecord(stdout: string, action: string): Record<string, unknown> {
  const parsed = parseJson(stdout, action);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid ${action} output: expected a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function parseJson(stdout: string, action: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid ${action} output: ${error instanceof Error ? error.message : "unknown parse error"}`
    );
  }
}

export function ghPrView(
  prUrl: string,
  fields: readonly string[],
  options: GitHubCliOptions = {}
): Record<string, unknown> {
  const ref = requirePullRequestRef(prUrl);
  const canonicalPrUrl = ref.url;
  const requestedFields = dedupe([...fields]);
  const result = runGh(["pr", "view", canonicalPrUrl, "--json", requestedFields.join(",")], options);
  if (result.code === 0) {
    const parsed = parseJsonRecord(result.stdout, "gh pr view");
    parsed.url ??= canonicalPrUrl;
    return parsed;
  }

  const availableFields = parseGhAvailableFields(result.stderr);
  const fallbackFields = requestedFields.filter((field) => availableFields.includes(field));
  if (fallbackFields.length === 0 || fallbackFields.length === requestedFields.length) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "gh pr view failed");
  }

  const fallback = runGh(
    ["pr", "view", canonicalPrUrl, "--json", fallbackFields.join(",")],
    options
  );
  if (fallback.code !== 0) {
    throw new Error(fallback.stderr.trim() || fallback.stdout.trim() || "gh pr view failed");
  }
  const parsed = parseJsonRecord(fallback.stdout, "gh pr view");
  parsed.url ??= canonicalPrUrl;
  return parsed;
}

export function ghPrDiff(prUrl: string, options: GitHubCliOptions = {}): string {
  const ref = requirePullRequestRef(prUrl);
  return runGhOrThrow(["pr", "diff", ref.url], options);
}

export function ghApiJson(
  prUrl: string,
  args: string[],
  payload?: unknown,
  options: GitHubCliOptions = {}
): Record<string, unknown> {
  const ref = requirePullRequestRef(prUrl);
  const commandArgs = ["api"];
  if (ref.host !== "github.com") {
    commandArgs.push("--hostname", ref.host);
  }
  commandArgs.push(...args);
  if (payload !== undefined) {
    commandArgs.push("--input", "-");
  }

  const stdout = runGhOrThrow(commandArgs, {
    ...options,
    input: payload === undefined ? undefined : JSON.stringify(payload)
  });
  if (!stdout.trim()) {
    return {};
  }
  return parseJsonRecord(stdout, "gh api");
}

export function ghApiPaginatedJsonArray(
  prUrl: string,
  endpoint: string,
  options: GitHubCliOptions = {}
): Record<string, unknown>[] {
  const ref = requirePullRequestRef(prUrl);
  const values: Record<string, unknown>[] = [];
  let nextEndpoint: string | null = endpoint;
  while (nextEndpoint) {
    const args = ["api"];
    if (ref.host !== "github.com") {
      args.push("--hostname", ref.host);
    }
    args.push("--include", nextEndpoint);
    const result = runGh(args, options);
    let response: GitHubApiResponse;
    try {
      response = parseGitHubApiResponse(result.stdout);
    } catch (error) {
      if (result.code === 0) {
        throw error;
      }
      throw new Error(result.stderr.trim() || result.stdout.trim() || "gh api failed");
    }
    const resumeEndpoint = nextEndpoint;
    const rateLimit = rateLimitStatus(response, {
      repo: `${ref.owner}/${ref.repo}`,
      resumeEndpoint,
      partialResults: values.length
    });
    if (result.code !== 0 || response.statusCode >= 400) {
      if (rateLimit) {
        throw new GitHubRateLimitError(rateLimit);
      }
      throw new Error(result.stderr.trim() || result.stdout.trim() || "gh api failed");
    }
    const items = parseJsonArrayRecords(response.body);
    values.push(...items);
    nextEndpoint = nextGitHubEndpoint(response);
    if (nextEndpoint && rateLimit) {
      throw new GitHubRateLimitError({
        ...rateLimit,
        resumeEndpoint: nextEndpoint,
        partialResults: values.length
      });
    }
  }
  return values;
}

function parseJsonArrayRecords(body: unknown): Record<string, unknown>[] {
  if (!Array.isArray(body)) {
    throw new Error("Invalid gh api output: expected a JSON array");
  }
  return body.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid gh api output: expected JSON object entries");
    }
    return value as Record<string, unknown>;
  });
}
