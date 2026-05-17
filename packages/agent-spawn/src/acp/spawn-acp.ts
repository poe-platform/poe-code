import { allAgents, resolveAgentId } from "@poe-code/agent-defs";
import { AcpClient, type McpServer } from "@poe-code/poe-acp-client";
import { getAcpSpawnConfig } from "../configs/index.js";
import type { McpSpawnConfig, OtelSink, SpawnMode, SpawnResult } from "../types.js";
import type { AcpEvent } from "./types.js";
import { stampReceiveTime } from "./meta.js";
import { sessionUpdateToEvents, createToolRenderState } from "./session-update-converter.js";
import { applyMiddlewares, type AcpMiddleware, type SpawnContext } from "./middleware.js";
import { observeAgentSpawn } from "../observability/otel.js";

export interface SpawnAcpOptions {
  agentId: string;
  prompt: string;
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  mcpServers?: McpSpawnConfig;
  resumeThreadId?: string;
  runtime?: "host" | "docker" | "e2b";
  runtimeImage?: string;
  runtimeTemplate?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: "both" | "upload" | "none";
  signal?: AbortSignal;
  otelSink?: OtelSink;
  middlewares?: AcpMiddleware[];
}

export interface SpawnAcpResult {
  events: AsyncIterable<AcpEvent>;
  done: Promise<SpawnResult>;
}

function toAcpMcpServers(servers?: McpSpawnConfig): McpServer[] {
  if (!servers) return [];
  return Object.entries(servers).map(([name, server]) => ({
    name,
    command: server.command,
    args: server.args ?? [],
    env: server.env ? Object.entries(server.env).map(([k, v]) => ({ name: k, value: v })) : []
  }));
}

function createAbortError(): Error {
  const error = new Error("Agent spawn aborted");
  error.name = "AbortError";
  return error;
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

export function spawnAcp(options: SpawnAcpOptions): SpawnAcpResult {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const resolvedId = resolveAgentId(options.agentId);
  if (!resolvedId) {
    throw new Error(`Unknown agent "${options.agentId}".`);
  }

  const acpConfig = getAcpSpawnConfig(resolvedId);
  if (!acpConfig) {
    throw new Error(`Agent "${resolvedId}" does not support ACP spawn.`);
  }

  const agentDef = allAgents.find((a) => a.id === resolvedId);
  const binaryName = agentDef?.binaryName;
  if (!binaryName) {
    throw new Error(`Agent "${resolvedId}" has no binaryName.`);
  }
  const mcpEnvVars =
    options.mcpServers && acpConfig.mcpEnv ? acpConfig.mcpEnv(options.mcpServers) : {};

  const envOverrides = { ...(acpConfig.env ?? {}), ...mcpEnvVars };
  const env =
    Object.keys(envOverrides).length > 0 ? { ...process.env, ...envOverrides } : undefined;

  const client = new AcpClient({
    command: binaryName,
    args: acpConfig.acpArgs,
    cwd: options.cwd ?? process.cwd(),
    env,
    skipAuth: acpConfig.skipAuth ?? false,
    autoApprove: (options.mode ?? "yolo") === "yolo"
  });

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    void client.dispose();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const toolState = createToolRenderState();

  let sessionId = "";
  let assistantText = "";
  let lastToolOutput = "";

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
    model: options.model,
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

  const done = (async (): Promise<SpawnResult> => {
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

            const cwd = options.cwd ?? process.cwd();
            const mcpServers = toAcpMcpServers(options.mcpServers);
            if (options.resumeThreadId) {
              await client.loadSession(options.resumeThreadId, cwd, mcpServers);
              sessionId = options.resumeThreadId;
            } else {
              const session = await client.newSession(cwd, mcpServers);
              sessionId = session.sessionId;
            }

            pushEvent({ event: "session_start", threadId: sessionId });

            const turn = client.prompt(sessionId, [{ type: "text", text: options.prompt }]);

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
  })();

  return {
    events,
    done: observeAgentSpawn(
      {
        agent: resolvedId,
        cwd: options.cwd,
        mode: options.mode,
        otelSink: options.otelSink,
        prompt: options.prompt
      },
      () => done
    )
  };
}
