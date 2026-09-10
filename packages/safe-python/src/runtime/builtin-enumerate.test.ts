import { expect, it } from "vitest";
import { createEnumerateBuiltin } from "./builtin-enumerate.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { IterationContext } from "./protocol-iterator.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[], context?: Parameters<typeof createEnumerateBuiltin>[2]) => {
    const result = createEnumerateBuiltin(v, meter, context).value.invoke(args, keywords, meter);
    if (result.kind !== "iterator") throw new Error("expected iterator"); return result.value;
  };
  return { meter, v, keywords, call };
}
it("enumerates lazily with huge indices and shared member identity", () => {
  const { v, call } = fixture(), member = v.list([]), source = v.list([member]), start = 10n ** 80n;
  const cursor = call([source, v.integer(start)]); source.items.append(v.true);
  expect(cursor.next()).toEqual({ done: false, value: v.tuple([v.integer(start), member]) });
  expect(cursor.next()).toEqual({ done: false, value: v.tuple([v.integer(start + 1n), v.true]) });
  expect(cursor.next().done).toBe(true);
});
it("defaults to zero and accepts bool starts", () => {
  const { v, call } = fixture();
  expect(call([v.string("😀")]).next().value).toEqual(v.tuple([v.integer(0), v.string("😀")]));
  expect(call([v.list([v.none]), v.true]).next().value).toEqual(v.tuple([v.integer(1), v.none]));
});
it("accepts iterable and start keywords in either order", () => {
  const { v, call, keywords } = fixture();
  for (const names of [["iterable", "start"], ["start", "iterable"]]) {
    for (const name of names) keywords.items.set(v.string(name), name === "iterable" ? v.list([v.true]) : v.integer(-3));
    expect(call([]).next().value).toEqual(v.tuple([v.integer(-3), v.true])); keywords.items.clear();
  }
  keywords.items.set(v.string("start"), v.integer(8));
  expect(call([v.list([v.false])]).next().value).toEqual(v.tuple([v.integer(8), v.false]));
});
it("matches constructor argument count and invalid-keyword precedence", () => {
  const { v, call, keywords } = fixture();
  expect(() => call([])).toThrow("enumerate() missing required argument 'iterable'");
  keywords.items.set(v.string("start"), v.integer(1));
  expect(() => call([])).toThrow("'start' is an invalid keyword argument for enumerate()");
  expect(() => call([v.none, v.none])).toThrow("enumerate() takes at most 2 arguments (3 given)");
  keywords.items.set(v.string("iterable"), v.list([])); keywords.items.set(v.string("bad"), v.none);
  expect(() => call([])).toThrow("enumerate() missing required argument 'iterable'");
  keywords.items.clear(); keywords.items.set(v.string("iterable"), v.list([]));
  expect(() => call([v.none])).toThrow("'iterable' is an invalid keyword argument for enumerate()");
});
it("converts start before acquiring an iterator", () => {
  const { v, call } = fixture();
  expect(() => call([v.none, v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
  expect(() => call([v.none, v.integer(0)])).toThrow("'NoneType' object is not iterable");
});
it("uses guest index and iteration capabilities once, in Python order", () => {
  const { v, meter, keywords } = fixture(), source = v.cell({}), start = v.cell({}), target = v.cell({}), events: string[] = [];
  const index: IntegerIndexContext<RuntimeValue> = {
    integer: value => value.kind === "int" ? value.value : undefined, isExactInteger: value => value.kind === "int",
    lookupIndex(value) { expect(value).toBe(start); events.push("index lookup"); return () => { events.push("index"); return v.integer(17); }; },
    typeName: () => "Custom", warn: () => { throw new Error("unexpected warning"); }
  };
  const iteration: IterationContext<RuntimeValue> = {
    lookupIter(value) { expect(value).toBe(source); events.push("iter lookup"); return () => { events.push("iter"); return target; }; },
    hasNext: value => value === target, next: () => { events.push("next"); return v.true; },
    hasSequenceItem: () => false, getItem: () => v.none, isStopIteration: () => false, isIndexError: () => false, typeName: () => "Custom"
  };
  const unused = (): never => { throw Error("explicit policy must win"); };
  const result = createEnumerateBuiltin(v, meter, { index, iteration }).value.invoke([source, start], keywords, meter, { call: unused, isStopIteration: unused, integerIndex: { ...index, lookupIndex: unused }, iteration: { ...iteration, lookupIter: unused } });
  if (result.kind !== "iterator") throw Error("expected iterator");
  const cursor = result.value;
  expect(events).toEqual(["index lookup", "index", "iter lookup", "iter"]);
  expect(cursor.next().value).toEqual(v.tuple([v.integer(17), v.true])); expect(events.at(-1)).toBe("next");
});
it("forwards prepared source exhaustion without incrementing the counter", () => {
  const { v, call } = fixture(), failure = new PythonRuntimeError("StopIteration", "payload"); let calls = 0;
  const cursor = call([v.iterator({ next: () => ++calls === 1 ? { done: true, value: undefined, exception: { value: failure } } : { done: false, value: v.true } })]);
  expect(cursor.next()).toEqual({ done: true, value: undefined, exception: { value: failure } });
  expect(cursor.next().value).toEqual(v.tuple([v.integer(0), v.true]));
});
it("does not produce tuple values after source cancellation", () => {
  const { v, keywords } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const result = createEnumerateBuiltin(v, meter).value.invoke([v.iterator({ next() { cancelled = true; return { done: false, value: v.true }; } })], keywords, meter);
  if (result.kind !== "iterator") throw new Error("expected iterator");
  expect(() => result.value.next()).toThrow(ExecutionLimitError);
});
