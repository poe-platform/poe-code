import type { AcpEvent, AcpSpawnContext } from "@poe-code/agent-spawn";

import { redact } from "./redact.js";

export interface AcpTraceSpan {
  name: string;
  kind: "agent" | "tool";
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  metrics?: Record<string, number>;
  startTs?: number;
  endTs?: number;
  children: AcpTraceSpan[];
}

export interface AcpTrace {
  root: AcpTraceSpan;
}

type EventRecord = Record<string, unknown>;
type SpawnContextWithMetadata = AcpSpawnContext & {
  metadata?: Record<string, unknown>;
};

export function acpToTrace(ctx: AcpSpawnContext): AcpTrace {
  const spawnCtx = ctx as SpawnContextWithMetadata;

  return {
    root: {
      name: `agent:${ctx.agent}:${ctx.model ?? "?"}`,
      kind: "agent",
      input: redact({
        prompt: ctx.prompt,
        mode: ctx.mode,
        cwd: ctx.cwd
      }),
      output: redact(accumulateAgentOutput(ctx.events)),
      metadata: redactRecord({
        ...spawnCtx.metadata,
        sessionId: ctx.sessionId,
        threadId: ctx.threadId
      }),
      metrics: buildMetrics(ctx),
      children: logToolSpans(ctx.events)
    }
  };
}

function logToolSpans(events: AcpEvent[]): AcpTraceSpan[] {
  const spans: AcpTraceSpan[] = [];

  for (const [index, event] of events.entries()) {
    const toolCall = asToolCall(event);
    if (toolCall === undefined) {
      continue;
    }

    const toolCallId = readToolCallId(toolCall);
    const metadata = collectToolMeta(events, index, toolCallId);
    spans.push({
      name: `tool_call:${readString(toolCall.kind) ?? "unknown"}`,
      kind: "tool",
      input: redact(readToolInput(toolCall)),
      output: redact(assembleToolOutput(events, index, toolCallId)),
      ...(metadata ? { metadata } : {}),
      ...readSpanTimestamps(metadata),
      children: []
    });
  }

  return spans;
}

function collectToolMeta(
  events: AcpEvent[],
  toolCallIndex: number,
  toolCallId: string | undefined
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {
    ...(toolCallId !== undefined ? { toolCallId } : {})
  };

  const startMeta = asRecord(asRecord(events[toolCallIndex])?._meta);
  if (startMeta) {
    for (const [key, value] of Object.entries(startMeta)) {
      setOwnProperty(merged, key === "ts" ? "startTs" : key, value);
    }
  }

  for (const event of events.slice(toolCallIndex + 1)) {
    if (toolCallId === undefined && asToolCall(event) !== undefined) {
      break;
    }

    const update = asToolCallUpdate(event);
    if (update === undefined) continue;
    if (readToolCallId(update) !== toolCallId) continue;
    const updateMeta = asRecord(update._meta);
    if (!updateMeta) continue;
    for (const [key, value] of Object.entries(updateMeta)) {
      setOwnProperty(merged, key === "ts" ? "endTs" : key, value);
    }
  }

  if (Object.keys(merged).length === 0) {
    return undefined;
  }

  return redactRecord(merged);
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
  toolCallId: string | undefined
): unknown {
  const outputs: unknown[] = [];
  let text = "";

  for (const event of events.slice(toolCallIndex + 1)) {
    if (toolCallId === undefined && asToolCall(event) !== undefined) {
      break;
    }

    const update = asToolCallUpdate(event);
    if (update === undefined) {
      continue;
    }

    if (readToolCallId(update) !== toolCallId) {
      continue;
    }

    if (Object.hasOwn(update, "rawOutput")) {
      outputs.push(update.rawOutput);
    }

    const contentText = readContentText(update.content);
    if (contentText.length > 0) {
      text += contentText;
    }

    if (update.event === "tool_complete" && Object.hasOwn(update, "path")) {
      outputs.push(update.path);
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

function buildMetrics(ctx: AcpSpawnContext): Record<string, number> {
  const usage = asRecord(ctx.usage) ?? {};
  const metrics: Record<string, number> = {};
  const promptTokens = readNumber(usage.prompt_tokens) ?? readNumber(usage.inputTokens);
  const completionTokens = readNumber(usage.completion_tokens) ?? readNumber(usage.outputTokens);

  addMetric(metrics, "prompt_tokens", promptTokens);
  addMetric(metrics, "completion_tokens", completionTokens);
  addMetric(
    metrics,
    "tokens",
    readNumber(usage.tokens) ?? sumIfPresent(promptTokens, completionTokens)
  );
  addMetric(
    metrics,
    "prompt_cached_tokens",
    readNumber(usage.prompt_cached_tokens) ?? readNumber(usage.cachedTokens)
  );
  addMetric(
    metrics,
    "prompt_cache_creation_tokens",
    readNumber(usage.prompt_cache_creation_tokens)
  );
  addMetric(metrics, "durationMs", readNumber(usage.durationMs));

  return metrics;
}

function asToolCall(event: AcpEvent): EventRecord | undefined {
  const record = asRecord(event);
  return record?.sessionUpdate === "tool_call" || record?.event === "tool_start"
    ? record
    : undefined;
}

function asToolCallUpdate(event: AcpEvent): EventRecord | undefined {
  const record = asRecord(event);
  return record?.sessionUpdate === "tool_call_update" || record?.event === "tool_complete"
    ? record
    : undefined;
}

function readToolCallId(toolEvent: EventRecord): string | undefined {
  return readString(toolEvent.toolCallId) ?? readString(toolEvent.id);
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

function readSpanTimestamps(
  metadata: Record<string, unknown> | undefined
): Pick<AcpTraceSpan, "startTs" | "endTs"> {
  if (metadata === undefined) {
    return {};
  }

  const startTs = readNumber(metadata.startTs);
  const endTs = readNumber(metadata.endTs);

  return {
    ...(startTs !== undefined ? { startTs } : {}),
    ...(endTs !== undefined ? { endTs } : {})
  };
}

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const redacted = redact(record);
  return asRecord(redacted) ?? { redacted };
}

function asRecord(value: unknown): EventRecord | undefined {
  return typeof value === "object" && value !== null ? (value as EventRecord) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function addMetric(metrics: Record<string, number>, key: string, value: number | undefined): void {
  if (value !== undefined && value >= 0) {
    metrics[key] = value;
  }
}

function sumIfPresent(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined || right === undefined || left < 0 || right < 0) {
    return undefined;
  }

  return readNumber(left + right);
}

function setOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}
