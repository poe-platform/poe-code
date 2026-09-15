import { expect, it } from "vitest";
import { createAllAnyBuiltin, type AllAnyContext } from "./builtin-all-any.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture(name: "all" | "any", context: AllAnyContext = {}) {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const builtin = createAllAnyBuiltin(name, v, meter, context);
  return { v, meter, keywords, builtin, call: (value: RuntimeValue) => builtin.value.invoke([value], keywords, meter) };
}
it.each(["all", "any"] as const)("implements %s empty results and builtin truth", name => {
  const { v, call } = fixture(name);
  expect(call(v.list([]))).toBe(v.boolean(name === "all"));
  expect(call(v.list([v.integer(1), v.string("x")]))).toBe(v.true);
  expect(call(v.tuple([v.none, v.integer(0), v.string("")]))).toBe(v.false);
  expect(call(v.list([v.false, v.true]))).toBe(v.boolean(name === "any"));
});
it.each(["all", "any"] as const)("short-circuits %s without closing or over-pulling the iterator", name => {
  const { v, call } = fixture(name);
  let pulls = 0, closes = 0;
  const cursor = { next() { pulls++; return { done: false as const, value: v.boolean(name === "any") }; }, return() { closes++; return { done: true as const, value: undefined }; } };
  expect(call(v.iterator(cursor))).toBe(v.boolean(name === "any"));
  expect(pulls).toBe(1); expect(closes).toBe(0);
  cursor.next(); expect(pulls).toBe(2);
});
it.each(["all", "any"] as const)("validates %s arguments before acquiring input", name => {
  const { v, call, builtin, keywords, meter } = fixture(name);
  for (const args of [[], [v.none, v.none]]) expect(() => builtin.value.invoke(args, keywords, meter)).toThrow(`${name}() takes exactly one argument (${args.length} given)`);
  keywords.items.set(v.string("iterable"), v.none);
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow(`${name}() takes no keyword arguments`);
  keywords.items.clear(); expect(() => call(v.none)).toThrow("'NoneType' object is not iterable");
});
it("uses guest iterator acquisition and truth in order, consuming exhaustion metadata", () => {
  const events: string[] = [], context: AllAnyContext = {};
  const { v, call } = fixture("all", context), source = v.cell({});
  const stop = Error("guest StopIteration"); let pulls = 0;
  context.iteration = {
    lookupIter: () => { events.push("iter"); return () => source; }, hasNext: () => true,
    next: () => { events.push("next"); if (pulls++ === 1) throw stop; return source; },
    hasSequenceItem: () => false, getItem: () => v.none, isStopIteration: error => error === stop, isIndexError: () => false, typeName: () => "Guest"
  };
  context.truth = function(value) { expect(this).toBe(context); expect(value).toBe(source); events.push("truth"); return true; };
  expect(call(source)).toBe(v.true);
  expect(events).toEqual(["iter", "next", "truth", "next"]);
});
it("propagates truth errors including StopIteration without closing the cursor", () => {
  const error = new PythonRuntimeError("StopIteration", "truth StopIteration"), context: AllAnyContext = { truth() { throw error; } };
  const { v, call } = fixture("any", context); let pulls = 0;
  const cursor = v.iterator({ next() { pulls++; return { done: false, value: v.none }; } });
  expect(() => call(cursor)).toThrow(error); expect(pulls).toBe(1);
  const nextError = Error("next failed");
  expect(() => call(v.iterator({ next() { throw nextError; } }))).toThrow(nextError);
});
it("checks cancellation after both cursor pulls and guest truth calls", () => {
  for (const stage of ["next", "truth"]) {
    let cancelled = false;
    const context: AllAnyContext = { truth() { cancelled = true; return true; } };
    const { v, builtin, keywords } = fixture("any", context);
    const cursor = v.iterator({ next() { if (stage === "next") cancelled = true; return { done: false, value: v.true }; } });
    expect(() => builtin.value.invoke([cursor], keywords, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  }
});
it("bounds infinite input without allocating a collection of consumed values", () => {
  const { v, builtin, keywords } = fixture("all");
  const cursor = v.iterator({ next() { return { done: false, value: v.true }; } });
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 });
  expect(() => builtin.value.invoke([cursor], keywords, meter)).toThrow("execution step limit exceeded");
  expect(meter.usage.allocatedBytes).toBe(0);
});
it.each(["all", "any"] as const)("keeps explicit %s truth policy ahead of invocation policy", name => {
  const context: AllAnyContext = { truth() { expect(this).toBe(context); return name === "any"; } };
  const { v, builtin, keywords, meter } = fixture(name, context);
  const unused = (): never => { throw Error("unexpected invocation callback"); };
  expect(builtin.value.invoke([v.list([v.none])], keywords, meter, { call: unused, isStopIteration: unused, truth: unused })).toBe(v.boolean(name === "any"));
});
it.each(["all", "any"] as const)("propagates %s invocation truth StopIteration instead of treating it as exhaustion", name => {
  const { v, builtin, keywords, meter } = fixture(name), fault = new PythonRuntimeError("StopIteration", "truth failed");
  const unused = (): never => { throw Error("unexpected invocation callback"); };
  expect(() => builtin.value.invoke([v.list([v.none])], keywords, meter, { call: unused, isStopIteration: unused, truth() { throw fault; } })).toThrow(fault);
});
