import { allAgents, resolveAgentId } from "@poe-code/agent-defs";
import {
  AcpClient,
  type McpServer,
  type PermissionOption,
  type RequestPermissionOutcome
} from "@poe-code/poe-acp-client";
import { getAcpSpawnConfig } from "../configs/index.js";
import type { McpSpawnConfig, OtelSink, SpawnMode, SpawnResult } from "../types.js";
import type { AcpEvent } from "./types.js";
import { stampReceiveTime } from "./meta.js";
import { sessionUpdateToEvents, createToolRenderState } from "./session-update-converter.js";
import { applyMiddlewares, type AcpMiddleware, type SpawnContext } from "./middleware.js";
import { observeAgentSpawn } from "../observability/otel.js";
import { bridgeResourcesForRun, cleanupResourcesForRun } from "../skill-bridge.js";
import type { HookBridgeOptions } from "../types.js";
import { mergeSpawnEnvironment } from "../environment.js";
import { validateMcpSpawnConfig } from "../configs/mcp.js";
import { normalizeModelOverride } from "../model-utils.js";

export interface SpawnAcpOptions {
  agentId: string;
  prompt: string;
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  mcpServers?: McpSpawnConfig;
  skills?: string[];
  hooks?: HookBridgeOptions;
  resumeThreadId?: string;
  runtime?: "host" | "docker";
  runtimeImage?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: "both" | "upload" | "none";
  signal?: AbortSignal;
  otelSink?: OtelSink;
  middlewares?: AcpMiddleware[];
  env?: Record<string, string | undefined>;
}

export interface SpawnAcpResult {
  events: AsyncIterable<AcpEvent>;
  done: Promise<SpawnResult>;
  unstable_setSessionModel?(model: string): Promise<void>;
}

function toAcpMcpServers(servers?: McpSpawnConfig): McpServer[] {
  if (!servers) return [];
  return Object.entries(servers).map(([name, server]) => {
    const args = getOwnProperty(server, "args") as McpSpawnConfig[string]["args"];
    const env = getOwnProperty(server, "env") as McpSpawnConfig[string]["env"];
    return {
      name,
      command: getOwnProperty(server, "command") as string,
      args: args ?? [],
      env: env ? Object.entries(env).map(([k, v]) => ({ name: k, value: v })) : []
    };
  });
}

function createAbortError(): Error {
  const error = new Error("Agent spawn aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Auto mode answers permission requests with an explicit rejection so the
 * agent can adapt and continue, instead of "cancelled" which ends the turn.
 */
function rejectPermissionRequest(args: {
  options: PermissionOption[];
}): RequestPermissionOutcome {
  const reject =
    args.options.find((option) => option.kind === "reject_once") ??
    args.options.find((option) => option.kind === "reject_always");
  return reject
    ? { outcome: "selected", optionId: reject.optionId }
    : { outcome: "cancelled" };
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

export function spawnAcp(input: SpawnAcpOptions): SpawnAcpResult {
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

  const resolvedId = resolveAgentId(options.agentId);
  if (!resolvedId) {
    throw new Error(`Unknown agent "${options.agentId}".`);
  }

  const acpConfig = getAcpSpawnConfig(resolvedId);
  if (!acpConfig) {
    throw new Error(`Agent "${resolvedId}" does not support ACP spawn.`);
  }
  const supportsMcpServers = getOwnProperty(acpConfig, "supportsMcpServers") as
    | boolean
    | undefined;
  if (options.mcpServers && supportsMcpServers === false) {
    throw new Error(`Agent "${resolvedId}" does not support MCP servers over ACP spawn.`);
  }
  if (options.mcpServers) {
    validateMcpSpawnConfig(options.mcpServers);
  }
  const modelOverride = normalizeModelOverride(options.model);

  const agentDef = allAgents.find((a) => a.id === resolvedId);
  const binaryName = agentDef?.binaryName;
  if (!binaryName) {
    throw new Error(`Agent "${resolvedId}" has no binaryName.`);
  }
  const mcpEnv = getOwnProperty(acpConfig, "mcpEnv") as
    | ((servers: McpSpawnConfig) => NodeJS.ProcessEnv)
    | undefined;
  const mcpEnvVars = options.mcpServers && mcpEnv ? mcpEnv(options.mcpServers) : {};

  const acpEnv = getOwnProperty(acpConfig, "env") as NodeJS.ProcessEnv | undefined;
  const envOverrides = { ...(acpEnv ?? {}), ...mcpEnvVars, ...(options.env ?? {}) };
  const env =
    Object.keys(envOverrides).length > 0
      ? mergeSpawnEnvironment(process.env, envOverrides)
      : undefined;
  const cwd = options.cwd ?? process.cwd();
  const manifest = bridgeResourcesForRun(options.agentId, cwd, options.skills, options.hooks);

  let client: AcpClient;
  const acpArgs = getOwnProperty(acpConfig, "acpArgs") as typeof acpConfig.acpArgs;
  const skipAuth = getOwnProperty(acpConfig, "skipAuth") as typeof acpConfig.skipAuth;
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
      autoApprove: (options.mode ?? "yolo") === "yolo",
      ...(options.mode === "auto"
        ? {
            permissionHandler: (args: {
              toolCall: { title?: string | null; toolCallId: string };
              options: PermissionOption[];
            }) => {
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
  let activeTurn: ReturnType<AcpClient["prompt"]> | undefined;

  const eventQueue: AcpEvent[] = [];
  const waiters: Array<(result: IteratorResult<AcpEvent>) => void> = [];
  let eventsDone = false;
  const ctx: SpawnContext = {
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

  const pushEvent = (event: AcpEvent): void => {
    if (eventsDone) return;
    stampReceiveTime(event, Date.now());
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
      waiter({ done: false, value: event });
    } else {
      eventQueue.push(event);
    }
  };

  const completeEventStream = (): void => {
    if (eventsDone) return;
    eventsDone = true;
    while (waiters.length > 0) {
      waiters.shift()?.({ done: true, value: undefined });
    }
  };

  const events: AsyncIterable<AcpEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<AcpEvent> {
      return {
        next(): Promise<IteratorResult<AcpEvent>> {
          if (eventQueue.length > 0) {
            return Promise.resolve({ done: false, value: eventQueue.shift()! });
          }
          if (eventsDone) {
            return Promise.resolve({ done: true, value: undefined });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        }
      };
    }
  };
  ctx.eventStream = events;

  const hasMiddlewares = options.middlewares !== undefined && options.middlewares.length > 0;
  let resolveMiddlewaresApplied: (() => void) | undefined;
  const middlewaresApplied = hasMiddlewares
    ? new Promise<void>((resolve) => {
        resolveMiddlewaresApplied = resolve;
      })
    : undefined;

  const done = (async (): Promise<SpawnResult> => {
    try {
      let finalResult: SpawnResult | undefined;
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
                    const output = (event as { path?: string }).path;
                    if (output) {
                      lastToolOutput = output;
                    }
                  }
                  pushEvent(event);
                }
              }

              const promptResponse = await turn.response;
              const stopReason = promptResponse.stopReason as string;
              const meta = (promptResponse._meta ?? {}) as Record<string, unknown>;
              const metaUsage = meta.usage as
                | { inputTokens?: number; outputTokens?: number }
                | undefined;

              const responseText = assistantText || lastToolOutput;
              finalResult = {
                stdout: responseText.length > 0 ? `${responseText}\n` : "",
                stderr: "",
                exitCode: stopReason === "completed" || stopReason === "end_turn" ? 0 : 1,
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
    async unstable_setSessionModel(model: string): Promise<void> {
      if (!sessionId) return;
      await client.setConfigOption(sessionId, "model", model).catch(() => undefined);
    }
  };
}

function normalizeSpawnAcpOptions(options: SpawnAcpOptions): SpawnAcpOptions {
  const normalized = createNullRecord<SpawnAcpOptions>({
    agentId: getOwnProperty(options, "agentId") as SpawnAcpOptions["agentId"],
    prompt: getOwnProperty(options, "prompt") as SpawnAcpOptions["prompt"]
  });
  const optionalNames: readonly (keyof SpawnAcpOptions)[] = [
    "cwd", "model", "mode", "mcpServers", "skills", "hooks", "resumeThreadId", "runtime",
    "runtimeImage", "detach", "mountPoeCode", "runnerSync", "signal",
    "otelSink", "middlewares", "env"
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
