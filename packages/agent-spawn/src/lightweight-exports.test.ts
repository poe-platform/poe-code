import { describe, expect, it } from "vitest";
import { createSpawnParallel } from "./parallel.js";
import type { SpawnUsage } from "./types.js";

describe("agent-spawn lightweight subpaths", () => {
  it("exposes parallel helpers without loading provider factories", async () => {
    const parallel = createSpawnParallel<string, { signal?: AbortSignal }, { exitCode: number }>(
      () => ({ events: emptyEvents(), result: Promise.resolve({ exitCode: 0 }) })
    );

    await expect(parallel([["agent", {}]])).resolves.toEqual([{ exitCode: 0 }]);
  });

  it("keeps SpawnUsage available as a type-only contract", () => {
    const usage: SpawnUsage = { inputTokens: 1, outputTokens: 2 };
    expect(usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });
});

async function* emptyEvents() {}
