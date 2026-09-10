import { expect, it } from "vitest";
import { createSortedBuiltin, type SortedContext } from "./builtin-sorted.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const context: SortedContext = { callKey() { throw new PythonRuntimeError("TypeError", "key is not callable"); } };
  const builtin = createSortedBuiltin(v, meter, context);
  return { v, meter, keywords, context, builtin, call: (...args: RuntimeValue[]) => builtin.value.invoke(args, keywords, meter) };
}
it("copies source slots and preserves member identity in stable reverse ordering", () => {
  const { v, call, keywords } = fixture(), first = v.float(2), second = v.float(2), low = v.float(1), source = v.list([first, low, second]);
  keywords.items.set(v.string("reverse"), v.true);
  const result = call(source);
  expect(result).not.toBe(source);
  if (result.kind !== "list") throw Error("expected list");
  expect(result.items.snapshot()).toEqual([first, second, low]);
  expect(result.items.get(0n)).toBe(first); expect(result.items.get(1n)).toBe(second);
  expect(source.items.snapshot()).toEqual([first, low, second]);
});
it("uses invocation key, comparison and reverse-truth capabilities", () => {
  const { v, meter, keywords } = fixture(), key = v.cell({}), reverse = v.cell({}), trace: string[] = [];
  keywords.items.set(v.string("key"), key); keywords.items.set(v.string("reverse"), reverse);
  const result = createSortedBuiltin(v, meter).value.invoke([v.list([v.integer(2), v.integer(1)])], keywords, meter, {
    call(fn, args) { expect(fn).toBe(key); trace.push("key"); return args[0]; },
    compareTruth(operator, left, right) { expect(operator).toBe("<"); if (left.kind !== "int" || right.kind !== "int") throw Error("expected integers"); trace.push("less"); return left.value < right.value; },
    truth(value) { expect(value).toBe(reverse); trace.push("reverse"); return false; }, isStopIteration: () => false
  });
  if (result.kind !== "list") throw Error("expected list"); expect(result.items.snapshot()).toEqual([v.integer(1), v.integer(2)]);
  expect(trace.slice(0,3)).toEqual(["reverse", "key", "key"]); expect(trace).toContain("less");
});
it("retains explicit sort policies over invocation defaults", () => {
  const { v, meter, keywords, context, builtin } = fixture(), first = v.integer(2), second = v.integer(1);
  context.callKey = (_key, value) => value; context.less = () => false; context.truth = () => false;
  keywords.items.set(v.string("key"), v.true); keywords.items.set(v.string("reverse"), v.true);
  const unused = (): never => { throw Error("explicit policy must win"); };
  const result = builtin.value.invoke([v.list([first,second])], keywords, meter, { call: unused, truth: unused, compareTruth: unused, isStopIteration: unused });
  if (result.kind !== "list") throw Error("expected list"); expect(result.items.snapshot()).toEqual([first, second]);
});
it("validates positional arity first but consumes input before keyword validation", () => {
  const { v, call, keywords } = fixture(); let pulls = 0;
  keywords.items.set(v.string("bad"), v.none);
  expect(() => call()).toThrow("sorted expected 1 argument, got 0");
  expect(() => call(v.none, v.none)).toThrow("sorted expected 1 argument, got 2");
  expect(() => call(v.none)).toThrow("'NoneType' object is not iterable");
  const source = v.iterator({ next() { pulls++; return { done: pulls === 3, value: v.integer(pulls) }; } });
  expect(() => call(source)).toThrow("sort() got an unexpected keyword argument 'bad'");
  expect(pulls).toBe(3);
  keywords.items.clear(); keywords.items.set(v.string("ke"), v.none);
  expect(() => call(v.list([]))).toThrow("Did you mean 'key'?");
});
it("converts reverse after iteration then calls each key once on copied members", () => {
  const { v, call, context, keywords } = fixture(), events: string[] = [], source = v.list([v.integer(3), v.integer(1), v.integer(2)]);
  context.truth = function() { expect(this).toBe(context); events.push("reverse"); return false; };
  context.callKey = function(_key, item) { expect(this).toBe(context); source.items.clear(); if (item.kind !== "int") throw Error("integer required"); events.push(`key:${item.value}`); return v.integer(-item.value); };
  keywords.items.set(v.string("key"), v.true); keywords.items.set(v.string("reverse"), v.true);
  const result = call(source);
  if (result.kind !== "list") throw Error("expected list");
  expect(result.items.snapshot()).toEqual([v.integer(3), v.integer(2), v.integer(1)]);
  expect(source.items.length).toBe(0); expect(events).toEqual(["reverse", "key:3", "key:1", "key:2"]);
});
it("defers key callability for empty sources and bypasses None keys", () => {
  const { v, call, keywords } = fixture();
  keywords.items.set(v.string("key"), v.true);
  expect(call(v.list([]))).toEqual(v.list([]));
  expect(() => call(v.list([v.none]))).toThrow("key is not callable");
  keywords.items.clear(); keywords.items.set(v.string("key"), v.none);
  expect(call(v.tuple([v.integer(2), v.integer(1)]))).toEqual(v.list([v.integer(1), v.integer(2)]));
});
it("propagates source failure before reverse truth and never closes the source", () => {
  const { v, call, context, keywords } = fixture(), failure = Error("source failed"); let closes = 0;
  context.truth = () => { throw Error("must not reach truth"); };
  keywords.items.set(v.string("reverse"), v.true);
  const source = v.iterator({ next() { throw failure; }, return() { closes++; return { done: true, value: undefined }; } });
  expect(() => call(source)).toThrow(failure); expect(closes).toBe(0);
});
it("checks cancellation after reverse truth before returning an empty list", () => {
  const { v, context, builtin, keywords } = fixture(); let cancelled = false;
  context.truth = () => { cancelled = true; return false; };
  keywords.items.set(v.string("reverse"), v.true);
  expect(() => builtin.value.invoke([v.list([])], keywords, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
});
it("orders guest iterator acquisition, length hints, consumption and reverse truth", () => {
  const { v, builtin, meter, context, keywords } = fixture(), source = v.cell({}), events: string[] = [];
  const stop = new PythonRuntimeError("StopIteration", "done"); let next = 3;
  context.extension = {
    exactList: () => undefined, lookupIter: () => { events.push("iter"); return () => source; }, hasNext: () => true,
    next: () => { events.push("next"); if (next === 0) throw stop; return v.integer(next--); }, hasSequenceItem: () => false,
    getItem: () => { throw Error("unexpected sequence access"); }, isStopIteration: error => error === stop, isIndexError: () => false,
    length: () => { events.push("len"); return undefined; }, lookupHint: () => () => { events.push("hint"); return v.integer(3); },
    integer: value => value.kind === "int" ? value.value : undefined, isNotImplemented: () => false,
    isTypeError: () => false, typeName: () => "Guest"
  };
  context.truth = () => { events.push("reverse"); return false; };
  keywords.items.set(v.string("reverse"), v.true);
  const unused = (): never => { throw Error("explicit extension policy must win"); };
  expect(builtin.value.invoke([source], keywords, meter, { call: unused, isStopIteration: unused, iteration: { ...context.extension, lookupIter: unused } })).toEqual(v.list([v.integer(1), v.integer(2), v.integer(3)]));
  expect(events).toEqual(["iter", "len", "hint", "next", "next", "next", "next", "reverse"]);
});
