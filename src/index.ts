#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// SDK exports
export { spawn } from "./sdk/spawn.js";
export { runPipeline, runPipelineInit } from "./sdk/pipeline.js";
export { runMaestro } from "@poe-code/agent-maestro";
export {
  createLogWriter,
  createStateStore,
  createSupervisor,
  waitForReady
} from "./sdk/process-launcher.js";
export { runRalph } from "./sdk/ralph.js";
export { runExperiment, readExperimentJournal } from "./sdk/experiment.js";
export { generate, generateImage, generateVideo, generateAudio } from "./sdk/generate.js";
export { getPoeApiKey } from "./sdk/credentials.js";
export { bridgeHooks, cleanupBridgedHooks, supportedHookAgents } from "@poe-code/agent-hook-config";
export { planDocumentSchema, planDocumentSchemaId } from "./plan/document-schema.js";
export { ghGroup } from "@poe-code/github-workflows";
export {
  evalCheck,
  evalInit,
  evalLint,
  evalGroup,
  runCheckCli,
  runInitCli,
  runLintCli
} from "@poe-code/agent-eval";
export type {
  CheckCliInput,
  CheckOptions,
  CheckResult,
  InitCliInput,
  InitOptions,
  InitResult,
  LintCliInput,
  LintIssue,
  LintResult
} from "@poe-code/agent-eval";
export {
  followLaunchLogs,
  listLaunches,
  readLaunchLogs,
  removeLaunch,
  restartLaunch,
  runLaunchDaemon,
  startLaunch,
  stopLaunch
} from "./sdk/launch.js";
export type {
  SpawnOptions,
  HookBridgeOptions,
  SpawnRetryOptions,
  SpawnUsage,
  SpawnResult,
  GenerateOptions,
  MediaGenerateOptions,
  GenerateResult,
  MediaGenerateResult
} from "./sdk/types.js";
export type {
  BridgeHookManifest,
  BridgeStrategy,
  GeneratedHookEntry,
  HookDrop
} from "@poe-code/agent-hook-config";
export { SpawnParallelError } from "@poe-code/agent-spawn";
export type {
  SpawnParallelCall,
  SpawnParallelOptions,
  SpawnParallelThunk,
  SpawnParallelTuple
} from "@poe-code/agent-spawn";
export type {
  FollowLaunchLogsSdkOptions,
  ListLaunchesOptions,
  ReadLaunchLogsOptions,
  RemoveLaunchOptions,
  RestartLaunchOptions,
  RunLaunchDaemonOptions,
  StartLaunchOptions,
  StopLaunchOptions
} from "./sdk/launch.js";
export type {
  LauncherFileSystem,
  LogWriter,
  ManagedProcessRecord,
  ProcessSpec,
  ProcessState,
  ProcessStatus,
  ReadyCheck,
  RestartPolicy,
  StateStore,
  Supervisor,
  SupervisorOptions
} from "./sdk/process-launcher.js";
export type {
  PipelineRunOptions,
  PipelineRunResult,
  PipelineInitRunOptions,
  PipelineInitRunResult,
  PipelineInitSource
} from "./sdk/pipeline.js";
export type {
  RunMaestroOptions,
  MaestroEvent,
  Logger as MaestroLogger
} from "@poe-code/agent-maestro";
export type { RalphRunOptions, RalphRunResult } from "./sdk/ralph.js";
export type { AutomationDefinition } from "@poe-code/github-workflows";
export type {
  ExperimentRunOptions,
  ExperimentRunResult,
  ExperimentJournalOptions
} from "./sdk/experiment.js";

async function main(): Promise<void> {
  const [{ createProgram }, { createCliMain }] = await Promise.all([
    import("./cli/program.js"),
    import("./cli/bootstrap.js")
  ]);

  const runCli = createCliMain(createProgram);
  await runCli();
}

function isCliInvocation(
  argv: string[],
  moduleUrl: string,
  realpath: (path: string) => string = realpathSync
): boolean {
  const entry = argv.at(1);
  if (typeof entry !== "string") {
    return false;
  }

  const candidates = [pathToFileURL(entry).href];

  try {
    candidates.push(pathToFileURL(realpath(entry)).href);
  } catch {
    // Ignore resolution errors; fall back to direct comparison.
  }

  return candidates.includes(moduleUrl);
}

if (isCliInvocation(process.argv, import.meta.url)) {
  void main();
}

// CLI exports
export { main, isCliInvocation };
export { poeAgentMain } from "./cli/poe-agent-main.js";
