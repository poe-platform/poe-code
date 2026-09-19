import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAdversarialCorpus } from "./harness.js";

afterEach(() => vi.restoreAllMocks());

describe("fast adversarial corpus", () => {
  it("handles transferable parser, runtime, lifecycle, and resource failures", async () => {
    await expect(runAdversarialCorpus()).resolves.toBeUndefined();
  }, 2_000);

  it("does not count scheduler delays against its CPU work limit", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(1_000);
    vi.spyOn(process, "threadCpuUsage")
      .mockReturnValueOnce({ user: 0, system: 0 })
      .mockReturnValue({ user: 100_000, system: 0 });
    await expect(runAdversarialCorpus()).resolves.toBeUndefined();
  });

  it("still rejects excessive CPU work", async () => {
    vi.spyOn(process, "threadCpuUsage")
      .mockReturnValueOnce({ user: 0, system: 0 })
      .mockReturnValue({ user: 500_000, system: 251_000 });
    await expect(runAdversarialCorpus()).rejects.toThrow("corpus exceeded 750ms CPU");
  });
});
