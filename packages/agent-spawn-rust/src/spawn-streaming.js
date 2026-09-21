import { native } from "./native.js";
import { resolveConfig, mergeSpawnEnvironment } from "./index.js";
import { getMcpEnv } from "./mcp-args.js";
import { applyMcpFile } from "./mcp-file.js";
import { resolveSpawnExecution } from "./runtime.js";
import { bridgeResourcesForRun, cleanupResourcesForRun } from "./resources.js";
import { runPoeCommand } from "./harness/run-poe-command.js";
import { getAdapter } from "./adapters.js";
import { applyMiddlewares } from "./stream.js";
import { LINE_BATCHES, EVENT_BATCHES } from "./adapter-batches.js";
import { EventQueue } from "./event-queue.js";
import { observeAgentSpawn } from "./observe.js";
import { startNativeOtelCapture } from "./native-otel.js";
import { DEFAULT_SPAWN_MODE } from "./types.js";
const planner = new native.NativeSpawnPlanner();
function own(value, key) {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}
function normalize(input) {
  const result = Object.assign(Object.create(null), {
    agentId: own(input, "agentId"),
    prompt: own(input, "prompt"),
    mode: own(input, "mode") ?? DEFAULT_SPAWN_MODE
  });
  for (const key of [
    "cwd",
    "model",
    "args",
    "mcpServers",
    "skills",
    "hooks",
    "resumeThreadId",
    "useStdin",
    "interactive",
    "signal",
    "otelSink",
    "captureOtel",
    "captureOtelContent",
    "env",
    "middlewares",
    "tee",
    "activityTimeoutMs",
    "logPath",
    "logDir",
    "logFileName",
    "runtime",
    "runtimeImage",
    "runtimeConfigCwd",
    "detach",
    "mountPoeCode",
    "runnerSync"
  ]) {
    const value = own(input, key);
    if (value !== undefined) result[key] = value;
  }
  return result;
}
function delivery(queue) {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => queue.next(),
        return() {
          queue.abandon();
          return Promise.resolve({ done: true, value: undefined });
        }
      };
    }
  };
}
function mergeEnvironment(...sources) {
  const result = Object.create(null);
  for (const source of sources)
    for (const [key, value] of Object.entries(source ?? {})) {
      const previous = result[key];
      if (value === undefined || previous === undefined) {
        result[key] = value;
        continue;
      }
      try {
        const left = JSON.parse(previous),
          right = JSON.parse(value);
        result[key] =
          left !== null &&
          right !== null &&
          typeof left === "object" &&
          typeof right === "object" &&
          !Array.isArray(left) &&
          !Array.isArray(right)
            ? JSON.stringify(native.spawnMergeMcp(JSON.stringify(left), JSON.stringify(right)))
            : value;
      } catch {
        result[key] = value;
      }
    }
  return result;
}
async function startCapture(options) {
  if (!options.captureOtel) return undefined;
  if (options.runtime !== undefined && options.runtime !== "host") {
    console.warn("warning: native OpenTelemetry capture currently supports only the host runtime");
    return undefined;
  }
  return startNativeOtelCapture(options.agentId, options.captureOtelContent);
}
export function spawnStreaming(input) {
  const options = normalize(input);
  if (options.signal?.aborted) {
    const error = new Error("Agent spawn aborted");
    error.name = "AbortError";
    throw error;
  }
  const { agentId, spawnConfig } = resolveConfig(options.agentId);
  const cwd = options.cwd ?? process.cwd(),
    dto = JSON.stringify({
      prompt: options.prompt,
      mode: options.mode,
      model: options.model,
      args: options.args,
      mcpServers: options.mcpServers,
      resumeThreadId: options.resumeThreadId,
      cwd,
      useStdin: options.useStdin,
      streamingTransport: true
    });
  const plan = planner.build(options.agentId, dto, process.env.POE_AGENT_BINARY);
  const useStdin =
    planner.selectedStdin(
      options.agentId,
      JSON.stringify({ prompt: options.prompt, useStdin: options.useStdin })
    ) !== null;
  const model = options.model ? options.model.trim() || undefined : undefined;
  if (options.model && model === undefined) throw new Error("Model must not be blank.");
  const capturePromise = startCapture(options),
    mcpEnv = getMcpEnv(spawnConfig, options.mcpServers);
  const lineQueue = new EventQueue(),
    eventQueue = new EventQueue(),
    framer = new native.NativeSpawnLines(true),
    usage = new native.NativeSpawnUsage();
  let linesClosed = false,
    flushScheduled = false;
  const pendingChunks = [];
  const flushLines = () => {
    flushScheduled = false;
    if (!pendingChunks.length) return;
    const batch = framer.push(pendingChunks.join(""));
    pendingChunks.length = 0;
    if (batch.length) lineQueue.push(batch);
  };
  const closeLines = () => {
    if (linesClosed) return;
    flushLines();
    linesClosed = true;
    const tail = framer.end();
    if (tail !== null) lineQueue.push([tail]);
    lineQueue.close();
  };
  const source = {
    [LINE_BATCHES]: lineQueue,
    async *[Symbol.asyncIterator]() {
      for await (const batch of lineQueue) yield* batch;
    }
  };
  const hasMiddlewares = options.middlewares !== undefined && options.middlewares.length > 0;
  const ctx = {
    sessionId: "unknown",
    agent: agentId,
    events: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    prompt: options.prompt,
    model,
    mode: options.mode,
    cwd,
    startedAt: new Date(),
    eventStream: delivery(eventQueue)
  };
  for (const key of ["logPath", "logDir", "logFileName"])
    if (options[key] !== undefined) ctx[key] = options[key];
  const adapter = getAdapter(spawnConfig.adapter);
  const manifest = bridgeResourcesForRun(options.agentId, cwd, options.skills, options.hooks);
  const eventDone = (async () => {
    try {
      const batches = adapter[EVENT_BATCHES]
        ? adapter[EVENT_BATCHES](source)
        : (async function* () {
            for await (const event of adapter(source)) yield [event];
          })();
      for await (const batch of batches) {
        const delivery = [];
        for (const event of batch) {
          if (!event || typeof event !== "object" || !Object.hasOwn(event, "event")) continue;
          if (!event._meta || typeof event._meta.ts !== "number")
            event._meta = { ...event._meta, ts: Date.now() };
          if (
            event.event === "session_start" &&
            typeof event.threadId === "string" &&
            event.threadId.length > 0
          )
            ctx.threadId = ctx.sessionId = event.threadId;
          if (hasMiddlewares) ctx.events.push(event);
          if (event.event === "usage")
            ctx.usage = usage.observe(
              [event.inputTokens, event.outputTokens, event.cachedTokens, event.costUsd].map(
                (value) => (typeof value === "number" ? value : null)
              )
            );
          delivery.push(event);
        }
        eventQueue.pushMany(delivery);
      }
      eventQueue.close();
    } catch (error) {
      eventQueue.fail(error);
      throw error;
    }
  })();
  // An adapter may fail before runtime effects finish. Observe it immediately;
  // the runtime layer still waits on the same rejection before middleware exits.
  eventDone.catch(() => {});
  let applied;
  const middlewareDone = new Promise((resolve) => {
    applied = resolve;
  });
  const done = (async () => {
    let restore;
    const result = { stdout: "", stderr: "", exitCode: 1 };
    try {
      restore =
        options.mcpServers && spawnConfig.mcpFile
          ? await applyMcpFile(spawnConfig.mcpFile, options.mcpServers, cwd)
          : undefined;
      await applyMiddlewares(
        [
          ...(options.middlewares ?? []),
          async (_ctx, next) => {
            const capture = await capturePromise,
              envOverrides = mergeEnvironment(mcpEnv, plan.env, {
                ...(capture?.env ?? {}),
                ...(options.env ?? {})
              });
            const processEnv = Object.keys(envOverrides).length
              ? mergeSpawnEnvironment(process.env, envOverrides)
              : undefined;
            const execution = resolveSpawnExecution({
              cwd,
              runtimeConfigCwd: options.runtimeConfigCwd,
              env: processEnv ?? process.env,
              argv: [plan.binaryName, ...plan.args, ...(capture?.args ?? [])],
              displayArgv: [plan.binaryName, ...plan.displayArgs, ...(capture?.args ?? [])],
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
                  env: processEnv,
                  input: useStdin ? options.prompt : "",
                  captureOutput: true,
                  captureStdout: false,
                  activityTimeoutMs: options.activityTimeoutMs,
                  activityTimeoutSource: "stdout",
                  onStdout(chunk) {
                    options.tee?.stdout?.write(chunk);
                    if (!linesClosed) {
                      pendingChunks.push(chunk);
                      if (!flushScheduled) {
                        flushScheduled = true;
                        queueMicrotask(flushLines);
                      }
                    }
                  },
                  onStderr(chunk) {
                    options.tee?.stderr?.write(chunk);
                  }
                }
              }
            });
            try {
              const run = await runPoeCommand({
                factory: execution.factory,
                openSpec: execution.openSpec,
                detach: execution.detach,
                state: execution.state,
                signal: options.signal
              });
              if (run.kind === "detached") {
                result.exitCode = 0;
                result.detached = { jobId: run.jobId, envId: run.envId };
              } else {
                result.stderr = run.stderr ?? "";
                result.exitCode = run.exitCode;
              }
            } finally {
              closeLines();
            }
            await eventDone;
            if (capture)
              ctx.metadata = {
                ...ctx.metadata,
                nativeOtelCorrelationId: capture.correlationId,
                nativeOtel: await capture.drain()
              };
            await next();
          }
        ],
        ctx
      );
      return { ...result, ...(ctx.logFile ? { logFile: ctx.logFile } : {}) };
    } finally {
      applied();
      closeLines();
      await restore?.();
      cleanupResourcesForRun(manifest);
    }
  })();
  const events = hasMiddlewares
    ? (async function* () {
        await middlewareDone;
        yield* ctx.eventStream;
      })()
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
