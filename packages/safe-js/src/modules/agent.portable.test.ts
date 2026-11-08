import { expect, it, vi } from "vitest";
import { createSpawnUsageAccumulator, makeAgentModule, runWithSpawnUsageAccumulator } from "./agent.js";

vi.mock("#safe-js-platform", async importOriginal => ({
  ...await importOriginal<typeof import("#safe-js-platform")>(),
  AsyncLocalStorage: (await import("../platform/context.js")).StackContext
}));

it.each(["single", "retry", "parallel"] as const)("retains isolated usage across portable %s spawn awaits", async mode => {
  const accumulators = [createSpawnUsageAccumulator(), createSpawnUsageAccumulator()];
  await Promise.all(accumulators.map((accumulator, index) => {
    let attempts = 0;
    const agent = makeAgentModule(async () => {
      await Promise.resolve();
      attempts++;
      return {
        exitCode: mode === "retry" && attempts === 1 ? 1 : 0,
        stdout: "", stderr: "", summary: "done", durationMs: 1,
        usage: { inputTokens: index + 1, outputTokens: 10, cachedTokens: 2 }
      };
    });
    return runWithSpawnUsageAccumulator(accumulator, async () => {
      if (mode === "single") await agent.spawn("codex", { prompt: "mock" });
      else if (mode === "retry") await agent.spawn.retry("codex", { prompt: "mock" }, {
        maxAttempts: 2, backoffMs: 0, isRetryable: () => true
      });
      else await agent.spawn.parallel([["codex", { prompt: "mock" }], ["codex", { prompt: "mock" }]]);
    });
  }));
  const calls = mode === "single" ? 1 : 2;
  for (const [index, accumulator] of accumulators.entries()) {
    expect(accumulator.snapshot()).toEqual({
      inputTokens: (index + 1) * calls, outputTokens: 10 * calls, cachedTokens: 2 * calls,
      spawnCount: mode === "parallel" ? 2 : 1,
      ...(mode === "retry" ? { attemptCount: 2 } : {})
    });
  }
});
