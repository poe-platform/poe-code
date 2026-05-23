import type { SpawnUsage } from "../../types.js";

export type TraceToolOperation = "read" | "search" | "exec" | "edit" | "write" | "mcp" | "other";
export type TraceToolOutcome = "completed" | "failed" | "cancelled";
export type TraceTimestamp = string | number;

export interface TraceMessageEvent {
  type: "message";
  sequence: number;
  text: string;
  channel?: "reasoning";
  timestamp?: TraceTimestamp;
}

export interface TraceToolEvent {
  type: "tool";
  sequence: number;
  phase: "start" | "complete";
  id?: string;
  name: string;
  operation: TraceToolOperation;
  rawArguments?: unknown;
  rawOutput?: unknown;
  paths: readonly string[];
  outcome?: TraceToolOutcome;
  timestamp?: TraceTimestamp;
}

export interface TraceUsageEvent {
  type: "usage";
  sequence: number;
  usage: SpawnUsage;
  timestamp?: TraceTimestamp;
}

export interface TraceErrorEvent {
  type: "error";
  sequence: number;
  message: string;
  timestamp?: TraceTimestamp;
}

export type NormalizedTraceEvent =
  | TraceMessageEvent
  | TraceToolEvent
  | TraceUsageEvent
  | TraceErrorEvent;

export interface NormalizedTrace {
  events: readonly NormalizedTraceEvent[];
  usage: SpawnUsage;
}
