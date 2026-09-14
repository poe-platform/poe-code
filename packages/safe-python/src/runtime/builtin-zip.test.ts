import { expect, it } from "vitest";
import { createZipBuiltin } from "./builtin-zip.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import type { IterationContext } from "./protocol-iterator.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b || (a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0) }, meter));
  const call = (args: RuntimeValue[], context?: Parameters<typeof createZipBuiltin>[2]) => {
    const result = createZipBuiltin(v, meter, context).value.invoke(args, keywords, meter);
    if (result.kind !== "iterator") throw new Error("expected iterator"); return result.value;
  };
  return { meter, v, keywords, call };
}
it("zips exact iterable values lazily into tuples retaining member identity", () => {
  const { v, call } = fixture(), member = v.list([]), source = v.list([member]);
  const cursor = call([source, v.string("ab")]); source.items.append(v.true);
  expect(cursor.next().value).toEqual(v.tuple([member, v.string("a")]));
  expect(cursor.next().value).toEqual(v.tuple([v.true, v.string("b")]));
  expect(cursor.next().done).toBe(true);
  expect(call([]).next().done).toBe(true);
});
it("strict zip detects shorter and longer inputs only during traversal", () => {
  const { v, call, keywords } = fixture(); keywords.items.set(v.string("strict"), v.true);
  const shorter = call([v.list([v.true]), v.list([])]);
  expect(() => shorter.next()).toThrow("zip() argument 2 is shorter than argument 1");
  const longer = call([v.list([]), v.list([v.true])]);
  expect(() => longer.next()).toThrow("zip() argument 2 is longer than argument 1");
});
it("validates strict keywords and truth before acquiring any inputs", () => {
  const { v, call, keywords } = fixture();
  keywords.items.set(v.string("stric"), v.true);
  expect(() => call([v.none])).toThrow("zip() got an unexpected keyword argument 'stric'. Did you mean 'strict'?");
  keywords.items.set(v.string("x"), v.true);
  expect(() => call([v.none])).toThrow("zip() takes at most 1 keyword argument (2 given)");
  keywords.items.clear(); keywords.items.set(v.string("strict"), v.notImplemented);
  expect(() => call([])).toThrow("NotImplemented should not be used in a boolean context");
  expect(() => call([v.none])).toThrow("NotImplemented should not be used in a boolean context");
});
it("converts guest strict truth then acquires input iterators left to right", () => {
  const { v, meter, keywords } = fixture(), a = v.cell({}), b = v.cell({}), strict = v.cell({}), events: string[] = [];
  keywords.items.set(v.string("strict"), strict);
  const iteration: IterationContext<RuntimeValue> = {
    lookupIter(source) { events.push(source === a ? "a" : "b"); return () => source; }, hasNext: () => true,
    next(source) { events.push("next"); return source; }, hasSequenceItem: () => false, getItem: () => v.none,
    isStopIteration: () => false, isIndexError: () => false, typeName: () => "Custom"
  };
  const context = { iteration, truth(value: RuntimeValue) { expect(this).toBe(context); expect(value).toBe(strict); events.push("truth"); return true; } };
  const unused = (): never => { throw Error("explicit policy must win"); };
  const result = createZipBuiltin(v, meter, context).value.invoke([a, b], keywords, meter, { call: unused, isStopIteration: unused, truth: unused, iteration: { ...iteration, lookupIter: unused } });
  if (result.kind !== "iterator") throw Error("expected iterator");
  const cursor = result.value; expect(events).toEqual(["truth", "a", "b"]);
  expect(cursor.next().value).toEqual(v.tuple([a, b])); expect(events).toEqual(["truth", "a", "b", "next", "next"]);
});
it("stops acquisition at the first error without consuming prepared inputs", () => {
  const { v, call } = fixture(); let pulls = 0;
  const cursor = v.iterator({ next() { pulls++; return { done: false, value: v.true }; } });
  expect(() => call([cursor, v.none, cursor])).toThrow("'NoneType' object is not iterable"); expect(pulls).toBe(0);
});
it("non-strict zip preserves source exhaustion metadata while strict zip clears it", () => {
  const { v, call, keywords } = fixture(), error = new PythonRuntimeError("StopIteration", "source");
  const source = v.iterator({ next: () => ({ done: true, value: undefined, exception: { value: error } }) });
  expect(call([source]).next()).toEqual({ done: true, value: undefined, exception: { value: error } });
  keywords.items.set(v.string("strict"), v.true);
  expect(call([source]).next()).toEqual({ done: true, value: undefined });
});
it("checks cancellation after strict truth even with no inputs", () => {
  const { v, keywords } = fixture(); keywords.items.set(v.string("strict"), v.true); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const builtin = createZipBuiltin(v, meter, { truth: () => { cancelled = true; return false; } });
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow(ExecutionLimitError);
});
it("checks cancellation after invocation strict truth even with no inputs", () => {
  const { v, keywords, meter } = fixture(); keywords.items.set(v.string("strict"), v.none); let cancelled = false;
  const builtin = createZipBuiltin(v, meter), unused = (): never => { throw Error("unexpected callback"); };
  expect(() => builtin.value.invoke([], keywords, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } }, {
    call: unused, isStopIteration: unused, truth() { cancelled = true; return false; }
  })).toThrow(ExecutionLimitError);
});
