import {
  canonicalPullRequestUrl,
  fetchPullRequestDetails,
  fetchPullRequestDiff,
  fetchPullRequestReviewActivity
} from "github-review";
import { type SpawnResult, spawn } from "@poe-code/agent-spawn";
import { S, defineCommand, defineGroup } from "toolcraft";
import { runMCP } from "toolcraft/mcp";
import { discoverCodeReviewProfiles, loadCodeReviewRolePrompt } from "./assets.js";
import { requireSafeDocumentSegment } from "./document-schemas.js";
import type {
  CodeReviewDecision,
  CodeReviewDraft,
  CodeReviewInlineComment
} from "./review-state.js";
import { shouldUseTextStdinForCodeReview } from "./prompt-transport.js";
import { CodeReviewYamlStore, resolveCodeReviewStoreDirectory } from "./review-store.js";
import { parseCodeReviewProfileDirectories } from "./config-scope.js";
import { buildCodeReviewReviewerPrompt } from "./prompt-builders.js";

export const CODE_REVIEW_AGENT_MCP_ROLES = ["agent", "orchestrator", "subagent"] as const;

export type CodeReviewAgentMcpRole = (typeof CODE_REVIEW_AGENT_MCP_ROLES)[number];

export interface CodeReviewAgentMcpContext {
  role: CodeReviewAgentMcpRole;
  session: string;
  actor: string;
  cwd: string;
  draftStore?: string;
  agent: string;
  profiles?: string[];
  profileDirectories?: string[];
}

export interface CodeReviewAgentMcpConfig {
  transport: "stdio";
  command: string;
  args: string[];
}

export interface CodeReviewAgentMcpDependencies {
  store?: CodeReviewYamlStore;
  now?: () => Date;
  fetchPr?: typeof fetchPullRequestDetails;
  fetchDiff?: typeof fetchPullRequestDiff;
  fetchComments?: typeof fetchPullRequestReviewActivity;
  spawnAgent?: (
    agent: string,
    prompt: string,
    options: {
      cwd: string;
      mcpServers: Record<string, { command: string; args: string[] }>;
    }
  ) => Promise<SpawnResult>;
}

const inlineCommentSchema = S.Object({
  path: S.String({ description: "Repository-relative path in the PR diff." }),
  line: S.Number({
    description: "Right-side line number in the PR diff.",
    jsonType: "integer",
    minimum: 1
  }),
  body: S.String({ description: "Inline review comment body." })
});
const inlineCommentIndexSchema = S.Number({
  description: "Zero-based merged review inline comment index.",
  jsonType: "integer",
  minimum: 0
});

const prParam = S.String({ description: "GitHub pull request URL." });
export function parseCodeReviewAgentMcpArgs(argv: string[]): CodeReviewAgentMcpContext {
  const values = new Map<string, string>();
  const supportedFlags = new Set([
    "--role",
    "--session",
    "--actor",
    "--cwd",
    "--draft-store",
    "--agent",
    "--profiles",
    "--profile-directories"
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !supportedFlags.has(flag)) {
      throw new Error(`Unknown code-review agent MCP arg: ${flag}`);
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    if (values.has(flag)) {
      throw new Error(`${flag} may only be specified once`);
    }
    values.set(flag, value);
  }
  const role = requiredValue(values, "--role");
  if (!CODE_REVIEW_AGENT_MCP_ROLES.includes(role as CodeReviewAgentMcpRole)) {
    throw new Error(`Invalid code-review MCP role: ${role}`);
  }
  const profiles = values.get("--profiles")?.split(",");
  const profileDirectories = values.has("--profile-directories")
    ? parseCodeReviewProfileDirectories(JSON.parse(requiredValue(values, "--profile-directories")))
    : undefined;
  if (values.has("--profiles") && profiles?.length === 0) {
    throw new Error("--profiles requires at least one profile");
  }
  return {
    role: role as CodeReviewAgentMcpRole,
    session: requireSafeDocumentSegment(requiredValue(values, "--session"), "--session"),
    actor: requireSafeDocumentSegment(requiredValue(values, "--actor"), "--actor"),
    cwd: requiredValue(values, "--cwd"),
    ...(values.has("--draft-store") ? { draftStore: requiredValue(values, "--draft-store") } : {}),
    agent: requiredValue(values, "--agent"),
    ...(profileDirectories ? { profileDirectories } : {}),
    ...(profiles && profiles.length > 0
      ? {
          profiles: [
            ...new Set(profiles.map((profile) => requireSafeDocumentSegment(profile, "--profiles")))
          ]
        }
      : {})
  };
}

export function createCodeReviewAgentMcpConfig(
  context: CodeReviewAgentMcpContext
): CodeReviewAgentMcpConfig {
  const args = [
    "agent-mcp",
    "--role",
    context.role,
    "--session",
    context.session,
    "--actor",
    context.actor,
    "--cwd",
    context.cwd,
    ...(context.draftStore ? ["--draft-store", context.draftStore] : []),
    "--agent",
    context.agent
  ];
  if (context.profiles?.length) {
    args.push("--profiles", context.profiles.join(","));
  }
  if (context.profileDirectories?.length) {
    args.push("--profile-directories", JSON.stringify(context.profileDirectories));
  }
  return { transport: "stdio", command: "poe-code", args: ["code-review", ...args] };
}

export function createCodeReviewAgentMcpGroup(
  context: CodeReviewAgentMcpContext,
  dependencies: CodeReviewAgentMcpDependencies = {}
) {
  const store =
    dependencies.store ??
    new CodeReviewYamlStore({
      directory: resolveCodeReviewStoreDirectory(context.cwd, context.draftStore)
    });
  const fetchPr = dependencies.fetchPr ?? fetchPullRequestDetails;
  const fetchDiff = dependencies.fetchDiff ?? fetchPullRequestDiff;
  const fetchComments = dependencies.fetchComments ?? fetchPullRequestReviewActivity;
  const now = dependencies.now ?? (() => new Date());

  const prViewCommand = defineCommand({
    name: "code_review_pr_view",
    description: "Fetch GitHub pull request metadata and review activity.",
    scope: ["mcp"],
    params: S.Object({ pr: prParam }),
    handler: async ({ params }) => fetchPr(params.pr, undefined, { cwd: context.cwd })
  });
  const prDiffCommand = defineCommand({
    name: "code_review_pr_diff",
    description: "Fetch the pull request unified diff.",
    scope: ["mcp"],
    params: S.Object({ pr: prParam }),
    handler: async ({ params }) => fetchDiff(params.pr, { cwd: context.cwd })
  });
  const prCommentsCommand = defineCommand({
    name: "code_review_pr_comments",
    description: "Fetch pull request discussion and review comments.",
    scope: ["mcp"],
    params: S.Object({ pr: prParam }),
    handler: async ({ params }) => fetchComments(params.pr, { cwd: context.cwd })
  });
  const createDraftCommand = defineCommand({
    name: "code_review_create_draft",
    description: "Save a draft review without publishing anything to GitHub.",
    scope: ["mcp"],
    params: S.Object({
      pr: prParam,
      body: S.String({ description: "Draft review summary body." }),
      decision: S.Optional(
        S.Enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const, {
          description: "Optional proposed review decision."
        })
      ),
      comments: S.Optional(S.Array(inlineCommentSchema))
    }),
    handler: async ({ params }) => {
      const pr = canonicalPullRequestUrl(params.pr);
      const draft = validateDraft(params);
      const currentState =
        context.role === "orchestrator"
          ? await ensureState(store, context, pr)
          : await requireState(store, context, pr);
      if (context.role === "orchestrator") {
        const unfinishedProfiles = Object.values(currentState.subagents)
          .filter(({ status }) => status === "pending" || status === "running")
          .map(({ profile }) => profile);
        if (unfinishedProfiles.length > 0) {
          throw new Error(
            `Cannot create merged review while subagents are unfinished: ${unfinishedProfiles.join(", ")}.`
          );
        }
        const state = await store.setMergedReview(pr, draft);
        await store.appendOrchestratorAction(pr, {
          action: "created_merged_review",
          details: draft.decision
        });
        return {
          ok: true,
          dry_run: true,
          actor: context.actor,
          draft: state.mergedReview
        };
      }
      const state = await store.addRawReview(pr, context.actor, draft);
      return {
        ok: true,
        dry_run: true,
        actor: context.actor,
        draft: state.rawReviews[context.actor]
      };
    }
  });

  const sharedTools = [prViewCommand, prDiffCommand, prCommentsCommand, createDraftCommand];
  if (context.role !== "orchestrator") {
    return defineGroup({
      name: "code_review_agent",
      description: "Role-filtered tools for code review agents.",
      children: sharedTools
    });
  }

  const profileListCommand = defineCommand({
    name: "code_review_profile_list",
    description: "List reviewer profiles permitted for this run.",
    scope: ["mcp"],
    params: S.Object({}),
    handler: async () =>
      discoverCodeReviewProfiles({
        cwd: context.cwd,
        filters: context.profiles,
        profileDirectories: context.profileDirectories
      })
  });
  const agentSpawnCommand = defineCommand({
    name: "code_review_agent_spawn",
    description: "Spawn one review subagent with draft-only MCP access.",
    scope: ["mcp"],
    params: S.Object({
      pr: prParam,
      profile: S.String({ description: "Reviewer profile name." }),
      agent: S.Optional(S.String({ description: "Optional agent override for this reviewer." }))
    }),
    handler: async ({ params }) => {
      const pr = canonicalPullRequestUrl(params.pr);
      const profiles = await discoverCodeReviewProfiles({
        cwd: context.cwd,
        filters: context.profiles,
        profileDirectories: context.profileDirectories
      });
      const profile = profiles.find((candidate) => candidate.name === params.profile);
      if (!profile) {
        throw new Error(`Code review profile is unavailable: ${params.profile}`);
      }
      const existingState = await ensureState(store, context, pr);
      const overrideAgent = params.agent?.trim();
      if (params.agent !== undefined && !overrideAgent) {
        throw new Error("agent must be a non-empty string when specified.");
      }
      const agent = overrideAgent ?? context.agent;
      if (existingState.rawReviews[profile.name]) {
        await store.updateSubagent(pr, profile.name, {
          profile: profile.name,
          agent,
          status: "completed",
          completedAt: now().toISOString()
        });
        await store.appendOrchestratorAction(pr, {
          action: "reused_raw_review",
          profile: profile.name
        });
        return {
          actor: profile.name,
          agent,
          status: "completed",
          reused: true
        };
      }
      if (
        existingState.subagents[profile.name]?.status === "pending" ||
        existingState.subagents[profile.name]?.status === "running"
      ) {
        throw new Error(`Code review profile was already spawned in this session: ${profile.name}`);
      }
      const pendingStatus = {
        profile: profile.name,
        agent,
        status: "pending" as const,
        startedAt: now().toISOString()
      };
      if (existingState.subagents[profile.name]) {
        await store.updateSubagent(pr, profile.name, pendingStatus);
      } else {
        await store.addSubagent(pr, profile.name, pendingStatus);
      }
      const childConfig = createCodeReviewAgentMcpConfig({
        ...context,
        role: "subagent",
        actor: profile.name,
        agent,
        profiles: [profile.name]
      });
      void (async () => {
        try {
          await store.appendOrchestratorAction(pr, {
            action: "spawned_subagent",
            profile: profile.name,
            details: agent
          });
          const prDetails = await fetchPr(pr, undefined, { cwd: context.cwd });
          const prompt = buildCodeReviewReviewerPrompt({
            template: await loadCodeReviewRolePrompt({
              cwd: context.cwd,
              role: "subagent"
            }),
            profile: profile.content,
            prUrl: pr,
            prDetails
          });
          await store.updateSubagent(pr, profile.name, {
            profile: profile.name,
            agent,
            status: "running",
            startedAt: now().toISOString()
          });
          const result = await (dependencies.spawnAgent ?? spawnWithPoeCode)(agent, prompt, {
            cwd: context.cwd,
            mcpServers: {
              "code-review": {
                command: childConfig.command,
                args: childConfig.args
              }
            }
          });
          const completedState = await store.read(pr);
          const missingRawReview =
            result.exitCode === 0 && !completedState?.rawReviews[profile.name];
          await store.updateSubagent(pr, profile.name, {
            profile: profile.name,
            agent,
            status: result.exitCode === 0 && !missingRawReview ? "completed" : "failed",
            completedAt: now().toISOString(),
            ...(missingRawReview
              ? { error: "Reviewer completed without writing a raw review." }
              : result.exitCode === 0
                ? {}
                : { error: result.stderr || `exit ${result.exitCode}` })
          });
        } catch (error) {
          await store.updateSubagent(pr, profile.name, {
            profile: profile.name,
            agent,
            status: "failed",
            completedAt: now().toISOString(),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })();
      return { actor: profile.name, agent, status: "pending" };
    }
  });
  const agentStatusCommand = defineCommand({
    name: "code_review_agent_status",
    description: "Read current subagent status for a pull request.",
    scope: ["mcp"],
    params: S.Object({ pr: prParam }),
    handler: async ({ params }) => (await requireState(store, context, params.pr)).subagents
  });
  const listDraftsCommand = defineCommand({
    name: "code_review_list_drafts",
    description: "Read draft reviews stored for a pull request.",
    scope: ["mcp"],
    params: S.Object({ pr: prParam }),
    handler: async ({ params }) => {
      const state = await requireState(store, context, params.pr);
      return {
        raw_reviews: state.rawReviews,
        merged_review: state.mergedReview ?? null
      };
    }
  });
  const editInlineCommentCommand = defineCommand({
    name: "code_review_edit_inline_comment",
    description: "Replace one inline comment in the merged review draft.",
    scope: ["mcp"],
    params: S.Object({
      pr: prParam,
      index: inlineCommentIndexSchema,
      path: S.String({ description: "Repository-relative path in the PR diff." }),
      line: S.Number({
        description: "Right-side line number in the PR diff.",
        jsonType: "integer",
        minimum: 1
      }),
      body: S.String({ description: "Inline review comment body." })
    }),
    handler: async ({ params }) => {
      const pr = canonicalPullRequestUrl(params.pr);
      await requireState(store, context, pr);
      const state = await store.editMergedInlineComment(pr, params.index, {
        path: params.path,
        line: params.line,
        body: params.body
      });
      await store.appendOrchestratorAction(pr, {
        action: "edited_inline_comment",
        details: String(params.index)
      });
      return { ok: true, dry_run: true, merged_review: state.mergedReview };
    }
  });
  const deleteInlineCommentCommand = defineCommand({
    name: "code_review_delete_inline_comment",
    description: "Delete one inline comment from the merged review draft.",
    scope: ["mcp"],
    params: S.Object({ pr: prParam, index: inlineCommentIndexSchema }),
    handler: async ({ params }) => {
      const pr = canonicalPullRequestUrl(params.pr);
      await requireState(store, context, pr);
      const state = await store.deleteMergedInlineComment(pr, params.index);
      await store.appendOrchestratorAction(pr, {
        action: "deleted_inline_comment",
        details: String(params.index)
      });
      return { ok: true, dry_run: true, merged_review: state.mergedReview };
    }
  });
  const discardDraftCommand = defineCommand({
    name: "code_review_discard_draft",
    description: "Discard the merged review draft without changing raw reviews.",
    scope: ["mcp"],
    params: S.Object({ pr: prParam }),
    handler: async ({ params }) => {
      const pr = canonicalPullRequestUrl(params.pr);
      await requireState(store, context, pr);
      await store.discardMergedReview(pr);
      await store.appendOrchestratorAction(pr, { action: "discarded_merged_review" });
      return { ok: true, dry_run: true, merged_review: null };
    }
  });
  const commitDraftsCommand = defineCommand({
    name: "code_review_commit_drafts",
    description: "Preview publishing stored drafts; MCP never publishes to GitHub.",
    scope: ["mcp"],
    params: S.Object({ pr: prParam }),
    handler: async ({ params }) => {
      const state = await requireState(store, context, params.pr);
      return {
        ok: true,
        dry_run: true,
        would_publish: state.mergedReview ?? Object.values(state.rawReviews)
      };
    }
  });
  return defineGroup({
    name: "code_review_agent",
    description: "Role-filtered tools for code review agents.",
    children: [
      ...sharedTools,
      profileListCommand,
      agentSpawnCommand,
      agentStatusCommand,
      listDraftsCommand,
      editInlineCommentCommand,
      deleteInlineCommentCommand,
      discardDraftCommand,
      commitDraftsCommand
    ]
  });
}

export async function runCodeReviewAgentMcp(context: CodeReviewAgentMcpContext): Promise<void> {
  await runMCP(createCodeReviewAgentMcpGroup(context), {
    name: "code-review-agent-mcp",
    version: "0.1.0",
    omitRootToolNamePrefix: true
  });
}

async function spawnWithPoeCode(
  agent: string,
  prompt: string,
  options: {
    cwd: string;
    mcpServers: Record<string, { command: string; args: string[] }>;
  }
): Promise<SpawnResult> {
  return spawn(agent, {
    prompt,
    ...options,
    ...(shouldUseTextStdinForCodeReview(agent) ? { useStdin: true } : {})
  });
}

async function ensureState(
  store: CodeReviewYamlStore,
  context: CodeReviewAgentMcpContext,
  pr: string
) {
  const state = await store.read(pr);
  if (state) {
    if (state.sessionId !== context.session) {
      throw new Error("Draft belongs to a different code-review session.");
    }
    return state;
  }
  return store.create({
    prUrl: pr,
    sessionId: context.session,
    selectedAgent: context.agent,
    selectedProfiles: context.profiles ?? []
  });
}

async function requireState(
  store: CodeReviewYamlStore,
  context: CodeReviewAgentMcpContext,
  pr: string
) {
  const state = await store.read(pr);
  if (!state) {
    throw new Error(`No draft review exists for pull request: ${pr}`);
  }
  if (state.sessionId !== context.session) {
    throw new Error("Draft belongs to a different code-review session.");
  }
  return state;
}

function validateDraft(input: {
  body: string;
  decision?: CodeReviewDecision;
  comments?: CodeReviewInlineComment[];
}): CodeReviewDraft {
  const body = requireText(input.body, "body");
  const comments = (input.comments ?? []).map((comment) => ({
    path: requireText(comment.path, "comments.path"),
    line: requirePositiveInteger(comment.line, "comments.line"),
    body: requireText(comment.body, "comments.body")
  }));
  return {
    body,
    comments,
    ...(input.decision ? { decision: input.decision } : {})
  };
}

function requiredValue(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined || value.length === 0) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be non-empty.`);
  }
  return normalized;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}
