import { type GitHubCliOptions, ghApiPaginatedJsonArray, ghPrDiff, ghPrView } from "./gh.js";
import { parseGitHubPullRequestRef } from "./pr-url.js";

export const DEFAULT_PULL_REQUEST_METADATA_FIELDS = [
  "number",
  "url",
  "title",
  "body",
  "headRefName",
  "baseRefName",
  "state",
  "author",
  "labels"
] as const;

export const DEFAULT_PULL_REQUEST_COMMENT_FIELDS = ["url", "comments"] as const;

export const DEFAULT_PULL_REQUEST_REVIEW_FIELDS = [
  "url",
  "reviews",
  "latestReviews",
  "reviewThreads"
] as const;

export const DEFAULT_PULL_REQUEST_REVIEW_ACTIVITY_FIELDS = [
  "url",
  "comments",
  "reviews",
  "latestReviews",
  "reviewThreads"
] as const;

export const DEFAULT_PR_FIELDS = [
  ...DEFAULT_PULL_REQUEST_METADATA_FIELDS,
  "comments",
  "reviews",
  "latestReviews",
  "reviewThreads"
] as const;

function reviewCommentsEndpoint(prUrl: string): string {
  const ref = parseGitHubPullRequestRef(prUrl);
  if (!ref) {
    throw new Error(`GitHub PR URL is required: ${prUrl}`);
  }
  return `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments?per_page=100`;
}

export function fetchPullRequestMetadata(
  prUrl: string,
  options: GitHubCliOptions & { fields?: readonly string[] } = {}
): Record<string, unknown> {
  return ghPrView(prUrl, options.fields ?? DEFAULT_PULL_REQUEST_METADATA_FIELDS, options);
}

export function fetchPullRequestDetails(
  prUrl: string,
  fields: readonly string[] = DEFAULT_PR_FIELDS,
  options: GitHubCliOptions = {}
): Record<string, unknown> {
  return ghPrView(prUrl, fields, options);
}

export function fetchPullRequestDiff(prUrl: string, options: GitHubCliOptions = {}): string {
  return ghPrDiff(prUrl, options);
}

export function fetchPullRequestComments(
  prUrl: string,
  options: GitHubCliOptions = {}
): Record<string, unknown> {
  return ghPrView(prUrl, DEFAULT_PULL_REQUEST_COMMENT_FIELDS, options);
}

export function fetchPullRequestReviews(
  prUrl: string,
  options: GitHubCliOptions = {}
): Record<string, unknown> {
  return ghPrView(prUrl, DEFAULT_PULL_REQUEST_REVIEW_FIELDS, options);
}

export function fetchPullRequestReviewComments(
  prUrl: string,
  options: GitHubCliOptions = {}
): Record<string, unknown>[] {
  return ghApiPaginatedJsonArray(prUrl, reviewCommentsEndpoint(prUrl), options);
}

export function fetchPullRequestReviewActivity(
  prUrl: string,
  options: GitHubCliOptions = {}
): Record<string, unknown> {
  return {
    ...ghPrView(prUrl, DEFAULT_PULL_REQUEST_REVIEW_ACTIVITY_FIELDS, options),
    reviewComments: fetchPullRequestReviewComments(prUrl, options)
  };
}
