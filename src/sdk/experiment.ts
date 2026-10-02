import type { FileSystem } from "@poe-code/safe-fs/contracts";
import path from "node:path";
import { mapSourcePathIntoWorktree, resolveWorkflowPath } from "@poe-code/agent-harness-tools";
import {
  ExperimentJournal,
  experimentFileSystem,
  runExperimentLoop as runWorkspaceExperimentLoop,
  runExperimentSequence as runWorkspaceSequence,
  type ExperimentFileSystem,
  type ExperimentRunOptions as WorkspaceExperimentRunOptions,
  type ExperimentRunResult,
  type ExperimentSequenceOptions as WorkspaceExperimentSequenceOptions,
  type ExperimentSequenceResult,
  type JournalEntry
} from "@poe-code/experiment-loop";
import { spawn as sdkSpawn } from "./spawn.js";
import type { WorktreeExecutionOptions } from "./types.js";
import { runWithOptionalWorktree } from "./worktree.js";

export type {
  AgentRunInput,
  AgentRunResult,
  EvalResult,
  ExperimentFileSystem,
  ExperimentFrontmatter,
  ExperimentRunResult,
  ExperimentSequenceResult,
  ExperimentPlanSummary,
  ExperimentStopReason,
  JournalEntry,
  MetricDef,
  MetricDirection
} from "@poe-code/experiment-loop";

export type ExperimentRunOptions = WorkspaceExperimentRunOptions & {
  worktree?: WorktreeExecutionOptions;
};

export type ExperimentSequenceOptions = WorkspaceExperimentSequenceOptions & {
  worktree?: WorktreeExecutionOptions;
};

export async function runExperimentSequence(options: ExperimentSequenceOptions): Promise<ExperimentSequenceResult> {
  const { worktree, ...sequenceOptions } = options;
  const execute = async (cwd: string): Promise<ExperimentSequenceResult> => {
    const runPlan = options.runPlan ?? runExperimentDirect;
    return runWorkspaceSequence({
      ...sequenceOptions, cwd,
      runAgent: options.runAgent ?? createDefaultExperimentRunAgent(options),
      runPlan: (planOptions) => runPlan({
        ...planOptions,
        docPath: mapSourcePathIntoWorktree(options.cwd, planOptions.docPath, cwd),
        additionalManagedPaths: planOptions.additionalManagedPaths?.map((filePath) => mapSourcePathIntoWorktree(options.cwd, filePath, cwd))
      })
    });
  };
  if (!isWorktreeEnabled(worktree)) return execute(options.cwd);
  const wrapped = await runWithOptionalWorktree({
    cwd: options.cwd, selectedAgent: resolveWorktreeAgent(options.agent), worktree,
    signal: options.signal,
    isSuccessful: (result: ExperimentSequenceResult) => result.status === "completed",
    run: ({ worktreeCwd }) => execute(worktreeCwd)
  });
  return wrapped.value;
}

export interface ExperimentJournalOptions {
  cwd: string;
  homeDir: string;
  docPath: string;
  fs?: ExperimentFileSystem | FileSystem;
}

function resolveJournalPath(docPath: string): string {
  return path.join(
    path.dirname(docPath),
    `${path.basename(docPath, path.extname(docPath))}.journal.jsonl`
  );
}

export async function runExperiment(options: ExperimentRunOptions): Promise<ExperimentRunResult> {
  if (isWorktreeEnabled(options.worktree)) {
    const selectedAgent = resolveWorktreeAgent(options.agent);
    const wrapped = await runWithOptionalWorktree<ExperimentRunResult>({
      cwd: options.cwd,
      selectedAgent,
      worktree: options.worktree,
      run: async ({ worktreeCwd }) =>
        await runExperimentDirect({
          ...options,
          cwd: worktreeCwd,
          worktree: false
        })
    });
    return wrapped.value;
  }

  return await runExperimentDirect(options);
}

async function runExperimentDirect(options: ExperimentRunOptions): Promise<ExperimentRunResult> {
  const { worktree: ignoredWorktree, ...workspaceOptions } = options;
  return await runWorkspaceExperimentLoop({
    ...workspaceOptions,
    runAgent: options.runAgent ?? createDefaultExperimentRunAgent(options)
  });
}

function createDefaultExperimentRunAgent(
  options: Pick<ExperimentRunOptions, "runtime" | "runtimeImage" | "detach" | "mountPoeCode" | "runnerSync">
): NonNullable<ExperimentRunOptions["runAgent"]> {
  return async (input) => {
      return await sdkSpawn.autonomous(input.agent, {
        prompt: input.prompt,
        cwd: input.cwd,
        model: input.model,
        ...(input.logDir ? { logDir: input.logDir } : {}),
        ...(input.logFileName ? { logFileName: input.logFileName } : {}),
        ...(options.runtime ? { runtime: options.runtime } : {}),
        ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
        ...(options.detach ? { detach: options.detach } : {}),
        ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
        ...(options.runnerSync ? { runnerSync: options.runnerSync } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
        worktree: false
      });
  };
}

function isWorktreeEnabled(options: WorktreeExecutionOptions | undefined): boolean {
  return options === true;
}

function resolveWorktreeAgent(agent: WorkspaceExperimentRunOptions["agent"]): string {
  if (typeof agent === "string" && agent.trim().length > 0) {
    return agent;
  }
  if (Array.isArray(agent) && typeof agent[0] === "string" && agent[0].trim().length > 0) {
    return agent[0];
  }
  throw new Error("runExperiment with worktree requires a resolved agent.");
}

export async function readExperimentJournal(
  options: ExperimentJournalOptions
): Promise<JournalEntry[]> {
  const fs = experimentFileSystem(options.fs);
  const absoluteDocPath = resolveWorkflowPath(options.docPath, options.cwd, options.homeDir);
  const journal = new ExperimentJournal(resolveJournalPath(absoluteDocPath), fs);
  return await journal.readAll();
}

export interface AppendJournalEntryOptions extends ExperimentJournalOptions {
  entry: JournalEntry;
}

export async function appendExperimentJournalEntry(
  options: AppendJournalEntryOptions
): Promise<void> {
  const fs = experimentFileSystem(options.fs);
  const absoluteDocPath = resolveWorkflowPath(options.docPath, options.cwd, options.homeDir);
  const journal = new ExperimentJournal(resolveJournalPath(absoluteDocPath), fs);
  await journal.init();
  await journal.log(options.entry);
}
