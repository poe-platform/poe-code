import path from "node:path";
import * as fsPromises from "node:fs/promises";
import {
  ExperimentJournal,
  runExperimentLoop as runWorkspaceExperimentLoop,
  type ExperimentFileSystem,
  type ExperimentRunOptions,
  type ExperimentRunResult,
  type JournalEntry
} from "@poe-code/experiment-loop";
import { renderAcpStream, isActivityTimeoutError } from "@poe-code/agent-spawn";
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
        mtimeMs: stat.mtimeMs
      };
    },
    mkdir: async (filePath, options) => {
      await fsPromises.mkdir(filePath, options);
    },
    appendFile: async (filePath, content) => {
      await fsPromises.appendFile(filePath, content, "utf8");
    }
  };
}

function resolveAbsoluteDocPath(docPath: string, cwd: string, homeDir: string): string {
  if (docPath.startsWith("~/")) {
    return path.join(homeDir, docPath.slice(2));
  }

  return path.isAbsolute(docPath) ? docPath : path.resolve(cwd, docPath);
}

function resolveJournalPath(docPath: string): string {
  return path.join(
    path.dirname(docPath),
    `${path.basename(docPath, path.extname(docPath))}.journal.jsonl`
  );
}

const AUTONOMOUS_ACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TIMEOUT_RETRIES = 3;

export async function runExperiment(options: ExperimentRunOptions): Promise<ExperimentRunResult> {
  return runWorkspaceExperimentLoop({
    ...options,
    runAgent: async (input: Parameters<NonNullable<ExperimentRunOptions["runAgent"]>>[0]) => {
      for (let attempt = 1; attempt <= MAX_TIMEOUT_RETRIES; attempt++) {
        try {
          const { events, result } = sdkSpawn(input.agent, {
            prompt: input.prompt,
            cwd: input.cwd,
            model: input.model,
            mode: "yolo",
            activityTimeoutMs: AUTONOMOUS_ACTIVITY_TIMEOUT_MS,
            ...(input.signal ? { signal: input.signal } : {})
          });
          await renderAcpStream(events);
          return await result;
        } catch (error) {
          if (!isActivityTimeoutError(error) || attempt === MAX_TIMEOUT_RETRIES) {
            throw error;
          }
        }
      }
      throw new Error("Unreachable");
    }
  });
}

export async function readExperimentJournal(
  options: ExperimentJournalOptions
): Promise<JournalEntry[]> {
  const fs = options.fs ?? createDefaultFs();
  const absoluteDocPath = resolveAbsoluteDocPath(options.docPath, options.cwd, options.homeDir);
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
  const absoluteDocPath = resolveAbsoluteDocPath(options.docPath, options.cwd, options.homeDir);
  const journal = new ExperimentJournal(resolveJournalPath(absoluteDocPath), fs);
  await journal.init();
  await journal.log(options.entry);
}
