import { expect, it } from "vitest";
import { createMapBuiltin, type MapBuiltinContext } from "./builtin-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b || (a.kind === "str" && b.kind === "str" && a.value.compare(b.value, meter) === 0) }, meter));
  const empty = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const context: MapBuiltinContext = {
    call(fn, args) {
      expect(this).toBe(context);
      if (fn.kind !== "builtin_function_or_method") throw new PythonRuntimeError("TypeError", "'NoneType' object is not callable");
      return fn.value.invoke(args, empty, meter);
    },
    isStopIteration: error => error instanceof PythonRuntimeError && error.name === "StopIteration"
  };
  const call = (args: RuntimeValue[]) => {
    const result = createMapBuiltin(v, meter, context).value.invoke(args, keywords, meter);
    if (result.kind !== "iterator") throw new Error("expected iterator"); return result.value;
  };
  return { v, meter, keywords, context, call };
}
it("calls the mapper lazily with complete rows and preserves returned identity", () => {
  const { v, call } = fixture(), result = v.list([]), rows: RuntimeValue[][] = [];
  const fn = v.builtinFunction({ name: "mapper", invoke(args) { rows.push([...args]); return result; } });
  const cursor = call([fn, v.list([v.true]), v.tuple([v.false])]); expect(rows).toEqual([]);
  expect(cursor.next().value).toBe(result); expect(rows).toEqual([[v.true, v.false]]);
  expect(cursor.next().done).toBe(true); expect(rows).toHaveLength(1);
});
it("uses invocation callbacks lazily when no explicit policy was configured", () => {
  const { v, meter, keywords } = fixture(), marker = v.cell({}), result = v.cell({}); let calls = 0;
  const mapped = createMapBuiltin(v, meter).value.invoke([marker, v.list([v.true])], keywords, meter, {
    call(fn, args) { expect(fn).toBe(marker); expect(args).toEqual([v.true]); calls++; return result; }, isStopIteration: () => false
  });
  expect(calls).toBe(0); if (mapped.kind !== "iterator") throw Error("expected iterator");
  expect(mapped.value.next().value).toBe(result); expect(calls).toBe(1);
});
it("retains an explicit callback policy when an invocation capability is supplied", () => {
  const { v, meter, keywords, context } = fixture(), fn = v.builtinFunction({ name: "mapper", invoke: () => v.true });
  const mapped = createMapBuiltin(v, meter, context).value.invoke([fn, v.list([v.false])], keywords, meter, {
    call() { throw Error("explicit policy must win"); }, isStopIteration() { throw Error("explicit policy must win"); }
  });
  if (mapped.kind !== "iterator") throw Error("expected iterator");
  expect(mapped.value.next().value).toBe(v.true);
});
it("does not check mapper callability before a complete row exists", () => {
  const { v, call, keywords } = fixture();
  expect(call([v.none, v.list([])]).next().done).toBe(true);
  expect(() => call([v.none, v.list([v.true])]).next()).toThrow("'NoneType' object is not callable");
  keywords.items.set(v.string("strict"), v.true);
  expect(() => call([v.none, v.list([]), v.list([v.true])]).next()).toThrow("map() argument 2 is longer than argument 1");
});
it("validates strict keywords and truth before minimum positional arity", () => {
  const { v, call, keywords } = fixture();
  expect(() => call([])).toThrow("map() must have at least two arguments.");
  expect(() => call([v.none])).toThrow("map() must have at least two arguments.");
  keywords.items.set(v.string("stric"), v.true);
  expect(() => call([])).toThrow("map() got an unexpected keyword argument 'stric'. Did you mean 'strict'?");
  keywords.items.set(v.string("x"), v.true);
  expect(() => call([])).toThrow("map() takes at most 1 keyword argument (2 given)");
  keywords.items.clear(); keywords.items.set(v.string("strict"), v.notImplemented);
  expect(() => call([])).toThrow("NotImplemented should not be used in a boolean context");
});
it("acquires guest inputs in order after strict truth, without pulling", () => {
  const { v, call, context, keywords } = fixture(), a = v.cell({}), b = v.cell({}), events: string[] = [];
  context.truth = () => { events.push("truth"); return true; };
  context.iteration = {
    lookupIter(value) { events.push(value === a ? "a" : "b"); return () => value; }, hasNext: () => true,
    next(value) { events.push("next"); return value; }, hasSequenceItem: () => false, getItem: () => v.none,
    isStopIteration: () => false, isIndexError: () => false, typeName: () => "Custom"
  };
  keywords.items.set(v.string("strict"), v.true);
  const fn = v.builtinFunction({ name: "mapper", invoke(args) { events.push("map"); return args[0]; } });
  const cursor = call([fn, a, b]); expect(events).toEqual(["truth", "a", "b"]);
  expect(cursor.next().value).toBe(a); expect(events).toEqual(["truth", "a", "b", "next", "next", "map"]);
});
it("stops input acquisition at a failure without consuming prepared cursors", () => {
  const { v, call } = fixture(); let pulls = 0;
  const source = v.iterator({ next() { pulls++; return { done: false, value: v.true }; } });
  expect(() => call([v.none, source, v.none, source])).toThrow("'NoneType' object is not iterable"); expect(pulls).toBe(0);
});
it("retains mapper exhaustion payloads and resumes from the next row", () => {
  const { v, call, keywords } = fixture(), error = new PythonRuntimeError("StopIteration", "mapped stop"); let calls = 0;
  const fn = v.builtinFunction({ name: "mapper", invoke(args) { if (++calls === 1) throw error; return args[0]; } });
  keywords.items.set(v.string("strict"), v.true);
  const cursor = call([fn, v.list([v.true, v.false])]);
  expect(cursor.next()).toEqual({ done: true, value: undefined, exception: { value: error } });
  expect(cursor.next().value).toBe(v.false);
});
it("checks cancellation after guest strict truth before arity validation", () => {
  const { v, keywords, context } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  context.truth = () => { cancelled = true; return true; }; keywords.items.set(v.string("strict"), v.true);
  const fn = createMapBuiltin(v, meter, context);
  expect(() => fn.value.invoke([], keywords, meter)).toThrow(ExecutionLimitError);
});
it("uses invocation strict truth before arity validation and observes cancellation", () => {
  const { v, keywords, meter } = fixture(), fault = Error("strict truth failed"), builtin = createMapBuiltin(v, meter);
  keywords.items.set(v.string("strict"), v.none);
  const unused = (): never => { throw Error("unexpected callback"); };
  expect(() => builtin.value.invoke([], keywords, meter, { call: unused, isStopIteration: unused, truth() { throw fault; } })).toThrow(fault);
  let cancelled = false;
  const invocationMeter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  expect(() => builtin.value.invoke([], keywords, invocationMeter, { call: unused, isStopIteration: unused, truth() { cancelled = true; return false; } })).toThrow(ExecutionLimitError);
});
it("preserves explicit strict truth and its receiver over invocation truth", () => {
  const { v, keywords, meter, context } = fixture(); let conversions = 0;
  context.truth = function() { expect(this).toBe(context); conversions++; return false; };
  keywords.items.set(v.string("strict"), v.none);
  const unused = (): never => { throw Error("unexpected invocation callback"); };
  const result = createMapBuiltin(v, meter, context).value.invoke([v.none, v.list([])], keywords, meter, { call: unused, isStopIteration: unused, truth: unused });
  expect(result.kind).toBe("iterator"); expect(conversions).toBe(1);
});
