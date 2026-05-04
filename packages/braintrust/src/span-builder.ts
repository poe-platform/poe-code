import type { AcpEvent, AcpSpawnContext as SpawnContext } from "@poe-code/agent-spawn";

import type { BraintrustClient } from "./client.js";
import { redact } from "./redact.js";

interface BraintrustSpan {
  startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpan;
  log(event: {
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
    metrics?: Record<string, number>;
  }): void;
  end(): void;
}

interface BraintrustSpanParent {
  startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpan;
}

type EventRecord = Record<string, unknown>;
type SpawnContextWithMetadata = SpawnContext & {
  metadata?: Record<string, unknown>;
};

export async function logSpawnSession(
  client: BraintrustClient,
  ctx: SpawnContextWithMetadata,
): Promise<void> {
  try {
    const { currentSpan } = await import("braintrust");
    const agentSpan = asSpanParent(currentSpan()).startSpan({
      name: `agent:${ctx.agent}:${ctx.model ?? "?"}`,
      type: "task",
    });

    try {
      logToolSpans(agentSpan, ctx.events);
      agentSpan.log({
        input: redact({
          prompt: ctx.prompt,
          mode: ctx.mode,
          cwd: ctx.cwd,
        }),
        output: redact(accumulateAgentOutput(ctx.events)),
        metadata: {
          sessionId: ctx.sessionId,
          threadId: ctx.threadId,
          ...ctx.metadata,
        },
        metrics: buildMetrics(ctx),
      });
    } finally {
      agentSpan.end();
    }
  } catch (err) {
    client.recordError(err, "log spawn session");
  }
}

function logToolSpans(agentSpan: BraintrustSpan, events: AcpEvent[]): void {
  for (const [index, event] of events.entries()) {
    const toolCall = asToolCall(event);
    if (toolCall === undefined) {
      continue;
    }

    const toolSpan = agentSpan.startSpan({
      name: `tool_call:${readString(toolCall.kind) ?? "unknown"}`,
      type: "tool",
    });

    try {
      toolSpan.log({
        input: redact(readToolInput(toolCall)),
        output: redact(assembleToolOutput(events, index, readString(toolCall.toolCallId))),
      });
    } finally {
      toolSpan.end();
    }
  }
}

function accumulateAgentOutput(events: AcpEvent[]): string {
  let output = "";

  for (const event of events) {
    const record = asRecord(event);
    if (record === undefined) {
      continue;
    }

    if (record.event === "agent_message") {
      output += readString(record.text) ?? "";
      continue;
    }

    if (record.sessionUpdate === "agent_message_chunk") {
      output += readContentText(record.content);
    }
  }

  return output;
}

function assembleToolOutput(
  events: AcpEvent[],
  toolCallIndex: number,
  toolCallId: string | undefined,
): unknown {
  const outputs: unknown[] = [];
  let text = "";

  for (const event of events.slice(toolCallIndex + 1)) {
    const update = asToolCallUpdate(event);
    if (update === undefined) {
      continue;
    }

    if (toolCallId !== undefined && update.toolCallId !== toolCallId) {
      continue;
    }

    if (Object.hasOwn(update, "rawOutput")) {
      outputs.push(update.rawOutput);
    }

    const contentText = readContentText(update.content);
    if (contentText.length > 0) {
      text += contentText;
    }
  }

  if (outputs.length === 0) {
    return text;
  }

  if (text.length > 0) {
    outputs.push(text);
  }

  return outputs.length === 1 ? outputs[0] : outputs;
}

function buildMetrics(ctx: SpawnContext): Record<string, number> {
  const usage = ctx.usage as unknown as Record<string, unknown>;
  const metrics: Record<string, number> = {};
  const promptTokens = readNumber(usage.prompt_tokens) ?? readNumber(usage.inputTokens);
  const completionTokens = readNumber(usage.completion_tokens) ?? readNumber(usage.outputTokens);

  addMetric(metrics, "prompt_tokens", promptTokens);
  addMetric(metrics, "completion_tokens", completionTokens);
  addMetric(
    metrics,
    "tokens",
    readNumber(usage.tokens) ?? sumIfPresent(promptTokens, completionTokens),
  );
  addMetric(
    metrics,
    "prompt_cached_tokens",
    readNumber(usage.prompt_cached_tokens) ?? readNumber(usage.cachedTokens),
  );
  addMetric(
    metrics,
    "prompt_cache_creation_tokens",
    readNumber(usage.prompt_cache_creation_tokens),
  );
  addMetric(metrics, "durationMs", readNumber(usage.durationMs));

  return metrics;
}

function asSpanParent(value: unknown): BraintrustSpanParent {
  const span = value as Partial<BraintrustSpanParent> | undefined;
  if (span === undefined || typeof span.startSpan !== "function") {
    throw new Error("Braintrust current span unavailable");
  }

  return span as BraintrustSpanParent;
}

function asToolCall(event: AcpEvent): EventRecord | undefined {
  const record = asRecord(event);
  return record?.sessionUpdate === "tool_call" ? record : undefined;
}

function asToolCallUpdate(event: AcpEvent): EventRecord | undefined {
  const record = asRecord(event);
  return record?.sessionUpdate === "tool_call_update" ? record : undefined;
}

function readToolInput(toolCall: EventRecord): unknown {
  if (Object.hasOwn(toolCall, "input")) {
    return toolCall.input;
  }

  return toolCall.rawInput;
}

function readContentText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(readContentText).join("");
  }

  const record = asRecord(value);
  if (record === undefined || record.type !== "text") {
    return "";
  }

  return readString(record.text) ?? "";
}

function asRecord(value: unknown): EventRecord | undefined {
  return typeof value === "object" && value !== null
    ? value as EventRecord
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function addMetric(
  metrics: Record<string, number>,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined) {
    metrics[key] = value;
  }
}

function sumIfPresent(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  return left !== undefined && right !== undefined ? left + right : undefined;
}
