import { AsyncLocalStorage } from "node:async_hooks";

import { supportsSpawnMode } from "@poe-code/agent-spawn/configs";
import {
  createSpawnParallel,
  SpawnParallelError,
  type SpawnParallelOptions
} from "@poe-code/agent-spawn/parallel";
import { DEFAULT_SPAWN_MODE, type SpawnUsage } from "@poe-code/agent-spawn/types";
import { hostErrorData } from "../error/shape.js";
import {
  bindOtelSpan,
  activateOtelSpan,
  getActiveOtelSink,
  safeAddEvent,
  safeEndSpan,
  safeRecordException,
  safeStartSpan,
  type OtelSink
} from "../observability/otel.js";

export type AgentSpawnMode = "read" | "edit" | "auto" | "yolo";

export type AgentModuleMcpServer = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
};

export type AgentModuleMcpConfig = Record<string, AgentModuleMcpServer>;

export type AgentModuleDefinition =
  | string
  | {
      agent: string;
      prompt?: string;
      model?: string;
      mode?: AgentSpawnMode;
      cwd?: string;
      mcp?: AgentModuleMcpConfig;
    };

export type AgentModuleSpawnOptions = {
  prompt: string;
  check?: boolean;
  label?: string;
  mcp?: AgentModuleMcpConfig;
  model?: string;
  mode?: AgentSpawnMode;
  cwd?: string;
  otelSink?: OtelSink;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type SpawnAgentInput = Omit<AgentModuleSpawnOptions, "label" | "check"> & {
  agent: string;
};

type ResolvedSpawnAgentInput = SpawnAgentInput & { label?: string; check: boolean };

export type SpawnAgentResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
  durationMs: number;
  usage?: SpawnUsage;
};

export type SpawnAgent = (input: SpawnAgentInput) => Promise<SpawnAgentResult>;

export class AgentSpawnError extends Error {
  readonly result: SpawnAgentResult;

  constructor(result: SpawnAgentResult) {
    super(createSpawnFailureMessage(result));
    this.name = "AgentSpawnError";
    this.result = result;
    hostErrorData.set(this, { result });
  }
}

export type AgentModuleOptions = {
  defaultRetry?: AgentModuleRetryOptions;
  onEvent?: (event: AgentSpawnEvent) => void | Promise<void>;
  otelSink?: OtelSink;
};

export type AgentSpawnEvent =
  | {
      type: "spawn.started";
      spawnId: number;
      agent: string;
      task: string;
      attempt: number;
      maxAttempts: number;
    }
  | {
      type: "spawn.retry";
      spawnId: number;
      agent: string;
      task: string;
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      error: string;
    }
  | {
      type: "spawn.succeeded";
      spawnId: number;
      agent: string;
      task: string;
      attempt: number;
      maxAttempts: number;
      durationMs: number;
    }
  | {
      type: "spawn.failed";
      checked: boolean;
      spawnId: number;
      agent: string;
      task: string;
      attempt: number;
      maxAttempts: number;
      durationMs: number;
      error: string;
    }
  | {
      type: "spawn.cancelled";
      spawnId: number;
      agent: string;
      task: string;
      attempt: number;
      maxAttempts: number;
      durationMs: number;
      reason: string;
    };

export type SpawnUsageTotal = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd?: number;
  spawnCount: number;
  attemptCount?: number;
};

export type SpawnUsageAccumulator = {
  beginAttempt?(): void;
  beginSpawn?(): void;
  record(usage: SpawnUsage | undefined): void;
  reset(): void;
  snapshot(): SpawnUsageTotal;
};

const activeUsageAccumulator = new AsyncLocalStorage<SpawnUsageAccumulator>();

export function createSpawnUsageAccumulator(): SpawnUsageAccumulator {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let costUsd: number | undefined;
  let spawnCount = 0;
  let attemptCount = 0;

  return {
    beginAttempt() {
      attemptCount += 1;
    },
    beginSpawn() {
      spawnCount += 1;
    },
    record(usage) {
      if (usage === undefined) {
        return;
      }

      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      cachedTokens += usage.cachedTokens ?? 0;

      if (usage.costUsd !== undefined) {
        costUsd = (costUsd ?? 0) + usage.costUsd;
      }
    },
    reset() {
      inputTokens = 0;
      outputTokens = 0;
      cachedTokens = 0;
      costUsd = undefined;
      spawnCount = 0;
      attemptCount = 0;
    },
    snapshot() {
      return {
        inputTokens,
        outputTokens,
        cachedTokens,
        ...(costUsd === undefined ? {} : { costUsd }),
        spawnCount,
        ...(attemptCount === spawnCount ? {} : { attemptCount })
      };
    }
  };
}

export async function runWithSpawnUsageAccumulator<TResult>(
  accumulator: SpawnUsageAccumulator,
  operation: () => Promise<TResult>
): Promise<TResult> {
  accumulator.reset();
  return await activeUsageAccumulator.run(accumulator, operation);
}

export type AgentModuleRetryOptions = {
  maxAttempts: number;
  backoffMs: number;
  isErrorRetryable?: (error: unknown) => boolean;
  isRetryable?: (result: SpawnAgentResult) => boolean;
};

export type AgentModuleParallelCall =
  | readonly [agentDef: AgentModuleDefinition, options: AgentModuleSpawnOptions]
  | ((signal?: AbortSignal) => {
      events: AsyncIterable<never>;
      result: Promise<SpawnAgentResult>;
    });

type AgentModuleSpawn = {
  (agentDef: AgentModuleDefinition, options: AgentModuleSpawnOptions): Promise<SpawnAgentResult>;
  retry(
    agentDef: AgentModuleDefinition,
    options: AgentModuleSpawnOptions,
    retryOptions: AgentModuleRetryOptions
  ): Promise<SpawnAgentResult>;
  parallel(
    calls: AgentModuleParallelCall[],
    options?: SpawnParallelOptions
  ): Promise<SpawnAgentResult[]>;
};

export function makeAgentModule(
  spawnAgent: SpawnAgent,
  moduleOptions: AgentModuleOptions = {}
): {
  spawn: AgentModuleSpawn;
} {
  const defaultRetry =
    moduleOptions.defaultRetry === undefined
      ? undefined
      : normalizeRetryOptions(moduleOptions.defaultRetry);
  let nextSpawnId = 1;

  const spawnOnce = async (
    agentDef: AgentModuleDefinition,
    options: AgentModuleSpawnOptions
  ): Promise<SpawnAgentResult> => {
    const input = resolveSpawnInput(agentDef, options);
    const spawnId = nextSpawnId;
    nextSpawnId += 1;
    recordActiveSpawnStart();
    return runObservedSpawn(moduleOptions.otelSink, input, async () => {
      return defaultRetry === undefined
        ? runSpawnAttempt(spawnAgent, input, moduleOptions.onEvent, spawnId)
        : runSpawnRetry(spawnAgent, input, defaultRetry, moduleOptions.onEvent, spawnId);
    });
  };

  return {
    spawn: Object.assign(spawnOnce, {
      async retry(
        agentDef: AgentModuleDefinition,
        options: AgentModuleSpawnOptions,
        retryOptions: AgentModuleRetryOptions
      ) {
        const input = resolveSpawnInput(agentDef, options);
        const normalizedRetry = normalizeRetryOptions(retryOptions);
        const spawnId = nextSpawnId;
        nextSpawnId += 1;
        recordActiveSpawnStart();
        return await runObservedSpawn(moduleOptions.otelSink, input, () =>
          runSpawnRetry(
            spawnAgent,
            input,
            normalizedRetry,
            moduleOptions.onEvent,
            spawnId
          )
        );
      },
      async parallel(calls: AgentModuleParallelCall[], options: SpawnParallelOptions = {}) {
        const check =
          readOptionalBoolean(getOwnProperty(options, "check"), "Agent parallel options check") ??
          false;
        const parallel = createSpawnParallel<
          AgentModuleDefinition,
          AgentModuleSpawnOptions,
          SpawnAgentResult
        >((agentDef, spawnOptions) => ({
          events: (async function* () {})(),
          result: (() => {
            const input = resolveSpawnInput(agentDef, spawnOptions);
            const spawnId = nextSpawnId;
            nextSpawnId += 1;
            recordActiveSpawnStart();
            return runObservedSpawn(moduleOptions.otelSink, input, () =>
              runSpawnRetry(
                spawnAgent,
                input,
                defaultRetry ?? oneAttemptRetryOptions,
                (event) =>
                  moduleOptions.onEvent?.(
                    event.type === "spawn.failed"
                      ? { ...event, checked: event.checked || check }
                      : event
                  ),
                spawnId
              )
            );
          })()
        }));
        try {
          return await parallel(calls, { ...options, check });
        } catch (error) {
          if (error instanceof SpawnParallelError) {
            hostErrorData.set(error, {
              index: error.index,
              result: error.result,
              results: error.results
            });
          }
          throw error;
        }
      }
    })
  };
}

async function runSpawnAttempt(
  spawnAgent: SpawnAgent,
  input: ResolvedSpawnAgentInput,
  onEvent: ((event: AgentSpawnEvent) => void | Promise<void>) | undefined,
  spawnId: number
): Promise<SpawnAgentResult> {
  const task = resolveTaskLabel(input);
  const startedAt = Date.now();
  try {
    throwIfAborted(input.signal);
  } catch (error) {
    emitSpawnCancelled(onEvent, spawnId, input.agent, task, 1, 1, Date.now() - startedAt, error);
    throw error;
  }
  emitSpawnEvent(onEvent, {
    type: "spawn.started",
    spawnId,
    agent: input.agent,
    task,
    attempt: 1,
    maxAttempts: 1
  });

  try {
    recordActiveSpawnAttempt();
    const result = validateSpawnResult(await spawnAgent(toProviderSpawnInput(input)));
    throwIfAborted(input.signal);
    recordActiveSpawnUsage(result.usage);

    if (result.exitCode !== 0) {
      const error = new AgentSpawnError(result);
      if (input.check) {
        throw error;
      }
      emitFinalSpawnFailure(
        onEvent,
        spawnId,
        input.agent,
        task,
        1,
        1,
        result.durationMs,
        error,
        false
      );
      return result;
    }

    emitSpawnEvent(onEvent, {
      type: "spawn.succeeded",
      spawnId,
      agent: input.agent,
      task,
      attempt: 1,
      maxAttempts: 1,
      durationMs: result.durationMs
    });
    return result;
  } catch (error) {
    if (isAbortError(error, input.signal)) {
      const reason = input.signal?.aborted ? readAbortReason(input.signal) : error;
      emitSpawnCancelled(onEvent, spawnId, input.agent, task, 1, 1, Date.now() - startedAt, reason);
      throw reason;
    }
    emitSpawnEvent(onEvent, {
      type: "spawn.failed",
      checked: true,
      spawnId,
      agent: input.agent,
      task,
      attempt: 1,
      maxAttempts: 1,
      durationMs: Date.now() - startedAt,
      error: formatSpawnError(error)
    });
    throw error;
  }
}

function runObservedSpawn(
  moduleSink: OtelSink | undefined,
  input: ResolvedSpawnAgentInput,
  operation: () => Promise<SpawnAgentResult>
): Promise<SpawnAgentResult> {
  const otelSink = input.otelSink ?? moduleSink ?? getActiveOtelSink();
  const cwd = input.cwd ?? readCurrentWorkingDirectory();
  const span = safeStartSpan(otelSink, "agent.spawn", {
    agent: input.agent,
    mode: input.mode ?? DEFAULT_SPAWN_MODE,
    cwd
  });
  const deactivateSpan = activateOtelSpan(span);
  safeAddEvent(span, "prompt", { prompt: input.prompt });

  const promise = (async () => {
    try {
      const result = await operation();
      safeAddEvent(span, "summary", { summary: result.summary });
      safeAddEvent(span, "exit", {
        exitCode: result.exitCode,
        durationMs: result.durationMs
      });
      return result;
    } catch (error) {
      safeRecordException(otelSink, span, error);
      throw error;
    } finally {
      deactivateSpan();
      safeEndSpan(span);
    }
  })();

  bindOtelSpan(promise, span);
  return promise;
}

function readCurrentWorkingDirectory(): string {
  try {
    return process.cwd();
  } catch (error) {
    throw new Error(`Unable to resolve current working directory: ${formatSpawnError(error)}`);
  }
}

async function runSpawnRetry(
  spawnAgent: SpawnAgent,
  input: ResolvedSpawnAgentInput,
  retryOptions: Required<AgentModuleRetryOptions>,
  onEvent: ((event: AgentSpawnEvent) => void | Promise<void>) | undefined,
  spawnId: number
): Promise<SpawnAgentResult> {
  const task = resolveTaskLabel(input);
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= retryOptions.maxAttempts; attempt += 1) {
    try {
      throwIfAborted(input.signal);
    } catch (error) {
      emitSpawnCancelled(
        onEvent,
        spawnId,
        input.agent,
        task,
        attempt,
        retryOptions.maxAttempts,
        Date.now() - startedAt,
        error
      );
      throw error;
    }
    emitSpawnEvent(onEvent, {
      type: "spawn.started",
      spawnId,
      agent: input.agent,
      task,
      attempt,
      maxAttempts: retryOptions.maxAttempts
    });

    let result: SpawnAgentResult;
    try {
      recordActiveSpawnAttempt();
      result = validateSpawnResult(await spawnAgent(toProviderSpawnInput(input)));
      throwIfAborted(input.signal);
    } catch (error) {
      if (isAbortError(error, input.signal)) {
        const reason = input.signal?.aborted ? readAbortReason(input.signal) : error;
        emitSpawnCancelled(
          onEvent,
          spawnId,
          input.agent,
          task,
          attempt,
          retryOptions.maxAttempts,
          Date.now() - startedAt,
          reason
        );
        throw reason;
      }

      if (attempt >= retryOptions.maxAttempts) {
        emitFinalSpawnFailure(
          onEvent,
          spawnId,
          input.agent,
          task,
          attempt,
          retryOptions.maxAttempts,
          Date.now() - startedAt,
          error
        );
        throw error;
      }

      let retryable: boolean;
      try {
        retryable = retryOptions.isErrorRetryable(error);
      } catch (classifierError) {
        emitFinalSpawnFailure(
          onEvent,
          spawnId,
          input.agent,
          task,
          attempt,
          retryOptions.maxAttempts,
          Date.now() - startedAt,
          classifierError
        );
        throw classifierError;
      }

      if (!retryable) {
        emitFinalSpawnFailure(
          onEvent,
          spawnId,
          input.agent,
          task,
          attempt,
          retryOptions.maxAttempts,
          Date.now() - startedAt,
          error
        );
        throw error;
      }

      try {
        await retryOrThrow(
          error,
          input,
          retryOptions,
          onEvent,
          spawnId,
          task,
          attempt,
          Date.now() - startedAt
        );
      } catch (retryError) {
        if (isAbortError(retryError, input.signal)) {
          emitSpawnCancelled(
            onEvent,
            spawnId,
            input.agent,
            task,
            attempt,
            retryOptions.maxAttempts,
            Date.now() - startedAt,
            retryError
          );
        }
        throw retryError;
      }
      continue;
    }

    recordActiveSpawnUsage(result.usage);
    if (result.exitCode === 0) {
      emitSpawnEvent(onEvent, {
        type: "spawn.succeeded",
        spawnId,
        agent: input.agent,
        task,
        attempt,
        maxAttempts: retryOptions.maxAttempts,
        durationMs: Date.now() - startedAt
      });
      return result;
    }

    const error = new AgentSpawnError(result);
    if (attempt >= retryOptions.maxAttempts) {
      emitFinalSpawnFailure(
        onEvent,
        spawnId,
        input.agent,
        task,
        attempt,
        retryOptions.maxAttempts,
        Date.now() - startedAt,
        error,
        input.check
      );
      if (input.check) {
        throw error;
      }
      return result;
    }

    let retryable: boolean;
    try {
      retryable = retryOptions.isRetryable(result);
    } catch (classifierError) {
      emitFinalSpawnFailure(
        onEvent,
        spawnId,
        input.agent,
        task,
        attempt,
        retryOptions.maxAttempts,
        Date.now() - startedAt,
        classifierError
      );
      throw classifierError;
    }

    if (!retryable) {
      emitFinalSpawnFailure(
        onEvent,
        spawnId,
        input.agent,
        task,
        attempt,
        retryOptions.maxAttempts,
        Date.now() - startedAt,
        error,
        input.check
      );
      if (input.check) {
        throw error;
      }
      return result;
    }

    try {
      await scheduleRetry(error, input, retryOptions, onEvent, spawnId, task, attempt);
    } catch (retryError) {
      if (isAbortError(retryError, input.signal)) {
        emitSpawnCancelled(
          onEvent,
          spawnId,
          input.agent,
          task,
          attempt,
          retryOptions.maxAttempts,
          Date.now() - startedAt,
          retryError
        );
      }
      throw retryError;
    }
  }

  throw new Error("agent.spawn.retry reached an unreachable retry state.");
}

function emitSpawnCancelled(
  onEvent: ((event: AgentSpawnEvent) => void | Promise<void>) | undefined,
  spawnId: number,
  agent: string,
  task: string,
  attempt: number,
  maxAttempts: number,
  durationMs: number,
  error: unknown
): void {
  emitSpawnEvent(onEvent, {
    type: "spawn.cancelled",
    spawnId,
    agent,
    task,
    attempt,
    maxAttempts,
    durationMs,
    reason: formatSpawnError(error)
  });
}

async function retryOrThrow(
  error: unknown,
  input: ResolvedSpawnAgentInput,
  retryOptions: Required<AgentModuleRetryOptions>,
  onEvent: ((event: AgentSpawnEvent) => void | Promise<void>) | undefined,
  spawnId: number,
  task: string,
  attempt: number,
  durationMs: number
): Promise<void> {
  if (attempt >= retryOptions.maxAttempts) {
    emitFinalSpawnFailure(
      onEvent,
      spawnId,
      input.agent,
      task,
      attempt,
      retryOptions.maxAttempts,
      durationMs,
      error
    );
    throw error;
  }

  await scheduleRetry(error, input, retryOptions, onEvent, spawnId, task, attempt);
}

async function scheduleRetry(
  error: unknown,
  input: ResolvedSpawnAgentInput,
  retryOptions: Required<AgentModuleRetryOptions>,
  onEvent: ((event: AgentSpawnEvent) => void | Promise<void>) | undefined,
  spawnId: number,
  task: string,
  attempt: number
): Promise<void> {
  const delayMs = calculateBackoffMs(retryOptions.backoffMs, attempt);
  emitSpawnEvent(onEvent, {
    type: "spawn.retry",
    spawnId,
    agent: input.agent,
    task,
    attempt,
    maxAttempts: retryOptions.maxAttempts,
    delayMs,
    error: formatSpawnError(error)
  });
  await sleep(delayMs, input.signal);
}

function emitFinalSpawnFailure(
  onEvent: ((event: AgentSpawnEvent) => void | Promise<void>) | undefined,
  spawnId: number,
  agent: string,
  task: string,
  attempt: number,
  maxAttempts: number,
  durationMs: number,
  error: unknown,
  checked = true
): void {
  emitSpawnEvent(onEvent, {
    type: "spawn.failed",
    checked,
    spawnId,
    agent,
    task,
    attempt,
    maxAttempts,
    durationMs,
    error: formatSpawnError(error)
  });
}

function emitSpawnEvent(
  onEvent: ((event: AgentSpawnEvent) => void | Promise<void>) | undefined,
  event: AgentSpawnEvent
): void {
  try {
    const agent = sanitizeLifecycleText(event.agent, 48) || "agent";
    const result = onEvent?.({ ...event, agent });
    if (isPromiseLike(result)) {
      void result.catch((error) => warnSpawnEventObserverFailure(error));
    }
  } catch (error) {
    warnSpawnEventObserverFailure(error);
  }
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    "catch" in value &&
    typeof value.catch === "function"
  );
}

function warnSpawnEventObserverFailure(error: unknown): void {
  console.warn(`Agent spawn event observer failed: ${formatSpawnError(error)}`);
}

function createTaskLabel(prompt: string): string {
  const lines = prompt.split("\n").map((line) => line.trim());
  const taskHeadingIndex = lines.indexOf("# Task");
  const relevantLines = taskHeadingIndex < 0 ? lines : lines.slice(taskHeadingIndex + 1);
  const firstLine = sanitizeLifecycleText(
    relevantLines.find((line) => line.length > 0) ?? "agent task",
    72
  );
  if (firstLine.length === 0) {
    return "agent task";
  }
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
}

function resolveTaskLabel(input: ResolvedSpawnAgentInput): string {
  return input.label ?? createTaskLabel(input.prompt);
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || readErrorField(error, "name") === "AbortError";
}

function formatSpawnError(error: unknown): string {
  return sanitizeLifecycleText(readErrorField(error, "message") ?? String(error), 400);
}

function sanitizeLifecycleText(value: string, maxLength: number): string {
  let sanitized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      character === "\n" ||
      character === "\r" ||
      character === "\t" ||
      code < 32 ||
      code === 127
    ) {
      sanitized += " ";
    } else {
      sanitized += character;
    }
  }
  const compact = sanitized
    .split(" ")
    .filter((part) => part.length > 0)
    .join(" ");
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function readErrorField(error: unknown, field: "message" | "name"): string | undefined {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function normalizeRetryOptions(
  retryOptions: AgentModuleRetryOptions | unknown
): Required<AgentModuleRetryOptions> {
  if (!isRecord(retryOptions)) {
    throw new Error("Agent spawn retry options must be an object.");
  }

  const maxAttempts = readFiniteNumber(
    getOwnProperty(retryOptions, "maxAttempts"),
    "Agent spawn retry maxAttempts"
  );
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("Agent spawn retry maxAttempts must be an integer greater than or equal to 1.");
  }
  if (maxAttempts > 5) {
    throw new Error("Agent spawn retry maxAttempts must not exceed 5.");
  }

  const backoffMs = readNonNegativeFiniteNumber(
    getOwnProperty(retryOptions, "backoffMs"),
    "Agent spawn retry backoffMs"
  );

  const isRetryableValue = getOwnProperty(retryOptions, "isRetryable");
  if (isRetryableValue !== undefined && typeof isRetryableValue !== "function") {
    throw new Error("Agent spawn retry isRetryable must be a function.");
  }
  const isRetryable =
    isRetryableValue === undefined
      ? defaultIsRetryable
      : (isRetryableValue as (result: SpawnAgentResult) => boolean);

  const isErrorRetryableValue = getOwnProperty(retryOptions, "isErrorRetryable");
  if (isErrorRetryableValue !== undefined && typeof isErrorRetryableValue !== "function") {
    throw new Error("Agent spawn retry isErrorRetryable must be a function.");
  }

  return createNullRecord({
    maxAttempts,
    backoffMs,
    isErrorRetryable:
      isErrorRetryableValue === undefined
        ? () => true
        : (isErrorRetryableValue as (error: unknown) => boolean),
    isRetryable
  });
}

function defaultIsRetryable(result: SpawnAgentResult): boolean {
  return (
    result.exitCode === 1 ||
    result.exitCode === 124 ||
    result.exitCode === 125 ||
    result.exitCode === 137
  );
}

const oneAttemptRetryOptions: Required<AgentModuleRetryOptions> = {
  maxAttempts: 1,
  backoffMs: 0,
  isErrorRetryable: () => false,
  isRetryable: () => false
};

function calculateBackoffMs(baseBackoffMs: number, completedAttempt: number): number {
  return Math.min(baseBackoffMs * 2 ** (completedAttempt - 1), 30_000);
}

function sleep(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(readAbortReason(signal));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw readAbortReason(signal);
  }
}

function readAbortReason(signal: AbortSignal | undefined): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  const error = new Error("Agent spawn retry aborted");
  error.name = "AbortError";
  return error;
}

function resolveSpawnInput(
  agentDef: AgentModuleDefinition,
  options: AgentModuleSpawnOptions
): ResolvedSpawnAgentInput {
  const definition = normalizeAgentDefinition(agentDef);
  const normalizedOptions = normalizeSpawnOptions(options);
  const mode = normalizedOptions.mode ?? definition.mode;

  if (mode !== undefined && !supportsSpawnMode(definition.agent, mode)) {
    throw new Error(`Agent "${definition.agent}" does not support mode "${mode}".`);
  }

  return createNullRecord({
    agent: definition.agent,
    prompt: prependSystemPrompt(definition.prompt, normalizedOptions.prompt),
    check: normalizedOptions.check ?? false,
    ...(normalizedOptions.label !== undefined ? { label: normalizedOptions.label } : {}),
    ...((normalizedOptions.model ?? definition.model)
      ? { model: normalizedOptions.model ?? definition.model }
      : {}),
    ...((normalizedOptions.mode ?? definition.mode)
      ? { mode: normalizedOptions.mode ?? definition.mode }
      : {}),
    ...((normalizedOptions.cwd ?? definition.cwd)
      ? { cwd: normalizedOptions.cwd ?? definition.cwd }
      : {}),
    ...(normalizedOptions.otelSink !== undefined ? { otelSink: normalizedOptions.otelSink } : {}),
    ...((normalizedOptions.mcp ?? definition.mcp)
      ? { mcp: normalizedOptions.mcp ?? definition.mcp }
      : {}),
    ...(normalizedOptions.timeoutMs !== undefined
      ? { timeoutMs: normalizedOptions.timeoutMs }
      : {}),
    ...(normalizedOptions.signal !== undefined ? { signal: normalizedOptions.signal } : {})
  });
}

function normalizeAgentDefinition(
  agentDef: AgentModuleDefinition | unknown
): Exclude<AgentModuleDefinition, string> {
  if (typeof agentDef === "string") {
    return createNullRecord({
      agent: readRequiredAgent(agentDef)
    });
  }

  if (!isRecord(agentDef)) {
    throw new Error("Agent definition must be a string or object.");
  }

  const prompt = getOwnProperty(agentDef, "prompt");
  const model = getOwnProperty(agentDef, "model");
  const mode = getOwnProperty(agentDef, "mode");
  const cwd = getOwnProperty(agentDef, "cwd");
  const mcp = getOwnProperty(agentDef, "mcp");

  return createNullRecord({
    agent: readRequiredAgent(getOwnProperty(agentDef, "agent")),
    ...(prompt === undefined
      ? {}
      : { prompt: readOptionalString(prompt, "Agent definition prompt") }),
    ...(model === undefined ? {} : { model: readOptionalString(model, "Agent definition model") }),
    ...(mode === undefined ? {} : { mode: readSpawnMode(mode, "Agent definition mode") }),
    ...(cwd === undefined ? {} : { cwd: readOptionalString(cwd, "Agent definition cwd") }),
    ...(mcp === undefined ? {} : { mcp: readMcpConfig(mcp, "Agent definition mcp") })
  });
}

function normalizeSpawnOptions(
  options: AgentModuleSpawnOptions | unknown
): AgentModuleSpawnOptions {
  if (!isRecord(options)) {
    throw new Error("Agent spawn options must be an object.");
  }

  const label = getOwnProperty(options, "label");
  const model = getOwnProperty(options, "model");
  const mode = getOwnProperty(options, "mode");
  const cwd = getOwnProperty(options, "cwd");
  const otelSink = getOwnProperty(options, "otelSink");
  const mcp = getOwnProperty(options, "mcp");
  const timeoutMs = getOwnProperty(options, "timeoutMs");
  const signal = getOwnProperty(options, "signal");

  return createNullRecord({
    prompt: readRequiredPrompt(getOwnProperty(options, "prompt")),
    check: readOptionalBoolean(getOwnProperty(options, "check"), "Agent spawn options check"),
    ...(label === undefined
      ? {}
      : { label: readRequiredString(label, "Agent spawn options label") }),
    ...(model === undefined
      ? {}
      : { model: readOptionalString(model, "Agent spawn options model") }),
    ...(mode === undefined ? {} : { mode: readSpawnMode(mode, "Agent spawn options mode") }),
    ...(cwd === undefined ? {} : { cwd: readOptionalString(cwd, "Agent spawn options cwd") }),
    ...(otelSink === undefined ? {} : { otelSink: readOtelSink(otelSink) }),
    ...(mcp === undefined ? {} : { mcp: readMcpConfig(mcp, "Agent spawn options mcp") }),
    ...(timeoutMs === undefined
      ? {}
      : {
          timeoutMs: readNonNegativeFiniteNumber(timeoutMs, "Agent spawn options timeoutMs")
        }),
    ...(signal === undefined
      ? {}
      : { signal: readAbortSignal(signal, "Agent spawn options signal") })
  });
}

function toProviderSpawnInput(input: ResolvedSpawnAgentInput): SpawnAgentInput {
  const { label: ignoredLabel, check: ignoredCheck, ...providerInput } = input;
  void ignoredLabel;
  void ignoredCheck;
  return providerInput;
}

function readOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function validateSpawnResult(result: unknown): SpawnAgentResult {
  if (!isRecord(result)) {
    throw new Error("spawnAgent must resolve to an object result.");
  }

  const usage = getOwnProperty(result, "usage");

  return createNullRecord({
    exitCode: readFiniteNumber(getOwnProperty(result, "exitCode"), "spawnAgent result exitCode"),
    stdout: readOptionalString(getOwnProperty(result, "stdout"), "spawnAgent result stdout") ?? "",
    stderr: readOptionalString(getOwnProperty(result, "stderr"), "spawnAgent result stderr") ?? "",
    summary:
      readOptionalString(getOwnProperty(result, "summary"), "spawnAgent result summary") ?? "",
    durationMs: readNonNegativeFiniteNumber(
      getOwnProperty(result, "durationMs"),
      "spawnAgent result durationMs"
    ),
    ...(usage === undefined ? {} : { usage: readSpawnUsage(usage) })
  });
}

function recordActiveSpawnUsage(usage: SpawnUsage | undefined): void {
  activeUsageAccumulator.getStore()?.record(usage);
}

function recordActiveSpawnAttempt(): void {
  activeUsageAccumulator.getStore()?.beginAttempt?.();
}

function recordActiveSpawnStart(): void {
  activeUsageAccumulator.getStore()?.beginSpawn?.();
}

function readSpawnUsage(value: unknown): SpawnUsage {
  if (!isRecord(value)) {
    throw new Error("spawnAgent result usage must be an object.");
  }

  const cachedTokens = getOwnProperty(value, "cachedTokens");
  const costUsd = getOwnProperty(value, "costUsd");

  return createNullRecord({
    inputTokens: readNonNegativeFiniteNumber(
      getOwnProperty(value, "inputTokens"),
      "spawnAgent result usage inputTokens"
    ),
    outputTokens: readNonNegativeFiniteNumber(
      getOwnProperty(value, "outputTokens"),
      "spawnAgent result usage outputTokens"
    ),
    ...(cachedTokens === undefined
      ? {}
      : {
          cachedTokens: readNonNegativeFiniteNumber(
            cachedTokens,
            "spawnAgent result usage cachedTokens"
          )
        }),
    ...(costUsd === undefined
      ? {}
      : {
          costUsd: readNonNegativeFiniteNumber(costUsd, "spawnAgent result usage costUsd")
        })
  });
}

function prependSystemPrompt(systemPrompt: string | undefined, userPrompt: string): string {
  if (systemPrompt === undefined || systemPrompt.trim().length === 0) {
    return userPrompt;
  }

  return `${systemPrompt}\n\n# Task\n\n${userPrompt}`;
}

function createSpawnFailureMessage(result: SpawnAgentResult): string {
  const stderr = result.stderr.trim();
  const summary = result.summary.trim();
  return stderr.length > 0
    ? `Agent spawn failed with exit code ${result.exitCode}: ${stderr}`
    : summary.length > 0
      ? `Agent spawn failed with exit code ${result.exitCode}: ${summary}`
      : `Agent spawn failed with exit code ${result.exitCode}.`;
}

function readRequiredAgent(value: unknown): string {
  const agent = readOptionalString(value, "Agent definition agent")?.trim();

  if (agent === undefined || agent.length === 0) {
    throw new Error("Agent definition must define a non-empty agent.");
  }

  return agent;
}

function readRequiredString(value: unknown, label: string): string {
  const text = readOptionalString(value, label)?.trim();
  if (text === undefined || text.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return text;
}

function readRequiredPrompt(value: unknown): string {
  const prompt = readOptionalString(value, "Agent spawn options prompt");

  if (prompt === undefined || prompt.trim().length === 0) {
    throw new Error("Agent spawn options must define a non-empty prompt.");
  }

  return prompt;
}

function readSpawnMode(value: unknown, label: string): AgentSpawnMode {
  if (value === "read" || value === "edit" || value === "auto" || value === "yolo") {
    return value;
  }

  throw new Error(`${label} must be one of: read, edit, auto, yolo.`);
}

function readMcpConfig(value: unknown, label: string): AgentModuleMcpConfig {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const entries = Object.entries(value).map(
    ([name, server]) => [name, readMcpServer(server, `${label}.${name}`)] as const
  );
  return createNullRecord(Object.fromEntries(entries) as AgentModuleMcpConfig);
}

function readMcpServer(value: unknown, label: string): AgentModuleMcpServer {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const args = getOwnProperty(value, "args");
  const env = getOwnProperty(value, "env");
  const timeout = getOwnProperty(value, "timeout");

  return createNullRecord({
    command: readNonEmptyString(getOwnProperty(value, "command"), `${label}.command`),
    ...(args === undefined ? {} : { args: readStringArray(args, `${label}.args`) }),
    ...(env === undefined ? {} : { env: readStringRecord(env, `${label}.env`) }),
    ...(timeout === undefined
      ? {}
      : { timeout: readPositiveFiniteNumber(timeout, `${label}.timeout`) })
  });
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return [...value];
}

function readStringRecord(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const entries = Object.entries(value);

  if (entries.some(([, entry]) => typeof entry !== "string")) {
    throw new Error(`${label} must be a string record.`);
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  const text = readOptionalString(value, label);

  if (text === undefined || text.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return text;
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function readNonNegativeFiniteNumber(value: unknown, label: string): number {
  const number = readFiniteNumber(value, label);

  if (number < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }

  return number;
}

function readPositiveFiniteNumber(value: unknown, label: string): number {
  const number = readFiniteNumber(value, label);

  if (number <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }

  return number;
}

function readAbortSignal(value: unknown, label: string): AbortSignal {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { aborted?: unknown }).aborted !== "boolean" ||
    typeof (value as { addEventListener?: unknown }).addEventListener !== "function" ||
    typeof (value as { removeEventListener?: unknown }).removeEventListener !== "function"
  ) {
    throw new Error(`${label} must be an AbortSignal.`);
  }

  return value as AbortSignal;
}

function readOtelSink(value: unknown): OtelSink {
  if (
    !isRecord(value) ||
    typeof value.startSpan !== "function" ||
    typeof value.recordException !== "function"
  ) {
    throw new Error("Agent spawn options otelSink must be an OtelSink.");
  }

  return value as unknown as OtelSink;
}

function getOwnProperty<Name extends PropertyKey>(value: object, name: Name): unknown {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
