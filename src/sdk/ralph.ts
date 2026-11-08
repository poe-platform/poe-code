import {
  runRalph as runWorkspaceRalph,
  runRalphSequence as runWorkspaceSequence,
  type RalphRunOptions as WorkspaceRalphRunOptions,
  type RalphRunResult,
  type RalphSequenceOptions as WorkspaceRalphSequenceOptions,
  type RalphSequenceResult
} from "@poe-code/ralph";
import { mapSourcePathIntoWorktree } from "@poe-code/agent-harness-tools";
import { spawn as sdkSpawn } from "./spawn.js";
import { runWithOptionalWorktree } from "./worktree.js";
import type { WorktreeExecutionOptions } from "./types.js";

export type {
  AgentRunInput,
  AgentRunResult,
  RalphRunResult,
  RalphSequenceResult,
  RalphStopReason
} from "@poe-code/ralph";

export type RalphRunOptions = WorkspaceRalphRunOptions & {
  worktree?: WorktreeExecutionOptions;
};

export type RalphSequenceOptions = WorkspaceRalphSequenceOptions & {
  worktree?: WorktreeExecutionOptions;
};

export async function runRalphSequence(options: RalphSequenceOptions): Promise<RalphSequenceResult> {
  const { worktree, ...sequenceOptions } = options;
  const execute = async (cwd: string): Promise<RalphSequenceResult> => {
    const runPlan = options.runPlan ?? runRalphDirect;
    return runWorkspaceSequence({
      ...sequenceOptions,
      cwd,
      runAgent: options.runAgent ?? createDefaultRalphRunAgent(sequenceOptions),
      runPlan: (planOptions) => runPlan({
        ...planOptions,
        docPath: mapSourcePathIntoWorktree(options.cwd, planOptions.docPath, cwd)
      })
    });
  };
  if (!isWorktreeEnabled(worktree)) return execute(options.cwd);
  const wrapped = await runWithOptionalWorktree({
    cwd: options.cwd,
    selectedAgent: resolveWorktreeAgent(options.agent),
    worktree,
    signal: options.signal,
    isSuccessful: (result: RalphSequenceResult) => result.status === "completed",
    run: ({ worktreeCwd }) => execute(worktreeCwd)
  });
  return wrapped.value;
}

export async function runRalph(options: RalphRunOptions): Promise<RalphRunResult> {
  if (isWorktreeEnabled(options.worktree)) {
    const wrapped = await runWithOptionalWorktree<RalphRunResult>({
      cwd: options.cwd,
      selectedAgent: resolveWorktreeAgent(options.agent),
      worktree: options.worktree,
      signal: options.signal,
      isSuccessful: ({ stopReason }) => stopReason === "completed" || stopReason === "max_iterations",
      run: async ({ worktreeCwd }) =>
        await runRalphDirect({
          ...options,
          cwd: worktreeCwd,
          worktree: false
        })
    });
    return wrapped.value;
  }

  return await runRalphDirect(options);
}

function resolveWorktreeAgent(agent: RalphRunOptions["agent"]): string {
  if (typeof agent === "string" && agent.length > 0) {
    return agent;
  }
  if (Array.isArray(agent) && typeof agent[0] === "string" && agent[0].length > 0) {
    return agent[0];
  }
  throw new Error("runRalph with worktree requires a resolved agent.");
}

async function runRalphDirect(options: RalphRunOptions): Promise<RalphRunResult> {
  return await runWorkspaceRalph({
    ...options,
    runAgent: options.runAgent ?? createDefaultRalphRunAgent(options)
  });
}

function createDefaultRalphRunAgent(
  options: Pick<RalphRunOptions, "runtime" | "runtimeImage" | "runtimeConfigCwd" | "detach" | "mountPoeCode" | "runnerSync">
): NonNullable<WorkspaceRalphRunOptions["runAgent"]> {
  return async (input) =>
    await sdkSpawn.autonomous(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
      ...(input.skills ? { skills: input.skills } : {}),
      ...(input.hooks ? { hooks: input.hooks } : {}),
      ...(input.logDir !== undefined ? { logDir: input.logDir } : {}),
      ...(input.logFileName !== undefined ? { logFileName: input.logFileName } : {}),
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
      ...(options.runtimeConfigCwd ? { runtimeConfigCwd: options.runtimeConfigCwd } : {}),
      ...(options.detach ? { detach: options.detach } : {}),
      ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
      ...(options.runnerSync ? { runnerSync: options.runnerSync } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    });
}

function isWorktreeEnabled(worktree: WorktreeExecutionOptions | undefined): boolean {
  return worktree === true;
}
