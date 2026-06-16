import { type GitHubCliOptions, ghApiJson } from "./gh.js";
import { parseGitHubPullRequestRef } from "./pr-url.js";

export type PullRequestReviewDecision = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface PullRequestReviewCommentInput {
  path: string;
  line: number;
  body: string;
}

export interface PullRequestReviewSubmission {
  id: number | null;
  url: string | null;
}

type PullRequestTarget = { pr?: string; prUrl?: string };

const REVIEW_DECISIONS: ReadonlySet<string> = new Set(["APPROVE", "REQUEST_CHANGES", "COMMENT"]);

function inputPullRequestUrl(input: PullRequestTarget): string {
  const prUrl = input.prUrl ?? input.pr;
  if (!prUrl) {
    throw new Error("GitHub PR URL is required.");
  }
  return prUrl;
}

function reviewEndpoint(prUrl: string): string {
  const ref = parseGitHubPullRequestRef(prUrl);
  if (!ref) {
    throw new Error(`GitHub PR URL is required: ${prUrl}`);
  }
  return `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`;
}

function commentEndpoint(prUrl: string, commentId: string | number): string {
  const ref = parseGitHubPullRequestRef(prUrl);
  if (!ref) {
    throw new Error(`GitHub PR URL is required: ${prUrl}`);
  }
  return `repos/${ref.owner}/${ref.repo}/pulls/comments/${requirePositiveId(commentId)}`;
}

function requirePositiveId(commentId: string | number): string {
  if (typeof commentId === "number") {
    if (!Number.isSafeInteger(commentId) || commentId <= 0) {
      throw new Error("Review comment ID must be a positive integer.");
    }
    return String(commentId);
  }
  const normalized = commentId.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error("Review comment ID must be a positive integer.");
  }
  return normalized;
}

function normalizeReviewComments(
  comments: readonly PullRequestReviewCommentInput[]
): PullRequestReviewCommentInput[] {
  return comments.map((comment) => {
    const path = comment.path.trim();
    const body = comment.body.trim();
    if (!path) {
      throw new Error("Review comment path must be non-empty.");
    }
    if (!Number.isSafeInteger(comment.line) || comment.line <= 0) {
      throw new Error("Review comment line must be a positive integer.");
    }
    if (!body) {
      throw new Error("Review comment body must be non-empty.");
    }
    return { path, line: comment.line, body };
  });
}

function submissionFromResponse(response: Record<string, unknown>): PullRequestReviewSubmission {
  return {
    id: typeof response.id === "number" ? response.id : null,
    url: typeof response.html_url === "string" ? response.html_url : null
  };
}

export function submitPullRequestReview(
  input: {
    decision: PullRequestReviewDecision;
    summary: string;
    comments?: readonly PullRequestReviewCommentInput[];
  } & PullRequestTarget &
    GitHubCliOptions
): PullRequestReviewSubmission {
  const prUrl = inputPullRequestUrl(input);
  if (!REVIEW_DECISIONS.has(input.decision)) {
    throw new Error(`Invalid pull request review decision: ${input.decision}`);
  }
  const comments = normalizeReviewComments(input.comments ?? []);
  const response = ghApiJson(
    prUrl,
    ["--method", "POST", reviewEndpoint(prUrl)],
    {
      body: input.summary,
      event: input.decision,
      comments: comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: "RIGHT",
        body: comment.body
      }))
    },
    input
  );
  return submissionFromResponse(response);
}

export function editPullRequestReviewComment(
  input: {
    commentId: string | number;
    body: string;
  } & PullRequestTarget &
    GitHubCliOptions
): PullRequestReviewSubmission {
  const prUrl = inputPullRequestUrl(input);
  const body = input.body.trim();
  if (!body) {
    throw new Error("Review comment body must be non-empty.");
  }
  const response = ghApiJson(
    prUrl,
    ["--method", "PATCH", commentEndpoint(prUrl, input.commentId)],
    { body },
    input
  );
  return submissionFromResponse(response);
}

export function deletePullRequestReviewComment(
  input: {
    commentId: string | number;
  } & PullRequestTarget &
    GitHubCliOptions
): void {
  const prUrl = inputPullRequestUrl(input);
  ghApiJson(
    prUrl,
    ["--method", "DELETE", commentEndpoint(prUrl, input.commentId)],
    undefined,
    input
  );
}
