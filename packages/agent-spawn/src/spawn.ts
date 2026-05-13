import "./register-factories.js";
import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import path from "node:path";
import { runPoeCommand } from "@poe-code/agent-harness-tools";
import { resolveConfig } from "./configs/resolve-config.js";
import { getMcpArgs } from "./mcp-args.js";
import { stripModelNamespace } from "./model-utils.js";
import { resolveSpawnExecution } from "./runtime.js";
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

const PROMPT_STDIN_FALLBACK_BYTES = 64 * 1024;

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

function resolveStdinMode(
  config: CliSpawnConfig,
  options: Pick<BuildSpawnArgsOptions, "prompt" | "useStdin">
): StdinMode | undefined {
  if (!config.stdinMode) {
    return undefined;
  }
  if (options.useStdin) {
    return config.stdinMode;
  }
  return Buffer.byteLength(options.prompt, "utf8") > PROMPT_STDIN_FALLBACK_BYTES
    ? config.stdinMode
    : undefined;
}

function buildCliArgs(
  config: CliSpawnConfig,
  options: BuildSpawnArgsOptions,
  stdinMode?: StdinMode
): { args: string[]; env?: Record<string, string> } {
  const mcpArgs = getMcpArgs(config, options.mcpServers);
  const resumeArgs = getResumeArgs(config, options);
  const defaultArgsPosition = getDefaultArgsPosition(config);
  const mcpArgsPosition = getMcpArgsPosition(config);
  const resumeArgsPosition = config.resume?.position ?? "afterPrompt";

  const args: string[] = [];

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
    args.push(...(stdinMode.omitPrompt ? [] : [options.prompt]), ...stdinMode.extraArgs);
  } else {
    args.push(config.promptFlag);
    if (resumeArgsPosition === "beforePrompt") {
      args.push(...resumeArgs);
    }
    args.push(options.prompt);
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

  return { args, env: mode.env };
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
  const stdinMode = resolveStdinMode(spawnConfig, options);
  const result = buildCliArgs(spawnConfig, options, stdinMode);
  return { binaryName, args: result.args, env: result.env };
}

export async function spawn(
  agentId: string,
  options: SpawnOptions,
  context?: SpawnContext
): Promise<SpawnResult> {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const { agentId: resolvedId, binaryName, spawnConfig } = resolveCliConfig(agentId);

  const stdinMode = resolveStdinMode(spawnConfig, options);

  const { args: spawnArgs, env: modeEnv } = buildCliArgs(spawnConfig, options, stdinMode);

  if (context?.dryRun) {
    const rendered = [binaryName, ...spawnArgs].join(" ");
    context.logger?.dryRun(rendered);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  const logFilePath = resolveSpawnLogPath(options);
  const logFd = logFilePath ? openSpawnLog(logFilePath) : undefined;

  const processEnv = modeEnv ? { ...process.env, ...modeEnv } : undefined;
  const argv = [binaryName, ...spawnArgs];
  const execution = resolveSpawnExecution({
    cwd: options.cwd ?? process.cwd(),
    runtimeConfigCwd: options.runtimeConfigCwd,
    env: (processEnv ?? process.env) as Record<string, string>,
    argv,
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

  try {
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
  }
}

function resolveSpawnLogPath(options: SpawnOptions): string | undefined {
  if (options.logPath) {
    return options.logPath;
  }
  if (!options.logDir || !options.logFileName) {
    return undefined;
  }
  return path.join(options.logDir, options.logFileName);
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
