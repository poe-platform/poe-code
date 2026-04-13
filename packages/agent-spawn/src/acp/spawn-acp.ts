import { allAgents, resolveAgentId } from "@poe-code/agent-defs";
import { AcpClient, type McpServer, type SessionUpdateNotification, type ToolKind } from "@poe-code/poe-acp-client";
import { getAcpSpawnConfig } from "../configs/index.js";
import type { McpSpawnConfig, SpawnMode, SpawnResult } from "../types.js";
import type { AcpEvent } from "./types.js";

export interface SpawnAcpOptions {
  agentId: string;
  prompt: string;
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  mcpServers?: McpSpawnConfig;
  signal?: AbortSignal;
}

export interface SpawnAcpResult {
  events: AsyncIterable<AcpEvent>;
  done: Promise<SpawnResult>;
}

interface ToolRenderState {
  startedToolCalls: Set<string>;
  toolCallKinds: Map<string, string>;
  toolCallTitles: Map<string, string>;
}

function toRenderKind(kind: ToolKind | undefined | null): string {
  if (kind === "execute") return "exec";
  if (kind === "write") return "edit";
  if (kind === "read") return "read";
  return "other";
}

function toToolTitle(
  title: string,
  locations?: Array<{ path: string }> | null
): string {
  if (locations && locations.length > 0 && locations[0].path) {
    return locations[0].path;
  }
  return title;
}

function toToolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractToolOutputText(update: {
  rawOutput?: unknown;
  content?: Array<{ type: string; text?: string }> | null;
}): string {
  const raw = toToolOutput(update.rawOutput);
  if (raw) return raw;
  if (!update.content) return "";
  return update.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");
}

function toEventsFromSessionUpdate(
  notification: SessionUpdateNotification,
  state: ToolRenderState
): AcpEvent[] {
  const update = notification.params.update;

  if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
    return [{ event: "agent_message", text: update.content.text }];
  }

  if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
    return [{ event: "reasoning", text: update.content.text }];
  }

  if (update.sessionUpdate === "usage_update") {
    const cachedTokens = Math.max(0, update.size - update.used);
    const usage: AcpEvent = {
      event: "usage",
      inputTokens: update.used,
      outputTokens: 0,
    };

    if (cachedTokens > 0) {
      (usage as { cachedTokens?: number }).cachedTokens = cachedTokens;
    }

    if (update.cost && update.cost.currency === "USD") {
      (usage as { costUsd?: number }).costUsd = update.cost.amount;
    }

    return [usage];
  }

  if (update.sessionUpdate === "tool_call") {
    const renderKind = toRenderKind(update.kind);
    const title = toToolTitle(update.title, update.locations);
    state.toolCallKinds.set(update.toolCallId, renderKind);
    state.toolCallTitles.set(update.toolCallId, title);

    if (state.startedToolCalls.has(update.toolCallId)) {
      return [];
    }

    state.startedToolCalls.add(update.toolCallId);
    return [{
      event: "tool_start",
      kind: renderKind,
      title,
      id: update.toolCallId,
    }];
  }

  if (update.sessionUpdate === "tool_call_update") {
    const renderKind = toRenderKind(update.kind ?? undefined)
      || state.toolCallKinds.get(update.toolCallId)
      || "other";
    state.toolCallKinds.set(update.toolCallId, renderKind);

    const events: AcpEvent[] = [];
    const toolTitle = toToolTitle(
      state.toolCallTitles.get(update.toolCallId) ?? update.toolCallId,
      update.locations
    );
    state.toolCallTitles.set(update.toolCallId, toolTitle);
    const status = update.status;

    const shouldStart = !state.startedToolCalls.has(update.toolCallId)
      && (status === "pending" || status === "in_progress");
    if (shouldStart) {
      state.startedToolCalls.add(update.toolCallId);
      events.push({
        event: "tool_start",
        kind: renderKind,
        title: toolTitle,
        id: update.toolCallId,
      });
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      if (!state.startedToolCalls.has(update.toolCallId)) {
        state.startedToolCalls.add(update.toolCallId);
        events.push({
          event: "tool_start",
          kind: renderKind,
          title: toolTitle,
          id: update.toolCallId,
        });
      }

      events.push({
        event: "tool_complete",
        kind: renderKind,
        path: extractToolOutputText(update),
        id: update.toolCallId,
      });
    }

    return events;
  }

  return [];
}

function toAcpMcpServers(servers?: McpSpawnConfig): McpServer[] {
  if (!servers) return [];
  return Object.entries(servers).map(([name, server]) => ({
    name,
    command: server.command,
    args: server.args ?? [],
    env: server.env
      ? Object.entries(server.env).map(([k, v]) => ({ name: k, value: v }))
      : [],
  }));
}

function createAbortError(): Error {
  const error = new Error("Agent spawn aborted");
  error.name = "AbortError";
  return error;
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
  const mcpEnvVars = options.mcpServers && acpConfig.mcpEnv
    ? acpConfig.mcpEnv(options.mcpServers)
    : {};

  const env = Object.keys(mcpEnvVars).length > 0
    ? { ...process.env, ...mcpEnvVars }
    : undefined;

  const client = new AcpClient({
    command: binaryName,
    args: acpConfig.acpArgs,
    cwd: options.cwd ?? process.cwd(),
    env,
    requestTimeoutMs: 300_000,
    skipAuth: acpConfig.skipAuth ?? false,
    autoApprove: (options.mode ?? "yolo") === "yolo",
  });

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    void client.dispose();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const toolState: ToolRenderState = {
    startedToolCalls: new Set(),
    toolCallKinds: new Map(),
    toolCallTitles: new Map(),
  };

  let sessionId = "";
  let assistantText = "";
  let lastToolOutput = "";

  const eventQueue: AcpEvent[] = [];
  const waiters: Array<(result: IteratorResult<AcpEvent>) => void> = [];
  let eventsDone = false;

  const pushEvent = (event: AcpEvent): void => {
    if (eventsDone) return;
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
        },
      };
    },
  };

  const done = (async (): Promise<SpawnResult> => {
    try {
      const initResult = await client.initialize();

      if (initResult.authMethods && initResult.authMethods.length > 0 && client.state !== "ready") {
        await client.authenticate(initResult.authMethods[0].id);
      }

      const session = await client.newSession(options.cwd ?? process.cwd(), toAcpMcpServers(options.mcpServers));
      sessionId = session.sessionId;

      pushEvent({ event: "session_start", threadId: sessionId });

      const turn = client.prompt(sessionId, [{ type: "text", text: options.prompt }]);

      for await (const notification of turn) {
        if (aborted) break;

        const update = notification.params.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          assistantText += update.content.text;
        }

        for (const event of toEventsFromSessionUpdate(notification, toolState)) {
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
      const metaUsage = meta.usage as { inputTokens?: number; outputTokens?: number } | undefined;

      const responseText = assistantText || lastToolOutput;
      return {
        stdout: responseText.length > 0 ? `${responseText}\n` : "",
        stderr: "",
        exitCode: stopReason === "completed" || stopReason === "end_turn" ? 0 : 1,
        threadId: sessionId,
        ...(metaUsage ? {
          usage: {
            inputTokens: metaUsage.inputTokens ?? 0,
            outputTokens: metaUsage.outputTokens ?? 0,
          }
        } : {}),
      };
    } catch (error) {
      if (aborted) {
        throw createAbortError();
      }

      const message = error instanceof Error ? error.message : String(error);
      pushEvent({
        event: "error",
        message,
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });

      return {
        stdout: assistantText.length > 0 ? `${assistantText}\n` : "",
        stderr: message,
        exitCode: 1,
        ...(sessionId ? { threadId: sessionId } : {}),
      };
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      completeEventStream();
      await client.dispose();
    }
  })();

  return { events, done };
}
