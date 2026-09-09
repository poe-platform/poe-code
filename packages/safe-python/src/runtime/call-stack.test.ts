import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { CallStack } from "./call-stack.js";

const budget = (maxSteps = 1000) => new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });

describe("execution call stack", () => {
  it("tracks the innermost frame and restores callers in LIFO order", () => {
    const calls = new CallStack(3, budget());
    const outer = {}, inner = {};
    expect(calls.current).toBeUndefined();
    const leaveOuter = calls.enter(outer), leaveInner = calls.enter(inner);
    expect(calls.depth).toBe(2);
    expect(calls.current).toBe(inner);
    leaveInner();
    expect(calls.current).toBe(outer);
    leaveInner();
    expect(calls.depth).toBe(1);
    leaveOuter();
    expect(calls.depth).toBe(0);
    expect(calls.current).toBeUndefined();
  });

  it("rejects excess depth without corrupting the active stack and allows recovery", () => {
    const calls = new CallStack(1, budget()), frame = {};
    const leave = calls.enter(frame);
    expect(() => calls.enter({})).toThrow(expect.objectContaining({ name: "RecursionError", message: "maximum recursion depth exceeded" }));
    expect(calls.current).toBe(frame);
    expect(calls.depth).toBe(1);
    leave();
    const leaveNext = calls.enter({});
    expect(calls.depth).toBe(1);
    leaveNext();
  });

  it("restores state even after a latched fatal execution limit", () => {
    const meter = budget(1), calls = new CallStack(2, meter);
    const leave = calls.enter({});
    expect(() => calls.enter({})).toThrow(ExecutionLimitError);
    leave();
    expect(calls.depth).toBe(0);
    expect(calls.current).toBeUndefined();
  });

  it("detects out-of-order restoration without modifying the stack", () => {
    const calls = new CallStack(2, budget());
    const leaveOuter = calls.enter({}), leaveInner = calls.enter({});
    expect(() => leaveOuter()).toThrow("call frames must be restored in LIFO order");
    expect(calls.depth).toBe(2);
    leaveInner(); leaveOuter();
    expect(calls.depth).toBe(0);
  });

  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid maximum depth %s", limit => {
    expect(() => new CallStack(limit, budget())).toThrow(RangeError);
  });
});
