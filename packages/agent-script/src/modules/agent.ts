import { AsyncLocalStorage } from "node:async_hooks";

import { createSpawnParallel, type SpawnParallelOptions } from "@poe-code/agent-spawn";
import type { SpawnUsage } from "@poe-code/agent-spawn";
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

export type AgentSpawnMode = "read" | "edit" | "yolo";

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
  mcp?: AgentModuleMcpConfig;
  model?: string;
  mode?: AgentSpawnMode;
  cwd?: string;
  otelSink?: OtelSink;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type SpawnAgentInput = AgentModuleSpawnOptions & {
  agent: string;
};

export type SpawnAgentResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
  durationMs: number;
  usage?: SpawnUsage;
};

export type SpawnAgent = (input: SpawnAgentInput) => Promise<SpawnAgentResult>;

export type AgentModuleOptions = {
  otelSink?: OtelSink;
};

export type SpawnUsageTotal = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd?: number;
  spawnCount: number;
};

export type SpawnUsageAccumulator = {
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

  return {
    record(usage) {
      spawnCount += 1;

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
    },
    snapshot() {
      return {
        inputTokens,
        outputTokens,
        cachedTokens,
        ...(costUsd === undefined ? {} : { costUsd }),
        spawnCount
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
  const spawnOnce = async (
    agentDef: AgentModuleDefinition,
    options: AgentModuleSpawnOptions
  ): Promise<SpawnAgentResult> => {
    const input = resolveSpawnInput(agentDef, options);
    return runObservedSpawn(moduleOptions.otelSink, input, async () => {
      const result = validateSpawnResult(await spawnAgent(input));
      recordActiveSpawnUsage(result.usage);

      if (result.exitCode !== 0) {
        throw new Error(createSpawnFailureMessage(result));
      }

      return result;
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
        return await runObservedSpawn(moduleOptions.otelSink, input, () =>
          runSpawnRetry(spawnAgent, input, normalizeRetryOptions(retryOptions))
        );
      },
      parallel: createSpawnParallel<
        AgentModuleDefinition,
        AgentModuleSpawnOptions,
        SpawnAgentResult
      >((agentDef, options) => ({
        events: (async function* () {})(),
        result: (() => {
          const input = resolveSpawnInput(agentDef, options);
          return runObservedSpawn(moduleOptions.otelSink, input, async () => {
            const result = validateSpawnResult(await spawnAgent(input));
            recordActiveSpawnUsage(result.usage);
            return result;
          });
        })()
      }))
    })
  };
}

function runObservedSpawn(
  moduleSink: OtelSink | undefined,
  input: SpawnAgentInput,
  operation: () => Promise<SpawnAgentResult>
): Promise<SpawnAgentResult> {
  const otelSink = input.otelSink ?? moduleSink ?? getActiveOtelSink();
  const span = safeStartSpan(otelSink, "agent.spawn", {
    agent: input.agent,
    mode: input.mode ?? "yolo",
    cwd: input.cwd ?? process.cwd()
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

async function runSpawnRetry(
  spawnAgent: SpawnAgent,
  input: SpawnAgentInput,
  retryOptions: Required<AgentModuleRetryOptions>
): Promise<SpawnAgentResult> {
  for (let attempt = 1; attempt <= retryOptions.maxAttempts; attempt += 1) {
    throwIfAborted(input.signal);
    const result = validateSpawnResult(await spawnAgent(input));
    recordActiveSpawnUsage(result.usage);
    const isLastAttempt = attempt >= retryOptions.maxAttempts;

    if (result.exitCode === 0 || isLastAttempt || !retryOptions.isRetryable(result)) {
      return result;
    }

    await sleep(calculateBackoffMs(retryOptions.backoffMs, attempt), input.signal);
  }

  throw new Error("agent.spawn.retry reached an unreachable retry state.");
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

  const backoffMs = readNonNegativeFiniteNumber(
    getOwnProperty(retryOptions, "backoffMs"),
    "Agent spawn retry backoffMs"
  );

  const isRetryableValue = getOwnProperty(retryOptions, "isRetryable");
  if (isRetryableValue !== undefined && typeof isRetryableValue !== "function") {
    throw new Error("Agent spawn retry isRetryable must be a function.");
  }
  const isRetryable = isRetryableValue === undefined
    ? defaultIsRetryable
    : (isRetryableValue as (result: SpawnAgentResult) => boolean);

  return {
    maxAttempts,
    backoffMs,
    isRetryable
  };
}

function defaultIsRetryable(result: SpawnAgentResult): boolean {
  return (
    result.exitCode === 1 ||
    result.exitCode === 124 ||
    result.exitCode === 125 ||
    result.exitCode === 137
  );
}

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
      reject(createAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error("Agent spawn retry aborted");
  error.name = "AbortError";
  return error;
}

function resolveSpawnInput(
  agentDef: AgentModuleDefinition,
  options: AgentModuleSpawnOptions
): SpawnAgentInput {
  const definition = normalizeAgentDefinition(agentDef);
  const normalizedOptions = normalizeSpawnOptions(options);

  return {
    agent: definition.agent,
    prompt: prependSystemPrompt(definition.prompt, normalizedOptions.prompt),
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
  };
}

function normalizeAgentDefinition(
  agentDef: AgentModuleDefinition | unknown
): Exclude<AgentModuleDefinition, string> {
  if (typeof agentDef === "string") {
    return {
      agent: readRequiredAgent(agentDef)
    };
  }

  if (!isRecord(agentDef)) {
    throw new Error("Agent definition must be a string or object.");
  }

  const prompt = getOwnProperty(agentDef, "prompt");
  const model = getOwnProperty(agentDef, "model");
  const mode = getOwnProperty(agentDef, "mode");
  const cwd = getOwnProperty(agentDef, "cwd");
  const mcp = getOwnProperty(agentDef, "mcp");

  return {
    agent: readRequiredAgent(getOwnProperty(agentDef, "agent")),
    ...(prompt === undefined
      ? {}
      : { prompt: readOptionalString(prompt, "Agent definition prompt") }),
    ...(model === undefined
      ? {}
      : { model: readOptionalString(model, "Agent definition model") }),
    ...(mode === undefined
      ? {}
      : { mode: readSpawnMode(mode, "Agent definition mode") }),
    ...(cwd === undefined
      ? {}
      : { cwd: readOptionalString(cwd, "Agent definition cwd") }),
    ...(mcp === undefined ? {} : { mcp: readMcpConfig(mcp, "Agent definition mcp") })
  };
}

function normalizeSpawnOptions(
  options: AgentModuleSpawnOptions | unknown
): AgentModuleSpawnOptions {
  if (!isRecord(options)) {
    throw new Error("Agent spawn options must be an object.");
  }

  const model = getOwnProperty(options, "model");
  const mode = getOwnProperty(options, "mode");
  const cwd = getOwnProperty(options, "cwd");
  const otelSink = getOwnProperty(options, "otelSink");
  const mcp = getOwnProperty(options, "mcp");
  const timeoutMs = getOwnProperty(options, "timeoutMs");
  const signal = getOwnProperty(options, "signal");

  return {
    prompt: readRequiredPrompt(getOwnProperty(options, "prompt")),
    ...(model === undefined
      ? {}
      : { model: readOptionalString(model, "Agent spawn options model") }),
    ...(mode === undefined ? {} : { mode: readSpawnMode(mode, "Agent spawn options mode") }),
    ...(cwd === undefined
      ? {}
      : { cwd: readOptionalString(cwd, "Agent spawn options cwd") }),
    ...(otelSink === undefined ? {} : { otelSink: readOtelSink(otelSink) }),
    ...(mcp === undefined ? {} : { mcp: readMcpConfig(mcp, "Agent spawn options mcp") }),
    ...(timeoutMs === undefined
      ? {}
      : {
          timeoutMs: readNonNegativeFiniteNumber(timeoutMs, "Agent spawn options timeoutMs")
        }),
    ...(signal === undefined ? {} : { signal: readAbortSignal(signal, "Agent spawn options signal") })
  };
}

function validateSpawnResult(result: unknown): SpawnAgentResult {
  if (!isRecord(result)) {
    throw new Error("spawnAgent must resolve to an object result.");
  }

  const usage = getOwnProperty(result, "usage");

  return {
    exitCode: readFiniteNumber(getOwnProperty(result, "exitCode"), "spawnAgent result exitCode"),
    stdout: readOptionalString(getOwnProperty(result, "stdout"), "spawnAgent result stdout") ?? "",
    stderr: readOptionalString(getOwnProperty(result, "stderr"), "spawnAgent result stderr") ?? "",
    summary: readOptionalString(getOwnProperty(result, "summary"), "spawnAgent result summary") ?? "",
    durationMs: readNonNegativeFiniteNumber(
      getOwnProperty(result, "durationMs"),
      "spawnAgent result durationMs"
    ),
    ...(usage === undefined ? {} : { usage: readSpawnUsage(usage) })
  };
}

function recordActiveSpawnUsage(usage: SpawnUsage | undefined): void {
  activeUsageAccumulator.getStore()?.record(usage);
}

function readSpawnUsage(value: unknown): SpawnUsage {
  if (!isRecord(value)) {
    throw new Error("spawnAgent result usage must be an object.");
  }

  const cachedTokens = getOwnProperty(value, "cachedTokens");
  const costUsd = getOwnProperty(value, "costUsd");

  return {
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
  };
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

function readRequiredPrompt(value: unknown): string {
  const prompt = readOptionalString(value, "Agent spawn options prompt");

  if (prompt === undefined || prompt.trim().length === 0) {
    throw new Error("Agent spawn options must define a non-empty prompt.");
  }

  return prompt;
}

function readSpawnMode(value: unknown, label: string): AgentSpawnMode {
  if (value === "read" || value === "edit" || value === "yolo") {
    return value;
  }

  throw new Error(`${label} must be one of: read, edit, yolo.`);
}

function readMcpConfig(value: unknown, label: string): AgentModuleMcpConfig {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const entries = Object.entries(value).map(
    ([name, server]) => [name, readMcpServer(server, `${label}.${name}`)] as const
  );
  return Object.fromEntries(entries) as AgentModuleMcpConfig;
}

function readMcpServer(value: unknown, label: string): AgentModuleMcpServer {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const args = getOwnProperty(value, "args");
  const env = getOwnProperty(value, "env");
  const timeout = getOwnProperty(value, "timeout");

  return {
    command: readNonEmptyString(getOwnProperty(value, "command"), `${label}.command`),
    ...(args === undefined ? {} : { args: readStringArray(args, `${label}.args`) }),
    ...(env === undefined ? {} : { env: readStringRecord(env, `${label}.env`) }),
    ...(timeout === undefined
      ? {}
      : { timeout: readPositiveFiniteNumber(timeout, `${label}.timeout`) })
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
