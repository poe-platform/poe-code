import { spawn as spawnChildProcess } from "node:child_process";
import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import path from "node:path";
import { resolveConfig } from "./configs/resolve-config.js";
import { getMcpArgs } from "./mcp-args.js";
import { stripModelNamespace } from "./model-utils.js";
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

function createActivityTimeoutError(timeoutMs: number): Error {
  const error = new Error(
    `Agent spawn timed out after ${timeoutMs / 1000}s of inactivity`
  );
  error.name = "ActivityTimeoutError";
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

function buildCliArgs(
  config: CliSpawnConfig,
  options: BuildSpawnArgsOptions,
  stdinMode?: StdinMode
): { args: string[]; env?: Record<string, string> } {
  const mcpArgs = getMcpArgs(config, options.mcpServers);
  const defaultArgsPosition = getDefaultArgsPosition(config);
  const mcpArgsPosition = getMcpArgsPosition(config);

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
    args.push(
      config.promptFlag,
      ...(stdinMode.omitPrompt ? [] : [options.prompt]),
      ...stdinMode.extraArgs
    );
  } else {
    args.push(config.promptFlag, options.prompt);
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
    args.push(...options.args);
  }

  return { args, env: mode.env };
}

export function buildSpawnArgs(
  agentId: string,
  options: BuildSpawnArgsOptions
): BuildSpawnArgsResult {
  const { binaryName, spawnConfig } = resolveCliConfig(agentId);
  const stdinMode =
    options.useStdin && spawnConfig.stdinMode ? spawnConfig.stdinMode : undefined;
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

  const stdinMode =
    options.useStdin && spawnConfig.stdinMode ? spawnConfig.stdinMode : undefined;

  const { args: spawnArgs, env: modeEnv } = buildCliArgs(spawnConfig, options, stdinMode);

  if (context?.dryRun) {
    const rendered = [binaryName, ...spawnArgs].join(" ");
    context.logger?.dryRun(rendered);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  const logFilePath = resolveSpawnLogPath(options);
  const logFd = logFilePath ? openSpawnLog(logFilePath) : undefined;

  const child = spawnChildProcess(binaryName, spawnArgs, {
    cwd: options.cwd,
    stdio: [stdinMode ? "pipe" : "inherit", "pipe", "pipe"],
    ...(modeEnv ? { env: { ...process.env, ...modeEnv } } : {})
  });

  if (!child.stdout || !child.stderr) {
    throw new Error(`Failed to spawn "${resolvedId}": missing stdio pipes.`);
  }

  const stdoutStream = child.stdout;
  const stderrStream = child.stderr;

  if (stdinMode) {
    if (!child.stdin) {
      throw new Error(`Failed to spawn "${resolvedId}": missing stdin pipe.`);
    }
    child.stdin.setDefaultEncoding("utf8");
    child.stdin.write(options.prompt);
    child.stdin.end();
  }

  return new Promise<SpawnResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let aborted = false;
    let timedOut = false;

    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    let activityTimer: ReturnType<typeof setTimeout> | undefined;
    const resetActivityTimer = options.activityTimeoutMs
      ? () => {
          if (activityTimer) clearTimeout(activityTimer);
          activityTimer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.activityTimeoutMs);
        }
      : undefined;

    resetActivityTimer?.();

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
      if (activityTimer) clearTimeout(activityTimer);
    };

    stdoutStream.setEncoding("utf8");
    stdoutStream.on("data", (chunk) => {
      stdout += chunk;
      resetActivityTimer?.();
      if (options.tee?.stdout) options.tee.stdout.write(chunk);
      appendSpawnLog(logFd, chunk);
    });

    stderrStream.setEncoding("utf8");
    stderrStream.on("data", (chunk) => {
      stderr += chunk;
      resetActivityTimer?.();
      if (options.tee?.stderr) options.tee.stderr.write(chunk);
      appendSpawnLog(logFd, chunk);
    });

    child.on("error", (error) => {
      cleanup();
      closeSpawnLog(logFd);
      if (aborted) {
        reject(createAbortError());
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      cleanup();
      closeSpawnLog(logFd);
      if (aborted) {
        reject(createAbortError());
        return;
      }
      if (timedOut) {
        reject(createActivityTimeoutError(options.activityTimeoutMs!));
        return;
      }
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        ...(logFilePath ? { logFile: logFilePath } : {})
      });
    });
  });
}

function resolveSpawnLogPath(options: SpawnOptions): string | undefined {
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
