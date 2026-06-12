import "./register-factories.js";
import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import path from "node:path";
import { runPoeCommand } from "@poe-code/agent-harness-tools";
import { resolveConfig } from "./configs/resolve-config.js";
import { applyMcpFile } from "./configs/mcp-file.js";
import { getMcpArgs, getMcpEnv } from "./mcp-args.js";
import { stripModelNamespace } from "./model-utils.js";
import { observeAgentSpawn } from "./observability/otel.js";
import { createSpawnParallel } from "./parallel.js";
import { redactPromptArgIndexes, shouldSendPromptViaStdin } from "./prompt-transport.js";
import { createSpawnRetry } from "./retry.js";
import { resolveSpawnExecution } from "./runtime.js";
import { bridgeResourcesForRun, cleanupResourcesForRun } from "./skill-bridge.js";
import { spawnStreaming } from "./acp/spawn.js";
import {
  resolveModeConfig,
  type CliSpawnConfig,
  type McpSpawnConfig,
  type SpawnContext,
  type SpawnMode,
  type SpawnOptions,
  type SpawnResult,
  type StdinMode
} from "./types.js";

function createAbortError(): Error {
  const error = new Error("Agent spawn aborted");
  error.name = "AbortError";
  return error;
}

export function isActivityTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "ActivityTimeoutError";
}

export interface BuildSpawnArgsOptions {
  prompt: string;
  model?: string;
  mode?: SpawnMode;
  args?: string[];
  mcpServers?: McpSpawnConfig;
  resumeThreadId?: string;
  cwd?: string;
  useStdin?: boolean;
}

export interface BuildSpawnArgsResult {
  binaryName: string;
  args: string[];
  displayArgs: string[];
  env?: Record<string, string>;
}

function resolveCliConfig(agentId: string) {
  const resolved = resolveConfig(agentId);

  if (!resolved.spawnConfig) {
    throw new Error(`Agent "${resolved.agentId}" has no spawn config.`);
  }

  if (resolved.spawnConfig.kind !== "cli") {
    throw new Error(`Agent "${resolved.agentId}" does not support CLI spawn.`);
  }

  if (!resolved.binaryName) {
    throw new Error(`Agent "${resolved.agentId}" has no binaryName.`);
  }

  return {
    agentId: resolved.agentId,
    binaryName: resolved.binaryName,
    spawnConfig: resolved.spawnConfig
  };
}

function getDefaultArgsPosition(config: CliSpawnConfig): "beforePrompt" | "afterPrompt" {
  return config.defaultArgsPosition ?? "afterPrompt";
}

function getMcpArgsPosition(
  config: CliSpawnConfig
): "beforeCommand" | "beforePrompt" | "afterCommand" {
  if (config.mcpArgsPosition) {
    return config.mcpArgsPosition;
  }
  return config.mcpArgsBeforeCommand ? "beforeCommand" : "afterCommand";
}

function buildCliArgs(
  config: CliSpawnConfig,
  options: BuildSpawnArgsOptions,
  stdinMode?: StdinMode
): { args: string[]; displayArgs: string[]; env?: Record<string, string> } {
  const mcpArgs = getMcpArgs(config, options.mcpServers);
  const resumeArgs = getResumeArgs(config, options);
  const defaultArgsPosition = getDefaultArgsPosition(config);
  const mcpArgsPosition = getMcpArgsPosition(config);
  const resumeArgsPosition = config.resume?.position ?? "afterPrompt";

  const args: string[] = [];
  const promptArgIndexes = new Set<number>();
  const pushPromptArg = () => {
    promptArgIndexes.add(args.length);
    args.push(options.prompt);
  };

  if (mcpArgsPosition === "beforeCommand") {
    args.push(...mcpArgs);
  }

  if (defaultArgsPosition === "beforePrompt") {
    args.push(...config.defaultArgs);
  }

  if (mcpArgsPosition === "beforePrompt") {
    args.push(...mcpArgs);
  }

  if (stdinMode) {
    args.push(config.promptFlag);
    if (resumeArgsPosition === "beforePrompt") {
      args.push(...resumeArgs);
    }
    if (!stdinMode.omitPrompt) {
      pushPromptArg();
    }
    args.push(...stdinMode.extraArgs);
  } else {
    args.push(config.promptFlag);
    if (resumeArgsPosition === "beforePrompt") {
      args.push(...resumeArgs);
    }
    pushPromptArg();
  }

  if (options.model && config.modelFlag) {
    let model = config.modelStripProviderPrefix
      ? stripModelNamespace(options.model)
      : options.model;
    if (config.modelTransform) model = config.modelTransform(model);
    args.push(config.modelFlag, model);
  }

  if (defaultArgsPosition === "afterPrompt") {
    args.push(...config.defaultArgs);
  }

  if (mcpArgsPosition === "afterCommand") {
    args.push(...mcpArgs);
  }

  const mode = resolveModeConfig(config.modes[options.mode ?? "yolo"]);
  args.push(...mode.args);

  if (options.args && options.args.length > 0) {
    if (resumeArgsPosition === "afterPrompt") {
      args.push(...resumeArgs);
    }
    args.push(...options.args);
  } else if (resumeArgsPosition === "afterPrompt") {
    args.push(...resumeArgs);
  }

  return { args, displayArgs: redactPromptArgIndexes(args, promptArgIndexes), env: mode.env };
}

function getResumeArgs(
  config: CliSpawnConfig,
  options: Pick<BuildSpawnArgsOptions, "resumeThreadId" | "cwd">
): string[] {
  if (!options.resumeThreadId) {
    return [];
  }

  if (!config.resume) {
    throw new Error(`Agent "${config.agentId}" does not support resumeThreadId.`);
  }

  return config.resume.args(options.resumeThreadId, options.cwd ?? process.cwd());
}

export function buildSpawnArgs(
  agentId: string,
  options: BuildSpawnArgsOptions
): BuildSpawnArgsResult {
  const { binaryName, spawnConfig } = resolveCliConfig(agentId);
  const stdinMode = shouldSendPromptViaStdin(spawnConfig, options)
    ? spawnConfig.stdinMode
    : undefined;
  const result = buildCliArgs(spawnConfig, options, stdinMode);
  return {
    binaryName,
    args: result.args,
    displayArgs: result.displayArgs,
    env: result.env
  };
}

export async function spawn(
  agentId: string,
  options: SpawnOptions,
  context?: SpawnContext
): Promise<SpawnResult> {
  return observeAgentSpawn(
    {
      agent: agentId,
      cwd: options.cwd,
      mode: options.mode,
      otelSink: options.otelSink,
      prompt: options.prompt
    },
    () => runSpawn(agentId, options, context)
  );
}

async function runSpawn(
  agentId: string,
  options: SpawnOptions,
  context?: SpawnContext
): Promise<SpawnResult> {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const { agentId: resolvedId, binaryName, spawnConfig } = resolveCliConfig(agentId);

  const stdinMode = shouldSendPromptViaStdin(spawnConfig, options)
    ? spawnConfig.stdinMode
    : undefined;

  const {
    args: spawnArgs,
    displayArgs: displaySpawnArgs,
    env: modeEnv
  } = buildCliArgs(spawnConfig, options, stdinMode);

  if (context?.dryRun) {
    const rendered = [binaryName, ...displaySpawnArgs].join(" ");
    context.logger?.dryRun(rendered);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  const cwd = options.cwd ?? process.cwd();
  const manifest = bridgeResourcesForRun(agentId, cwd, options.skills, options.hooks);
  const restoreMcpFile =
    options.mcpServers && spawnConfig.mcpFile
      ? await applyMcpFile(spawnConfig.mcpFile, options.mcpServers, cwd)
      : undefined;
  let logFd: number | undefined;

  try {
    const logFilePath = resolveSpawnLogPath(options);
    logFd = logFilePath ? openSpawnLog(logFilePath) : undefined;

    const envOverrides = {
      ...(modeEnv ?? {}),
      ...getMcpEnv(spawnConfig, options.mcpServers),
      ...(options.env ?? {})
    };
    const processEnv =
      Object.keys(envOverrides).length > 0 ? { ...process.env, ...envOverrides } : undefined;
    const argv = [binaryName, ...spawnArgs];
    const displayArgv = [binaryName, ...displaySpawnArgs];
    const execution = resolveSpawnExecution({
      cwd,
      runtimeConfigCwd: options.runtimeConfigCwd,
      env: (processEnv ?? process.env) as Record<string, string>,
      argv,
      displayArgv,
      tool: resolvedId,
      runtime: {
        runtime: options.runtime,
        runtimeImage: options.runtimeImage,
        runtimeTemplate: options.runtimeTemplate,
        detach: options.detach,
        mountPoeCode: options.mountPoeCode,
        runnerSync: options.runnerSync
      },
      context,
      openSpec: {
        execution: {
          wrapForLogTee: false,
          stdin: stdinMode ? "pipe" : "inherit",
          stdout: "pipe",
          stderr: "pipe",
          env: processEnv as Record<string, string> | undefined,
          input: stdinMode ? options.prompt : undefined,
          captureOutput: true,
          activityTimeoutMs: options.activityTimeoutMs,
          onStdout(chunk: string) {
            options.tee?.stdout?.write(chunk);
            appendSpawnLog(logFd, chunk);
          },
          onStderr(chunk: string) {
            options.tee?.stderr?.write(chunk);
            appendSpawnLog(logFd, chunk);
          }
        }
      }
    });

    const result = await runPoeCommand({
      factory: execution.factory,
      openSpec: execution.openSpec,
      detach: execution.detach,
      state: execution.state,
      signal: options.signal
    });

    if (result.kind === "detached") {
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        detached: { jobId: result.jobId, envId: result.envId },
        ...(logFilePath ? { logFile: logFilePath } : {})
      };
    }

    const captured = result as typeof result & { stdout?: string; stderr?: string };
    return {
      stdout: captured.stdout ?? "",
      stderr: captured.stderr ?? "",
      exitCode: result.exitCode,
      ...(logFilePath ? { logFile: logFilePath } : {})
    };
  } finally {
    closeSpawnLog(logFd);
    await restoreMcpFile?.();
    cleanupResourcesForRun(manifest);
  }
}

spawn.retry = createSpawnRetry<SpawnOptions, SpawnResult>((service, options) => {
  const handle = spawnStreaming({ ...options, agentId: service });
  return {
    events: handle.events,
    result: handle.done
  };
});

spawn.parallel = createSpawnParallel<string, SpawnOptions, SpawnResult>((service, options) => ({
  events: (async function* () {})(),
  result: spawn(service, options)
}));

function resolveSpawnLogPath(options: SpawnOptions): string | undefined {
  if (options.logPath) {
    return options.logPath;
  }
  if (!options.logDir || !options.logFileName) {
    return undefined;
  }
  if (!isSafeLogFileName(options.logFileName)) {
    return undefined;
  }
  return path.join(options.logDir, options.logFileName);
}

function isSafeLogFileName(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    !path.isAbsolute(fileName) &&
    !path.win32.isAbsolute(fileName) &&
    path.basename(fileName) === fileName &&
    path.win32.basename(fileName) === fileName
  );
}

function openSpawnLog(filePath: string): number | undefined {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    return openSync(filePath, "a");
  } catch {
    return undefined;
  }
}

function appendSpawnLog(fd: number | undefined, chunk: string): void {
  if (fd === undefined) return;
  try {
    writeSync(fd, chunk);
  } catch {
    // ignore — logging is best-effort
  }
}

function closeSpawnLog(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    // ignore
  }
}
