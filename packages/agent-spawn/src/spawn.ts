import { spawn as spawnChildProcess } from "node:child_process";
import { resolveConfig } from "./configs/resolve-config.js";
import { getMcpArgs } from "./mcp-args.js";
import { stripModelNamespace } from "./model-utils.js";
import type {
  CliSpawnConfig,
  McpSpawnConfig,
  SpawnContext,
  SpawnMode,
  SpawnOptions,
  SpawnResult,
  StdinMode
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
): string[] {
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

  args.push(...config.modes[options.mode ?? "yolo"]);

  if (options.args && options.args.length > 0) {
    args.push(...options.args);
  }

  return args;
}

export function buildSpawnArgs(
  agentId: string,
  options: BuildSpawnArgsOptions
): BuildSpawnArgsResult {
  const { binaryName, spawnConfig } = resolveCliConfig(agentId);
  const stdinMode =
    options.useStdin && spawnConfig.stdinMode ? spawnConfig.stdinMode : undefined;
  return { binaryName, args: buildCliArgs(spawnConfig, options, stdinMode) };
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

  const spawnArgs = buildCliArgs(spawnConfig, options, stdinMode);

  if (context?.dryRun) {
    const rendered = [binaryName, ...spawnArgs].join(" ");
    context.logger?.dryRun(rendered);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  const child = spawnChildProcess(binaryName, spawnArgs, {
    cwd: options.cwd,
    stdio: [stdinMode ? "pipe" : "inherit", "pipe", "pipe"]
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
    });

    stderrStream.setEncoding("utf8");
    stderrStream.on("data", (chunk) => {
      stderr += chunk;
      resetActivityTimer?.();
      if (options.tee?.stderr) options.tee.stderr.write(chunk);
    });

    child.on("error", (error) => {
      cleanup();
      if (aborted) {
        reject(createAbortError());
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      cleanup();
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
        exitCode: code ?? 1
      });
    });
  });
}
