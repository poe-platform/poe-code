import "../register-factories.js";
import { runPoeCommand } from "@poe-code/agent-harness-tools";
import { getAdapter } from "../adapters/index.js";
import { stampReceiveTime } from "./meta.js";
import type { AcpEvent } from "./types.js";
import { resolveConfig } from "../configs/resolve-config.js";
import { applyMcpFile } from "../configs/mcp-file.js";
import { getMcpArgs, getMcpEnv } from "../mcp-args.js";
import { normalizeModelOverride, stripModelNamespace } from "../model-utils.js";
import { observeAgentSpawn } from "../observability/otel.js";
import { startNativeOtelCapture, type NativeOtelCapture } from "../native-otel.js";
import { redactPromptArgIndexes, shouldSendPromptViaStdin } from "../prompt-transport.js";
import { resolveSpawnExecution } from "../runtime.js";
import { mergeSpawnEnvironment } from "../environment.js";
import { bridgeResourcesForRun, cleanupResourcesForRun } from "../skill-bridge.js";
import {
  DEFAULT_SPAWN_MODE,
  resolveAgentModeConfig,
  type CliSpawnConfig,
  type SpawnMode,
  type SpawnOptions,
  type SpawnResult
} from "../types.js";
import { applyMiddlewares, type SpawnContext } from "./middleware.js";

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
  return (
    !!value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "event")
  );
}

function accumulateUsage(ctx: SpawnContext, event: AcpEvent): void {
  if (event.event !== "usage") {
    return;
  }

  const usage = event as {
    inputTokens?: unknown;
    outputTokens?: unknown;
    cachedTokens?: unknown;
    costUsd?: unknown;
  };

  if (typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens)) {
    ctx.usage.inputTokens += usage.inputTokens;
  }

  if (typeof usage.outputTokens === "number" && Number.isFinite(usage.outputTokens)) {
    ctx.usage.outputTokens += usage.outputTokens;
  }

  if (typeof usage.cachedTokens === "number" && Number.isFinite(usage.cachedTokens)) {
    ctx.usage.cachedTokens = (ctx.usage.cachedTokens ?? 0) + usage.cachedTokens;
  }

  if (typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)) {
    ctx.usage.costUsd = (ctx.usage.costUsd ?? 0) + usage.costUsd;
  }
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

function getResumeArgs(
  config: CliSpawnConfig,
  options: Pick<SpawnStreamingOptions, "resumeThreadId" | "cwd">
): string[] {
  if (!options.resumeThreadId) {
    return [];
  }

  if (!config.resume) {
    throw new Error(`Agent "${config.agentId}" does not support resumeThreadId.`);
  }

  return config.resume.args(options.resumeThreadId, options.cwd ?? process.cwd());
}

export function spawnStreaming(input: SpawnStreamingOptions): SpawnStreamingResult {
  const options = normalizeSpawnStreamingOptions(input);

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

  const capturePromise = startCapture(options.agentId, options);
  const mcpArgs = getMcpArgs(spawnConfig, options.mcpServers);
  const mcpEnvVars = getMcpEnv(spawnConfig, options.mcpServers);
  const resumeArgs = getResumeArgs(spawnConfig, options);
  const defaultArgsPosition = getDefaultArgsPosition(spawnConfig);
  const mcpArgsPosition = getMcpArgsPosition(spawnConfig);
  const resumeArgsPosition = spawnConfig.resume?.position ?? "afterPrompt";
  const commandOptionsBeforeResume =
    resumeArgs.length > 0 && spawnConfig.resume?.commandOptionsPosition === "beforeResume";
  const useStdin = shouldSendPromptViaStdin(spawnConfig, options);
  const args: string[] = [];
  const promptArgIndexes = new Set<number>();
  const pushPromptArg = () => {
    promptArgIndexes.add(args.length);
    args.push(options.prompt);
  };
  const pushPromptOrStdinArgs = () => {
    if (useStdin) {
      args.push(...spawnConfig.stdinMode!.extraArgs);
      return;
    }
    pushPromptArg();
  };
  const commandOptionArgs: string[] = [];

  if (mcpArgsPosition === "beforeCommand") {
    args.push(...mcpArgs);
  }

  if (defaultArgsPosition === "beforePrompt") {
    args.push(...spawnConfig.defaultArgs);
  }

  if (mcpArgsPosition === "beforePrompt") {
    args.push(...mcpArgs);
  }

  if (spawnConfig.promptFlag) {
    args.push(spawnConfig.promptFlag);
  }

  const modelOverride = normalizeModelOverride(options.model);
  if (modelOverride && spawnConfig.modelFlag) {
    let model = spawnConfig.modelStripProviderPrefix
      ? stripModelNamespace(modelOverride)
      : modelOverride;
    if (spawnConfig.modelTransform) model = spawnConfig.modelTransform(model);
    commandOptionArgs.push(spawnConfig.modelFlag, model);
  }

  if (defaultArgsPosition === "afterPrompt") {
    commandOptionArgs.push(...spawnConfig.defaultArgs);
  }

  if (mcpArgsPosition === "afterCommand") {
    commandOptionArgs.push(...mcpArgs);
  }

  const modeResolved = resolveAgentModeConfig(spawnConfig, options.mode);
  commandOptionArgs.push(...modeResolved.args);

  const runArgs = async (): Promise<{
    args: string[];
    env: Record<string, string | undefined>;
    capture?: NativeOtelCapture;
  }> => {
    const capture = await capturePromise;
    return {
      args: capture?.args ?? [],
      env: { ...(capture?.env ?? {}), ...(options.env ?? {}) },
      ...(capture ? { capture } : {})
    };
  };

  if (commandOptionsBeforeResume) {
    args.push(...commandOptionArgs);
    if (options.args && options.args.length > 0) {
      args.push(...options.args);
    }
    args.push(...resumeArgs);
    pushPromptOrStdinArgs();
  } else {
    if (resumeArgsPosition === "beforePrompt") {
      args.push(...resumeArgs);
    }
    if (!useStdin || !spawnConfig.stdinMode?.omitPrompt) {
      pushPromptArg();
    }
    args.push(...commandOptionArgs);
    if (useStdin) {
      args.push(...spawnConfig.stdinMode!.extraArgs);
    }
  }

  if (options.args && options.args.length > 0 && !commandOptionsBeforeResume) {
    if (resumeArgsPosition === "afterPrompt") {
      args.push(...resumeArgs);
    }
    args.push(...options.args);
  } else if (resumeArgsPosition === "afterPrompt" && !commandOptionsBeforeResume) {
    args.push(...resumeArgs);
  }

  const cwd = options.cwd ?? process.cwd();
  const queue = createLineQueue();

  const result: SpawnResult = { stdout: "", stderr: "", exitCode: 1 };
  const adapter = getAdapter(spawnConfig.adapter);
  let resolveEventStreamDone: (() => void) | undefined;
  let rejectEventStreamDone: ((error: unknown) => void) | undefined;
  const eventStreamDone = new Promise<void>((resolve, reject) => {
    resolveEventStreamDone = resolve;
    rejectEventStreamDone = reject;
  });
  const eventQueue: AcpEvent[] = [];
  const waiters: Array<{
    resolve(result: IteratorResult<AcpEvent>): void;
    reject(error: unknown): void;
  }> = [];
  let eventsDone = false;
  let eventStreamError: unknown;
  const ctx: SpawnContext = {
    sessionId: "unknown",
    agent: agentId,
    ...(options.logPath !== undefined ? { logPath: options.logPath } : {}),
    ...(options.logDir !== undefined ? { logDir: options.logDir } : {}),
    ...(options.logFileName !== undefined ? { logFileName: options.logFileName } : {}),
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0
    },
    prompt: options.prompt,
    model: modelOverride,
    mode: options.mode,
    cwd: options.cwd ?? process.cwd(),
    startedAt: new Date()
  };

  const pushEvent = (event: AcpEvent): void => {
    if (eventsDone) return;
    if (event.event === "session_start") {
      const threadId = (event as { threadId?: unknown }).threadId;
      if (typeof threadId === "string" && threadId.length > 0) {
        ctx.threadId = threadId;
        ctx.sessionId = threadId;
      }
    }
    ctx.events.push(event);
    accumulateUsage(ctx, event);
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: event });
      return;
    }
    eventQueue.push(event);
  };

  const completeEventStream = (): void => {
    if (eventsDone) return;
    eventsDone = true;
    while (waiters.length > 0) {
      waiters.shift()?.resolve({ done: true, value: undefined });
    }
  };

  const failEventStream = (error: unknown): void => {
    if (eventsDone) return;
    eventStreamError = error;
    eventsDone = true;
    while (waiters.length > 0) {
      waiters.shift()?.reject(error);
    }
  };

  ctx.eventStream = {
    [Symbol.asyncIterator](): AsyncIterator<AcpEvent> {
      return {
        next(): Promise<IteratorResult<AcpEvent>> {
          if (eventQueue.length > 0) {
            return Promise.resolve({ done: false, value: eventQueue.shift()! });
          }
          if (eventStreamError) {
            return Promise.reject(eventStreamError);
          }
          if (eventsDone) {
            return Promise.resolve({ done: true, value: undefined });
          }
          return new Promise((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        }
      };
    }
  };

  const manifest = bridgeResourcesForRun(options.agentId, cwd, options.skills, options.hooks);

  void (async () => {
    try {
      for await (const output of adapter(queue.lines())) {
        if (!isAcpEvent(output)) continue;
        pushEvent(stampReceiveTime(output, Date.now()));
      }
      completeEventStream();
      resolveEventStreamDone?.();
    } catch (error) {
      failEventStream(error);
      rejectEventStreamDone?.(error);
    }
  })();

  const hasMiddlewares = options.middlewares !== undefined && options.middlewares.length > 0;
  let resolveMiddlewaresApplied: (() => void) | undefined;
  const middlewaresApplied = hasMiddlewares
    ? new Promise<void>((resolve) => {
        resolveMiddlewaresApplied = resolve;
      })
    : undefined;

  const done = (async (): Promise<SpawnResult> => {
    let restoreMcpFile: (() => Promise<void>) | undefined;
    try {
      restoreMcpFile =
        options.mcpServers && spawnConfig.mcpFile
          ? await applyMcpFile(spawnConfig.mcpFile, options.mcpServers, cwd)
          : undefined;

      await applyMiddlewares(
        [
          ...(options.middlewares ?? []),
          async (_ctx, next) => {
            const nativeOtel = await runArgs();
            const spawnArgs = [...args, ...nativeOtel.args];
            const envOverrides = mergeEnvironment(
              mcpEnvVars,
              modeResolved.env,
              nativeOtel.env
            );
            const processEnv =
              Object.keys(envOverrides).length > 0
                ? mergeSpawnEnvironment(process.env, envOverrides)
                : undefined;
            const execution = resolveSpawnExecution({
              cwd,
              runtimeConfigCwd: options.runtimeConfigCwd,
              env: (processEnv ?? process.env) as Record<string, string>,
              argv: [binaryName, ...spawnArgs],
              displayArgv: [binaryName, ...redactPromptArgIndexes(spawnArgs, promptArgIndexes)],
              tool: agentId,
              runtime: {
                runtime: options.runtime,
                runtimeImage: options.runtimeImage,
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
                  activityTimeoutSource: "stdout",
                  onStdout(chunk: string) {
                    if (options.tee?.stdout) options.tee.stdout.write(chunk);
                    queue.push(chunk);
                  },
                  onStderr(chunk: string) {
                    if (options.tee?.stderr) options.tee.stderr.write(chunk);
                  }
                }
              }
            });
            try {
              const runResult = await runPoeCommand({
                factory: execution.factory,
                openSpec: execution.openSpec,
                detach: execution.detach,
                state: execution.state,
                signal: options.signal
              });

              if (runResult.kind === "detached") {
                result.stdout = "";
                result.stderr = "";
                result.exitCode = 0;
                result.detached = { jobId: runResult.jobId, envId: runResult.envId };
              } else {
                result.stderr = runResult.stderr ?? "";
                result.exitCode = runResult.exitCode;
              }
            } finally {
              queue.close();
            }
            await eventStreamDone;
            if (nativeOtel.capture) {
              ctx.metadata = {
                ...ctx.metadata,
                nativeOtelCorrelationId: nativeOtel.capture.correlationId,
                nativeOtel: await nativeOtel.capture.drain()
              };
            }
            await next();
          }
        ],
        ctx
      );
      return {
        ...result,
        ...(ctx.logFile && !result.logFile ? { logFile: ctx.logFile } : {})
      };
    } finally {
      resolveMiddlewaresApplied?.();
      queue.close();
      await restoreMcpFile?.();
      cleanupResourcesForRun(manifest);
    }
  })();

  const events =
    hasMiddlewares
      ? {
          [Symbol.asyncIterator](): AsyncIterator<AcpEvent> {
            let iterator: AsyncIterator<AcpEvent> | undefined;
            return {
              async next(): Promise<IteratorResult<AcpEvent>> {
                await middlewaresApplied;
                iterator ??= ctx.eventStream![Symbol.asyncIterator]();
                return iterator.next();
              }
            };
          }
        }
      : ctx.eventStream;

  return {
    events,
    done: observeAgentSpawn(
      {
        agent: agentId,
        cwd: options.cwd,
        mode: options.mode,
        otelSink: options.otelSink,
        prompt: options.prompt
      },
      () => done
    )
  };
}

function mergeEnvironment(
  ...sources: Array<Record<string, string | undefined> | undefined>
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value === undefined) {
        merged[key] = undefined;
        continue;
      }
      const existing = merged[key];
      merged[key] = existing === undefined ? value : mergeJsonObjectStrings(existing, value);
    }
  }
  return merged;
}

function mergeJsonObjectStrings(left: string, right: string): string {
  try {
    const leftValue = JSON.parse(left) as unknown;
    const rightValue = JSON.parse(right) as unknown;
    if (isObject(leftValue) && isObject(rightValue)) {
      return JSON.stringify(deepMerge(leftValue, rightValue));
    }
  } catch {
    return right;
  }
  return right;
}

function deepMerge(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = merged[key];
    merged[key] = isObject(existing) && isObject(value) ? deepMerge(existing, value) : value;
  }
  return merged;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function startCapture(
  agentId: string,
  options: Pick<SpawnOptions, "captureOtel" | "captureOtelContent" | "runtime">
): Promise<NativeOtelCapture | undefined> {
  if (!options.captureOtel) return undefined;
  if (options.runtime !== undefined && options.runtime !== "host") {
    console.warn("warning: native OpenTelemetry capture currently supports only the host runtime");
    return undefined;
  }
  return startNativeOtelCapture(agentId, options.captureOtelContent);
}

function normalizeSpawnStreamingOptions(options: SpawnStreamingOptions): SpawnStreamingOptions {
  const normalized = createNullRecord<SpawnStreamingOptions>({
    agentId: getOwnProperty(options, "agentId") as SpawnStreamingOptions["agentId"],
    prompt: getOwnProperty(options, "prompt") as SpawnStreamingOptions["prompt"],
    mode: (getOwnProperty(options, "mode") ?? DEFAULT_SPAWN_MODE) as SpawnMode
  });
  const optionalNames: readonly (keyof SpawnStreamingOptions)[] = [
    "cwd", "model", "args", "mcpServers", "skills", "hooks", "resumeThreadId",
    "useStdin", "interactive", "signal", "otelSink", "captureOtel", "captureOtelContent", "env",
    "middlewares", "tee", "activityTimeoutMs", "logPath", "logDir", "logFileName", "runtime",
    "runtimeImage", "runtimeConfigCwd", "detach", "mountPoeCode", "runnerSync"
  ];
  for (const name of optionalNames) {
    const value = getOwnProperty(options, name);
    if (value !== undefined) Object.assign(normalized, { [name]: value });
  }
  return normalized;
}

function getOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): unknown {
  return hasOwnProperty(value, name) ? value[name] : undefined;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function createNullRecord<T extends object>(value: T): T {
  return Object.assign(Object.create(null) as T, value);
}
