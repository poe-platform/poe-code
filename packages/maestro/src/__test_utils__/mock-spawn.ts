import type {
  AcpEvent,
  SpawnHandle,
  SpawnOptions,
  SpawnParallelCall,
  SpawnParallelOptions,
  SpawnResult,
  SpawnRetryOptions,
  SpawnContext,
  SpawnMode,
  spawn as agentSpawn
} from "@poe-code/agent-spawn";
import type { TaskList } from "@poe-code/task-list";

export interface SpawnCall {
  agent: string;
  prompt: string;
  model?: string;
  mode?: SpawnMode;
  cwd?: string;
  signal?: AbortSignal;
  skills?: string[];
  logDir?: string;
  logFileName?: string;
  hooks?: SpawnOptions["hooks"];
}

export type MockSpawnStep =
  | { kind: "emit"; event: AcpEvent }
  | { kind: "exit"; exitCode: number }
  | {
      kind: "throw";
      error: "abort" | "activity_timeout" | "agent_startup_error" | "agent_crashed" | Error;
    }
  | { kind: "wait"; ms: number; ignoreAbort?: boolean }
  | { kind: "block" }
  | { kind: "run"; fn: (call: SpawnCall) => void | Promise<void> }
  | { kind: "assert"; fn: (call: SpawnCall) => void };

export type MockSpawnScripts =
  | Record<string, MockSpawnStep[]>
  | ((call: SpawnCall) => MockSpawnStep[] | undefined);

export interface MockSpawnOptions {
  cwdExists?: (cwd: string) => boolean;
  afterResult?: (result: MockSpawnResult, call: SpawnCall) => void | Promise<void>;
}

export type MockSpawnResult = SpawnResult & {
  events: AcpEvent[];
};

export interface MockSpawn {
  spawn: typeof agentSpawn;
  calls: SpawnCall[];
  clock: {
    now(): number;
  };
}

export type MockTaskScriptAction =
  | { kind: "complete" }
  | { kind: "fail" }
  | { kind: "exit"; exitCode: number }
  | { kind: "block" };

export interface MockTaskScriptSpawnOptions {
  list?: string;
}

const defaultMessage = "Mock agent response";

export function createMockSpawn(
  scripts: MockSpawnScripts = {},
  options: MockSpawnOptions = {}
): MockSpawn {
  const calls: SpawnCall[] = [];
  let clockMs = 0;

  const run = (
    agent: string,
    spawnOptions: SpawnOptions,
    emit: (event: AcpEvent) => void
  ): Promise<MockSpawnResult> => {
    const call = captureCall(agent, spawnOptions);
    calls.push(call);
    throwIfAborted(spawnOptions.signal);

    return Promise.resolve().then(() => {
      verifyCwd(call, options);

      return runScript({
        call,
        steps: resolveScript(scripts, call),
        activityTimeoutMs: spawnOptions.activityTimeoutMs,
        startedAtMs: clockMs,
        getClockMs: () => clockMs,
        advanceClockMs: (ms) => {
          clockMs += ms;
        },
        emit
      }).then(async (result) => {
        await options.afterResult?.(result, call);
        return result;
      });
    });
  };

  const spawn = Object.assign(
    ((agent: string, spawnOptions: SpawnOptions, _context?: SpawnContext): Promise<SpawnResult> => {
      const events: AcpEvent[] = [];
      return run(agent, spawnOptions, (event) => events.push(event));
    }) as typeof agentSpawn,
    {
      retry(
        agent: string,
        spawnOptions: SpawnOptions,
        retryOptions: SpawnRetryOptions<SpawnResult>
      ): SpawnHandle<SpawnResult> {
        return runRetry({ agent, spawnOptions, retryOptions, run });
      },
      parallel(
        parallelCalls: Array<SpawnParallelCall<string, SpawnOptions, SpawnResult>>,
        parallelOptions: SpawnParallelOptions = {}
      ): Promise<SpawnResult[]> {
        return runParallel({ parallelCalls, parallelOptions, spawn });
      }
    }
  );

  return {
    spawn,
    calls,
    clock: {
      now: () => clockMs
    }
  };
}

export function createTaskScriptSpawn(
  taskList: TaskList,
  scripts: Record<string, MockTaskScriptAction[]>,
  options: MockTaskScriptSpawnOptions = {}
): MockSpawn {
  const attempts = new Map<string, number>();
  const list = options.list ?? "tasks";

  return createMockSpawn((call) => {
    const taskId = taskIdFromPrompt(call.prompt);
    const attempt = (attempts.get(taskId) ?? 0) + 1;
    attempts.set(taskId, attempt);
    const action = scripts[taskId]?.[attempt - 1] ?? { kind: "complete" };
    const steps: MockSpawnStep[] = [
      { kind: "emit", event: { event: "session_start", threadId: `thread-${taskId}-${attempt}` } }
    ];

    if (action.kind === "complete") {
      steps.push({
        kind: "run",
        fn: async () => {
          await taskList.list(list).fire(taskId, "complete");
        }
      });
      return steps;
    }

    if (action.kind === "fail") {
      steps.push({
        kind: "run",
        fn: async () => {
          await taskList.list(list).fire(taskId, "fail");
        }
      });
      steps.push({ kind: "throw", error: "abort" });
      return steps;
    }

    if (action.kind === "block") {
      steps.push({ kind: "block" });
      return steps;
    }

    steps.push({ kind: "exit", exitCode: action.exitCode });
    return steps;
  });
}

function taskIdFromPrompt(prompt: string): string {
  const prefix = "task:";
  const start = prompt.indexOf(prefix);
  if (start < 0) {
    throw new Error(`Missing task id in prompt: ${prompt}`);
  }

  const rest = prompt.slice(start + prefix.length);
  const end = rest.indexOf(" ");
  return end < 0 ? rest : rest.slice(0, end);
}

function captureCall(agent: string, options: SpawnOptions): SpawnCall {
  return {
    agent,
    prompt: options.prompt,
    model: options.model,
    cwd: options.cwd,
    signal: options.signal,
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.skills === undefined ? {} : { skills: options.skills }),
    ...(options.logDir === undefined ? {} : { logDir: options.logDir }),
    ...(options.logFileName === undefined ? {} : { logFileName: options.logFileName }),
    ...(options.hooks === undefined ? {} : { hooks: options.hooks })
  };
}

function verifyCwd(call: SpawnCall, options: MockSpawnOptions): void {
  if (call.cwd === undefined || options.cwdExists === undefined) {
    return;
  }

  if (!options.cwdExists(call.cwd)) {
    throw new Error(`Mock spawn cwd does not exist: "${call.cwd}"`);
  }
}

function resolveScript(scripts: MockSpawnScripts, call: SpawnCall): MockSpawnStep[] {
  const steps = typeof scripts === "function" ? scripts(call) : scripts[call.agent];
  return steps ?? [{ kind: "emit", event: { event: "agent_message", text: defaultMessage } }];
}

async function runScript(input: {
  call: SpawnCall;
  steps: MockSpawnStep[];
  activityTimeoutMs?: number;
  startedAtMs: number;
  getClockMs: () => number;
  advanceClockMs: (ms: number) => void;
  emit: (event: AcpEvent) => void;
}): Promise<MockSpawnResult> {
  const events: AcpEvent[] = [];
  let exitCode = 0;
  let explicitExit = false;
  let stdout = "";
  let threadId: string | undefined;
  let usage: SpawnResult["usage"];

  const emit = (event: AcpEvent): void => {
    events.push(event);
    input.emit(event);

    if (event.event === "agent_message") {
      const text = readString((event as { text?: unknown }).text);
      if (text !== undefined) {
        stdout = stdout.length === 0 ? text : `${stdout}\n${text}`;
      }
    }

    if (event.event === "session_start") {
      threadId = readString((event as { threadId?: unknown }).threadId) ?? threadId;
    }

    if (event.event === "usage") {
      const eventUsage = event as {
        inputTokens?: unknown;
        outputTokens?: unknown;
        cachedTokens?: unknown;
        costUsd?: unknown;
      };
      const inputTokens = readNumber(eventUsage.inputTokens);
      const outputTokens = readNumber(eventUsage.outputTokens);
      const cachedTokens = readNumber(eventUsage.cachedTokens);
      const costUsd = readNumber(eventUsage.costUsd);

      usage = {
        inputTokens: (usage?.inputTokens ?? 0) + (inputTokens ?? 0),
        outputTokens: (usage?.outputTokens ?? 0) + (outputTokens ?? 0),
        cachedTokens:
          cachedTokens === undefined
            ? usage?.cachedTokens
            : (usage?.cachedTokens ?? 0) + cachedTokens,
        costUsd: costUsd === undefined ? usage?.costUsd : (usage?.costUsd ?? 0) + costUsd
      };
    }

    if (event.event === "spawn_result") {
      const resultEvent = event as {
        exitCode?: unknown;
        threadId?: unknown;
        usage?: unknown;
      };
      const resultExitCode = readNumber(resultEvent.exitCode);
      exitCode = resultExitCode ?? exitCode;
      explicitExit = true;
      threadId = readString(resultEvent.threadId) ?? threadId;
      usage = readUsage(resultEvent.usage) ?? usage;
    }
  };

  for (const step of input.steps) {
    throwIfAborted(input.call.signal);

    if (step.kind === "emit") {
      emit(step.event);
      continue;
    }

    if (step.kind === "exit") {
      exitCode = step.exitCode;
      explicitExit = true;
      break;
    }

    if (step.kind === "throw") {
      throw createScriptError(step.error, input.activityTimeoutMs);
    }

    if (step.kind === "wait") {
      assertValidWait(step.ms);
      if (step.ignoreAbort === true) {
        await new Promise<void>((resolve) => setTimeout(resolve, step.ms));
        input.advanceClockMs(step.ms);
        continue;
      }

      await Promise.resolve();
      throwIfAborted(input.call.signal);
      input.advanceClockMs(step.ms);
      continue;
    }

    if (step.kind === "block") {
      await new Promise(() => undefined);
      continue;
    }

    if (step.kind === "run") {
      await step.fn(input.call);
      continue;
    }

    step.fn(input.call);
  }

  throwIfAborted(input.call.signal);

  return {
    stdout,
    stderr: "",
    exitCode: explicitExit ? exitCode : 0,
    durationMs: input.getClockMs() - input.startedAtMs,
    ...(threadId === undefined ? {} : { threadId }),
    ...(usage === undefined ? {} : { usage }),
    events
  };
}

function assertValidWait(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error("Mock spawn wait ms must be a non-negative finite number.");
  }
}

type ThrowStepError = Extract<MockSpawnStep, { kind: "throw" }>["error"];

function createScriptError(error: ThrowStepError, activityTimeoutMs?: number): Error {
  if (error instanceof Error) {
    return error;
  }

  if (error === "abort") {
    return createNamedError("AbortError", "Agent spawn aborted");
  }

  if (error === "activity_timeout") {
    if (activityTimeoutMs !== undefined) {
      return createNamedError(
        "ActivityTimeoutError",
        `Agent spawn timed out after ${activityTimeoutMs / 1000}s of inactivity`
      );
    }
    return createNamedError("ActivityTimeoutError", "Agent spawn activity timed out");
  }

  if (error === "agent_startup_error") {
    const startupError = createNamedError("AgentStartupError", "Agent failed to start");
    (startupError as Error & { failure: "agent_startup_error" }).failure = "agent_startup_error";
    return startupError;
  }

  return new Error("Agent crashed");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createNamedError("AbortError", "Agent spawn aborted");
  }
}

function createNamedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readUsage(value: unknown): SpawnResult["usage"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const usage = value as {
    inputTokens?: unknown;
    outputTokens?: unknown;
    cachedTokens?: unknown;
    costUsd?: unknown;
  };
  const inputTokens = readNumber(usage.inputTokens);
  const outputTokens = readNumber(usage.outputTokens);
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    ...(readNumber(usage.cachedTokens) === undefined
      ? {}
      : { cachedTokens: readNumber(usage.cachedTokens) }),
    ...(readNumber(usage.costUsd) === undefined ? {} : { costUsd: readNumber(usage.costUsd) })
  };
}

function runRetry(input: {
  agent: string;
  spawnOptions: SpawnOptions;
  retryOptions: SpawnRetryOptions<SpawnResult>;
  run: (
    agent: string,
    spawnOptions: SpawnOptions,
    emit: (event: AcpEvent) => void
  ) => Promise<MockSpawnResult>;
}): SpawnHandle<SpawnResult> {
  const queue = createEventQueue<AcpEvent>();
  const retryOptions = normalizeRetryOptions(input.retryOptions);

  const result = (async (): Promise<SpawnResult> => {
    try {
      for (let attempt = 1; attempt <= retryOptions.maxAttempts; attempt += 1) {
        throwIfAborted(input.spawnOptions.signal);
        const result = await input.run(input.agent, input.spawnOptions, queue.push);
        const isLastAttempt = attempt >= retryOptions.maxAttempts;
        if (result.exitCode === 0 || isLastAttempt || !retryOptions.isRetryable(result)) {
          queue.close();
          return result;
        }
      }

      throw new Error("Mock spawn retry reached an unreachable state.");
    } catch (error) {
      queue.fail(error);
      throw error;
    }
  })();

  return { events: queue, result };
}

function normalizeRetryOptions(
  retryOptions: SpawnRetryOptions<SpawnResult>
): Required<SpawnRetryOptions<SpawnResult>> {
  if (!Number.isInteger(retryOptions.maxAttempts) || retryOptions.maxAttempts < 1) {
    throw new Error("spawn.retry maxAttempts must be an integer greater than or equal to 1.");
  }

  if (!Number.isFinite(retryOptions.backoffMs) || retryOptions.backoffMs < 0) {
    throw new Error("spawn.retry backoffMs must be a non-negative finite number.");
  }

  return {
    maxAttempts: retryOptions.maxAttempts,
    backoffMs: retryOptions.backoffMs,
    isRetryable:
      retryOptions.isRetryable ??
      ((result: SpawnResult) => [1, 124, 125, 137].includes(result.exitCode))
  };
}

async function runParallel(input: {
  parallelCalls: Array<SpawnParallelCall<string, SpawnOptions, SpawnResult>>;
  parallelOptions: SpawnParallelOptions;
  spawn: typeof agentSpawn;
}): Promise<SpawnResult[]> {
  if (input.parallelOptions.signal?.aborted) {
    throw createNamedError("AbortError", "Agent spawn parallel aborted");
  }

  const results: SpawnResult[] = [];
  for (const call of input.parallelCalls) {
    if (typeof call === "function") {
      const handle = call(input.parallelOptions.signal);
      results.push(await handle.result);
      await drainEvents(handle.events);
      continue;
    }

    const [agent, options] = call;
    results.push(await input.spawn(agent, mergeSignals(options, input.parallelOptions.signal)));
  }
  return results;
}

function mergeSignals(options: SpawnOptions, signal: AbortSignal | undefined): SpawnOptions {
  if (signal === undefined || options.signal !== undefined) {
    return options;
  }
  return { ...options, signal };
}

async function drainEvents(events: AsyncIterable<AcpEvent>): Promise<void> {
  for await (const event of events) {
    void event;
  }
}

type EventQueue<T> = AsyncIterable<T> & {
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
};

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
      return Promise.resolve({ done: false, value: values.shift() as T });
    }

    if (failure !== undefined) {
      return Promise.reject(failure);
    }

    if (closed) {
      return Promise.resolve({ done: true, value: undefined });
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
        waiter.resolve({ done: false, value });
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
        waiter.resolve({ done: true, value: undefined });
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
