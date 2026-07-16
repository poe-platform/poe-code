import { acp, resolveOutputFormat, text } from "toolcraft-design";
import type { SessionUpdate } from "@poe-code/poe-acp-client";
import type { AcpEvent, SpawnResultEvent } from "./types.js";
import { toRenderKind } from "./session-update-converter.js";

function writeLine(line: string): void {
  acp.getAcpWriter()(line);
}

/**
 * Render a single ACP event using design-system rendering primitives.
 *
 * Example:
 * `await renderAcpStream(spawnStreaming(...).events)`
 */
export function renderAcpEvent(event: AcpEvent): void {
  switch (event.event) {
    case "session_start":
      return;
    case "agent_message":
      acp.renderAgentMessage((event as { text: string }).text);
      return;
    case "tool_start":
      acp.renderToolStart(
        (event as { kind: string }).kind,
        (event as { title: string }).title
      );
      return;
    case "tool_complete":
      acp.renderToolComplete((event as { kind: string }).kind);
      return;
    case "reasoning":
      acp.renderReasoning((event as { text: string }).text);
      return;
    case "usage":
      acp.renderUsage({
        input: (event as { inputTokens: number }).inputTokens,
        output: (event as { outputTokens: number }).outputTokens,
        cached: (event as { cachedTokens?: number }).cachedTokens,
        costUsd: (event as { costUsd?: number }).costUsd
      });
      return;
    case "permission_rejected":
      acp.renderPermissionRejected((event as { title: string }).title);
      return;
    case "error":
      acp.renderError(
        (() => {
          const { message, stack } = event as { message: string; stack?: string };
          return typeof stack === "string" && stack.length > 0
            ? `${message}\n${stack}`
            : message;
        })()
      );
      return;
    case "spawn_result":
      if (resolveOutputFormat() === "json") {
        writeLine(JSON.stringify(event));
      }
      return;
    default:
      writeLine(text.muted(event.event));
      return;
  }
}

/**
 * Outcome an event reveals about the run, so buffered partial text is attributed correctly:
 * a failure marks the text it belongs to as failed instead of leaving it looking successful.
 */
function stateForEvent(event: AcpEvent): acp.AcpOutputState {
  if (event.event === "error") return "error";
  if (event.event === "spawn_result" && (event as SpawnResultEvent).exitCode !== 0) return "error";
  return "streaming";
}

export async function renderAcpStream(
  events: AsyncIterable<AcpEvent>
): Promise<void> {
  let messageBuffer = "";
  let reasoningBuffer = "";

  function flushMessageBuffer(state: acp.AcpOutputState): void {
    if (messageBuffer.length > 0) {
      acp.renderAgentMessage(messageBuffer, state);
      messageBuffer = "";
    }
  }

  function flushReasoningBuffer(): void {
    if (reasoningBuffer.length > 0) {
      acp.renderReasoning(reasoningBuffer);
      reasoningBuffer = "";
    }
  }

  function flushAll(state: acp.AcpOutputState): void {
    flushMessageBuffer(state);
    flushReasoningBuffer();
  }

  for await (const event of events) {
    if (event.event === "agent_message") {
      flushReasoningBuffer();
      messageBuffer += (event as { text: string }).text;
      continue;
    }
    if (event.event === "reasoning") {
      flushMessageBuffer("streaming");
      reasoningBuffer += (event as { text: string }).text;
      continue;
    }
    flushAll(stateForEvent(event));
    renderAcpEvent(event);
  }
  flushAll("streaming");
}

function renderSessionUpdate(update: SessionUpdate): void {
  if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
    acp.renderAgentMessage(update.content.text);
    return;
  }

  if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
    acp.renderReasoning(update.content.text);
    return;
  }

  if (update.sessionUpdate === "tool_call") {
    acp.renderToolStart(toRenderKind(update.kind), update.title);
    return;
  }

  if (update.sessionUpdate === "tool_call_update") {
    const status = update.status;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      acp.renderToolComplete(toRenderKind(update.kind ?? undefined));
    }
    return;
  }

  if (update.sessionUpdate === "usage_update") {
    const meta = (update._meta ?? {}) as {
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
    };
    const input = typeof meta.inputTokens === "number" ? meta.inputTokens : update.used;
    const output = typeof meta.outputTokens === "number" ? meta.outputTokens : 0;
    const cached =
      typeof meta.cachedTokens === "number"
        ? meta.cachedTokens
        : Math.max(0, update.size - update.used);

    acp.renderUsage({
      input,
      output,
      ...(cached > 0 ? { cached } : {}),
      ...(update.cost?.currency === "USD" ? { costUsd: update.cost.amount } : {}),
    });
    return;
  }
}

export async function renderSessionUpdateStream(
  updates: AsyncIterable<SessionUpdate>
): Promise<void> {
  let messageBuffer = "";
  let reasoningBuffer = "";

  function flushMessageBuffer(): void {
    if (messageBuffer.length > 0) {
      acp.renderAgentMessage(messageBuffer);
      messageBuffer = "";
    }
  }

  function flushReasoningBuffer(): void {
    if (reasoningBuffer.length > 0) {
      acp.renderReasoning(reasoningBuffer);
      reasoningBuffer = "";
    }
  }

  function flushAll(): void {
    flushMessageBuffer();
    flushReasoningBuffer();
  }

  for await (const update of updates) {
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      flushReasoningBuffer();
      messageBuffer += update.content.text;
      continue;
    }
    if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
      flushMessageBuffer();
      reasoningBuffer += update.content.text;
      continue;
    }
    flushAll();
    renderSessionUpdate(update);
  }
  flushAll();
}
