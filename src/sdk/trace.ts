import {
  acpToTrace as convertAcpToTrace,
  createTraceSinkMiddleware as createInternalTraceSinkMiddleware
} from "@poe-code/acp-telemetry";

import type { AcpMiddleware, AcpSpawnContext } from "./types.js";

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

export type TraceSink = (trace: AcpTrace) => void | Promise<void>;

export function acpToTrace(ctx: AcpSpawnContext): AcpTrace {
  return convertAcpToTrace(ctx as Parameters<typeof convertAcpToTrace>[0]);
}

export function createTraceSinkMiddleware(sink: TraceSink): AcpMiddleware {
  return createInternalTraceSinkMiddleware(sink) as AcpMiddleware;
}
