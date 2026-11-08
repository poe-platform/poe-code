import { resolve } from "node:path";
import {
  type PullRequestReviewCommentInput,
  type PullRequestReviewDecision,
  fetchPullRequestDiff,
  parseReviewDiff,
  submitPullRequestReview,
  validateInlineComments
} from "github-review";
import { requireSafeDocumentSegment } from "./document-schemas.js";
import type { CodeReviewState } from "./review-state.js";
import { CodeReviewYamlStore, resolveCodeReviewStoreDirectory } from "./review-store.js";

export interface CodeReviewPublicationPayload {
  body: string;
  event: PullRequestReviewDecision;
  comments: Array<PullRequestReviewCommentInput & { side: "RIGHT" }>;
}

export interface CommitCodeReviewDraftsInput {
  prUrl: string;
  cwd?: string;
  draftStore?: string;
  dryRun?: boolean;
  actor?: string;
}

export interface CodeReviewCommitResult {
  payload: CodeReviewPublicationPayload;
  published: NonNullable<CodeReviewState["published"]>;
  archivePath: string;
}

export interface CommitCodeReviewDraftsDependencies {
  store?: CodeReviewYamlStore;
  fetchDiff?: typeof fetchPullRequestDiff;
  submitReview?: typeof submitPullRequestReview;
}

export async function commitCodeReviewDrafts(
  input: CommitCodeReviewDraftsInput & { dryRun: true },
  dependencies?: CommitCodeReviewDraftsDependencies
): Promise<CodeReviewPublicationPayload>;
export async function commitCodeReviewDrafts(
  input: CommitCodeReviewDraftsInput,
  dependencies?: CommitCodeReviewDraftsDependencies
): Promise<CodeReviewCommitResult | CodeReviewPublicationPayload>;
export async function commitCodeReviewDrafts(
  input: CommitCodeReviewDraftsInput,
  dependencies: CommitCodeReviewDraftsDependencies = {}
): Promise<CodeReviewCommitResult | CodeReviewPublicationPayload> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const store =
    dependencies.store ?? new CodeReviewYamlStore({ directory: resolveDraftStore(input, cwd) });
  if (!input.dryRun) {
    const recovered = await store.resumePublished(input.prUrl);
    if (recovered?.state.mergedReview && recovered.state.published) {
      return {
        payload: payloadFromPublishedState(recovered.state),
        published: recovered.state.published,
        archivePath: recovered.archivePath
      };
    }
  }
  const state = await store.read(input.prUrl);
  if (!state) {
    throw new Error(`Code review not found for pull request: ${input.prUrl}`);
  }
  if (!state.mergedReview) {
    throw new Error("Cannot publish code review: YAML state has no merged_review.");
  }
  const decision = requireDecision(state.mergedReview.decision);
  const diff = await (dependencies.fetchDiff ?? fetchPullRequestDiff)(state.prUrl, { cwd });
  let comments: PullRequestReviewCommentInput[];
  try {
    comments = validateInlineComments(state.mergedReview.comments, parseReviewDiff(diff));
  } catch (error) {
    throw new Error(
      `Cannot publish code review: merged_review comments are invalid for the current PR diff: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const payload: CodeReviewPublicationPayload = {
    body: state.mergedReview.body,
    event: decision,
    comments: comments.map((comment) => ({ ...comment, side: "RIGHT" }))
  };
  if (input.dryRun) {
    return payload;
  }
  const committed = await store.publish(state.prUrl, async (activeState) => {
    if (activeState.timestamps.updatedAt !== state.timestamps.updatedAt) {
      throw new Error(
        "Cannot publish code review: YAML state changed while preparing publication."
      );
    }
    const submission = (dependencies.submitReview ?? submitPullRequestReview)({
      prUrl: activeState.prUrl,
      decision,
      summary: payload.body,
      comments,
      cwd
    });
    if (submission.id === null || submission.url === null) {
      throw new Error(
        "Cannot archive published code review: GitHub review response is missing its id or url."
      );
    }
    return {
      receipt: {
        actor: requireActor(input.actor),
        sessionId: activeState.sessionId,
        decision,
        reviewId: submission.id,
        reviewUrl: submission.url
      },
      result: undefined
    };
  });
  return {
    payload,
    published: committed.state.published as NonNullable<CodeReviewState["published"]>,
    archivePath: committed.archivePath
  };
}

function payloadFromPublishedState(state: CodeReviewState): CodeReviewPublicationPayload {
  const review = state.mergedReview as NonNullable<CodeReviewState["mergedReview"]>;
  return {
    body: review.body,
    event: requireDecision(review.decision),
    comments: review.comments.map((comment) => ({ ...comment, side: "RIGHT" }))
  };
}

function resolveDraftStore(input: CommitCodeReviewDraftsInput, cwd: string): string {
  return resolveCodeReviewStoreDirectory(cwd, input.draftStore);
}

function requireActor(actor: string | undefined): string {
  return requireSafeDocumentSegment(actor ?? "cli", "Code review actor");
}

function requireDecision(decision: string | undefined): PullRequestReviewDecision {
  if (decision === undefined) {
    return "COMMENT";
  }
  if (["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(decision)) {
    return decision as PullRequestReviewDecision;
  }
  throw new Error(`Cannot publish code review: invalid merged_review decision: ${decision}`);
}
