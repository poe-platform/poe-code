import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { resolveWorkflowPath } from "@poe-code/agent-harness-tools";
import {
  ExperimentJournal,
  runExperimentLoop as runWorkspaceExperimentLoop,
  type ExperimentFileSystem,
  type ExperimentRunOptions,
  type ExperimentRunResult,
  type JournalEntry
} from "@poe-code/experiment-loop";
import { spawn as sdkSpawn } from "./spawn.js";

export type {
  AgentRunInput,
  AgentRunResult,
  EvalResult,
  ExperimentFileSystem,
  ExperimentFrontmatter,
  ExperimentRunOptions,
  ExperimentRunResult,
  ExperimentStopReason,
  JournalEntry,
  MetricDef,
  MetricDirection
} from "@poe-code/experiment-loop";

export interface ExperimentJournalOptions {
  cwd: string;
  homeDir: string;
  docPath: string;
  fs?: ExperimentFileSystem;
}

function createDefaultFs(): ExperimentFileSystem {
  return {
    readFile: fsPromises.readFile as ExperimentFileSystem["readFile"],
    writeFile: async (filePath, content) => {
      await fsPromises.writeFile(filePath, content, "utf8");
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
    mkdir: async (filePath, options) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: async (filePath) => {
      await fsPromises.rmdir(filePath);
    },
    appendFile: async (filePath, content) => {
      await fsPromises.appendFile(filePath, content, "utf8");
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
  return runWorkspaceExperimentLoop({
    ...options,
    runAgent: async (input: Parameters<NonNullable<ExperimentRunOptions["runAgent"]>>[0]) => {
      return await sdkSpawn.autonomous(input.agent, {
        prompt: input.prompt,
        cwd: input.cwd,
        model: input.model,
        mode: "yolo",
        ...(input.signal ? { signal: input.signal } : {})
      });
    }
  });
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
