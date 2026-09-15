import type { AcpEvent } from "../types.js";
import type { AcpMiddleware, SessionToolCall, SpawnContext } from "../middleware.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function updateSessionFromEvent(
  ctx: SpawnContext,
  event: AcpEvent,
  toolCallsById: Map<string, SessionToolCall> | undefined
): void {
  if (event.event === "session_start") {
    const threadId = readNonEmptyString((event as { threadId?: unknown }).threadId);
    if (threadId) {
      ctx.threadId = threadId;
      ctx.sessionId = threadId;
    }
    return;
  }

  if (!toolCallsById) return;

  if (event.event === "agent_message") {
    const text = readString((event as { text?: unknown }).text);
    if (!text || !ctx.sessionResult) {
      return;
    }

    ctx.sessionResult.messages.push(text);
    ctx.sessionResult.output += (ctx.sessionResult.messages.length > 1 ? "\n" : "") + text;
    return;
  }

  if (event.event === "tool_start") {
    const id = readString((event as { id?: unknown }).id);
    const kind = readString((event as { kind?: unknown }).kind);
    const title = readString((event as { title?: unknown }).title);
    const input = (event as { input?: unknown }).input;

    let toolCall = id ? toolCallsById.get(id) : undefined;
    if (!toolCall) {
      toolCall = {};
      ctx.sessionResult?.toolCalls.push(toolCall);
      if (id) {
        toolCallsById.set(id, toolCall);
      }
    }

    if (id) {
      toolCall.id = id;
    }
    if (kind) {
      toolCall.kind = kind;
    }
    if (title) {
      toolCall.title = title;
    }
    if (input !== undefined) {
      toolCall.input = input;
    }

    return;
  }

  if (event.event !== "tool_complete") {
    return;
  }

  const id = readString((event as { id?: unknown }).id);
  const kind = readString((event as { kind?: unknown }).kind);
  const path = readString((event as { path?: unknown }).path);

  let toolCall = id ? toolCallsById.get(id) : undefined;
  if (!toolCall) {
    toolCall = {};
    ctx.sessionResult?.toolCalls.push(toolCall);
    if (id) {
      toolCallsById.set(id, toolCall);
    }
  }

  if (id) {
    toolCall.id = id;
  }
  if (kind) {
    toolCall.kind = kind;
  }
  if (path) {
    toolCall.path = path;
  }
}

function createSessionCapture(retainSession: boolean): AcpMiddleware {
  return async (ctx, next) => {
    await next();

    const source = ctx.eventStream;
    const toolCallsById = retainSession ? new Map<string, SessionToolCall>() : undefined;
    if (retainSession) {
      ctx.sessionResult = { output: "", messages: [], toolCalls: [] };
    }

    for (const event of ctx.events) {
      updateSessionFromEvent(ctx, event, toolCallsById);
    }

    if (!source) return;

    ctx.eventStream = (async function* () {
      for await (const event of source) {
        if (retainSession) ctx.events.push(event);
        updateSessionFromEvent(ctx, event, toolCallsById);
        yield event;
      }
    })();
  };
}

export const sessionCapture = createSessionCapture(true);
/** Capture thread metadata while leaving conversation content in the stream. */
export const sessionMetadataCapture = createSessionCapture(false);
