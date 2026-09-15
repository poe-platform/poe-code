import type { AgentRunUsage } from "../types.js";

export function getAbortUsage(error: Error): AgentRunUsage | undefined {
  if (!("usage" in error) || !error.usage || typeof error.usage !== "object") return undefined;
  const usage = error.usage as Record<string, unknown>;
  const { inputTokens, outputTokens, cachedTokens } = usage;
  if (typeof inputTokens !== "number" || !Number.isFinite(inputTokens) || inputTokens < 0
    || typeof outputTokens !== "number" || !Number.isFinite(outputTokens) || outputTokens < 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    ...(typeof cachedTokens === "number" && Number.isFinite(cachedTokens) && cachedTokens >= 0 ? { cachedTokens } : {})
  };
}
