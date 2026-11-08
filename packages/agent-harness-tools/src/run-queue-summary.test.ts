import { describe, expect, it } from "vitest";
import { createRunQueue } from "./run-queue.js";
import { formatRunQueueSummary } from "./run-queue-summary.js";

describe("run queue summary", () => {
  it("reports completed plans and messages separately from pending work", async () => {
    const queue = createRunQueue({ plans: ["one.md", "two.md"], afterEachPlan: ["Review", "Verify"] });
    let runs = 0;
    await queue.run({ execute: async () => ++runs === 3 ? "failed" : "completed" });
    expect(formatRunQueueSummary(queue.getSnapshot())).toBe("1/2 plans · 1/4 messages · 3 pending");
  });

  it("omits empty message and pending counts", async () => {
    const queue = createRunQueue({ plans: ["one.md"] });
    await queue.run({ execute: async () => "completed" });
    expect(formatRunQueueSummary(queue.getSnapshot())).toBe("1/1 plans");
  });
});
