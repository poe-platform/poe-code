import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { CallStack } from "./call-stack.js";
import { ExecutionFrame } from "./execution-frame.js";

const budget = (maxSteps = 1000) => new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });

describe("execution call stack", () => {
  it("retains ordinary callers while ignoring repeated native entries", () => {
    const calls = new CallStack(8, budget()), outer = new ExecutionFrame(), inner = new ExecutionFrame();
    const leaveOuter = calls.enter(outer), leaveNative = calls.enter(outer);
    expect(outer.caller).toBeUndefined();
    const leaveInner = calls.enter(inner), leaveInnerNative = calls.enter(inner);
    expect(inner.caller).toBe(outer);
    leaveInnerNative(); leaveInner(); leaveNative(); leaveOuter();
    expect(inner.caller).toBe(outer);
    expect(outer.caller).toBeUndefined();
  });

  it("detaches suspended bodies and links each resume to its new caller", () => {
    const calls = new CallStack(8, budget()), first = new ExecutionFrame(), second = new ExecutionFrame(), suspended = new ExecutionFrame();
    for (const caller of [first, second]) {
      const leaveCaller = calls.enter(caller), leaveBody = calls.enter(suspended, { retainCaller: false });
      expect(suspended.caller).toBe(caller);
      const leaveNative = calls.enter(suspended);
      leaveNative();
      expect(suspended.caller).toBe(caller);
      leaveBody();
      expect(suspended.caller).toBeUndefined();
      leaveCaller();
    }
  });

  it("does not mutate caller links on rejected entry or out-of-order cleanup", () => {
    const calls = new CallStack(2, budget()), outer = new ExecutionFrame(), inner = new ExecutionFrame(), rejected = new ExecutionFrame();
    const leaveOuter = calls.enter(outer), leaveInner = calls.enter(inner, { retainCaller: false });
    expect(() => calls.enter(rejected)).toThrow(expect.objectContaining({ name: "RecursionError" }));
    expect(rejected.caller).toBeUndefined();
    expect(() => leaveOuter()).toThrow("call frames must be restored in LIFO order");
    expect(inner.caller).toBe(outer);
    leaveInner(); leaveOuter();
    expect(inner.caller).toBeUndefined();
  });

  it("detaches a suspended caller after fatal cancellation without checkpoints", () => {
    const meter = budget(2), calls = new CallStack(3, meter), outer = new ExecutionFrame(), inner = new ExecutionFrame();
    const leaveOuter = calls.enter(outer), leaveInner = calls.enter(inner, { retainCaller: false });
    expect(() => calls.enter({})).toThrow(ExecutionLimitError);
    leaveInner(); leaveOuter();
    expect(inner.caller).toBeUndefined();
    expect(calls.depth).toBe(0);
  });

  it("preserves active links when a native callback reenters an earlier frame", () => {
    const calls = new CallStack(4, budget()), outer = new ExecutionFrame(), inner = new ExecutionFrame();
    const leaveOuter = calls.enter(outer), leaveInner = calls.enter(inner), leaveCallback = calls.enter(outer);
    expect(outer.caller).toBeUndefined();
    expect(inner.caller).toBe(outer);
    leaveCallback(); leaveInner(); leaveOuter();
  });

  it("counts delegated cleanup without activating the suspended delegating frame", () => {
    const calls = new CallStack(3, budget()), caller = new ExecutionFrame(), delegating = new ExecutionFrame(), child = new ExecutionFrame();
    const leaveCaller = calls.enter(caller), leaveDelegating = calls.enter(delegating, { activate: false });
    expect(calls.current).toBe(caller);
    expect(delegating.caller).toBeUndefined();
    expect(calls.depth).toBe(2);
    const leaveChild = calls.enter(child, { retainCaller: false });
    expect(child.caller).toBe(caller);
    expect(() => calls.enter({})).toThrow(expect.objectContaining({ name: "RecursionError" }));
    leaveChild(); leaveDelegating(); leaveCaller();
    expect(calls.current).toBeUndefined();
  });

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
