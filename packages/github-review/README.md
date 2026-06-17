# `github-review`

Reusable SDK for GitHub pull request and review mechanics backed exclusively by the GitHub CLI (`gh`). It provides the GitHub transport and validation layer for code-review workflows, and intentionally contains no agent, profile, session, draft-store, or orchestration behavior.

## GitHub CLI authentication

Every live operation shells out to `gh`; authenticate the GitHub CLI before calling the SDK:

```sh
gh auth login
gh auth status
```

For non-interactive CI, provide a token for `gh`, for example `GH_TOKEN`, with access to the repository and the review operations being performed. The SDK does not parse token environment variables itself: authentication remains the responsibility of `gh` and its configured environment.

## Exports

- `parseGitHubPullRequestRef(prUrl)` and `canonicalPullRequestUrl(prUrl)` parse pull request URLs.
- `filesystemSafeNamePart(value)` normalizes GitHub-derived names for local artifact paths.
- `defaultCommandRunner`, `ghPrView`, `ghPrDiff`, `ghApiJson`, and `ghApiPaginatedJsonArray` are the injectable `gh` execution primitives.
- `fetchPullRequestMetadata`, `fetchPullRequestDetails`, `fetchPullRequestDiff`, `fetchPullRequestComments`, and `fetchPullRequestReviews` read pull request data through `gh pr view` and `gh pr diff`.
- `fetchPullRequestReviewComments` reads inline review comments through paginated `gh api`; `fetchPullRequestReviewActivity` combines these with conversation comments, submitted reviews, and review-thread data when supported by the installed `gh` version.
- `fetchReviewHistory({ username, repos, since, maxComments, onRateLimit })` asynchronously yields normalized authored inline comments, submitted review bodies, and pull request conversation comments for profile ingest.
- `parseReviewDiff(diff)` exposes right-side `reviewableLines` and `validateInlineComments(comments, context)` rejects invalid inline targets.
- `submitPullRequestReview`, `editPullRequestReviewComment`, and `deletePullRequestReviewComment` write live GitHub review data through `gh api`.
- `GitHubRateLimitError` and `parseGitHubApiResponse` support rate-aware callers handling GitHub API responses.

## Environment and configuration

The SDK reads no environment variables and no configuration files of its own. Repository access, authentication, and rate-limit policy are determined by the `gh` CLI environment provided by the host process.

## Testing and embedding

All functions that invoke `gh` accept a `runner` option, enabling tests and hosts to inject command execution without invoking a real CLI:

```ts
import { fetchPullRequestMetadata, type CommandRunner } from "github-review";

const runner: CommandRunner = (_command, _args) => ({
  code: 0,
  stdout: JSON.stringify({ number: 123, title: "Review me" }),
  stderr: ""
});

const pullRequest = fetchPullRequestMetadata("https://github.com/acme/widgets/pull/123", {
  runner
});
```

Review-history ingest uses `gh api --include` to parse GitHub pagination and rate-limit headers. When remaining API requests fall to ten or fewer, it calls `onRateLimit` when provided and throws `GitHubRateLimitError` with a resumable endpoint and partial-result count so callers can stop and resume cleanly.

## Validation

- PR references are normalized to canonical GitHub PR URLs before `gh` commands run.
- Inline comments are validated against parsed reviewable lines; ambiguous deleted-line targets require an explicit right-side selection.
- Valid whitespace in diff paths is preserved when comments are submitted or edited.
- Review-history ingest deduplicates repositories case-insensitively and rejects malformed GitHub timestamps.
- Review comment bodies are normalized and validated before submission or edit API calls.
