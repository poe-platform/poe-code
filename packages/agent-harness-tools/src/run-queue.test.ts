import { describe, expect, it, vi } from "vitest";
import { createRunQueue } from "./run-queue.js";

describe("live harness work queue", () => {
  it("keeps the sequence open for a plan being validated and applies inherited follow-ups", async () => {
    const queue = createRunQueue({ plans: ["one.md"], afterEachPlan: ["Review"] });
    let validate!: (value: string) => void;
    const submitted = queue.enqueueValidatedPlan("two.md", () => new Promise<string>((resolve) => { validate = resolve; }));
    const executed: string[] = [];
    const running = queue.run({ async execute(item) {
      executed.push(item.kind === "plan" ? item.path : item.text);
      if (executed.length === 2) validate("two.md");
      return "completed";
    } });
    await submitted;
    expect((await running).status).toBe("completed");
    expect(executed).toEqual(["one.md", "Review", "two.md", "Review"]);
  });

  it("cancels while validation is pending and refuses its late result", async () => {
    const queue = createRunQueue({ plans: [] });
    const abort = new AbortController();
    let validate!: (value: string) => void;
    const submitted = queue.enqueueValidatedPlan("two.md", () => new Promise<string>((resolve) => { validate = resolve; }))
      .catch((error: unknown) => error);
    const execute = vi.fn(async () => "completed" as const);
    const running = queue.run({ execute, signal: abort.signal });
    abort.abort();
    expect((await running).status).toBe("cancelled");
    validate("two.md");
    expect(await submitted).toEqual(expect.objectContaining({ message: expect.stringContaining("finished") }));
    expect(execute).not.toHaveBeenCalled();
    expect(queue.getSnapshot().items).toEqual([]);
  });

  it("releases rejected validation without failing completed work or adding an invalid plan", async () => {
    const queue = createRunQueue({ plans: ["one.md"] });
    let reject!: (error: Error) => void;
    const submitted = queue.enqueueValidatedPlan("missing.md", () => new Promise<string>((_resolve, fail) => { reject = fail; }))
      .catch((error: unknown) => error);
    const running = queue.run({ async execute() { reject(new Error("Plan file not found")); return "completed"; } });
    expect(await submitted).toEqual(new Error("Plan file not found"));
    expect((await running).status).toBe("completed");
    expect(queue.getSnapshot().items).toHaveLength(1);
  });

  it("honors a graceful stop between items without changing completed or pending work", async () => {
    const queue = createRunQueue({ plans: ["one.md", "two.md"], afterEachPlan: ["Review"] });
    let stopped = false;
    const result = await queue.run({
      shouldPause: () => stopped,
      async execute() { stopped = true; return "completed"; }
    });
    expect(result.status).toBe("paused");
    expect(result.items.map((item) => item.status)).toEqual(["completed", "pending", "pending", "pending"]);
  });

  it("runs messages after their plan and before the next plan, including additions during execution", async () => {
    const queue = createRunQueue({ plans: ["first.md", "second.md"] });
    const [first, second] = queue.getSnapshot().items;
    queue.enqueueMessage("Review the implementation", first!.id);
    queue.enqueueMessage("Check accessibility", first!.id);
    queue.enqueueMessage("Summarize changes", second!.id);
    const executed: string[] = [];
    const result = await queue.run({
      async execute(item) {
        executed.push(item.kind === "plan" ? item.path : item.text);
        if (item.id === first!.id) {
          queue.enqueuePlan("third.md");
          queue.enqueueMessage("Verify the tests", first!.id);
        }
        return "completed";
      }
    });
    expect(executed).toEqual([
      "first.md", "Review the implementation", "Check accessibility", "Verify the tests",
      "second.md", "Summarize changes", "third.md"
    ]);
    expect(result.status).toBe("completed");
    expect(result.items.every((item) => item.status === "completed")).toBe(true);
  });

  it("applies CLI/SDK after-each-plan messages to both initial and newly queued plans", async () => {
    const queue = createRunQueue({ plans: ["first.md"], afterEachPlan: ["Review", "Summarize"] });
    queue.enqueuePlan("second.md");
    const execute = vi.fn(async () => "completed" as const);
    await queue.run({ execute });
    expect(execute.mock.calls).toHaveLength(6);
    expect(queue.getSnapshot().items.map((item) => item.kind === "plan" ? item.path : item.text))
      .toEqual(["first.md", "Review", "Summarize", "second.md", "Review", "Summarize"]);
  });

  it("keeps pending work when a plan or message fails", async () => {
    for (const failingKind of ["plan", "message"]) {
      const queue = createRunQueue({ plans: ["first.md", "second.md"], afterEachPlan: ["Review"] });
      const result = await queue.run({ execute: async (item) => item.kind === failingKind ? "failed" : "completed" });
      expect(result.status).toBe("failed");
      expect(result.items.at(-2)?.status).toBe("pending");
      expect(result.items.at(-1)?.status).toBe("pending");
      expect(result.items.filter((item) => item.status === "failed")).toHaveLength(1);
    }
  });

  it("does not advance or accept new work after cancellation", async () => {
    const queue = createRunQueue({ plans: ["first.md", "second.md"] });
    const abort = new AbortController();
    const result = await queue.run({
      signal: abort.signal,
      execute: async () => { abort.abort(); return "completed"; }
    });
    expect(result.status).toBe("cancelled");
    expect(result.items.map((item) => item.status)).toEqual(["cancelled", "pending"]);
    expect(() => queue.enqueuePlan("third.md")).toThrow("finished");
  });

  it("stops at a partial plan without sending its follow-ups", async () => {
    const queue = createRunQueue({ plans: ["first.md", "second.md"], afterEachPlan: ["Review"] });
    const result = await queue.run({ execute: async () => "paused" });
    expect(result.status).toBe("paused");
    expect(result.items.map((item) => item.status)).toEqual(["paused", "pending", "pending", "pending"]);
  });

  it("preserves the original exception and marks failed work", async () => {
    const queue = createRunQueue({ plans: ["first.md", "second.md"] });
    const error = new Error("Agent connection failed");
    await expect(queue.run({ execute: async () => { throw error; } })).rejects.toBe(error);
    expect(queue.getSnapshot().status).toBe("failed");
    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(["failed", "pending"]);
  });

  it("rejects empty messages, duplicate plans, and targets that have already passed", async () => {
    const queue = createRunQueue({ plans: ["first.md", "second.md"] });
    const first = queue.getSnapshot().items[0]!;
    expect(() => queue.enqueueMessage(" \n ", first.id)).toThrow("empty");
    expect(() => queue.enqueuePlan(" first.md ")).toThrow("already queued");
    expect(() => queue.enqueueMessage("Review", "missing")).toThrow("plan");
    await queue.run({ execute: async (item) => {
      if (item.kind === "plan" && item.path === "second.md") {
        expect(() => queue.enqueueMessage("Too late", first.id)).toThrow("already finished");
      }
      return "completed";
    } });
  });

  it("defaults new messages to the active plan, including while its follow-up is running", async () => {
    const queue = createRunQueue({ plans: ["first.md", "second.md"] });
    const seen: string[] = [];
    await queue.run({ execute: async (item) => {
      seen.push(item.kind === "plan" ? item.path : item.text);
      if (item.kind === "plan" && item.path === "first.md") queue.enqueueMessage("First follow-up");
      if (item.kind === "message" && item.text === "First follow-up") queue.enqueueMessage("Second follow-up");
      return "completed";
    } });
    expect(seen).toEqual(["first.md", "First follow-up", "Second follow-up", "second.md"]);
  });

  it("publishes immutable snapshots and unsubscribes observers", async () => {
    const queue = createRunQueue({ plans: ["first.md"] });
    const before = queue.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = queue.onChange(listener);
    queue.enqueueMessage("Review");
    expect(listener).toHaveBeenCalledOnce();
    expect(before.items).toHaveLength(1);
    expect(before.items[0]?.status).toBe("pending");
    unsubscribe();
    await queue.run({ execute: async () => "completed" });
    expect(listener).toHaveBeenCalledOnce();
    expect(before.items[0]?.status).toBe("pending");
  });

  it("rejects overlapping drains and finishes an empty queue without executing", async () => {
    const empty = createRunQueue({ plans: [] });
    const execute = vi.fn(async () => "completed" as const);
    expect((await empty.run({ execute })).status).toBe("completed");
    expect(execute).not.toHaveBeenCalled();
    const queue = createRunQueue({ plans: ["first.md"] });
    await queue.run({ execute: async () => {
      await expect(queue.run({ execute })).rejects.toThrow("already running");
      return "completed";
    } });
  });
});
