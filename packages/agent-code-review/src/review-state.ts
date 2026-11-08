import { canonicalPullRequestUrl, parseGitHubPullRequestRef } from "github-review";
import { parse as load, stringify } from "yaml";

export interface CodeReviewInlineComment {
  path: string;
  line: number;
  body: string;
}

export interface CodeReviewDraft {
  body: string;
  comments: CodeReviewInlineComment[];
  decision?: CodeReviewDecision;
}

export type CodeReviewDecision = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface CodeReviewPrRef {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export type CodeReviewReviewState = "in_progress" | "merged" | "published" | "failed";

export interface CodeReviewTimestamps {
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface CodeReviewSubagentStatus {
  profile: string;
  status: "pending" | "running" | "completed" | "failed";
  agent?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface CodeReviewOrchestratorAction {
  at: string;
  action: string;
  details?: string;
  profile?: string;
}

export interface CodeReviewPublishedReceipt {
  publishedAt: string;
  actor?: string;
  sessionId?: string;
  decision?: CodeReviewDecision;
  reviewId?: string | number;
  reviewUrl?: string;
}

export interface CodeReviewState {
  version: 1;
  sessionId: string;
  prUrl: string;
  prRef: CodeReviewPrRef;
  selectedAgent: string;
  selectedProfiles: string[];
  state: CodeReviewReviewState;
  timestamps: CodeReviewTimestamps;
  rawReviews: Record<string, CodeReviewDraft>;
  subagents: Record<string, CodeReviewSubagentStatus>;
  mergedReview?: CodeReviewDraft;
  orchestratorActions: CodeReviewOrchestratorAction[];
  published?: CodeReviewPublishedReceipt;
}

export function parseCodeReviewState(
  content: string,
  filePath = "code-review review YAML"
): CodeReviewState {
  let value: unknown;
  try {
    value = load(content) as unknown;
  } catch (error) {
    throw new Error(
      `${filePath}: invalid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  try {
    return parseCodeReviewStateValue(value);
  } catch (error) {
    throw new Error(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseCodeReviewStateValue(value: unknown): CodeReviewState {
  const state = requireMapping(value, "Code review state");
  requireOnlyFields(state, "Code review state", [
    "version",
    "session_id",
    "pr_url",
    "pr_ref",
    "selected_agent",
    "selected_profiles",
    "state",
    "timestamps",
    "raw_reviews",
    "subagents",
    "merged_review",
    "orchestrator_actions",
    "published"
  ]);
  if (state.version !== 1) throw new Error("version must equal 1.");
  if (!isSafeIdentifier(state.session_id)) throw new Error("session_id must be a safe identifier.");
  if (!isNonEmptyString(state.pr_url)) throw new Error("pr_url must be a non-empty string.");
  if (!isNonEmptyString(state.selected_agent))
    throw new Error("selected_agent must be a non-empty string.");
  if (!isReviewState(state.state)) throw new Error("state is invalid.");
  const prRef = validatePrRef(state.pr_ref);
  validatePrIdentity(state.pr_url, prRef);
  const selectedProfiles = validateStringArray(
    state.selected_profiles,
    "Code review state selected_profiles"
  );
  for (const [index, profile] of selectedProfiles.entries()) {
    if (!isSafeIdentifier(profile))
      throw new Error(`selected_profiles[${index}] must be a safe identifier.`);
  }
  const timestamps = validateTimestamps(state.timestamps);
  const rawReviews = validateDraftRecord(state.raw_reviews, "raw_reviews");
  const subagents = validateSubagents(state.subagents);
  const orchestratorActions = validateActions(state.orchestrator_actions);
  const mergedReview =
    state.merged_review === undefined
      ? undefined
      : validateDraft(state.merged_review, "Code review state merged_review");
  const published =
    state.published === undefined ? undefined : validatePublishedReceipt(state.published);
  if ((state.state === "merged" || state.state === "published") && mergedReview === undefined) {
    throw new Error("Merged code review state must include a merged review.");
  }
  if (state.state === "published" && published === undefined) {
    throw new Error("Published code review state must include a receipt.");
  }
  if (
    state.state === "published" &&
    (timestamps.publishedAt === undefined || timestamps.publishedAt !== published?.publishedAt)
  ) {
    throw new Error("Published code review state timestamps must match its receipt.");
  }
  if (
    state.state !== "published" &&
    (published !== undefined || timestamps.publishedAt !== undefined)
  ) {
    throw new Error("Unpublished code review state cannot include published metadata.");
  }
  return {
    version: 1,
    sessionId: state.session_id,
    prUrl: state.pr_url,
    prRef,
    selectedAgent: state.selected_agent,
    selectedProfiles,
    state: state.state,
    timestamps,
    rawReviews,
    subagents,
    ...(mergedReview === undefined ? {} : { mergedReview }),
    orchestratorActions,
    ...(published === undefined ? {} : { published })
  };
}

export function serializeCodeReviewState(state: CodeReviewState): string {
  const content = stringify(
    {
      version: state.version,
      session_id: state.sessionId,
      pr_url: state.prUrl,
      pr_ref: state.prRef,
      selected_agent: state.selectedAgent,
      selected_profiles: state.selectedProfiles,
      state: state.state,
      timestamps: {
        created_at: state.timestamps.createdAt,
        updated_at: state.timestamps.updatedAt,
        ...(state.timestamps.publishedAt === undefined
          ? {}
          : { published_at: state.timestamps.publishedAt })
      },
      raw_reviews: state.rawReviews,
      subagents: Object.fromEntries(
        Object.entries(state.subagents).map(([actor, subagent]) => [
          actor,
          {
            profile: subagent.profile,
            status: subagent.status,
            ...(subagent.agent === undefined ? {} : { agent: subagent.agent }),
            ...(subagent.startedAt === undefined ? {} : { started_at: subagent.startedAt }),
            ...(subagent.completedAt === undefined ? {} : { completed_at: subagent.completedAt }),
            ...(subagent.error === undefined ? {} : { error: subagent.error })
          }
        ])
      ),
      ...(state.mergedReview === undefined ? {} : { merged_review: state.mergedReview }),
      orchestrator_actions: state.orchestratorActions.map((action) => ({
        at: action.at,
        action: action.action,
        ...(action.details === undefined ? {} : { details: action.details }),
        ...(action.profile === undefined ? {} : { profile: action.profile })
      })),
      ...(state.published === undefined
        ? {}
        : {
            published: {
              published_at: state.published.publishedAt,
              ...(state.published.actor === undefined ? {} : { actor: state.published.actor }),
              ...(state.published.sessionId === undefined
                ? {}
                : { session_id: state.published.sessionId }),
              ...(state.published.decision === undefined
                ? {}
                : { decision: state.published.decision }),
              ...(state.published.reviewId === undefined
                ? {}
                : { review_id: state.published.reviewId }),
              ...(state.published.reviewUrl === undefined
                ? {}
                : { review_url: state.published.reviewUrl })
            }
          })
    },
    { aliasDuplicateObjects: false, lineWidth: 0 }
  );
  parseCodeReviewState(content);
  return content;
}

function validateDraftRecord(value: unknown, field: string): Record<string, CodeReviewDraft> {
  const reviews = requireMapping(value, `Code review state ${field}`);
  const entries: Array<[string, CodeReviewDraft]> = [];
  for (const [actor, draft] of Object.entries(reviews)) {
    if (!isSafeIdentifier(actor))
      throw new Error(`Code review state ${field}.${actor} key must be a safe identifier.`);
    entries.push([actor, validateDraft(draft, `Code review state ${field}.${actor}`)]);
  }
  return Object.fromEntries(entries) as Record<string, CodeReviewDraft>;
}

function validateSubagents(value: unknown): Record<string, CodeReviewSubagentStatus> {
  const statuses = requireMapping(value, "Code review state subagents");
  const entries: Array<[string, CodeReviewSubagentStatus]> = [];
  for (const [actor, value] of Object.entries(statuses)) {
    if (!isSafeIdentifier(actor))
      throw new Error(`Code review state subagents.${actor} key must be a safe identifier.`);
    const status = requireMapping(value, `Code review state subagents.${actor}`);
    requireOnlyFields(status, `Code review state subagents.${actor}`, [
      "profile",
      "status",
      "agent",
      "started_at",
      "completed_at",
      "error"
    ]);
    if (!isSafeIdentifier(status.profile)) {
      throw new Error(`Code review state subagents.${actor}.profile must be a safe identifier.`);
    }
    if (!isSubagentState(status.status)) {
      throw new Error(`Code review state subagents.${actor}.status is invalid.`);
    }
    if (!optionalString(status.agent)) {
      throw new Error(`Code review state subagents.${actor}.agent must be a non-empty string.`);
    }
    if (!optionalDateString(status.started_at)) {
      throw new Error(`Code review state subagents.${actor}.started_at must be a valid timestamp.`);
    }
    if (!optionalDateString(status.completed_at)) {
      throw new Error(
        `Code review state subagents.${actor}.completed_at must be a valid timestamp.`
      );
    }
    if (!optionalString(status.error)) {
      throw new Error(`Code review state subagents.${actor}.error must be a non-empty string.`);
    }
    entries.push([actor, {
      profile: status.profile,
      status: status.status,
      ...(status.agent === undefined ? {} : { agent: status.agent }),
      ...(status.started_at === undefined ? {} : { startedAt: status.started_at }),
      ...(status.completed_at === undefined ? {} : { completedAt: status.completed_at }),
      ...(status.error === undefined ? {} : { error: status.error })
    }]);
  }
  return Object.fromEntries(entries) as Record<string, CodeReviewSubagentStatus>;
}

function validateActions(value: unknown): CodeReviewOrchestratorAction[] {
  if (!Array.isArray(value)) {
    throw new Error("Code review state orchestrator_actions must be an array.");
  }
  return value.map((value, index) => {
    const field = `Code review state orchestrator_actions[${index}]`;
    const action = requireMapping(value, field);
    requireOnlyFields(action, field, ["at", "action", "details", "profile"]);
    if (!isDateString(action.at)) {
      throw new Error(`${field}.at must be a valid timestamp.`);
    }
    if (!isNonEmptyString(action.action)) {
      throw new Error(`${field}.action must be a non-empty string.`);
    }
    if (!optionalString(action.details)) {
      throw new Error(`${field}.details must be a non-empty string.`);
    }
    if (action.profile !== undefined && !isSafeIdentifier(action.profile)) {
      throw new Error(`${field}.profile must be a safe identifier.`);
    }
    return action as unknown as CodeReviewOrchestratorAction;
  });
}

function validatePrRef(value: unknown): CodeReviewPrRef {
  const ref = requireMapping(value, "Code review state pr_ref");
  requireOnlyFields(ref, "Code review state pr_ref", ["host", "owner", "repo", "number"]);
  if (!isNonEmptyString(ref.host)) {
    throw new Error("Code review state pr_ref.host must be a non-empty string.");
  }
  if (!isSafeIdentifier(ref.owner)) {
    throw new Error("Code review state pr_ref.owner must be a safe identifier.");
  }
  if (!isSafeIdentifier(ref.repo)) {
    throw new Error("Code review state pr_ref.repo must be a safe identifier.");
  }
  if (!Number.isSafeInteger(ref.number) || (ref.number as number) <= 0) {
    throw new Error("Code review state pr_ref.number must be a positive integer.");
  }
  return ref as unknown as CodeReviewPrRef;
}

function validatePrIdentity(prUrl: string, prRef: CodeReviewPrRef): void {
  const parsedRef = parseGitHubPullRequestRef(prUrl);
  if (
    parsedRef === undefined ||
    parsedRef === null ||
    canonicalPullRequestUrl(prUrl) !== prUrl ||
    parsedRef.host !== prRef.host ||
    parsedRef.owner !== prRef.owner ||
    parsedRef.repo !== prRef.repo ||
    parsedRef.number !== prRef.number
  ) {
    throw new Error("Code review state contains inconsistent PR metadata.");
  }
}

function validateTimestamps(value: unknown): CodeReviewTimestamps {
  const timestamps = requireMapping(value, "Code review state timestamps");
  requireOnlyFields(timestamps, "Code review state timestamps", [
    "created_at",
    "updated_at",
    "published_at"
  ]);
  if (!isDateString(timestamps.created_at)) {
    throw new Error("Code review state timestamps.created_at must be a valid timestamp.");
  }
  if (!isDateString(timestamps.updated_at)) {
    throw new Error("Code review state timestamps.updated_at must be a valid timestamp.");
  }
  if (!optionalDateString(timestamps.published_at)) {
    throw new Error("Code review state timestamps.published_at must be a valid timestamp.");
  }
  if (Date.parse(timestamps.updated_at as string) < Date.parse(timestamps.created_at as string)) {
    throw new Error("Code review state timestamps are out of order.");
  }
  return {
    createdAt: timestamps.created_at,
    updatedAt: timestamps.updated_at,
    ...(timestamps.published_at === undefined ? {} : { publishedAt: timestamps.published_at })
  };
}

function validatePublishedReceipt(value: unknown): CodeReviewPublishedReceipt {
  const receipt = requireMapping(value, "Code review state published");
  requireOnlyFields(receipt, "Code review state published", [
    "published_at",
    "actor",
    "session_id",
    "decision",
    "review_id",
    "review_url"
  ]);
  const reviewId = receipt.review_id;
  if (!isDateString(receipt.published_at)) {
    throw new Error("Code review state published.published_at must be a valid timestamp.");
  }
  if (receipt.actor !== undefined && !isSafeIdentifier(receipt.actor)) {
    throw new Error("Code review state published.actor must be a safe identifier.");
  }
  if (receipt.session_id !== undefined && !isSafeIdentifier(receipt.session_id)) {
    throw new Error("Code review state published.session_id must be a safe identifier.");
  }
  if (!optionalDecision(receipt.decision)) {
    throw new Error("Code review state published.decision is invalid.");
  }
  if (
    reviewId !== undefined &&
    !isNonEmptyString(reviewId) &&
    !(typeof reviewId === "number" && Number.isSafeInteger(reviewId) && reviewId > 0)
  ) {
    throw new Error("Code review state published.review_id is invalid.");
  }
  if (!optionalString(receipt.review_url)) {
    throw new Error("Code review state published.review_url must be a non-empty string.");
  }
  return {
    publishedAt: receipt.published_at,
    ...(receipt.actor === undefined ? {} : { actor: receipt.actor }),
    ...(receipt.session_id === undefined ? {} : { sessionId: receipt.session_id }),
    ...(receipt.decision === undefined ? {} : { decision: receipt.decision }),
    ...(reviewId === undefined ? {} : { reviewId }),
    ...(receipt.review_url === undefined ? {} : { reviewUrl: receipt.review_url })
  };
}

function validateDraft(value: unknown, field: string): CodeReviewDraft {
  const draft = requireMapping(value, field);
  requireOnlyFields(draft, field, ["body", "comments", "decision"]);
  if (typeof draft.body !== "string") {
    throw new Error(`${field}.body must be a string.`);
  }
  if (!Array.isArray(draft.comments)) {
    throw new Error(`${field}.comments must be an array.`);
  }
  if (!optionalDecision(draft.decision)) {
    throw new Error(`${field}.decision is invalid.`);
  }
  for (const [index, comment] of draft.comments.entries()) {
    const inlineComment = requireMapping(comment, `${field}.comments[${index}]`);
    requireOnlyFields(inlineComment, `${field}.comments[${index}]`, ["path", "line", "body"]);
    if (!isRepositoryRelativePath(inlineComment.path))
      throw new Error(`${field}.comments[${index}].path must be a repository-relative path.`);
    if (!Number.isSafeInteger(inlineComment.line) || (inlineComment.line as number) <= 0)
      throw new Error(
        `${field}.comments[${index}].line must be a positive integer (invalid inline comment).`
      );
    if (!isNonEmptyString(inlineComment.body))
      throw new Error(`${field}.comments[${index}].body must be a non-empty string.`);
  }
  return draft as unknown as CodeReviewDraft;
}

function requireMapping(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a YAML mapping.`);
  }
  return value as Record<string, unknown>;
}

function requireOnlyFields(
  value: Record<string, unknown>,
  field: string,
  allowedFields: readonly string[]
): void {
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${field}.${key} is not supported.`);
    }
  }
}

function validateStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new Error(`${field} must be an array of non-empty strings.`);
  }
  return value;
}

function isReviewState(value: unknown): value is CodeReviewReviewState {
  return ["in_progress", "merged", "published", "failed"].includes(value as string);
}

function isSubagentState(value: unknown): value is CodeReviewSubagentStatus["status"] {
  return ["pending", "running", "completed", "failed"].includes(value as string);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function optionalDecision(value: unknown): value is CodeReviewDecision | undefined {
  return value === undefined || ["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(value as string);
}

function optionalDateString(value: unknown): value is string | undefined {
  return value === undefined || isDateString(value);
}

function isDateString(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRepositoryRelativePath(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value.trim() === value &&
    !value.startsWith("/") &&
    !value.includes("\0") &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value.trim() === value &&
    value.normalize("NFKC") === value &&
    /^[A-Za-z0-9._-]+$/.test(value) &&
    !value.startsWith(".") &&
    value !== "." &&
    value !== ".."
  );
}
