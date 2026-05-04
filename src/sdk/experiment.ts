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
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import { createSpawnSession, type SpawnSession } from "./spawn-session.js";
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
  if (options.runAgent || options.detach === true) {
    return await runWorkspaceExperimentLoop({
      ...options,
      runAgent: options.runAgent ?? createDefaultExperimentRunAgent(options)
    });
  }

  const session = createExperimentSpawnSession(options);
  try {
    return await runWorkspaceExperimentLoop({
      ...options,
      runAgent: createSessionExperimentRunAgent(session)
    });
  } finally {
    await session.close();
  }
}

function createDefaultExperimentRunAgent(
  options: ExperimentRunOptions
): NonNullable<ExperimentRunOptions["runAgent"]> {
  return async (input) =>
    await sdkSpawn.autonomous(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
      mode: "yolo",
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
      ...(options.runtimeTemplate ? { runtimeTemplate: options.runtimeTemplate } : {}),
      ...(options.detach ? { detach: options.detach } : {}),
      ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
      ...(options.runnerSync ? { runnerSync: options.runnerSync } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    });
}

function createExperimentSpawnSession(options: ExperimentRunOptions): SpawnSession {
  const initialAgent = resolveInitialExperimentAgent(
    options.agent,
    (options as { model?: string }).model
  );

  return createSpawnSession({
    service: initialAgent.agent,
    cwd: options.cwd,
    ...(initialAgent.model ? { model: initialAgent.model } : {}),
    mode: "yolo",
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
    ...(options.runtimeTemplate ? { runtimeTemplate: options.runtimeTemplate } : {}),
    ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
    ...(options.runnerSync ? { runnerSync: options.runnerSync } : {}),
    downloadConflict: "overwrite",
    context: {
      homeDir: options.homeDir
    }
  });
}

function createSessionExperimentRunAgent(
  session: SpawnSession
): NonNullable<ExperimentRunOptions["runAgent"]> {
  return async (input) =>
    await session.run({
      agent: input.agent,
      prompt: input.prompt,
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      syncBack: true
    });
}

function resolveInitialExperimentAgent(
  agent: ExperimentRunOptions["agent"],
  model: string | undefined
): { agent: string; model?: string } {
  const value = Array.isArray(agent) ? agent[0] : agent;
  const specifier = parseAgentSpecifier(value ?? "claude-code");
  const initialModel = specifier.model ?? model;
  return {
    agent: specifier.agent,
    ...(initialModel ? { model: initialModel } : {})
  };
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
