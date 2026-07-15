import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { resolveWorkflowPath } from "@poe-code/agent-harness-tools";
import {
  ExperimentJournal,
  runExperimentLoop as runWorkspaceExperimentLoop,
  type ExperimentFileSystem,
  type ExperimentRunOptions as WorkspaceExperimentRunOptions,
  type ExperimentRunResult,
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
  ExperimentStopReason,
  JournalEntry,
  MetricDef,
  MetricDirection
} from "@poe-code/experiment-loop";

export type ExperimentRunOptions = WorkspaceExperimentRunOptions & {
  worktree?: WorktreeExecutionOptions;
};

export interface ExperimentJournalOptions {
  cwd: string;
  homeDir: string;
  docPath: string;
  fs?: ExperimentFileSystem;
}

function createDefaultFs(): ExperimentFileSystem {
  return {
    readFile: fsPromises.readFile as ExperimentFileSystem["readFile"],
    writeFile: async (filePath, content, options) => {
      await fsPromises.writeFile(filePath, content, options ?? { encoding: "utf8" });
    },
    readdir: fsPromises.readdir,
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    },
    lstat: async (filePath: string) => {
      const stat = await fsPromises.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    mkdir: async (filePath, options) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: async (filePath) => {
      await fsPromises.rmdir(filePath);
    },
    appendFile: async (filePath, content) => {
      await fsPromises.appendFile(filePath, content, "utf8");
    },
    rename: async (oldPath, newPath) => {
      await fsPromises.rename(oldPath, newPath);
    },
    unlink: async (filePath) => {
      await fsPromises.unlink(filePath);
    }
  };
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
    runAgent: options.runAgent ?? (async (input: Parameters<NonNullable<ExperimentRunOptions["runAgent"]>>[0]) => {
      return await sdkSpawn.autonomous(input.agent, {
        prompt: input.prompt,
        cwd: input.cwd,
        model: input.model,
        mode: "yolo",
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
    })
  });
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
  const fs = options.fs ?? createDefaultFs();
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
  const fs = options.fs ?? createDefaultFs();
  const absoluteDocPath = resolveWorkflowPath(options.docPath, options.cwd, options.homeDir);
  const journal = new ExperimentJournal(resolveJournalPath(absoluteDocPath), fs);
  await journal.init();
  await journal.log(options.entry);
}
