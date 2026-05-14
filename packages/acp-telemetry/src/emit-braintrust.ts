import type { AcpTrace, AcpTraceSpan } from "./trace.js";

export interface BraintrustSpanLike {
  startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpanLike;
  log(event: {
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
    metrics?: Record<string, number>;
  }): void;
  end(): void;
}

export function emitToBraintrust(trace: AcpTrace, parent: BraintrustSpanLike): void {
  const root = parent.startSpan({ name: trace.root.name, type: "task" });

  try {
    emitSpan(root, trace.root);
  } finally {
    root.end();
  }
}

function emitSpan(span: BraintrustSpanLike, traceSpan: AcpTraceSpan): void {
  span.log(toBraintrustLogEvent(traceSpan));

  for (const child of traceSpan.children) {
    const childSpan = span.startSpan({ name: child.name, type: "tool" });

    try {
      emitSpan(childSpan, child);
    } finally {
      childSpan.end();
    }
  }
}

function toBraintrustLogEvent(
  span: AcpTraceSpan,
): Parameters<BraintrustSpanLike["log"]>[0] {
  return {
    ...(Object.hasOwn(span, "input") ? { input: span.input } : {}),
    ...(Object.hasOwn(span, "output") ? { output: span.output } : {}),
    ...(Object.hasOwn(span, "metadata") ? { metadata: span.metadata } : {}),
    ...(Object.hasOwn(span, "metrics") ? { metrics: span.metrics } : {}),
  };
}
