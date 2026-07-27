import {
  runGaslightDaemon as runWorkspaceGaslightDaemon,
  runGaslight as runWorkspaceGaslight,
  type GaslightDaemonOptions as WorkspaceGaslightDaemonOptions,
  type GaslightDaemonResult,
  type GaslightOptions as WorkspaceGaslightOptions,
  type GaslightResult
} from "@poe-code/agent-gaslight";
import { runWithOptionalWorktree } from "./worktree.js";
import type { WorktreeExecutionOptions } from "./types.js";

export {
  GASLIGHT_CONFIG_EXAMPLE,
  ingestGaslight,
  loadGaslightConfig,
  parseGaslightConfig,
  type GaslightConfig,
  type GaslightDaemonEvent,
  type GaslightDaemonResult,
  type GaslightCollectHumanPrompts,
  type GaslightEvent,
  type GaslightFileSystem,
  type GaslightIngestEvent,
  type GaslightIngestOptions,
  type GaslightIngestResult,
  type GaslightPlanResult,
  type GaslightResult,
  type GaslightRound,
  type GaslightSpawn
} from "@poe-code/agent-gaslight";

export type GaslightOptions = WorkspaceGaslightOptions & {
  worktree?: WorktreeExecutionOptions;
};

export type GaslightDaemonOptions = Omit<WorkspaceGaslightDaemonOptions, "run"> & {
  worktree?: WorktreeExecutionOptions;
};

export async function runGaslightDaemon(
  options: GaslightDaemonOptions
): Promise<GaslightDaemonResult> {
  return await runWorkspaceGaslightDaemon({
    ...options,
    run: async (gaslightOptions: WorkspaceGaslightOptions) =>
      await runGaslight({ ...gaslightOptions, worktree: options.worktree })
  });
}

export async function runGaslight(options: GaslightOptions): Promise<GaslightResult> {
  if (!isWorktreeEnabled(options.worktree)) {
    return await runWorkspaceGaslight(options);
  }

  const cwd = options.cwd ?? process.cwd();
  const wrapped = await runWithOptionalWorktree<GaslightResult>({
    cwd,
    selectedAgent: options.agent,
    ...(options.model ? { selectedModel: options.model } : {}),
    worktree: options.worktree,
    signal: options.signal,
    run: async ({ worktreeCwd }) => {
      const { worktree: _worktree, ...workspaceOptions } = options;
      return await runWorkspaceGaslight({
        ...workspaceOptions,
        cwd: worktreeCwd
      });
    }
  });
  return wrapped.value;
}

function isWorktreeEnabled(worktree: WorktreeExecutionOptions | undefined): boolean {
  return worktree === true;
}
