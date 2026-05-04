import "../register-factories.js";
import { runPoeCommand } from "@poe-code/agent-harness-tools";
import { getAdapter } from "../adapters/index.js";
import type { AcpEvent } from "./types.js";
import { resolveConfig } from "../configs/resolve-config.js";
import { getMcpArgs, getMcpEnv } from "../mcp-args.js";
import { stripModelNamespace } from "../model-utils.js";
import { resolveSpawnExecution } from "../runtime.js";
import { resolveModeConfig, type CliSpawnConfig, type SpawnOptions, type SpawnResult } from "../types.js";

function createAbortError(): Error {
  const error = new Error("Agent spawn aborted");
  error.name = "AbortError";
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

function createLineQueue(): {
  push(chunk: string): void;
  close(): void;
  lines(): AsyncIterable<string>;
} {
  const lines: string[] = [];
  const waiters: Array<{
    resolve(value: IteratorResult<string>): void;
  }> = [];
  let pending = "";
  let closed = false;

  const emit = (line: string): void => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: line });
      return;
    }
    lines.push(line);
  };

  const finishWaiters = (): void => {
    while (waiters.length > 0) {
      const waiter = waiters.shift()!;
      waiter.resolve({ done: true, value: undefined });
    }
  };

  return {
    push(chunk: string): void {
      if (closed) return;
      pending += chunk;
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        const raw = pending.slice(0, newlineIndex);
        emit(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
    },
    close(): void {
      if (closed) return;
      if (pending.length > 0) {
        emit(pending.endsWith("\r") ? pending.slice(0, -1) : pending);
        pending = "";
      }
      closed = true;
      finishWaiters();
    },
    lines(): AsyncIterable<string> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<string> {
          return {
            next(): Promise<IteratorResult<string>> {
              if (lines.length > 0) {
                return Promise.resolve({ done: false, value: lines.shift()! });
              }
              if (closed) {
                return Promise.resolve({ done: true, value: undefined });
              }
              return new Promise((resolve) => {
                waiters.push({ resolve });
              });
            }
          };
        }
      };
    }
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

  const modeResolved = resolveModeConfig(spawnConfig.modes[options.mode ?? "yolo"]);
  args.push(...modeResolved.args);

  if (useStdin) {
    args.push(...spawnConfig.stdinMode!.extraArgs);
  }

  if (options.args && options.args.length > 0) {
    args.push(...options.args);
  }

  const envOverrides = { ...mcpEnvVars, ...modeResolved.env };
  const processEnv =
    Object.keys(envOverrides).length > 0 ? { ...process.env, ...envOverrides } : undefined;
  const queue = createLineQueue();
  const argv = [binaryName, ...args];
  const execution = resolveSpawnExecution({
    cwd: options.cwd ?? process.cwd(),
    runtimeConfigCwd: options.runtimeConfigCwd,
    env: (processEnv ?? process.env) as Record<string, string>,
    argv,
    tool: agentId,
    runtime: {
      runtime: options.runtime,
      runtimeImage: options.runtimeImage,
      runtimeTemplate: options.runtimeTemplate,
      detach: options.detach,
      mountPoeCode: options.mountPoeCode,
      runnerSync: options.runnerSync
    },
    openSpec: {
      execution: {
        wrapForLogTee: false,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: processEnv as Record<string, string> | undefined,
        input: useStdin ? options.prompt : "",
        captureOutput: true,
        activityTimeoutMs: options.activityTimeoutMs,
        onStdout(chunk: string) {
          queue.push(chunk);
        },
        onStderr(chunk: string) {
          if (options.tee?.stderr) options.tee.stderr.write(chunk);
        }
      }
    }
  });

  const result: SpawnResult = { stdout: "", stderr: "", exitCode: 1 };
  const adapter = getAdapter(spawnConfig.adapter);

  const events: AsyncIterable<AcpEvent> = (async function* () {
    for await (const output of adapter(queue.lines())) {
      if (!isAcpEvent(output)) continue;
      yield output;
    }
  })();

  const done = (async (): Promise<SpawnResult> => {
    try {
      const runResult = await runPoeCommand({
        factory: execution.factory,
        openSpec: execution.openSpec,
        detach: execution.detach,
        state: execution.state,
        signal: options.signal
      });

      if (runResult.kind === "detached") {
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          detached: { jobId: runResult.jobId, envId: runResult.envId }
        };
      }

      result.stderr = runResult.stderr ?? "";
      result.exitCode = runResult.exitCode;
      return result;
    } finally {
      queue.close();
    }
  })();

  return { events, done };
}
