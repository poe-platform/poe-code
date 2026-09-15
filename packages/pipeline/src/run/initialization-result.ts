import type { AgentRunResult, AgentRunUsage, PipelineRunResult } from "../types.js";
import { getAbortUsage } from "./abort-usage.js";

export function includePipelineInitialization(
  result: PipelineRunResult,
  initialization: { durationMs: number; usage?: AgentRunUsage }
): PipelineRunResult {
  return {
    ...result,
    totalDurationMs: result.totalDurationMs + initialization.durationMs,
    metrics: {
      ...result.metrics,
      totalInputTokens: result.metrics.totalInputTokens + (initialization.usage?.inputTokens ?? 0),
      totalOutputTokens: result.metrics.totalOutputTokens + (initialization.usage?.outputTokens ?? 0),
      totalCachedTokens: result.metrics.totalCachedTokens + (initialization.usage?.cachedTokens ?? 0)
    }
  };
}

export function cancelPipelineInitialization(initialization: {
  planPath: string;
  durationMs: number;
  result: AgentRunResult | Error;
}): PipelineRunResult {
  const usage = initialization.result instanceof Error
    ? getAbortUsage(initialization.result) : initialization.result.usage;
  return {
    stopReason: "cancelled",
    planPath: initialization.planPath,
    runsCompleted: 0,
    totalDurationMs: Math.max(0, initialization.durationMs),
    metrics: {
      totalInputTokens: usage?.inputTokens ?? 0,
      totalOutputTokens: usage?.outputTokens ?? 0,
      totalCachedTokens: usage?.cachedTokens ?? 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      stepsCompleted: 0
    }
  };
}
