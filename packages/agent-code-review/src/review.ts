import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  canonicalPullRequestUrl,
  fetchPullRequestDetails,
  fetchPullRequestDiff,
  fetchPullRequestReviewActivity
} from "github-review";
import { type SpawnOptions, type SpawnResult, spawn } from "@poe-code/agent-spawn";
import {
  CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT,
  discoverCodeReviewProfiles,
  loadCodeReviewProfile,
  loadCodeReviewPrompt,
  loadCodeReviewRolePrompt
} from "./assets.js";
import {
  type CodeReviewRunInput,
  type CodeReviewRunOptions,
  loadDefaultPoeCodeAgent,
  resolveCodeReviewRuntimeOptions
} from "./config.js";
import { createCodeReviewAgentMcpConfig } from "./mcp.js";
import { shouldUseTextStdinForCodeReview } from "./prompt-transport.js";
import type { CodeReviewState } from "./review-state.js";
import { CodeReviewYamlStore, resolveCodeReviewStoreDirectory } from "./review-store.js";

export interface CodeReviewOrchestrationInput extends CodeReviewRunInput {
  prompt?: string;
  profile?: string;
}

export interface CodeReviewOrchestrationDependencies {
  resolveOptions?: (
    input: CodeReviewRunInput
  ) => CodeReviewRunOptions | Promise<CodeReviewRunOptions>;
  fetchPr?: (
    prUrl: string,
    cwd?: string
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  fetchDiff?: (prUrl: string, cwd?: string) => string | Promise<string>;
  fetchComments?: (
    prUrl: string,
    cwd?: string
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  resolveAgent?: () => string | undefined | Promise<string | undefined>;
  createSessionId?: () => string;
  store?: CodeReviewYamlStore;
  spawnAgent?: (
    agent: string,
    prompt: string,
    options: Omit<SpawnOptions, "prompt">
  ) => Promise<SpawnResult>;
}

export interface CodeReviewResult {
  sessionId: string;
  state: CodeReviewState;
  prompt: string;
  spawnResult: SpawnResult;
}

export async function runCodeReview(
  input: CodeReviewOrchestrationInput,
  dependencies: CodeReviewOrchestrationDependencies = {}
): Promise<CodeReviewResult> {
  const unresolvedOptions = await (dependencies.resolveOptions ?? resolveCodeReviewRuntimeOptions)(
    input
  );
  const options = {
    ...unresolvedOptions,
    cwd: resolve(unresolvedOptions.cwd),
    prUrl: canonicalPullRequestUrl(unresolvedOptions.prUrl)
  };
  const agent =
    options.agent ??
    (await (dependencies.resolveAgent
      ? dependencies.resolveAgent()
      : loadDefaultPoeCodeAgent({ cwd: options.cwd })));
  if (!agent?.trim()) {
    throw new Error(
      "No code-review agent resolved; configure codeReview.agent or the normal poe-code core.defaultAgent / POE_DEFAULT_AGENT setting."
    );
  }
  const profiles = await discoverCodeReviewProfiles({
    cwd: options.cwd,
    filters: options.profiles
  });
  const [profile, promptTemplate, prDetails, diff, priorActivity] = await Promise.all([
    resolveProfile(input, options, profiles),
    resolvePrompt(input, options),
    (dependencies.fetchPr ?? fetchPrWithCwd)(options.prUrl, options.cwd),
    (dependencies.fetchDiff ?? fetchDiffWithCwd)(options.prUrl, options.cwd),
    (dependencies.fetchComments ?? fetchCommentsWithCwd)(options.prUrl, options.cwd)
  ]);
  const requestedSessionId = options.sessionId ?? dependencies.createSessionId?.() ?? randomUUID();
  const draftStore = absoluteDraftStore(options);
  const store = dependencies.store ?? new CodeReviewYamlStore({ directory: draftStore });
  const activeRun = await store.startRun({
    sessionId: requestedSessionId,
    prUrl: options.prUrl,
    selectedAgent: agent,
    selectedProfiles: profiles.map(({ name }) => name)
  });
  const sessionId = activeRun.sessionId;
  await store.appendOrchestratorAction(options.prUrl, {
    action: "spawned_orchestrator",
    details: agent
  });
  const prompt = renderReviewPrompt({
    input: options,
    profiles,
    profile,
    promptTemplate,
    prDetails,
    diff,
    priorActivity
  });
  const mcpConfig = createCodeReviewAgentMcpConfig({
    role: "orchestrator",
    session: sessionId,
    actor: "orchestrator",
    cwd: options.cwd,
    draftStore,
    agent,
    ...(options.profiles ? { profiles: options.profiles } : {})
  });
  const spawnResult = await (dependencies.spawnAgent ?? spawnWithPoeCode)(agent, prompt, {
    cwd: options.cwd,
    mcpServers: {
      "code-review": {
        command: mcpConfig.command,
        args: mcpConfig.args
      }
    }
  });
  if (spawnResult.exitCode !== 0) {
    throw new Error(
      `Code-review orchestrator failed: ${spawnResult.stderr || `exit ${spawnResult.exitCode}`}`
    );
  }
  const state = await store.read(options.prUrl);
  if (!state?.mergedReview) {
    throw new Error("Code-review orchestrator must create exactly one merged review.");
  }
  await store.appendOrchestratorAction(options.prUrl, {
    action: "completed_orchestration"
  });
  return {
    sessionId,
    state: (await store.read(options.prUrl)) ?? state,
    prompt,
    spawnResult
  };
}

async function resolveProfile(
  input: CodeReviewOrchestrationInput,
  options: CodeReviewRunOptions,
  profiles: Awaited<ReturnType<typeof discoverCodeReviewProfiles>>
): Promise<string> {
  if (input.profile !== undefined) {
    return input.profile;
  }
  if (options.profilePath) {
    return loadCodeReviewProfile(resolve(options.cwd, options.profilePath));
  }
  return profiles.map((profile) => `## ${profile.name}\n\n${profile.content.trim()}`).join("\n\n");
}

async function resolvePrompt(
  input: CodeReviewOrchestrationInput,
  options: CodeReviewRunOptions
): Promise<string> {
  if (input.prompt !== undefined) {
    return input.prompt;
  }
  return options.promptPath
    ? loadCodeReviewPrompt(resolve(options.cwd, options.promptPath))
    : loadCodeReviewRolePrompt({ cwd: options.cwd, role: "orchestrator" });
}

function renderReviewPrompt(input: {
  input: CodeReviewRunOptions;
  profiles: Awaited<ReturnType<typeof discoverCodeReviewProfiles>>;
  profile: string;
  promptTemplate: string;
  prDetails: Record<string, unknown>;
  diff: string;
  priorActivity: Record<string, unknown>;
}): string {
  const additionalFeedback = input.input.additionalFeedback?.trim();
  return [
    input.promptTemplate,
    ORCHESTRATOR_WORKFLOW_PROMPT,
    `\nPROFILE CARDS\n${input.profiles
      .map((profile) => `## ${profile.name}\n\n${profile.content.trim()}`)
      .join("\n\n")}`,
    `\nPRIMARY REVIEW PROFILE\n${input.profile}`,
    additionalFeedback ? `\nADDITIONAL FEEDBACK\n${additionalFeedback}` : "",
    `\nPULL REQUEST\n${input.input.prUrl}\n${JSON.stringify(input.prDetails)}`,
    `\nPRIOR COMMENTS AND REVIEWS\n${JSON.stringify(input.priorActivity)}`,
    `\nDIFF SUMMARY\n${input.diff}`
  ]
    .filter(Boolean)
    .join("\n");
}

const ORCHESTRATOR_WORKFLOW_PROMPT = `
REQUIRED ORCHESTRATION FLOW
1. Treat PRIOR COMMENTS AND REVIEWS as already-raised concerns and do not repeat the same underlying finding.
2. Use code_review_profile_list and spawn useful reviewer profiles through code_review_agent_spawn; spawn at least one available profile unless none can evaluate the change.
3. code_review_agent_spawn is asynchronous. Poll code_review_agent_status until all spawned reviewers are completed or failed before reading drafts.
4. Read completed raw reviews with code_review_list_drafts, merge useful new findings, and deduplicate overlapping or previously reported concerns.
5. Create exactly one final merged review with code_review_create_draft, even when there are no new findings.
6. Do not publish reviews or expose orchestration details in the final review text.
7. ${CODE_REVIEW_USER_FACING_OUTPUT_CONTRACT}`;

function absoluteDraftStore(input: CodeReviewRunOptions): string {
  return resolveCodeReviewStoreDirectory(input.cwd, input.draftStore);
}

function fetchPrWithCwd(prUrl: string, cwd: string): Record<string, unknown> {
  return fetchPullRequestDetails(prUrl, undefined, { cwd });
}

function fetchDiffWithCwd(prUrl: string, cwd: string): string {
  return fetchPullRequestDiff(prUrl, { cwd });
}

function fetchCommentsWithCwd(prUrl: string, cwd: string): Record<string, unknown> {
  return fetchPullRequestReviewActivity(prUrl, { cwd });
}

async function spawnWithPoeCode(
  agent: string,
  prompt: string,
  options: Omit<SpawnOptions, "prompt">
): Promise<SpawnResult> {
  return spawn(agent, {
    prompt,
    ...options,
    ...(shouldUseTextStdinForCodeReview(agent) ? { useStdin: true } : {})
  });
}
