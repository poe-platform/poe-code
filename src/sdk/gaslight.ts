import os from "node:os";
import {
  loadGaslightConfig,
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
  const selectedAgent =
    options.agent ??
    (await loadGaslightConfig(cwd, options.homeDir ?? os.homedir(), options.fs, options.configPath))
      .agent;
  if (!selectedAgent) {
    throw new Error("agent must be provided in run options or gaslight config.");
  }
  const wrapped = await runWithOptionalWorktree<GaslightResult>({
    cwd,
    selectedAgent,
    ...(options.model ? { selectedModel: options.model } : {}),
    worktree: options.worktree,
    signal: options.signal,
    run: async ({ worktreeCwd }) => {
      const { worktree: ignoredWorktree, ...workspaceOptions } = options;
      return await runWorkspaceGaslight({
        ...workspaceOptions,
        agent: selectedAgent,
        cwd: worktreeCwd
      });
    }
  });
  return wrapped.value;
}

function isWorktreeEnabled(worktree: WorktreeExecutionOptions | undefined): boolean {
  return worktree === true;
}
