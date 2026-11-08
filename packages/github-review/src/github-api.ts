export const LOW_RATE_LIMIT_REMAINING = 10;

export type GitHubRateLimitReason = "low_remaining" | "primary" | "secondary";

export interface GitHubRateLimitStatus {
  repo: string;
  limit: number | null;
  remaining: number | null;
  resetAt: Date | null;
  retryAfter: string | null;
  resumeEndpoint: string;
  partialResults: number;
  reason: GitHubRateLimitReason;
}

export class GitHubRateLimitError extends Error {
  readonly status: GitHubRateLimitStatus;

  constructor(status: GitHubRateLimitStatus) {
    const remaining =
      status.remaining === null
        ? "unknown remaining requests"
        : `${status.remaining} requests remaining`;
    const resetMessage = status.resetAt
      ? ` after ${status.resetAt.toISOString()}`
      : " once GitHub allows requests again";
    super(
      `GitHub API ${status.reason.replace("_", " ")} limit (${remaining}) while reading ${status.repo}. Resume ${status.resumeEndpoint}${resetMessage}; ${status.partialResults} results were already yielded.`
    );
    this.name = "GitHubRateLimitError";
    this.status = status;
  }
}

export interface GitHubApiResponse {
  body: unknown;
  statusCode: number;
  links: ReadonlyMap<string, string>;
  rateLimitLimit: number | null;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
  retryAfter: string | null;
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseLinks(value: string | undefined): ReadonlyMap<string, string> {
  const links = new Map<string, string>();
  if (!value) {
    return links;
  }
  for (const entry of value.split(/,\s*(?=<)/)) {
    const endpoint = entry.match(/^<([^>]+)>/)?.[1];
    const relations = entry
      .match(/(?:^|;)\s*rel=(?:"([^"]+)"|([^;\s]+))/i)
      ?.slice(1)
      .find(Boolean)
      ?.split(/\s+/);
    if (!endpoint || !relations) {
      continue;
    }
    for (const relation of relations) {
      links.set(relation, endpoint);
    }
  }
  return links;
}

export function parseGitHubApiResponse(stdout: string): GitHubApiResponse {
  const headers = new Map<string, string>();
  let statusCode: number | null = null;
  let bodyStart = 0;
  while (stdout.slice(bodyStart).startsWith("HTTP/")) {
    const windowsBoundary = stdout.indexOf("\r\n\r\n", bodyStart);
    const unixBoundary = stdout.indexOf("\n\n", bodyStart);
    const isWindows = windowsBoundary >= 0 && (unixBoundary < 0 || windowsBoundary <= unixBoundary);
    const boundary = isWindows ? windowsBoundary : unixBoundary;
    if (boundary < 0) {
      throw new Error("Invalid gh api output: response headers have no body");
    }
    const block = stdout.slice(bodyStart, boundary);
    const lines = block.split(/\r?\n/);
    const parsedStatus = lines[0]?.match(/^HTTP\/\S+\s+(\d{3})(?:\s|$)/)?.[1];
    if (!parsedStatus) {
      throw new Error("Invalid gh api output: malformed HTTP status");
    }
    statusCode = Number.parseInt(parsedStatus, 10);
    headers.clear();
    for (const line of lines.slice(1)) {
      const separator = line.indexOf(":");
      if (separator > 0) {
        headers.set(
          line.slice(0, separator).trim().toLowerCase(),
          line.slice(separator + 1).trim()
        );
      }
    }
    bodyStart = boundary + (isWindows ? 4 : 2);
  }
  if (statusCode === null) {
    throw new Error("Invalid gh api output: response headers are missing");
  }
  let body: unknown;
  try {
    body = JSON.parse(stdout.slice(bodyStart)) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid gh api output: ${error instanceof Error ? error.message : "unknown parse error"}`
    );
  }
  return {
    body,
    statusCode,
    links: parseLinks(headers.get("link")),
    rateLimitLimit: parseNonNegativeInteger(headers.get("x-ratelimit-limit")),
    rateLimitRemaining: parseNonNegativeInteger(headers.get("x-ratelimit-remaining")),
    rateLimitReset: parseNonNegativeInteger(headers.get("x-ratelimit-reset")),
    retryAfter: headers.get("retry-after") ?? null
  };
}

export function nextGitHubEndpoint(response: GitHubApiResponse): string | null {
  const endpoint = response.links.get("next");
  if (!endpoint) {
    return null;
  }
  try {
    const url = new URL(endpoint);
    return `${url.pathname.replace(/^\//, "")}${url.search}`;
  } catch {
    return endpoint;
  }
}

function retryAfterResetAt(retryAfter: string | null, now: () => Date): Date | null {
  if (!retryAfter) {
    return null;
  }
  const seconds = parseNonNegativeInteger(retryAfter);
  if (seconds !== null) {
    return validDate(now().getTime() + seconds * 1_000);
  }
  const date = new Date(retryAfter);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validDate(milliseconds: number): Date | null {
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function githubResetAt(
  response: GitHubApiResponse,
  now: () => Date = () => new Date()
): Date | null {
  const retryAfter = retryAfterResetAt(response.retryAfter, now);
  return (
    retryAfter ??
    (response.rateLimitReset === null ? null : validDate(response.rateLimitReset * 1_000))
  );
}

function responseMessage(response: GitHubApiResponse): string {
  if (!response.body || typeof response.body !== "object" || Array.isArray(response.body)) {
    return "";
  }
  const message = (response.body as Record<string, unknown>).message;
  return typeof message === "string" ? message.toLowerCase() : "";
}

export function rateLimitReason(response: GitHubApiResponse): GitHubRateLimitReason | null {
  const message = responseMessage(response);
  if (
    response.retryAfter !== null ||
    message.includes("secondary rate limit") ||
    message.includes("abuse detection") ||
    message.includes("abuse-rate")
  ) {
    return "secondary";
  }
  if (response.rateLimitRemaining === 0 || message.includes("api rate limit exceeded")) {
    return "primary";
  }
  if (
    response.rateLimitRemaining !== null &&
    response.rateLimitRemaining <= LOW_RATE_LIMIT_REMAINING
  ) {
    return "low_remaining";
  }
  return null;
}

export function rateLimitStatus(
  response: GitHubApiResponse,
  input: {
    repo: string;
    resumeEndpoint: string;
    partialResults: number;
    now?: () => Date;
  }
): GitHubRateLimitStatus | null {
  const reason = rateLimitReason(response);
  return reason === null
    ? null
    : {
        repo: input.repo,
        limit: response.rateLimitLimit,
        remaining: response.rateLimitRemaining,
        resetAt: githubResetAt(response, input.now),
        retryAfter: response.retryAfter,
        resumeEndpoint: input.resumeEndpoint,
        partialResults: input.partialResults,
        reason
      };
}
