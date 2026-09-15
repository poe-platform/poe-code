import type { AgentRunUsage, PipelineRunResult } from "../types.js";

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
