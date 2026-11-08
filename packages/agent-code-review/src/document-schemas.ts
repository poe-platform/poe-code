import { basename } from "node:path";
import { parse as load, stringify } from "yaml";

const CODE_REVIEW_PROMPT_ROLES = [
  "orchestrator",
  "subagent",
  "agent",
  "profile-synthesis"
] as const;
type CodeReviewPromptRole = (typeof CODE_REVIEW_PROMPT_ROLES)[number];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const SAFE_GITHUB_ACTOR_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export interface CodeReviewProfileMetadata {
  version: 1;
  name: string;
}

export interface CodeReviewPromptMetadata {
  version: 1;
  role: CodeReviewPromptRole;
}

export interface CodeReviewIngestSource {
  version: 1;
  username: string;
  repos: string[];
  fetchedAt: string;
  outputProfilePath: string;
  pagination: {
    partial: boolean;
    commentsWritten: number;
    resumeEndpoint?: string;
  };
  rateLimit: null | {
    repo: string;
    limit: number | null;
    remaining: number | null;
    resetAt: string | null;
    retryAfter: string | null;
    partialResults: number;
    reason: "low_remaining" | "primary" | "secondary";
  };
}

export function requireSafeDocumentSegment(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.normalize("NFKC") !== value ||
    !SAFE_SEGMENT_RE.test(value) ||
    value.startsWith(".") ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`${field} must be a safe path segment.`);
  }
  return value;
}

export function requireGitHubActorName(value: unknown, field: string): string {
  if (typeof value !== "string" || !SAFE_GITHUB_ACTOR_RE.test(value)) {
    throw new Error(`${field} must be a safe GitHub actor name.`);
  }
  return value;
}

export function parseCodeReviewProfileMarkdown(
  content: string,
  filePath: string
): { content: string; metadata?: CodeReviewProfileMetadata } {
  const parsed = parseOptionalFrontmatter(content, filePath);
  if (!parsed.frontmatter) {
    return { content: parsed.body };
  }
  const metadata = requireMapping(parsed.frontmatter, filePath, "frontmatter");
  requireOnlyFields(metadata, filePath, "frontmatter", ["version", "name"]);
  requireVersion(metadata.version, filePath, "frontmatter.version");
  const name = requireSafeDocumentSegment(metadata.name, `${filePath}: frontmatter.name`);
  if (basename(filePath, ".md") !== name) {
    throw invalidField(filePath, "frontmatter.name", "must match the filename");
  }
  return { content: parsed.body, metadata: { version: 1, name } };
}

export function parseCodeReviewPromptMarkdown(
  content: string,
  filePath: string,
  role?: CodeReviewPromptRole
): { content: string; metadata?: CodeReviewPromptMetadata } {
  const parsed = parseOptionalFrontmatter(content, filePath);
  if (!parsed.frontmatter) {
    return { content: parsed.body };
  }
  const metadata = requireMapping(parsed.frontmatter, filePath, "frontmatter");
  requireOnlyFields(metadata, filePath, "frontmatter", ["version", "role"]);
  requireVersion(metadata.version, filePath, "frontmatter.version");
  if (!CODE_REVIEW_PROMPT_ROLES.includes(metadata.role as CodeReviewPromptRole)) {
    throw invalidField(filePath, "frontmatter.role", "is not a supported role");
  }
  const promptRole = metadata.role as CodeReviewPromptRole;
  if (role !== undefined && promptRole !== role) {
    throw invalidField(filePath, "frontmatter.role", `must equal ${role}`);
  }
  return { content: parsed.body, metadata: { version: 1, role: promptRole } };
}

export function parseCodeReviewIngestSource(
  content: string,
  filePath = "code-review ingest source.yaml"
): CodeReviewIngestSource {
  try {
    const source = requireMapping(load(content), filePath, "document");
    requireOnlyFields(source, filePath, "document", [
      "version",
      "username",
      "repos",
      "fetched_at",
      "output_profile_path",
      "pagination",
      "rate_limit"
    ]);
    requireVersion(source.version, filePath, "version");
    const username = requireGitHubActorName(source.username, `${filePath}: username`);
    if (!Array.isArray(source.repos) || source.repos.length === 0) {
      throw invalidField(filePath, "repos", "must be a non-empty array");
    }
    const repos = source.repos.map((repo, index) => requireRepo(repo, filePath, `repos[${index}]`));
    const fetchedAt = requireDate(source.fetched_at, filePath, "fetched_at");
    if (typeof source.output_profile_path !== "string" || !source.output_profile_path) {
      throw invalidField(filePath, "output_profile_path", "must be a non-empty string");
    }
    const pagination = requireMapping(source.pagination, filePath, "pagination");
    requireOnlyFields(pagination, filePath, "pagination", [
      "partial",
      "comments_written",
      "resume_endpoint"
    ]);
    if (typeof pagination.partial !== "boolean") {
      throw invalidField(filePath, "pagination.partial", "must be a boolean");
    }
    const commentsWritten = requireNonNegativeInteger(
      pagination.comments_written,
      filePath,
      "pagination.comments_written"
    );
    const resumeEndpoint = optionalString(
      pagination.resume_endpoint,
      filePath,
      "pagination.resume_endpoint"
    );
    let rateLimit: CodeReviewIngestSource["rateLimit"] = null;
    if (source.rate_limit !== null) {
      const rate = requireMapping(source.rate_limit, filePath, "rate_limit");
      requireOnlyFields(rate, filePath, "rate_limit", [
        "repo",
        "limit",
        "remaining",
        "reset_at",
        "retry_after",
        "partial_results",
        "reason"
      ]);
      const reason = optionalString(rate.reason, filePath, "rate_limit.reason");
      if (
        reason !== undefined &&
        !(["low_remaining", "primary", "secondary"] as const).includes(
          reason as "low_remaining" | "primary" | "secondary"
        )
      ) {
        throw invalidField(filePath, "rate_limit.reason", "is not supported");
      }
      rateLimit = {
        repo: requireRepo(rate.repo, filePath, "rate_limit.repo"),
        limit:
          rate.limit === null || rate.limit === undefined
            ? null
            : requireNonNegativeInteger(rate.limit, filePath, "rate_limit.limit"),
        remaining:
          rate.remaining === null
            ? null
            : requireNonNegativeInteger(rate.remaining, filePath, "rate_limit.remaining"),
        resetAt:
          rate.reset_at === null
            ? null
            : requireDate(rate.reset_at, filePath, "rate_limit.reset_at"),
        retryAfter:
          rate.retry_after === null || rate.retry_after === undefined
            ? null
            : (optionalString(rate.retry_after, filePath, "rate_limit.retry_after") ?? null),
        partialResults: requireNonNegativeInteger(
          rate.partial_results,
          filePath,
          "rate_limit.partial_results"
        ),
        reason: (reason ?? "low_remaining") as "low_remaining" | "primary" | "secondary"
      };
    }
    return {
      version: 1,
      username,
      repos,
      fetchedAt,
      outputProfilePath: source.output_profile_path,
      pagination: {
        partial: pagination.partial,
        commentsWritten,
        ...(resumeEndpoint === undefined ? {} : { resumeEndpoint })
      },
      rateLimit
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${filePath}:`)) {
      throw error;
    }
    throw new Error(`${filePath}: invalid YAML: ${errorMessage(error)}`);
  }
}

export function serializeCodeReviewIngestSource(
  source: CodeReviewIngestSource,
  filePath = "code-review ingest source.yaml"
): string {
  const content = stringify(
    {
      version: source.version,
      username: source.username,
      repos: source.repos,
      fetched_at: source.fetchedAt,
      pagination: {
        partial: source.pagination.partial,
        comments_written: source.pagination.commentsWritten,
        ...(source.pagination.resumeEndpoint === undefined
          ? {}
          : { resume_endpoint: source.pagination.resumeEndpoint })
      },
      rate_limit:
        source.rateLimit === null
          ? null
          : {
              repo: source.rateLimit.repo,
              limit: source.rateLimit.limit,
              remaining: source.rateLimit.remaining,
              reset_at: source.rateLimit.resetAt,
              retry_after: source.rateLimit.retryAfter,
              partial_results: source.rateLimit.partialResults,
              reason: source.rateLimit.reason
            },
      output_profile_path: source.outputProfilePath
    },
    { aliasDuplicateObjects: false, lineWidth: 0 }
  );
  parseCodeReviewIngestSource(content, filePath);
  return content;
}

function parseOptionalFrontmatter(content: string, filePath: string) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { body: content };
  }
  try {
    return { frontmatter: load(match[1]), body: match[2] };
  } catch (error) {
    throw new Error(`${filePath}: invalid frontmatter YAML: ${errorMessage(error)}`);
  }
}

function requireMapping(value: unknown, filePath: string, field: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidField(filePath, field, "must be a YAML mapping");
  }
  return value as Record<string, unknown>;
}

function requireVersion(value: unknown, filePath: string, field: string): void {
  if (value !== 1) {
    throw invalidField(filePath, field, "must equal 1");
  }
}

function requireOnlyFields(
  value: Record<string, unknown>,
  filePath: string,
  field: string,
  allowedFields: readonly string[]
): void {
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw invalidField(filePath, `${field}.${key}`, "is not supported");
    }
  }
}

function requireRepo(value: unknown, filePath: string, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)) {
    throw invalidField(filePath, field, "must be a safe owner/repository name");
  }
  return value;
}

function requireDate(value: unknown, filePath: string, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw invalidField(filePath, field, "must be a valid timestamp");
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, filePath: string, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidField(filePath, field, "must be a non-negative integer");
  }
  return value as number;
}

function optionalString(value: unknown, filePath: string, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw invalidField(filePath, field, "must be a non-empty string");
  }
  return value;
}

function invalidField(filePath: string, field: string, reason: string): Error {
  return new Error(`${filePath}: ${field} ${reason}.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
