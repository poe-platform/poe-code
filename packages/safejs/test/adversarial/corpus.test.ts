import { describe, expect, it } from "vitest";

import { runAdversarialCorpus } from "./harness.js";

describe("fast adversarial corpus", () => {
  it("handles transferable parser, runtime, lifecycle, and resource failures", async () => {
    await expect(runAdversarialCorpus()).resolves.toBeUndefined();
  }, 2_000);
});
