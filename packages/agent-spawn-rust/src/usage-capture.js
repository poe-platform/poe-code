import { native } from "./native.js";
export function getCapturedUsage(usage) {
  if (!usage) return undefined;
  return usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cachedTokens !== undefined ||
    usage.costUsd !== undefined
    ? usage
    : undefined;
}
/** Preserve observed billing on the original cancellation error. */
export function captureAbortUsage(error, usage) {
  const captured = getCapturedUsage(usage);
  if (error instanceof Error && error.name === "AbortError" && captured) {
    Object.assign(error, { usage: { ...captured } });
  }
  return error;
}
export const usageCapture = async (ctx, next) => {
  await next();
  const source = ctx.eventStream;
  if (ctx.events.length > 0) ctx.usage = { inputTokens: 0, outputTokens: 0 };
  const state = new native.NativeSpawnUsage(
    [ctx.usage.inputTokens, ctx.usage.outputTokens, ctx.usage.cachedTokens, ctx.usage.costUsd].map(
      (value) => (typeof value === "number" ? value : null)
    )
  );
  const accumulateUsage = (ctx, event) => {
    if (event.event === "usage")
      Object.assign(
        ctx.usage,
        state.observeNonnegative(
          [event.inputTokens, event.outputTokens, event.cachedTokens, event.costUsd].map((value) =>
            typeof value === "number" ? value : null
          )
        )
      );
  };
  const preloadedCounts = new Map();
  if (ctx.events.length > 0) {
    for (const event of ctx.events) {
      accumulateUsage(ctx, event);
      preloadedCounts.set(event, (preloadedCounts.get(event) ?? 0) + 1);
    }
  }
  if (!source) {
    return;
  }
  ctx.eventStream = (async function* () {
    try {
      for await (const event of source) {
        const preloadedCount = preloadedCounts.get(event) ?? 0;
        if (preloadedCount > 0) {
          if (preloadedCount === 1) {
            preloadedCounts.delete(event);
          } else {
            preloadedCounts.set(event, preloadedCount - 1);
          }
        } else {
          accumulateUsage(ctx, event);
        }
        yield event;
      }
    } catch (error) {
      throw captureAbortUsage(error, ctx.usage);
    }
  })();
};
