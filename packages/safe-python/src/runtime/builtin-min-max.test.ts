import { expect, it } from "vitest";
import { createMinMaxBuiltin, type MinMaxContext } from "./builtin-min-max.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture(name: "min" | "max") {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const context: MinMaxContext = { call(key, value) {
    if (key.kind !== "builtin_function_or_method") throw new PythonRuntimeError("TypeError", `'${key.kind}' object is not callable`);
    return key.value.invoke([value], constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter), meter);
  } };
  const builtin = createMinMaxBuiltin(name, v, meter, context);
  return { v, meter, keywords, context, builtin, call: (...args: RuntimeValue[]) => builtin.value.invoke(args, keywords, meter) };
}
it.each(["min", "max"] as const)("selects %s in iterable and positional forms, keeping first ties", name => {
  const { v, call } = fixture(name), first = v.float(2), second = v.float(2);
  expect(call(first, second)).toBe(first);
  expect(call(v.list([first, second]))).toBe(first);
  const low = v.integer(-10), high = v.integer(20);
  expect(call(low, first, high)).toBe(name === "min" ? low : high);
  expect(call(v.list([low, first, high]))).toBe(name === "min" ? low : high);
  const nan = v.float(NaN); expect(call(nan, low, high)).toBe(nan);
  expect(call(v.list([v.none]))).toBe(v.none);
});
it.each(["min", "max"] as const)("preserves explicit %s key and comparison policies over invocation defaults", name => {
  const { v, meter, context, keywords, builtin } = fixture(name), first = v.integer(1), last = v.integer(2);
  context.call = (_key, value) => value; context.compare = () => true;
  keywords.items.set(v.string("key"), v.cell({}));
  expect(builtin.value.invoke([first, last], keywords, meter, {
    call() { throw Error("explicit call must win"); }, compareTruth() { throw Error("explicit comparison must win"); }, isStopIteration: () => false
  })).toBe(last);
});
it.each(["min", "max"] as const)("validates %s options in order and defers key callability", name => {
  const { v, call, keywords } = fixture(name);
  keywords.items.set(v.string("bad"), v.none);
  expect(() => call()).toThrow(`${name} expected at least 1 argument, got 0`);
  expect(() => call(v.none)).toThrow(`${name}() got an unexpected keyword argument 'bad'`);
  keywords.items.clear(); keywords.items.set(v.string("ke"), v.none);
  expect(() => call(v.none)).toThrow("Did you mean 'key'?");
  keywords.items.clear(); keywords.items.set(v.string("default"), v.none);
  expect(() => call(v.none, v.none)).toThrow(`Cannot specify a default for ${name}() with multiple positional arguments`);
  keywords.items.set(v.string("key"), v.integer(3));
  expect(call(v.list([]))).toBe(v.none);
  expect(() => call(v.list([v.none]))).toThrow("'int' object is not callable");
  keywords.items.clear(); expect(() => call(v.list([]))).toThrow(`${name}() iterable argument is empty`);
});
it("calls key once per item, compares candidate against best and returns the original", () => {
  const { v, call, context, keywords } = fixture("max"), events: string[] = [];
  const one = v.integer(1), two = v.integer(2), three = v.integer(3);
  const key = v.builtinFunction({ name: "key", invoke(args) { const value = args[0]; if (value.kind !== "int") throw Error("integer required"); events.push(`key:${value.value}`); return v.integer(-value.value); } });
  keywords.items.set(v.string("key"), key);
  context.compare = function(op, a, b) { expect(this).toBe(context); if (a.kind !== "int" || b.kind !== "int") throw Error("integer required"); events.push(`${op}:${a.value}:${b.value}`); return a.value > b.value; };
  expect(call(v.list([two, one, three]))).toBe(one);
  expect(events).toEqual(["key:2", "key:1", ">:-1:-2", "key:3", ">:-3:-1"]);
});
it("does not close iterators and propagates key/comparison StopIteration", () => {
  const { v, call, context, keywords } = fixture("min"); let pulls = 0, closes = 0;
  const source = v.iterator({ next() { pulls++; return { done: false, value: v.integer(pulls) }; }, return() { closes++; return { done: true, value: undefined }; } });
  const error = new PythonRuntimeError("StopIteration", "callback failed");
  context.compare = () => { throw error; };
  expect(() => call(source)).toThrow(error); expect(pulls).toBe(2); expect(closes).toBe(0);
  keywords.items.set(v.string("key"), v.none); // None bypasses key dispatch.
  expect(() => call(source)).toThrow(error); expect(pulls).toBe(4);
  context.call = () => { throw error; }; keywords.items.clear(); keywords.items.set(v.string("key"), v.true);
  expect(() => call(source)).toThrow(error); expect(pulls).toBe(5); expect(closes).toBe(0);
});
it("checks cancellation after pulls, key calls and comparisons", () => {
  for (const stage of ["next", "key", "compare"]) {
    const { v, context, keywords, builtin } = fixture("max"); let cancelled = false;
    const source = v.iterator({ next() { if (stage === "next") cancelled = true; return { done: false, value: v.true }; } });
    context.call = () => { if (stage === "key") cancelled = true; return v.true; };
    context.compare = () => { cancelled = true; return true; };
    keywords.items.set(v.string("key"), v.true);
    expect(() => builtin.value.invoke([source], keywords, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  }
});
it("uses guest sequence fallback and consumes only iteration exhaustion", () => {
  const { v, call, context, keywords } = fixture("min"), source = v.cell({}), visits: bigint[] = [];
  const stop = new PythonRuntimeError("IndexError", "end");
  context.iteration = {
    lookupIter: () => undefined, hasNext: () => false, next: () => { throw Error("must use sequence fallback"); },
    hasSequenceItem: value => value === source, getItem: (_value, index) => { visits.push(index); if (index === 3n) throw stop; return v.integer(3n - index); },
    isStopIteration: () => false, isIndexError: error => error === stop, typeName: () => "Sequence"
  };
  expect(call(source)).toBe(v.integer(1)); expect(visits).toEqual([0n, 1n, 2n, 3n]);
  context.iteration.getItem = () => { throw stop; };
  keywords.items.set(v.string("default"), source);
  expect(call(source)).toBe(source);
});
