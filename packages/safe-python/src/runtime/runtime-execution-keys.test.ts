import { expect, it } from "vitest";
import { CallStack } from "./call-stack.js";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeExecutionKeys } from "./runtime-execution-keys.js";
import { RuntimeValues, type BuiltinInvocationContext } from "./runtime-values.js";

it("selects the active frame and restores outer/native policies after exit", () => {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), calls = new CallStack<object>(10, meter);
  const keys = new RuntimeExecutionKeys(v, { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n }, meter, calls);
  const outer = {}, inner = {}, events: string[] = [];
  const invocation: BuiltinInvocationContext = { call() { throw Error("unexpected call"); }, isStopIteration: () => false, compare() { events.push("outer"); return v.true; }, truth: value => value === v.true };
  keys.bindInvocation(outer, invocation);
  keys.bindInvocation(inner, { ...invocation, compare() { events.push("inner"); return v.false; } });
  expect(keys.equal(v.integer(1), v.integer(2))).toBe(false);
  const leaveOuter = calls.enter(outer);
  try {
    expect(keys.equal(v.integer(1), v.integer(2))).toBe(true);
    const leaveInner = calls.enter(inner);
    try { expect(keys.equal(v.integer(1), v.integer(2))).toBe(false); }
    finally { leaveInner(); }
    expect(keys.equal(v.integer(1), v.integer(2))).toBe(true);
  } finally { leaveOuter(); }
  expect(keys.equal(v.integer(1), v.integer(2))).toBe(false);
  expect(events).toEqual(["outer", "inner", "outer"]); expect(keys.hash(v.string("key"))).toBe(23n);
});
