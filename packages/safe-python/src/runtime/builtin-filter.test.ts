import { expect, it } from "vitest";
import { createFilterBuiltin, type FilterBuiltinContext } from "./builtin-filter.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const context: FilterBuiltinContext = {
    call(fn, value) { expect(this).toBe(context); if (fn.kind !== "builtin_function_or_method") throw new PythonRuntimeError("TypeError", "'int' object is not callable"); return fn.value.invoke([value], keywords, meter); },
    isStopIteration: error => error instanceof PythonRuntimeError && error.name === "StopIteration"
  };
  const call = (args: RuntimeValue[]) => {
    const result = createFilterBuiltin(v, meter, context).value.invoke(args, keywords, meter);
    if (result.kind !== "iterator") throw new Error("expected iterator"); return result.value;
  };
  return { meter, v, keywords, context, call };
}
it("filters None predicates by truth, retaining original member identity", () => {
  const { v, call } = fixture(), member = v.list([v.true]);
  const cursor = call([v.none, v.list([v.false, v.integer(0), v.string(""), member])]);
  expect(cursor.next().value).toBe(member); expect(cursor.next().done).toBe(true);
});
it("invokes predicates lazily and tests their results rather than source values", () => {
  const { v, call } = fixture(), seen: RuntimeValue[] = [];
  const fn = v.builtinFunction({ name: "test", invoke(args) { seen.push(args[0]); return args[0] === v.false ? v.true : v.false; } });
  const cursor = call([fn, v.list([v.true, v.false])]); expect(seen).toEqual([]);
  expect(cursor.next().value).toBe(v.false); expect(seen).toEqual([v.true, v.false]);
});
it("uses invocation call and truth capabilities lazily", () => {
  const { v, meter, keywords } = fixture(), predicate = v.cell({}), decision = v.cell({}), trace: string[] = [];
  const filtered = createFilterBuiltin(v, meter).value.invoke([predicate, v.list([v.true])], keywords, meter, {
    call(fn, args) { expect(fn).toBe(predicate); expect(args).toEqual([v.true]); trace.push("call"); return decision; },
    truth(value) { expect(value).toBe(decision); trace.push("truth"); return true; }, isStopIteration: () => false
  });
  expect(trace).toEqual([]); if (filtered.kind !== "iterator") throw Error("expected iterator");
  expect(filtered.value.next().value).toBe(v.true); expect(trace).toEqual(["call", "truth"]);
});
it("preserves explicit predicate and truth policies over invocation defaults", () => {
  const { v, meter, keywords, context } = fixture(), predicate = v.builtinFunction({ name: "test", invoke: () => v.false });
  context.truth = () => true;
  const filtered = createFilterBuiltin(v, meter, context).value.invoke([predicate, v.list([v.true])], keywords, meter, {
    call() { throw Error("explicit policy must win"); }, truth() { throw Error("explicit policy must win"); }, isStopIteration() { throw Error("explicit policy must win"); }
  });
  if (filtered.kind !== "iterator") throw Error("expected iterator"); expect(filtered.value.next().value).toBe(v.true);
});
it("validates arity and keywords before input acquisition and delays callability", () => {
  const { v, call, keywords } = fixture();
  for (const args of [[], [v.none], [v.none, v.none, v.none]]) expect(() => call(args)).toThrow(`filter expected 2 arguments, got ${args.length}`);
  keywords.items.set(v.string("function"), v.none);
  expect(() => call([])).toThrow("filter() takes no keyword arguments"); keywords.items.clear();
  expect(() => call([v.integer(1), v.none])).toThrow("'NoneType' object is not iterable");
  expect(call([v.integer(1), v.list([])]).next().done).toBe(true);
  expect(() => call([v.integer(1), v.list([v.false])]).next()).toThrow("'int' object is not callable");
});
it("recognizes only the explicitly supplied bool identity as a truth predicate", () => {
  const { v, call, context } = fixture();
  const bool = v.builtinFunction({ name: "bool", invoke() { throw new Error("must not call exact bool"); } });
  context.boolType = bool;
  expect(call([bool, v.list([v.false, v.true])]).next().value).toBe(v.true);
  let called = false;
  const other = v.builtinFunction({ name: "bool", invoke() { called = true; return v.true; } });
  expect(call([other, v.list([v.false])]).next().value).toBe(v.false); expect(called).toBe(true);
});
it("acquires a guest iterator eagerly but defers next and truth callbacks", () => {
  const { v, call, context } = fixture(), source = v.cell({}), events: string[] = [];
  context.iteration = { lookupIter: () => { events.push("iter"); return () => source; }, hasNext: () => true,
    next: () => { events.push("next"); return source; }, hasSequenceItem: () => false, getItem: () => v.none,
    isStopIteration: () => false, isIndexError: () => false, typeName: () => "Custom" };
  context.truth = value => { expect(value).toBe(source); events.push("truth"); return true; };
  const cursor = call([v.none, source]); expect(events).toEqual(["iter"]);
  expect(cursor.next().value).toBe(source); expect(events).toEqual(["iter", "next", "truth"]);
});
it("preserves predicate exhaustion payloads and continues with the next item", () => {
  const { v, call } = fixture(), error = new PythonRuntimeError("StopIteration", "predicate stop"); let calls = 0;
  const fn = v.builtinFunction({ name: "test", invoke() { if (++calls === 1) throw error; return v.true; } });
  const cursor = call([fn, v.list([v.true, v.false])]);
  expect(cursor.next()).toEqual({ done: true, value: undefined, exception: { value: error } });
  expect(cursor.next().value).toBe(v.false);
});
it("checks cancellation after guest truth before returning a source value", () => {
  const { v, keywords, context } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  context.truth = () => { cancelled = true; return true; };
  const result = createFilterBuiltin(v, meter, context).value.invoke([v.none, v.list([v.true])], keywords, meter);
  if (result.kind !== "iterator") throw new Error("expected iterator");
  expect(() => result.value.next()).toThrow(ExecutionLimitError);
});
