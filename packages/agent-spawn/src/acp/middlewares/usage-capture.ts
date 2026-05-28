import type { AcpEvent } from "../types.js";
import type { AcpMiddleware, SpawnContext } from "../middleware.js";

function readUsageNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function accumulateUsage(ctx: SpawnContext, event: AcpEvent): void {
  if (event.event !== "usage") {
    return;
  }

  const usage = event as {
    inputTokens?: unknown;
    outputTokens?: unknown;
    cachedTokens?: unknown;
    costUsd?: unknown;
  };

  const inputTokens = readUsageNumber(usage.inputTokens);
  const outputTokens = readUsageNumber(usage.outputTokens);
  const cachedTokens = readUsageNumber(usage.cachedTokens);
  const costUsd = readUsageNumber(usage.costUsd);

  if (inputTokens !== undefined) {
    ctx.usage.inputTokens += inputTokens;
  }

  if (outputTokens !== undefined) {
    ctx.usage.outputTokens += outputTokens;
  }

  if (cachedTokens !== undefined) {
    ctx.usage.cachedTokens = (ctx.usage.cachedTokens ?? 0) + cachedTokens;
  }

  if (costUsd !== undefined) {
    ctx.usage.costUsd = (ctx.usage.costUsd ?? 0) + costUsd;
  }
}

export const usageCapture: AcpMiddleware = async (ctx, next) => {
  await next();

  const source = ctx.eventStream;
  const preloadedCounts = new Map<AcpEvent, number>();

  if (ctx.events.length > 0) {
    ctx.usage = { inputTokens: 0, outputTokens: 0 };
    for (const event of ctx.events) {
      accumulateUsage(ctx, event);
      preloadedCounts.set(event, (preloadedCounts.get(event) ?? 0) + 1);
    }
  }

  if (!source) {
    return;
  }

  ctx.eventStream = (async function* () {
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
  })();
};
