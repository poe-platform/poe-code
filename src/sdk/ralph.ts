import {
  runRalph as runWorkspaceRalph,
  type RalphRunOptions as WorkspaceRalphRunOptions,
  type RalphRunResult
} from "@poe-code/ralph";
import { spawn as sdkSpawn } from "./spawn.js";
import { runWithOptionalWorktree } from "./worktree.js";
import type { WorktreeExecutionOptions } from "./types.js";

export type {
  AgentRunInput,
  AgentRunResult,
  RalphRunResult,
  RalphStopReason
} from "@poe-code/ralph";

export type RalphRunOptions = WorkspaceRalphRunOptions & {
  worktree?: WorktreeExecutionOptions;
};

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
  options: RalphRunOptions
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
