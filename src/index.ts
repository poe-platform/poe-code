#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { configureTheme } from "toolcraft-design";

configureTheme({ brand: "purple", label: "Poe" });

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
export { getPoeApiKey, getPoeAuthIdentity } from "./sdk/credentials.js";
export type {
  GetPoeAuthIdentityOptions,
  PoeAuthIdentity
} from "./sdk/credentials.js";
export {
  agent,
  openaiChatCompletionsPlugin,
  openaiResponsesPlugin,
  systemPromptPlugin
} from "./agent.js";
export type {
  AcpEvent,
  AcpModel,
  AcpModelRequestMessage,
  AgentBuilder,
  AgentPlugin,
  AgentRunOptions,
  AgentSession,
  McpServerConfig,
  McpServerMap,
  OpenaiProviderPluginOptions,
  OpenaiResponsesPluginOptions,
  Provider,
  ProviderStreamEvent,
  RunResult,
  Tool
} from "./agent.js";
export { bridgeHooks, cleanupBridgedHooks, supportedHookAgents } from "@poe-code/agent-hook-config";
export { planDocumentSchema, planDocumentSchemaId } from "./plan/document-schema.js";
export { resolvePromptDocument } from "./sdk/prompt-document.js";
export type {
  PromptDocumentFileSystem,
  PromptDocumentBaseDocument,
  ResolvedPromptDocument,
  ResolvePromptDocumentInput
} from "./sdk/prompt-document.js";
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
  codeReviewGroup,
  createCodeReviewAgentMcpConfig,
  createCodeReviewGroup,
  createCodeReviewSession,
  createCodeReviewState,
  discoverCodeReviewProfiles,
  ingestCodeReviewProfile,
  installCodeReviewAssets,
  loadCodeReviewProfile,
  previewCodeReviewSpawnPrompt,
  readCodeReviewDraft,
  runCodeReview,
  runCodeReviewAgentMcp,
  commitCodeReviewDrafts
} from "agent-code-review";
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
  AcpMiddleware,
  AcpSpawnContext,
  McpSpawnConfig,
  McpSpawnServer,
  OtelSink,
  SessionResult,
  SessionToolCall,
  SpawnMode,
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
export { acpToTrace, createTraceSinkMiddleware } from "./sdk/trace.js";
export type { AcpTrace, AcpTraceSpan, TraceSink } from "./sdk/trace.js";
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
  CodeReviewAgentMcpConfig,
  CodeReviewAgentMcpContext,
  CodeReviewCliDependencies,
  CodeReviewCommitResult,
  CodeReviewIngestInput,
  CodeReviewIngestResult,
  CodeReviewInstallResult,
  CodeReviewOrchestrationInput,
  CodeReviewPreviewSpawn,
  CodeReviewProfile,
  CodeReviewResult,
  CodeReviewSpawnPromptPreview,
  CodeReviewRunInput,
  CodeReviewRunOptions,
  CodeReviewState,
  CommitCodeReviewDraftsInput,
  PreviewCodeReviewSpawnPromptInput,
  ReadCodeReviewDraftInput
} from "agent-code-review";
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

  configureTheme({ brand: "purple", label: "Poe" });
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
