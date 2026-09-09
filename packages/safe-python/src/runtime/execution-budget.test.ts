import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";

describe("execution budgets", () => {
  it("charges steps and cumulative allocation atomically through exact limits", () => {
    const budget = new ExecutionBudget({ maxSteps: 3, maxAllocatedBytes: 8 });
    budget.checkpoint();
    budget.checkpoint(2, 8);
    budget.checkpoint(0, 0);
    expect(budget.usage).toEqual({ steps: 3, allocatedBytes: 8 });
    expect(() => budget.checkpoint()).toThrow(expect.objectContaining({ reason: "steps" }));
    expect(budget.usage).toEqual({ steps: 3, allocatedBytes: 8 });
  });

  it("does not partially charge a rejected allocation", () => {
    const budget = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 3 });
    expect(() => budget.checkpoint(2, 4)).toThrow(expect.objectContaining({ reason: "allocation" }));
    expect(budget.usage).toEqual({ steps: 0, allocatedBytes: 0 });
  });

  it("latches termination so catching it cannot replenish or resume a budget", () => {
    const budget = new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 });
    let failure: unknown;
    try { budget.checkpoint(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).not.toBeInstanceOf(PythonRuntimeError);
    let repeated: unknown;
    try { budget.checkpoint(0, 0); } catch (error) { repeated = error; }
    expect(repeated).toBe(failure);
  });

  it("copies configured limits and returns immutable usage snapshots", () => {
    const limits = { maxSteps: 2, maxAllocatedBytes: 4 };
    const budget = new ExecutionBudget(limits);
    limits.maxSteps = 100;
    const snapshot = budget.usage;
    expect(Object.isFrozen(snapshot)).toBe(true);
    budget.checkpoint(2);
    expect(snapshot.steps).toBe(0);
    expect(() => budget.checkpoint()).toThrow(ExecutionLimitError);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid limits and charges: %s", value => {
    expect(() => new ExecutionBudget({ maxSteps: value, maxAllocatedBytes: 0 })).toThrow(RangeError);
    expect(() => new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: value })).toThrow(RangeError);
    const budget = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 10 });
    expect(() => budget.checkpoint(value)).toThrow(RangeError);
    expect(() => budget.checkpoint(0, value)).toThrow(RangeError);
    expect(budget.usage).toEqual({ steps: 0, allocatedBytes: 0 });
    budget.checkpoint();
    expect(budget.usage.steps).toBe(1);
  });

  it("does not lose precision when checking charges near the safe-integer limit", () => {
    const budget = new ExecutionBudget({ maxSteps: Number.MAX_SAFE_INTEGER, maxAllocatedBytes: Number.MAX_SAFE_INTEGER });
    budget.checkpoint(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER);
    expect(() => budget.checkpoint(2, 0)).toThrow(expect.objectContaining({ reason: "steps" }));
    expect(budget.usage.steps).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  it("observes cancellation at checkpoints without exposing the host abort reason", () => {
    const controller = new AbortController();
    const budget = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 10, signal: controller.signal });
    budget.checkpoint();
    controller.abort({ hostSecret: "not a guest exception value" });
    expect(() => budget.checkpoint(0)).toThrow(expect.objectContaining({ reason: "cancelled", message: "execution cancelled" }));
    expect(budget.usage).toEqual({ steps: 1, allocatedBytes: 0 });
  });
});

describe("budgeted substring search", () => {
  const text = new CodePointString(new Uint32Array([97, 97, 97, 97, 98]));
  const needle = new CodePointString(new Uint32Array([97, 98]));

  it("charges temporary prefix storage and search work", () => {
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 8 });
    expect(text.search(needle, "find", 0n, null, budget)).toBe(3);
    expect(budget.usage.allocatedBytes).toBe(8);
    expect(budget.usage.steps).toBeGreaterThan(5);
  });

  it("checks storage budget before allocating a prefix table", () => {
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 });
    expect(() => text.search(needle, "find", 0n, null, budget)).toThrow(expect.objectContaining({ reason: "allocation" }));
    expect(budget.usage.allocatedBytes).toBe(0);
  });

  it("stops scanning once work is exhausted", () => {
    const budget = new ExecutionBudget({ maxSteps: 3, maxAllocatedBytes: 100 });
    expect(() => text.search(needle, "rfind", 0n, null, budget)).toThrow(expect.objectContaining({ reason: "steps" }));
    expect(budget.usage.steps).toBe(3);
  });

  it("checks entry even when empty-pattern handling avoids scanning", () => {
    const controller = new AbortController();
    controller.abort();
    const budget = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 10, signal: controller.signal });
    expect(() => text.search(new CodePointString(new Uint32Array()), "count", 0n, null, budget)).toThrow(expect.objectContaining({ reason: "cancelled" }));
    expect(budget.usage).toEqual({ steps: 0, allocatedBytes: 0 });
  });

  it("observes a newly aborted signal during a running search", () => {
    const controller = new AbortController();
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal });
    let checkpoints = 0;
    const meter = {
      checkpoint(steps = 1, bytes = 0): void {
        if (++checkpoints === 5) controller.abort();
        budget.checkpoint(steps, bytes);
      }
    };
    expect(() => text.search(needle, "find", 0n, null, meter)).toThrow(expect.objectContaining({ reason: "cancelled" }));
    expect(checkpoints).toBe(5);
  });
});
