import "./register-factories.js";
import {
  createPoeCommandSession,
  resolvePoeCommandExecution,
  type DownloadResult,
  type OpenSpec
} from "@poe-code/agent-harness-tools";
import type { StateManager } from "@poe-code/poe-code-config";
import type { AcpMiddleware, SpawnContext } from "./acp/middleware.js";
import { applyMiddlewares } from "./acp/middleware.js";
import { sessionCapture } from "./acp/middlewares/session-capture.js";
import { spawnLog } from "./acp/middlewares/spawn-log.js";
import { usageCapture } from "./acp/middlewares/usage-capture.js";
import type { AcpEvent } from "./acp/types.js";
import { getAdapter } from "./adapters/index.js";
import { resolveConfig } from "./configs/resolve-config.js";
import { buildSpawnArgs } from "./spawn.js";
import type { McpSpawnConfig, SpawnMode, SpawnOptions, SpawnResult } from "./types.js";

export interface CreateSpawnSessionOptions {
  service: string;
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  args?: string[];
  mcpServers?: McpSpawnConfig;
  useStdin?: boolean;
  signal?: AbortSignal;
  tee?: SpawnOptions["tee"];
  activityTimeoutMs?: number;
  runtime?: SpawnOptions["runtime"];
  runtimeImage?: string;
  runtimeTemplate?: string;
  runtimeConfigCwd?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: SpawnOptions["runnerSync"];
  downloadConflict?: NonNullable<OpenSpec["runner"]>["download_conflict"];
  onProgress?: SpawnOptions["onProgress"];
  middlewares?: AcpMiddleware[];
  context?: {
    homeDir?: string;
    state?: StateManager;
  };
}

export interface SpawnSessionRunInput {
  prompt: string;
  agent?: string;
  model?: string;
  mode?: SpawnMode;
  cwd?: string;
  logDir?: string;
  logFileName?: string;
  mcpServers?: McpSpawnConfig;
  signal?: AbortSignal;
  syncBack?: boolean;
}

export interface SpawnSessionRunStreamingResult {
  events: AsyncIterable<AcpEvent>;
  result: Promise<SpawnResult>;
}

export interface SpawnSession {
  run(input: SpawnSessionRunInput, options: { streaming: true }): SpawnSessionRunStreamingResult;
  run(input: SpawnSessionRunInput): Promise<SpawnResult>;
  syncBack(): Promise<DownloadResult>;
  close(): Promise<void>;
}

export function createSpawnSession(options: CreateSpawnSessionOptions): SpawnSession {
  if (options.detach === true) {
    throw new Error(
      "createSpawnSession does not support detach: true. Use plain spawn(...) instead."
    );
  }

  const baseCwd = options.cwd ?? process.cwd();
  const baseSpawnArgs = buildSpawnArgs(options.service, {
    prompt: "",
    model: options.model,
    mode: options.mode,
    args: options.args,
    mcpServers: options.mcpServers,
    useStdin: options.useStdin
  });
  const baseProcessEnv = resolveProcessEnv(baseSpawnArgs.env);
  const execution = resolvePoeCommandExecution({
    cwd: baseCwd,
    runtimeConfigCwd: options.runtimeConfigCwd,
    env: baseProcessEnv,
    argv: [baseSpawnArgs.binaryName, ...baseSpawnArgs.args],
    tool: options.service,
    runtime: {
      runtime: options.runtime,
      runtimeImage: options.runtimeImage,
      runtimeTemplate: options.runtimeTemplate,
      detach: false,
      mountPoeCode: options.mountPoeCode,
      runnerSync: options.runnerSync
    },
    context: options.context,
    openSpec: {
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      execution: buildExecutionSpec({
        prompt: "",
        processEnv: baseProcessEnv,
        useStdin: options.useStdin,
        tee: options.tee,
        activityTimeoutMs: options.activityTimeoutMs
      })
    }
  });
  const session = createPoeCommandSession({
    factory: execution.factory,
    state: execution.state
  });

  const run: SpawnSession["run"] = ((input, runOptions?: { streaming?: boolean }) => {
    if (runOptions?.streaming) {
      return runStreaming(input);
    }

    return runCompleted(input);
  }) as SpawnSession["run"];

  return {
    run,
    async syncBack() {
      return await session.syncBack();
    },
    async close() {
      await session.close();
    }
  };

  function runStreaming(input: SpawnSessionRunInput): SpawnSessionRunStreamingResult {
    const streaming = createStreamingRunState({
      agent: input.agent ?? options.service,
      input,
      baseCwd,
      defaultModel: options.model,
      defaultMode: options.mode,
      middlewares: options.middlewares
    });

    return {
      events: streaming.events,
      result: runCompleted(input, streaming)
    };
  }

  async function runCompleted(
    input: SpawnSessionRunInput,
    streaming?: StreamingRunState
  ): Promise<SpawnResult> {
    const agent = input.agent ?? options.service;
    const prompt = input.prompt;
    const spawnArgs = buildSpawnArgs(agent, {
      prompt,
      model: input.model ?? options.model,
      mode: input.mode ?? options.mode,
      args: options.args,
      mcpServers: input.mcpServers ?? options.mcpServers,
      useStdin: options.useStdin
    });
    const processEnv = resolveProcessEnv(spawnArgs.env);
    const openSpec = mergeOpenSpec(execution.openSpec, {
      cwd: input.cwd ?? baseCwd,
      env: processEnv,
      jobLabel: {
        tool: agent,
        argv: [spawnArgs.binaryName, ...spawnArgs.args]
      },
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.downloadConflict
        ? { runner: { download_conflict: options.downloadConflict } }
        : {}),
      execution: buildExecutionSpec({
        prompt,
        processEnv,
        useStdin: options.useStdin,
        tee: options.tee,
        activityTimeoutMs: options.activityTimeoutMs,
        ...(streaming ? { streaming } : {})
      })
    });
    const runCommand = async () =>
      await session.run(openSpec, input.signal ?? options.signal, {
        syncBack: input.syncBack
      });
    const result = await (async () => {
      try {
        return streaming
          ? await runCommand()
          : options.middlewares && options.middlewares.length > 0
            ? await runWithMiddlewares(options.middlewares, {
                agent,
                prompt,
                model: input.model ?? options.model,
                mode: input.mode ?? options.mode,
                cwd: input.cwd ?? baseCwd,
                logDir: input.logDir,
                logFileName: input.logFileName,
                run: runCommand
              })
            : await runCommand();
      } finally {
        streaming?.close();
      }
    })();

    const usage = getCapturedUsage(streaming?.context.usage);
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode,
      ...(streaming?.context.threadId ? { threadId: streaming.context.threadId } : {}),
      ...(usage ? { usage } : {}),
      ...(streaming?.context.logFile ? { logFile: streaming.context.logFile } : {})
    };
  }
}

type StreamingRunState = {
  events: AsyncIterable<AcpEvent>;
  context: SpawnContext;
  onStdout(chunk: string): void;
  close(): void;
  suppressStdoutTee: boolean;
};

function createStreamingRunState(input: {
  agent: string;
  input: SpawnSessionRunInput;
  baseCwd: string;
  defaultModel?: string;
  defaultMode?: SpawnMode;
  middlewares?: AcpMiddleware[];
}): StreamingRunState {
  const queue = createLineQueue();
  const adapter = resolveStreamingAdapter(input.agent);
  const rawEvents = adapter
    ? filterAcpEvents(adapter(queue.lines()))
    : (async function* (): AsyncIterable<AcpEvent> {})();
  const context: SpawnContext = {
    sessionId: "spawn-session",
    agent: input.agent,
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0
    },
    eventStream: rawEvents,
    prompt: input.input.prompt,
    cwd: input.input.cwd ?? input.baseCwd,
    ...((input.input.model ?? input.defaultModel)
      ? { model: input.input.model ?? input.defaultModel }
      : {}),
    ...((input.input.mode ?? input.defaultMode)
      ? { mode: input.input.mode ?? input.defaultMode }
      : {}),
    ...(input.input.logDir ? { logDir: input.input.logDir } : {}),
    ...(input.input.logFileName ? { logFileName: input.input.logFileName } : {}),
    startedAt: new Date()
  };
  const eventsPromise = (async (): Promise<AsyncIterable<AcpEvent>> => {
    await applyMiddlewares(
      [sessionCapture, usageCapture, spawnLog, ...(input.middlewares ?? [])],
      context
    );
    return context.eventStream ?? (async function* (): AsyncIterable<AcpEvent> {})();
  })();

  return {
    context,
    suppressStdoutTee: adapter !== undefined,
    onStdout(chunk) {
      queue.push(chunk);
    },
    close() {
      queue.close();
    },
    events: (async function* () {
      for await (const event of await eventsPromise) {
        yield event;
      }
    })()
  };
}

function resolveStreamingAdapter(
  agent: string
): ((lines: AsyncIterable<string>) => AsyncIterable<AcpEvent>) | undefined {
  const { spawnConfig } = resolveConfig(agent);
  if (
    !spawnConfig ||
    spawnConfig.kind !== "cli" ||
    typeof (spawnConfig as { adapter?: unknown }).adapter !== "string"
  ) {
    return undefined;
  }

  return (lines) =>
    filterAcpEvents(
      getAdapter((spawnConfig as { adapter: Parameters<typeof getAdapter>[0] }).adapter)(lines)
    );
}

function isAcpEvent(value: unknown): value is AcpEvent {
  return !!value && typeof value === "object" && "event" in value;
}

async function* filterAcpEvents(source: AsyncIterable<unknown>): AsyncIterable<AcpEvent> {
  for await (const event of source) {
    if (isAcpEvent(event)) {
      yield event;
    }
  }
}

async function runWithMiddlewares(
  middlewares: AcpMiddleware[],
  input: {
    agent: string;
    prompt: string;
    model?: string;
    mode?: SpawnMode;
    cwd: string;
    logDir?: string;
    logFileName?: string;
    run(): Promise<{
      kind: "sync";
      exitCode: number;
      download?: DownloadResult;
      stdout?: string;
      stderr?: string;
    }>;
  }
): Promise<{
  kind: "sync";
  exitCode: number;
  download?: DownloadResult;
  stdout?: string;
  stderr?: string;
}> {
  let result:
    | {
        kind: "sync";
        exitCode: number;
        download?: DownloadResult;
        stdout?: string;
        stderr?: string;
      }
    | undefined;
  const ctx: SpawnContext = {
    sessionId: "spawn-session",
    agent: input.agent,
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0
    },
    prompt: input.prompt,
    cwd: input.cwd,
    ...(input.logDir ? { logDir: input.logDir } : {}),
    ...(input.logFileName ? { logFileName: input.logFileName } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    startedAt: new Date()
  };

  await runAcpMiddlewares(middlewares, ctx, async () => {
    result = await input.run();
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    if (stdout.length > 0) {
      ctx.events.push({ event: "agent_message", text: stdout });
    }
    if (stderr.length > 0) {
      ctx.events.push({ event: "error", message: stderr });
    }

    ctx.sessionResult = {
      output: stdout,
      messages: stdout.length > 0 ? [stdout] : [],
      toolCalls: []
    };
  });

  if (!result) {
    throw new Error("Spawn session middleware did not run the command.");
  }

  return result;
}

async function runAcpMiddlewares(
  middlewares: AcpMiddleware[],
  ctx: SpawnContext,
  runCommand: () => Promise<void>
): Promise<void> {
  let index = -1;

  async function dispatch(position: number): Promise<void> {
    if (position <= index) {
      throw new Error("next() called multiple times");
    }

    index = position;
    if (position === middlewares.length) {
      await runCommand();
      return;
    }

    const middleware = middlewares[position];
    if (typeof middleware !== "function") {
      throw new Error(`Invalid ACP middleware at index ${position}`);
    }

    await middleware(ctx, () => dispatch(position + 1));
  }

  await dispatch(0);
}

function resolveProcessEnv(env: Record<string, string> | undefined): Record<string, string> {
  const baseEnv = process.env as Record<string, string>;
  return env ? { ...baseEnv, ...env } : baseEnv;
}

function buildExecutionSpec(input: {
  prompt: string;
  processEnv: Record<string, string>;
  useStdin?: boolean;
  tee?: SpawnOptions["tee"];
  activityTimeoutMs?: number;
  streaming?: StreamingRunState;
}): NonNullable<OpenSpec["execution"]> {
  return {
    wrapForLogTee: false,
    stdin: input.useStdin ? "pipe" : "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env: input.processEnv,
    input: input.useStdin ? input.prompt : undefined,
    captureOutput: true,
    activityTimeoutMs: input.activityTimeoutMs,
    onStdout(chunk: string) {
      input.streaming?.onStdout(chunk);
      if (!input.streaming?.suppressStdoutTee) {
        input.tee?.stdout?.write(chunk);
      }
    },
    onStderr(chunk: string) {
      input.tee?.stderr?.write(chunk);
    }
  };
}

function getCapturedUsage(
  usage: SpawnResult["usage"] | undefined
): SpawnResult["usage"] | undefined {
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

function createLineQueue(): {
  push(chunk: string): void;
  close(): void;
  lines(): AsyncIterable<string>;
} {
  const lines: string[] = [];
  const waiters: Array<{ resolve(value: IteratorResult<string>): void }> = [];
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

  return {
    push(chunk) {
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
    close() {
      if (closed) return;
      if (pending.length > 0) {
        emit(pending.endsWith("\r") ? pending.slice(0, -1) : pending);
        pending = "";
      }
      closed = true;
      while (waiters.length > 0) {
        waiters.shift()!.resolve({ done: true, value: undefined });
      }
    },
    lines() {
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

function mergeOpenSpec(base: OpenSpec, override: Record<string, unknown>): OpenSpec {
  return deepMerge(base, override) as OpenSpec;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) {
    return base;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
