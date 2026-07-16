import * as nodeFs from "node:fs/promises";
import os from "node:os";
import { assertUsableThreadId, resolveConfiguredModel, spawnCore } from "./spawn-core.js";
import { createSdkContainer } from "./container.js";
import { ValidationError } from "../cli/errors.js";
import { formatAgentCapabilityError } from "@poe-code/agent-defs";
import { spawnAutonomous, type AutonomousSpawnOptions } from "./autonomous.js";
import {
  getAcpSpawnConfig,
  getSpawnConfig,
  spawn as spawnNonStreaming,
  spawnAcp,
  spawnInteractive,
  spawnStreaming,
  createSpawnParallel,
  renderAcpStream,
  applyMiddlewares,
  sessionCapture,
  usageCapture,
  spawnLog,
  runCommand,
  type AcpSpawnContext as InternalAcpSpawnContext
} from "@poe-code/agent-spawn";
import { loadIntegrations, type Integrations } from "@poe-code/braintrust";
import { createTraceSinkMiddleware } from "./trace.js";
import { resolveActiveProviderForService, resolveMergedDocument } from "../cli/commands/shared.js";
import { resolveIsolatedEnvDetails } from "../cli/isolated-env.js";
import type {
  AcpEvent,
  SpawnOptions,
  SpawnResult,
  SpawnRetryOptions,
  SpawnUsage
} from "./types.js";
import { resolveSpawnWorkspace } from "../workspace/resolve-spawn-workspace.js";
import { runInWorktree } from "./worktree.js";

/**
 * Spawns an agent with optional streaming.
 *
 * Returns both:
 * - `events`: an async stream of ACP events (empty when the provider doesn't support streaming)
 * - `result`: a promise resolving to the final SpawnResult
 *
 * @example
 * ```typescript
 * import { spawn } from "poe-code"
 *
 * const { events, result } = spawn("codex", "Fix the bug in auth.ts")
 *
 * for await (const e of events) {
 *   // render or log events
 * }
 *
 * const final = await result
 * console.log(final.exitCode)
 * ```
 */
export function spawn(
  service: string,
  prompt: string,
  options?: Omit<SpawnOptions, "prompt">
): SpawnHandle;
export function spawn(service: string, options: SpawnOptions): SpawnHandle;
export function spawn(
  service: string,
  promptOrOptions: string | SpawnOptions,
  maybeOptions?: Omit<SpawnOptions, "prompt">
): SpawnHandle {
  const options =
    typeof promptOrOptions === "string"
      ? { ...maybeOptions, prompt: promptOrOptions }
      : promptOrOptions;

  // Checked before any branch runs: every spawn path forwards this id to the
  // agent's own --resume, and a worktree must not be created for a run that
  // cannot start.
  if (options.resumeThreadId !== undefined) {
    assertUsableThreadId(options.resumeThreadId);
  }

  if (isWorktreeEnabled(options.worktree)) {
    const worktreeOptions = options.worktree ?? true;
    const queue = createEventQueue<AcpEvent>();
    const result = runInWorktree({
      cwd: options.cwd ?? process.cwd(),
      selectedAgent: service,
      ...(options.model ? { selectedModel: options.model } : {}),
      worktree: worktreeOptions,
      signal: options.signal,
      run: async ({ worktreeCwd }) => {
        const inner = spawn(service, {
          ...options,
          cwd: worktreeCwd,
          worktree: false
        });
        const forwarded = forwardEvents(inner.events, queue.push);
        const final = await inner.result;
        await forwarded;
        return final;
      }
    })
      .then(({ value, worktree }) => {
        queue.close();
        const spawnResult: SpawnResult = value;
        return {
          ...spawnResult,
          worktree
        };
      })
      .catch((error: unknown) => {
        queue.fail(error);
        throw error;
      });

    return {
      events: queue,
      result
    };
  }

  const resolvedMcpServers = options.mcpServers ?? options.mcpConfig;
  const captureOtel = options.captureOtel ?? process.env.POE_CODE_CAPTURE_OTEL === "1";
  const captureOtelContent =
    options.captureOtelContent ?? process.env.POE_CODE_CAPTURE_OTEL_CONTENT === "1";

  const emptyEvents: AsyncIterable<AcpEvent> = (async function* () {})();

  /**
   * Deferred event stream resolution.
   *
   * This pattern allows us to return both `events` and `result` synchronously from `spawn()`,
   * while the actual event source is determined asynchronously inside the `result` promise.
   *
   * The flow:
   * 1. Caller receives `{ events, result }` immediately
   * 2. Caller can start iterating `events` right away (iteration blocks on `eventsPromise`)
   * 3. Inside `result`, we determine if streaming is supported and resolve `eventsPromise`
   *    with either the real event stream or an empty generator
   * 4. The outer `events` generator then yields from the resolved inner stream
   *
   * This avoids forcing callers to `await` before they can set up their event handlers,
   * enabling patterns like: `for await (const e of events) { ... }` without race conditions.
   */
  let resolveEvents: ((value: AsyncIterable<AcpEvent>) => void) | undefined;
  let eventsResolved = false;
  const eventsPromise = new Promise<AsyncIterable<AcpEvent>>((resolve) => {
    resolveEvents = resolve;
  });
  const resolveEventsOnce = (value: AsyncIterable<AcpEvent>) => {
    if (eventsResolved) return;
    eventsResolved = true;
    resolveEvents?.(value);
  };

  const events: AsyncIterable<AcpEvent> = (async function* () {
    for await (const e of await eventsPromise) {
      yield e;
    }
  })();
  let setSessionModel: ((model: string) => Promise<void>) | undefined;

  const result = (async (): Promise<SpawnResult> => {
    let workspace: Awaited<ReturnType<typeof resolveSpawnWorkspace>> | undefined;
    let integrations: Integrations | null = null;

    try {
      workspace = await resolveSpawnWorkspace(options.cwd, {
        baseDir: process.cwd(),
        homeDir: os.homedir(),
        mode: options.mode,
        fs: {
          mkdir: async (target, resolveOptions) =>
            await nodeFs.mkdir(target, resolveOptions).then(() => undefined),
          stat: async (target) => await nodeFs.stat(target),
          lstat: async (target) => await nodeFs.lstat(target),
          rm: async (target, resolveOptions) => await nodeFs.rm(target, resolveOptions)
        },
        exec: runCommand
      });
      const cwd = workspace.cwd;

      const container = createSdkContainer({ cwd });
      const acpSpawnConfig = getAcpSpawnConfig(service);
      const spawnConfig = getSpawnConfig(service);
      const registeredService = container.registry.get(service);

      integrations = await loadIntegrations(await resolveMergedDocument(container));
      const consumerMiddlewares = [
        ...(integrations?.spawnMiddleware ? [integrations.spawnMiddleware] : []),
        ...(options.middlewares ?? []),
        ...(options.traceSink ? [createTraceSinkMiddleware(options.traceSink)] : [])
      ];
      const middlewares = [
        sessionCapture,
        usageCapture,
        spawnLog,
        ...(!captureOtel ? consumerMiddlewares : [])
      ];
      const nativeCaptureMiddlewares = captureOtel ? consumerMiddlewares : undefined;
      const resolveModel = async () =>
        options.model ?? (await resolveConfiguredModel(container, service));
      const runtimeOverrides = pickRuntimeOverrides(options);
      const hasRuntimeOverrides = Object.keys(runtimeOverrides).length > 0;
      const canUseAcpWithMcpServers =
        acpSpawnConfig?.supportsMcpServers !== false || resolvedMcpServers === undefined;

      if (options.interactive) {
        resolveEventsOnce(emptyEvents);
        const model = await resolveModel();
        const interactiveResult = await spawnInteractive(service, {
          prompt: options.prompt,
          cwd,
          model,
          mode: options.mode,
          signal: options.signal,
          otelSink: options.otelSink,
          args: options.args,
          ...(options.env ? { env: options.env } : {}),
          ...(options.skills && options.skills.length > 0 ? { skills: options.skills } : {}),
          ...(options.hooks ? { hooks: options.hooks } : {}),
          resumeThreadId: options.resumeThreadId,
          runtimeConfigCwd: options.runtimeConfigCwd,
          ...runtimeOverrides,
          ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers } : {})
        });
        return {
          stdout: interactiveResult.stdout,
          stderr: interactiveResult.stderr,
          exitCode: interactiveResult.exitCode,
          ...(interactiveResult.usage ? { usage: interactiveResult.usage } : {})
        };
      }

      if (acpSpawnConfig && hasRuntimeOverrides && !spawnConfig) {
        resolveEventsOnce(emptyEvents);
        throw new Error(
          `Agent "${service}" does not support runtime overrides because it has no CLI spawn configuration.`
        );
      }

      if (acpSpawnConfig && !hasRuntimeOverrides && canUseAcpWithMcpServers && !captureOtel) {
        const model = await resolveModel();
        const adapter = registeredService;
        const activeProvider = adapter?.isolatedEnv
          ? await resolveActiveProviderForService(container, adapter.name)
          : undefined;
        const resolvedAcpEnv = adapter?.isolatedEnv
          ? await resolveIsolatedEnvDetails(
              container.env,
              adapter.isolatedEnv,
              adapter.name,
              activeProvider
            ).then((details) => ({ ...activeProvider?.extraEnv, ...details.env }))
          : undefined;
        const acpSpawn = spawnAcp({
          agentId: service,
          prompt: options.prompt,
          cwd,
          model,
          mode: options.mode,
          mcpServers: resolvedMcpServers,
          ...(options.skills && options.skills.length > 0 ? { skills: options.skills } : {}),
          ...(options.hooks ? { hooks: options.hooks } : {}),
          resumeThreadId: options.resumeThreadId,
          signal: options.signal,
          otelSink: options.otelSink,
          ...(nativeCaptureMiddlewares ? { middlewares: nativeCaptureMiddlewares } : {}),
          ...(resolvedAcpEnv || options.env
            ? { env: { ...(resolvedAcpEnv ?? {}), ...(options.env ?? {}) } }
            : {}),
          ...runtimeOverrides
        });
        const { events: rawEvents, done } = acpSpawn;
        setSessionModel = acpSpawn.unstable_setSessionModel;

        const middlewareContext: InternalAcpSpawnContext = {
          sessionId: "unknown",
          agent: service,
          logDir: options.logDir,
          logFileName: options.logFileName,
          ...(options.logContent ? { logContent: true } : {}),
          events: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0
          },
          eventStream: rawEvents,
          prompt: options.prompt,
          model,
          mode: options.mode,
          cwd,
          startedAt: new Date()
        };

        await applyMiddlewares(middlewares, middlewareContext);

        resolveEventsOnce(middlewareContext.eventStream ?? emptyEvents);
        const final = await done;
        const threadId = middlewareContext.threadId ?? final.threadId;

        return {
          stdout: final.stdout,
          stderr: final.stderr,
          exitCode: final.exitCode,
          ...(threadId ? { threadId } : {}),
          ...(final.usage ? { usage: final.usage } : {}),
          ...(middlewareContext.logFile ? { logFile: middlewareContext.logFile } : {}),
          ...(middlewareContext.logError ? { logError: middlewareContext.logError } : {}),
          ...(middlewareContext.sessionResult
            ? { sessionResult: middlewareContext.sessionResult }
            : {})
        };
      }

      const supportsStreaming =
        !!spawnConfig &&
        spawnConfig.kind === "cli" &&
        typeof (spawnConfig as { adapter?: unknown }).adapter === "string";

      if (supportsStreaming) {
        const model = await resolveModel();
        const { events: rawEvents, done } = spawnStreaming({
          agentId: service,
          prompt: options.prompt,
          cwd,
          model,
          mode: options.mode,
          args: options.args,
          ...(options.env ? { env: options.env } : {}),
          ...(options.skills && options.skills.length > 0 ? { skills: options.skills } : {}),
          ...(options.hooks ? { hooks: options.hooks } : {}),
          resumeThreadId: options.resumeThreadId,
          signal: options.signal,
          otelSink: options.otelSink,
          captureOtel,
          captureOtelContent,
          ...(nativeCaptureMiddlewares ? { middlewares: nativeCaptureMiddlewares } : {}),
          runtimeConfigCwd: options.runtimeConfigCwd,
          ...runtimeOverrides,
          ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers } : {}),
          ...(options.tee ? { tee: options.tee } : {}),
          ...(options.activityTimeoutMs !== undefined
            ? { activityTimeoutMs: options.activityTimeoutMs }
            : {}),
          useStdin: options.useStdin ?? false
        });

        const middlewareContext: InternalAcpSpawnContext = {
          sessionId: "unknown",
          agent: service,
          logDir: options.logDir,
          logFileName: options.logFileName,
          ...(options.logContent ? { logContent: true } : {}),
          events: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0
          },
          eventStream: rawEvents,
          prompt: options.prompt,
          model,
          mode: options.mode,
          cwd,
          startedAt: new Date()
        };

        await applyMiddlewares(middlewares, middlewareContext);

        resolveEventsOnce(middlewareContext.eventStream ?? emptyEvents);
        const final = await done;
        const threadId = middlewareContext.threadId ?? final.threadId;
        const usage = final.usage ?? getCapturedUsage(middlewareContext.usage);

        return {
          stdout: final.stdout,
          stderr: final.stderr,
          exitCode: final.exitCode,
          ...(threadId ? { threadId } : {}),
          ...(usage ? { usage } : {}),
          ...(middlewareContext.logFile ? { logFile: middlewareContext.logFile } : {}),
          ...(middlewareContext.logError ? { logError: middlewareContext.logError } : {}),
          ...(middlewareContext.sessionResult
            ? { sessionResult: middlewareContext.sessionResult }
            : {})
        };
      }

      if (spawnConfig && spawnConfig.kind === "cli") {
        resolveEventsOnce(emptyEvents);
        const model = await resolveModel();
        return spawnNonStreaming(service, {
          prompt: options.prompt,
          cwd,
          model,
          mode: options.mode,
          args: options.args,
          ...(options.env ? { env: options.env } : {}),
          ...(options.skills && options.skills.length > 0 ? { skills: options.skills } : {}),
          ...(options.hooks ? { hooks: options.hooks } : {}),
          resumeThreadId: options.resumeThreadId,
          signal: options.signal,
          otelSink: options.otelSink,
          runtimeConfigCwd: options.runtimeConfigCwd,
          ...runtimeOverrides,
          ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers } : {}),
          ...(options.tee ? { tee: options.tee } : {}),
          ...(options.activityTimeoutMs !== undefined
            ? { activityTimeoutMs: options.activityTimeoutMs }
            : {}),
          ...(options.logDir ? { logDir: options.logDir } : {}),
          ...(options.logFileName ? { logFileName: options.logFileName } : {}),
          useStdin: options.useStdin ?? false
        });
      }

      resolveEventsOnce(emptyEvents);

      if (!registeredService) {
        throw new ValidationError(
          formatAgentCapabilityError({ agent: service, capability: "spawn" })
        );
      }

      const model = await resolveModel();
      return spawnCore(container, service, {
        prompt: options.prompt,
        cwd,
        model,
        mode: options.mode,
        args: options.args,
        ...(options.env ? { env: options.env } : {}),
        ...(options.skills && options.skills.length > 0 ? { skills: options.skills } : {}),
        ...(options.hooks ? { hooks: options.hooks } : {}),
        resumeThreadId: options.resumeThreadId,
        ...runtimeOverrides,
        ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers } : {}),
        useStdin: options.useStdin ?? false
      });
    } catch (error) {
      resolveEventsOnce(emptyEvents);
      throw error;
    } finally {
      await integrations?.shutdown().catch(() => undefined);
      await workspace?.cleanup?.().catch(() => undefined);
    }
  })();

  return {
    events,
    result,
    async unstable_setSessionModel(model: string): Promise<void> {
      await setSessionModel?.(model);
    }
  };
}

type SpawnHandle = {
  events: AsyncIterable<AcpEvent>;
  result: Promise<SpawnResult>;
  unstable_setSessionModel?(model: string): Promise<void>;
};

async function forwardEvents<T>(
  events: AsyncIterable<T>,
  emit: (event: T) => void
): Promise<void> {
  for await (const event of events) {
    emit(event);
  }
}

function isWorktreeEnabled(worktree: SpawnOptions["worktree"]): boolean {
  return worktree === true;
}

function getCapturedUsage(usage: SpawnUsage | undefined): SpawnUsage | undefined {
  if (!usage) {
    return undefined;
  }

  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    return usage;
  }

  if (usage.cachedTokens !== undefined || usage.costUsd !== undefined) {
    return usage;
  }

  return undefined;
}

function pickRuntimeOverrides(
  options: Pick<
    SpawnOptions,
    "runtime" | "runtimeImage" | "detach" | "mountPoeCode" | "runnerSync"
  >
): Pick<
  SpawnOptions,
  "runtime" | "runtimeImage" | "detach" | "mountPoeCode" | "runnerSync"
> {
  return {
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
    ...(options.detach ? { detach: options.detach } : {}),
    ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
    ...(options.runnerSync ? { runnerSync: options.runnerSync } : {})
  };
}

/**
 * Spawns an agent and renders ACP events to stdout with pretty formatting.
 *
 * @example
 * ```typescript
 * import { spawn } from "poe-code"
 *
 * const result = await spawn.pretty("codex", "Fix the bug in auth.ts")
 * console.log(result.exitCode)
 * ```
 */
spawn.pretty = async function pretty(
  service: string,
  promptOrOptions: string | SpawnOptions,
  maybeOptions?: Omit<SpawnOptions, "prompt">
): Promise<SpawnResult> {
  const { events, result } = spawn(service, promptOrOptions as string, maybeOptions);
  await renderAcpStream(events);
  return await result;
};

spawn.autonomous = async function autonomous(
  service: string,
  promptOrOptions: string | Omit<AutonomousSpawnOptions, "service">,
  maybeOptions?: Omit<AutonomousSpawnOptions, "prompt" | "service">
): Promise<SpawnResult> {
  const options =
    typeof promptOrOptions === "string"
      ? { ...maybeOptions, prompt: promptOrOptions }
      : promptOrOptions;

  return await spawnAutonomous(spawn, {
    ...options,
    service
  });
};

spawn.parallel = createSpawnParallel<string, SpawnOptions, SpawnResult>((service, options) =>
  spawn(service, options)
);

spawn.retry = function retry(
  service: string,
  options: SpawnOptions,
  retryOptions: SpawnRetryOptions
): { events: AsyncIterable<AcpEvent>; result: Promise<SpawnResult> } {
  const normalizedRetryOptions = normalizeRetryOptions(retryOptions);
  const queue = createEventQueue<AcpEvent>();
  const result = runRetryingSpawn({
    service,
    options,
    retryOptions: normalizedRetryOptions,
    emit: queue.push
  })
    .then((value) => {
      queue.close();
      return value;
    })
    .catch((error: unknown) => {
      queue.fail(error);
      throw error;
    });

  return {
    events: queue,
    result
  };
};

type EventQueue<T> = AsyncIterable<T> & {
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
};

const retryableExitCodes = new Set([1, 124, 125, 137]);
const maxRetryBackoffMs = 30_000;

function normalizeRetryOptions(retryOptions: SpawnRetryOptions): Required<SpawnRetryOptions> {
  if (!Number.isInteger(retryOptions.maxAttempts) || retryOptions.maxAttempts < 1) {
    throw new Error("spawn.retry maxAttempts must be an integer greater than or equal to 1.");
  }

  if (!Number.isFinite(retryOptions.backoffMs) || retryOptions.backoffMs < 0) {
    throw new Error("spawn.retry backoffMs must be a non-negative finite number.");
  }

  return {
    maxAttempts: retryOptions.maxAttempts,
    backoffMs: retryOptions.backoffMs,
    isRetryable: retryOptions.isRetryable ?? defaultIsRetryable
  };
}

async function runRetryingSpawn(input: {
  service: string;
  options: SpawnOptions;
  retryOptions: Required<SpawnRetryOptions>;
  emit: (event: AcpEvent) => void;
}): Promise<SpawnResult> {
  for (let attempt = 1; attempt <= input.retryOptions.maxAttempts; attempt += 1) {
    throwIfAborted(input.options.signal);

    const handle = spawn(input.service, input.options);
    const events = forwardAttemptEvents(handle.events, attempt, input.emit);
    const result = await handle.result;
    await events;

    const isLastAttempt = attempt >= input.retryOptions.maxAttempts;
    if (result.exitCode === 0 || isLastAttempt || !input.retryOptions.isRetryable(result)) {
      return result;
    }

    const delayMs = calculateRetryBackoffMs(input.retryOptions.backoffMs, attempt);
    input.emit({
      event: "agent_message",
      text: `attempt: ${attempt} wait ${delayMs}ms before retry`
    });
    await sleep(delayMs, input.options.signal);
  }

  throw new Error("spawn.retry reached an unreachable retry state.");
}

async function forwardAttemptEvents(
  events: AsyncIterable<AcpEvent>,
  attempt: number,
  emit: (event: AcpEvent) => void
): Promise<void> {
  for await (const event of events) {
    emit(prefixEvent(event, attempt));
  }
}

function prefixEvent(event: AcpEvent, attempt: number): AcpEvent {
  const prefix = `attempt: ${attempt}`;

  if (event.event === "agent_message" || event.event === "reasoning") {
    return { ...event, text: `${prefix} ${event.text}` };
  }

  if (event.event === "error") {
    return { ...event, message: `${prefix} ${event.message}` };
  }

  if (event.event === "tool_start") {
    return { ...event, title: `${prefix} ${event.title}` };
  }

  if (event.event === "tool_complete") {
    return { ...event, path: `${prefix} ${event.path}` };
  }

  return {
    ...event,
    _meta: {
      ...(typeof event._meta === "object" && event._meta !== null ? event._meta : {}),
      attempt
    }
  };
}

function defaultIsRetryable(result: SpawnResult): boolean {
  return retryableExitCodes.has(result.exitCode);
}

function calculateRetryBackoffMs(baseBackoffMs: number, completedAttempt: number): number {
  return Math.min(baseBackoffMs * 2 ** (completedAttempt - 1), maxRetryBackoffMs);
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

function createEventQueue<T>(): EventQueue<T> {
  const values: T[] = [];
  const waiters: Array<{
    resolve(value: IteratorResult<T>): void;
    reject(error: unknown): void;
  }> = [];
  let closed = false;
  let failure: unknown;

  const next = (): Promise<IteratorResult<T>> => {
    if (values.length > 0) {
      return Promise.resolve({ value: values.shift() as T, done: false });
    }

    if (failure !== undefined) {
      return Promise.reject(failure);
    }

    if (closed) {
      return Promise.resolve({ value: undefined, done: true });
    }

    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  };

  return {
    push(value) {
      if (closed || failure !== undefined) {
        return;
      }

      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value, done: false });
        return;
      }

      values.push(value);
    },
    close() {
      if (closed || failure !== undefined) {
        return;
      }

      closed = true;
      for (const waiter of waiters.splice(0)) {
        waiter.resolve({ value: undefined, done: true });
      }
    },
    fail(error) {
      if (closed || failure !== undefined) {
        return;
      }

      failure = error;
      for (const waiter of waiters.splice(0)) {
        waiter.reject(error);
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const item = await next();
        if (item.done) {
          return;
        }
        yield item.value;
      }
    }
  };
}
