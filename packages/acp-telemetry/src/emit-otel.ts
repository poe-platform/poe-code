import type { AcpTrace, AcpTraceSpan } from "./trace.js";

type OtelAttributeValue = string | number | boolean;

export interface OtelSpanLike {
  setAttribute(key: string, value: OtelAttributeValue): void;
  setAttributes(attrs: Record<string, OtelAttributeValue>): void;
  end(endTime?: number): void;
}

export interface OtelTracerLike {
  startSpan(name: string, options?: { startTime?: number }, parent?: OtelSpanLike): OtelSpanLike;
}

export function emitToOtel(trace: AcpTrace, tracer: OtelTracerLike): void {
  emitSpan(trace.root, tracer);
}

function emitSpan(traceSpan: AcpTraceSpan, tracer: OtelTracerLike, parent?: OtelSpanLike): void {
  const span = tracer.startSpan(
    traceSpan.name,
    traceSpan.startTs !== undefined ? { startTime: traceSpan.startTs } : undefined,
    parent,
  );

  try {
    const attrs = toOtelAttributes(traceSpan);
    if (Object.keys(attrs).length > 0) {
      span.setAttributes(attrs);
    }

    for (const child of traceSpan.children) {
      emitSpan(child, tracer, span);
    }
  } finally {
    if (traceSpan.endTs !== undefined) {
      span.end(traceSpan.endTs);
    } else {
      span.end();
    }
  }
}

function toOtelAttributes(span: AcpTraceSpan): Record<string, OtelAttributeValue> {
  const attrs: Record<string, OtelAttributeValue> = {};

  if (span.kind === "agent") {
    attrs["gen_ai.system"] = "poe-code";
    addAttribute(attrs, "gen_ai.request.model", readAgentModel(span.name));
    addAttribute(attrs, "gen_ai.agent.name", readAgentName(span.name));
    addAttribute(attrs, "gen_ai.usage.input_tokens", span.metrics?.prompt_tokens);
    addAttribute(attrs, "gen_ai.usage.output_tokens", span.metrics?.completion_tokens);
    addAttribute(attrs, "gen_ai.usage.cached_tokens", span.metrics?.prompt_cached_tokens);
    addAttribute(attrs, "poe_code.session_id", readPrimitive(span.metadata?.sessionId));
    addAttribute(attrs, "poe_code.thread_id", readPrimitive(span.metadata?.threadId));
  }

  if (span.kind === "tool") {
    addAttribute(attrs, "gen_ai.tool.name", readToolName(span.name));
    addAttribute(attrs, "poe_code.tool_call_id", readPrimitive(span.metadata?.toolCallId));
  }

  addInputOutputAttribute(attrs, "poe_code.input", span.input);
  addInputOutputAttribute(attrs, "poe_code.output", span.output);

  return attrs;
}

function addInputOutputAttribute(
  attrs: Record<string, OtelAttributeValue>,
  key: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  const primitive = readPrimitive(value);
  if (primitive !== undefined) {
    attrs[key] = primitive;
    return;
  }

  const serialized = JSON.stringify(value);
  if (serialized !== undefined) {
    attrs[key] = serialized;
  }
}

function addAttribute(
  attrs: Record<string, OtelAttributeValue>,
  key: string,
  value: OtelAttributeValue | undefined,
): void {
  if (value !== undefined) {
    attrs[key] = value;
  }
}

function readAgentName(name: string): string | undefined {
  const parts = name.split(":");
  return parts[0] === "agent" && parts[1] !== "" ? parts[1] : undefined;
}

function readAgentModel(name: string): string | undefined {
  const parts = name.split(":");
  if (parts[0] !== "agent" || parts.length < 3) {
    return undefined;
  }

  const model = parts.slice(2).join(":");
  return model === "" ? undefined : model;
}

function readToolName(name: string): string | undefined {
  const parts = name.split(":");
  if (parts[0] !== "tool_call" || parts.length < 2) {
    return undefined;
  }

  const toolName = parts.slice(1).join(":");
  return toolName === "" ? undefined : toolName;
}

function readPrimitive(value: unknown): OtelAttributeValue | undefined {
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
