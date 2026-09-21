import { spawnPlanner, spawnCatalog } from "./planning.js";
import { native } from "./native.js";
import { EventQueue } from "./event-queue.js";
import { AcpClient } from "./acp/acp-client.js";
import { getAcpSpawnConfig } from "./planning.js";
import { DEFAULT_SPAWN_MODE } from "./types.js";
import { stampReceiveTime } from "./meta.js";
import { sessionUpdateToEvents, createToolRenderState } from "./render.js";
import { applyMiddlewares } from "./stream.js";
import { observeAgentSpawn } from "./observe.js";
import { bridgeResourcesForRun, cleanupResourcesForRun } from "./resources.js";
import { mergeSpawnEnvironment } from "./planning.js";

import { normalizeModelOverride } from "./model-utils.js";
function toAcpMcpServers(servers) {
  if (!servers) return [];
  return Object.entries(servers).map(([name, server]) => {
    const args = getOwnProperty(server, "args");
    const env = getOwnProperty(server, "env");
    return {
      name,
      command: getOwnProperty(server, "command"),
      args: args ?? [],
      env: env ? Object.entries(env).map(([k, v]) => ({ name: k, value: v })) : []
    };
  });
}
function createAbortError() {
  const error = new Error("Agent spawn aborted");
  error.name = "AbortError";
  return error;
}
/**
 * Auto mode answers permission requests with an explicit rejection so the
 * agent can adapt and continue, instead of "cancelled" which ends the turn.
 */
function rejectPermissionRequest(args) {
  return native.spawnAcpRejection(JSON.stringify(args.options));
}
export function spawnAcp(input) {
  const options = normalizeSpawnAcpOptions(input);
  if (options.signal?.aborted) {
    throw createAbortError();
  }
  if (
    options.runtime !== undefined ||
    options.runtimeImage !== undefined ||
    options.detach !== undefined ||
    options.mountPoeCode !== undefined ||
    options.runnerSync !== undefined
  ) {
    throw new Error("spawnAcp does not support runtime overrides; use spawnStreaming instead.");
  }
  const resolvedId = spawnPlanner.resolveId(options.agentId);
  if (!resolvedId) {
    throw new Error(`Unknown agent "${options.agentId}".`);
  }
  const acpConfig = getAcpSpawnConfig(resolvedId);
  if (!acpConfig) {
    throw new Error(`Agent "${resolvedId}" does not support ACP spawn.`);
  }
  const supportsMcpServers = getOwnProperty(acpConfig, "supportsMcpServers");
  if (options.mcpServers && supportsMcpServers === false) {
    throw new Error(`Agent "${resolvedId}" does not support MCP servers over ACP spawn.`);
  }
  if (options.mcpServers) {
    native.spawnJsonServers(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(options.mcpServers).map(([name, server]) => [
            name,
            { command: server.command }
          ])
        )
      )
    );
  }
  const modelOverride = normalizeModelOverride(options.model);
  const agentDef = spawnCatalog.find((a) => a.metadata.id === resolvedId)?.metadata;
  const binaryName = agentDef?.binaryName;
  if (!binaryName) {
    throw new Error(`Agent "${resolvedId}" has no binaryName.`);
  }
  const mcpEnv = getOwnProperty(acpConfig, "mcpEnv");
  const mcpEnvVars = options.mcpServers && mcpEnv ? mcpEnv(options.mcpServers) : {};
  const acpEnv = getOwnProperty(acpConfig, "env");
  const envOverrides = { ...(acpEnv ?? {}), ...mcpEnvVars, ...(options.env ?? {}) };
  const env =
    Object.keys(envOverrides).length > 0
      ? mergeSpawnEnvironment(process.env, envOverrides)
      : undefined;
  const cwd = options.cwd ?? process.cwd();
  const manifest = bridgeResourcesForRun(options.agentId, cwd, options.skills, options.hooks);
  let client;
  const acpArgs = getOwnProperty(acpConfig, "acpArgs");
  const skipAuth = getOwnProperty(acpConfig, "skipAuth");
  try {
    client = new AcpClient({
      command: binaryName,
      args:
        typeof acpArgs === "function"
          ? acpArgs({
              model: modelOverride,
              mode: options.mode,
              mcpServers: options.mcpServers
            })
          : acpArgs,
      cwd,
      env,
      skipAuth: skipAuth ?? false,
      autoApprove: (options.mode ?? DEFAULT_SPAWN_MODE) === "yolo",
      ...(options.mode === "auto"
        ? {
            permissionHandler: (args) => {
              pushEvent({
                event: "permission_rejected",
                title: args.toolCall.title ?? args.toolCall.toolCallId
              });
              return rejectPermissionRequest(args);
            }
          }
        : {})
    });
  } catch (error) {
    cleanupResourcesForRun(manifest);
    throw error;
  }
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    void (async () => {
      if (sessionId) {
        await client.cancelSession(sessionId).catch(() => undefined);
      }
      await client.dispose();
    })();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const toolState = createToolRenderState();
  let sessionId = "";
  let assistantText = "";
  let lastToolOutput = "";
  let activeTurn;
  const eventQueue = new EventQueue(),
    usage = new native.NativeSpawnUsage();
  let eventsDone = false;
  const ctx = {
    sessionId: "unknown",
    agent: resolvedId,
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
  const pushEvent = (event) => {
    if (eventsDone) return;
    stampReceiveTime(event, Date.now());
    if (event.event === "session_start") {
      const threadId = event.threadId;
      if (typeof threadId === "string" && threadId.length > 0) {
        ctx.threadId = threadId;
        ctx.sessionId = threadId;
      }
    }
    ctx.events.push(event);
    if (event.event === "usage")
      ctx.usage = usage.observe(
        [event.inputTokens, event.outputTokens, event.cachedTokens, event.costUsd].map((value) =>
          typeof value === "number" ? value : null
        )
      );
    eventQueue.push(event);
  };
  const completeEventStream = () => {
    if (eventsDone) return;
    eventsDone = true;
    eventQueue.close();
  };
  const events = {
    [Symbol.asyncIterator]() {
      return {
        next: () => eventQueue.next(),
        return: async () => {
          eventQueue.abandon();
          return { done: true, value: undefined };
        }
      };
    }
  };
  ctx.eventStream = events;
  const hasMiddlewares = options.middlewares !== undefined && options.middlewares.length > 0;
  let resolveMiddlewaresApplied;
  const middlewaresApplied = hasMiddlewares
    ? new Promise((resolve) => {
        resolveMiddlewaresApplied = resolve;
      })
    : undefined;
  const done = (async () => {
    try {
      let finalResult;
      await applyMiddlewares(
        [
          ...(options.middlewares ?? []),
          async (_ctx, next) => {
            try {
              const initResult = await client.initialize();
              if (
                initResult.authMethods &&
                initResult.authMethods.length > 0 &&
                client.state !== "ready"
              ) {
                await client.authenticate(initResult.authMethods[0].id);
              }
              const mcpServers = toAcpMcpServers(options.mcpServers);
              if (options.resumeThreadId) {
                await client.loadSession(options.resumeThreadId, cwd, mcpServers);
                sessionId = options.resumeThreadId;
              } else {
                const session = await client.newSession(cwd, mcpServers);
                sessionId = session.sessionId;
              }
              if (aborted) {
                await client.cancelSession(sessionId).catch(() => undefined);
                throw createAbortError();
              }
              pushEvent({ event: "session_start", threadId: sessionId });
              const turn = client.prompt(sessionId, [{ type: "text", text: options.prompt }]);
              activeTurn = turn;
              for await (const notification of turn) {
                if (aborted) break;
                const update = notification.params.update;
                if (
                  update.sessionUpdate === "agent_message_chunk" &&
                  update.content.type === "text"
                ) {
                  assistantText += update.content.text;
                }
                const events = sessionUpdateToEvents(update, toolState);
                if (events.length > 0) {
                  events[0]._meta = { ...(events[0]._meta ?? {}), raw: update };
                }
                for (const event of events) {
                  if (event.event === "tool_complete") {
                    const output = event.path;
                    if (output) {
                      lastToolOutput = output;
                    }
                  }
                  pushEvent(event);
                }
              }
              const promptResponse = await turn.response;
              const stopReason = promptResponse.stopReason;
              const meta = promptResponse._meta ?? {};
              const metaUsage = meta.usage;
              const responseText = assistantText || lastToolOutput;
              finalResult = {
                stdout: responseText.length > 0 ? `${responseText}\n` : "",
                stderr: "",
                exitCode: native.spawnAcpExitCode(stopReason),
                threadId: sessionId,
                ...(metaUsage
                  ? {
                      usage: {
                        inputTokens: metaUsage.inputTokens ?? 0,
                        outputTokens: metaUsage.outputTokens ?? 0
                      }
                    }
                  : {})
              };
            } catch (error) {
              if (aborted) {
                throw createAbortError();
              }
              const message = error instanceof Error ? error.message : String(error);
              pushEvent({
                event: "error",
                message,
                ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
              });
              finalResult = {
                stdout: assistantText.length > 0 ? `${assistantText}\n` : "",
                stderr: message,
                exitCode: 1,
                ...(sessionId ? { threadId: sessionId } : {})
              };
            } finally {
              options.signal?.removeEventListener("abort", onAbort);
              completeEventStream();
              await activeTurn?.response.catch(() => undefined);
              await client.dispose();
            }
            await next();
          }
        ],
        ctx
      );
      return {
        ...(finalResult ?? { stdout: "", stderr: "", exitCode: 1 }),
        ...(ctx.threadId && !finalResult?.threadId ? { threadId: ctx.threadId } : {}),
        ...(ctx.logFile && !finalResult?.logFile ? { logFile: ctx.logFile } : {})
      };
    } finally {
      resolveMiddlewaresApplied?.();
      cleanupResourcesForRun(manifest);
    }
  })();
  const returnedEvents = hasMiddlewares
    ? {
        [Symbol.asyncIterator]() {
          let iterator;
          return {
            async next() {
              await middlewaresApplied;
              iterator ??= ctx.eventStream[Symbol.asyncIterator]();
              return iterator.next();
            }
          };
        }
      }
    : events;
  return {
    events: returnedEvents,
    done: observeAgentSpawn(
      {
        agent: resolvedId,
        cwd: options.cwd,
        mode: options.mode,
        otelSink: options.otelSink,
        prompt: options.prompt
      },
      () => done
    ),
    async unstable_setSessionModel(model) {
      if (!sessionId) return;
      await client.setConfigOption(sessionId, "model", model).catch(() => undefined);
    }
  };
}
function normalizeSpawnAcpOptions(options) {
  const normalized = createNullRecord({
    agentId: getOwnProperty(options, "agentId"),
    prompt: getOwnProperty(options, "prompt"),
    mode: getOwnProperty(options, "mode") ?? DEFAULT_SPAWN_MODE
  });
  const optionalNames = [
    "cwd",
    "model",
    "mcpServers",
    "skills",
    "hooks",
    "resumeThreadId",
    "runtime",
    "runtimeImage",
    "detach",
    "mountPoeCode",
    "runnerSync",
    "signal",
    "otelSink",
    "middlewares",
    "env"
  ];
  for (const name of optionalNames) {
    const value = getOwnProperty(options, name);
    if (value !== undefined) Object.assign(normalized, { [name]: value });
  }
  return normalized;
}
function getOwnProperty(value, name) {
  return hasOwnProperty(value, name) ? value[name] : undefined;
}
function hasOwnProperty(value, name) {
  return Object.prototype.hasOwnProperty.call(value, name);
}
function createNullRecord(value) {
  return Object.assign(Object.create(null), value);
}
