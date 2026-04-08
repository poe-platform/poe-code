import { spawn as spawnChildProcess } from "node:child_process";
import { getAdapter } from "../adapters/index.js";
import type { AcpEvent } from "./types.js";
import { readLines } from "./line-reader.js";
import { resolveConfig } from "../configs/resolve-config.js";
import { getMcpArgs, getMcpEnv } from "../mcp-args.js";
import { stripModelNamespace } from "../model-utils.js";
import type { CliSpawnConfig, SpawnOptions, SpawnResult } from "../types.js";

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

export interface SpawnStreamingOptions extends SpawnOptions {
  agentId: string;
}

export interface SpawnStreamingResult {
  events: AsyncIterable<AcpEvent>;
  done: Promise<SpawnResult>;
}

function isAcpEvent(value: unknown): value is AcpEvent {
  return !!value && typeof value === "object" && "event" in value;
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

export function spawnStreaming(options: SpawnStreamingOptions): SpawnStreamingResult {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const { agentId, binaryName, spawnConfig } = resolveConfig(options.agentId);

  if (spawnConfig === undefined) {
    throw new Error(`Agent "${agentId}" has no spawn config.`);
  }

  if (spawnConfig.kind !== "cli") {
    throw new Error(`Agent "${agentId}" does not support CLI spawn.`);
  }

  if (!binaryName) {
    throw new Error(`Agent "${agentId}" has no binaryName.`);
  }

  const mcpArgs = getMcpArgs(spawnConfig, options.mcpServers);
  const mcpEnvVars = getMcpEnv(spawnConfig, options.mcpServers);
  const defaultArgsPosition = getDefaultArgsPosition(spawnConfig);
  const mcpArgsPosition = getMcpArgsPosition(spawnConfig);
  const args: string[] = [];

  if (mcpArgsPosition === "beforeCommand") {
    args.push(...mcpArgs);
  }

  if (defaultArgsPosition === "beforePrompt") {
    args.push(...spawnConfig.defaultArgs);
  }

  if (mcpArgsPosition === "beforePrompt") {
    args.push(...mcpArgs);
  }

  args.push(spawnConfig.promptFlag);

  const useStdin = !!options.useStdin && !!spawnConfig.stdinMode;
  if (!useStdin || !spawnConfig.stdinMode?.omitPrompt) {
    args.push(options.prompt);
  }

  if (options.model && spawnConfig.modelFlag) {
    let model = spawnConfig.modelStripProviderPrefix
      ? stripModelNamespace(options.model)
      : options.model;
    if (spawnConfig.modelTransform) model = spawnConfig.modelTransform(model);
    args.push(spawnConfig.modelFlag, model);
  }

  if (defaultArgsPosition === "afterPrompt") {
    args.push(...spawnConfig.defaultArgs);
  }

  if (mcpArgsPosition === "afterCommand") {
    args.push(...mcpArgs);
  }

  const mode = options.mode ?? "yolo";
  args.push(...spawnConfig.modes[mode]);

  if (useStdin) {
    args.push(...spawnConfig.stdinMode!.extraArgs);
  }

  if (options.args && options.args.length > 0) {
    args.push(...options.args);
  }

  const child = spawnChildProcess(binaryName, args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: Object.keys(mcpEnvVars).length > 0
      ? { ...process.env, ...mcpEnvVars }
      : undefined
  });
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

  const result: SpawnResult = { stdout: "", stderr: "", exitCode: 1 };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    result.stderr += chunk;
    resetActivityTimer?.();
  });

  if (useStdin) {
    child.stdin.write(options.prompt);
  }
  child.stdin.end();

  const adapter = getAdapter(spawnConfig.adapter);

  const events: AsyncIterable<AcpEvent> = (async function* () {
    for await (const output of adapter(readLines(child.stdout))) {
      if (!isAcpEvent(output)) continue;
      resetActivityTimer?.();
      yield output;
    }
  })();

  const done = new Promise<SpawnResult>((resolve, reject) => {
    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (activityTimer) clearTimeout(activityTimer);
      if (aborted) {
        reject(createAbortError());
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (activityTimer) clearTimeout(activityTimer);
      if (aborted) {
        reject(createAbortError());
        return;
      }
      if (timedOut) {
        reject(createActivityTimeoutError(options.activityTimeoutMs!));
        return;
      }
      result.exitCode = code ?? 1;
      resolve(result);
    });
  });

  return { events, done };
}
