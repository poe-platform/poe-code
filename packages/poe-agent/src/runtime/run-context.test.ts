import { describe, expect, it, vi } from "bun:test";
import { createRunContext } from "./run-context.js";

function createErrorLogger() {
  return {
    error: vi.fn<(message: string, error?: unknown) => void>(),
  };
}

describe("RunContext", () => {
  it("creates fresh mutable state for each context", () => {
    const first = createRunContext({ activeSkills: [" repo ", "repo", ""] });
    const second = createRunContext();

    first.messages.push({ role: "user", content: "first" });

    expect(first).not.toBe(second);
    expect(first.messages).toEqual([{ role: "user", content: "first" }]);
    expect(second.messages).toEqual([]);
    expect(first.tools).not.toBe(second.tools);
    expect(first.prompts).not.toBe(second.prompts);
    expect(first.hooks).not.toBe(second.hooks);
    expect(first.abortController).not.toBe(second.abortController);
    expect(first.activeSkills).toEqual(["repo"]);
    expect(second.activeSkills).toEqual([]);
  });

  it("tracks child runs and removes them when settled", async () => {
    const context = createRunContext();
    const childRun = context.trackChildRun(Promise.resolve("done"));

    expect(context.getChildRunCount()).toBe(1);
    await expect(childRun).resolves.toBe("done");
    expect(context.getChildRunCount()).toBe(0);
  });

  it("removes rejected child runs when they settle", async () => {
    const context = createRunContext();
    const childRun = context.trackChildRun(Promise.reject(new Error("child failed")));

    expect(context.getChildRunCount()).toBe(1);
    await expect(childRun).rejects.toThrow("child failed");
    expect(context.getChildRunCount()).toBe(0);
  });

  it("disposes hooks in reverse registration order", async () => {
    const context = createRunContext();
    const callOrder: string[] = [];

    context.registerDisposeHook(() => {
      callOrder.push("first");
    });
    context.registerDisposeHook(() => {
      callOrder.push("second");
    });

    await context.dispose();

    expect(callOrder).toEqual(["second", "first"]);
  });

  it("logs each dispose failure, continues, and throws AggregateError", async () => {
    const logger = createErrorLogger();
    const context = createRunContext({ logger });

    context.registerDisposeHook(async () => {
      throw new Error("first failure");
    });
    context.registerDisposeHook(() => {
      throw new Error("second failure");
    });

    await expect(context.dispose()).rejects.toEqual(
      expect.objectContaining({
        name: "AggregateError",
        errors: [expect.any(Error), expect.any(Error)],
      }),
    );

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect((logger.error.mock.calls[0] ?? [])[0]).toContain("Dispose hook failed");
    expect((logger.error.mock.calls[1] ?? [])[0]).toContain("Dispose hook failed");
  });

  it("is idempotent and does not re-run disposal hooks", async () => {
    const context = createRunContext();
    const disposeHook = vi.fn();

    context.registerDisposeHook(disposeHook);

    await context.dispose();
    await context.dispose();

    expect(disposeHook).toHaveBeenCalledTimes(1);
  });

  it("is safe when dispose is called concurrently", async () => {
    const context = createRunContext();
    const order: string[] = [];
    let release = () => undefined;
    const blocker = new Promise<void>(resolve => {
      release = resolve;
    });

    context.registerDisposeHook(async () => {
      order.push("start");
      await blocker;
      order.push("finish");
    });

    const firstDispose = context.dispose();
    const secondDispose = context.dispose();

    release();

    await Promise.all([firstDispose, secondDispose]);

    expect(order).toEqual(["start", "finish"]);
  });
});
