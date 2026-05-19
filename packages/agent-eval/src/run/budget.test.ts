import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetEnforcer } from "./budget.js";
import type { Budget, SpawnEvent } from "../types.js";

const relaxedBudget: Budget = {
  maxIterations: 10,
  maxTokens: 100,
  wallClockMs: 60_000
};

function toolCall(): SpawnEvent {
  return {
    sessionUpdate: "tool_call",
    toolCallId: "tool-1",
    title: "Read",
    kind: "read"
  } as SpawnEvent;
}

function usage(inputTokens: number, outputTokens: number, cachedTokens?: number): SpawnEvent {
  return {
    event: "usage",
    inputTokens,
    outputTokens,
    ...(cachedTokens === undefined ? {} : { cachedTokens })
  } as SpawnEvent;
}

describe("BudgetEnforcer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts exactly once when the iteration cap is hit", () => {
    const controller = new AbortController();
    const abort = vi.spyOn(controller, "abort");
    const enforcer = new BudgetEnforcer(
      { ...relaxedBudget, maxIterations: 2 },
      controller
    );

    enforcer.onEvent(toolCall());
    enforcer.onEvent(toolCall());
    enforcer.onEvent(toolCall());

    expect(abort).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    expect(enforcer.snapshot().tripped).toBe("maxIterations");
  });

  it("aborts exactly once when the token cap is hit", () => {
    const controller = new AbortController();
    const abort = vi.spyOn(controller, "abort");
    const enforcer = new BudgetEnforcer(
      { ...relaxedBudget, maxTokens: 5 },
      controller
    );

    enforcer.onEvent(usage(2, 2));
    enforcer.onEvent(usage(1, 1));
    enforcer.onEvent(usage(10, 10));

    expect(abort).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    expect(enforcer.snapshot().tripped).toBe("maxTokens");
  });

  it("aborts exactly once when the wall-clock cap is hit", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const abort = vi.spyOn(controller, "abort");
    const enforcer = new BudgetEnforcer(
      { ...relaxedBudget, wallClockMs: 50 },
      controller
    );

    vi.advanceTimersByTime(49);
    expect(enforcer.snapshot().tripped).toBeUndefined();

    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(50);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    expect(enforcer.snapshot().tripped).toBe("wallClockMs");
  });

  it("snapshots partial metrics after abort", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const enforcer = new BudgetEnforcer(
      { ...relaxedBudget, maxTokens: 5 },
      controller
    );

    vi.advanceTimersByTime(25);
    enforcer.onEvent(toolCall());
    enforcer.onEvent(usage(4, 2, 1));

    expect(enforcer.snapshot()).toEqual({
      iterations: 1,
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        cachedTokens: 1
      },
      elapsedMs: 25,
      tripped: "maxTokens"
    });
  });

  it("never aborts when caps are not hit", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const abort = vi.spyOn(controller, "abort");
    const enforcer = new BudgetEnforcer(relaxedBudget, controller);

    vi.advanceTimersByTime(500);
    enforcer.onEvent(toolCall());
    enforcer.onEvent(usage(10, 20, 3));

    expect(abort).not.toHaveBeenCalled();
    expect(enforcer.snapshot()).toEqual({
      iterations: 1,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cachedTokens: 3
      },
      elapsedMs: 500
    });
  });
});
