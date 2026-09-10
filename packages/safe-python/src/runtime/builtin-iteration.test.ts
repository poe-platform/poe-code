import { expect, it } from "vitest";
import { createIterBuiltin, createNextBuiltin } from "./builtin-iteration.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import type { IterationContext } from "./protocol-iterator.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const context = {
    isCallable: (value: RuntimeValue) => value.kind === "builtin_function_or_method",
    call(value: RuntimeValue) { if (value.kind !== "builtin_function_or_method") throw new Error("not callable"); return value.value.invoke([], keywords, meter); },
    equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value,
    isStopIteration: (error: unknown) => error instanceof PythonRuntimeError && error.name === "StopIteration"
  };
  const iter = (...args: RuntimeValue[]) => createIterBuiltin(v, meter, context).value.invoke(args, keywords, meter);
  const next = (...args: RuntimeValue[]) => createNextBuiltin(v, meter).value.invoke(args, keywords, meter);
  return { meter, v, keywords, context, iter, next };
}

it("iter returns iterator identity and next delivers values and exact defaults", () => {
  const { v, iter, next } = fixture(), source = v.list([v.true]), cursor = iter(source), fallback = v.list([]);
  expect(iter(cursor) === cursor).toBe(true);
  expect(next(cursor, fallback)).toBe(v.true);
  expect(next(cursor, fallback)).toBe(fallback);
  expect(() => next(cursor)).toThrow(expect.objectContaining({ name: "StopIteration", message: "" }));
  source.items.append(v.false); expect(next(cursor, v.none)).toBe(v.none);
});
it("checks arity and keywords before receiver protocols", () => {
  const { v, iter, next, keywords } = fixture();
  for (const [name, fn] of [["iter", iter], ["next", next]] as const) {
    expect(() => fn()).toThrow(`${name} expected at least 1 argument, got 0`);
    expect(() => fn(v.none, v.none, v.none)).toThrow(`${name} expected at most 2 arguments, got 3`);
    keywords.items.set(v.string("x"), v.none);
    expect(() => fn()).toThrow(`${name}() takes no keyword arguments`); keywords.items.clear();
  }
  expect(() => iter(v.none)).toThrow("'NoneType' object is not iterable");
  expect(() => iter(v.integer(1), v.none)).toThrow("iter(v, w): v must be callable");
  expect(() => next(v.list([]), v.none)).toThrow("'list' object is not an iterator");
});
it("sentinel iteration is lazy and stays exhausted without extra calls", () => {
  const { v, iter, next } = fixture(); let calls = 0;
  const fn = v.builtinFunction({ name: "counter", invoke: () => v.integer(++calls) });
  const cursor = iter(fn, v.integer(2)); expect(calls).toBe(0);
  expect(next(cursor)).toEqual(v.integer(1));
  expect(next(cursor, v.none)).toBe(v.none);
  expect(next(cursor, v.none)).toBe(v.none); expect(calls).toBe(2);
});
it("compares sentinel first and skips equality for identical values", () => {
  const { v, iter, next, context } = fixture(), sentinel = v.list([]), item = v.list([]), seen: RuntimeValue[] = [];
  context.equal = (a, b) => { seen.push(a, b); return false; };
  const cursor = iter(v.builtinFunction({ name: "read", invoke: () => item }), sentinel);
  expect(next(cursor)).toBe(item); expect(seen).toEqual([sentinel, item]);
  context.equal = () => { throw new Error("must skip identity match"); };
  expect(next(iter(v.builtinFunction({ name: "same", invoke: () => sentinel }), sentinel), v.none)).toBe(v.none);
});
it("call errors are retryable but callable StopIteration permanently exhausts", () => {
  const { v, iter, next } = fixture(); let calls = 0;
  const cursor = iter(v.builtinFunction({ name: "read", invoke() {
    calls++; if (calls === 1) throw new PythonRuntimeError("ValueError", "retry");
    if (calls === 3) throw new PythonRuntimeError("StopIteration", "discarded");
    return v.true;
  } }), v.none);
  expect(() => next(cursor, v.none)).toThrow("retry"); expect(next(cursor)).toBe(v.true);
  expect(next(cursor, v.false)).toBe(v.false); expect(next(cursor, v.false)).toBe(v.false); expect(calls).toBe(3);
});
it("equality StopIteration does not exhaust the callable iterator", () => {
  const { v, iter, next, context } = fixture(); let comparisons = 0;
  context.equal = () => { if (++comparisons === 1) throw new PythonRuntimeError("StopIteration", "comparison"); return false; };
  const cursor = iter(v.builtinFunction({ name: "read", invoke: () => v.true }), v.none);
  expect(() => next(cursor)).toThrow(expect.objectContaining({ name: "StopIteration" })); expect(next(cursor)).toBe(v.true);
});
it("next translates raised StopIteration only when a default was supplied", () => {
  const { v, next } = fixture(), error = new PythonRuntimeError("StopIteration", "payload");
  const cursor = v.iterator({ next() { throw error; } });
  expect(next(cursor, v.none)).toBe(v.none); expect(() => next(cursor)).toThrow(error);
});
it("honors post-callback cancellation instead of delivering a result", () => {
  const { v, keywords, context } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const fn = createIterBuiltin(v, meter, context);
  const cursor = fn.value.invoke([v.builtinFunction({ name: "read", invoke() { cancelled = true; return v.true; } }), v.none], keywords, meter);
  expect(() => createNextBuiltin(v, meter).value.invoke([cursor], keywords, meter)).toThrow(ExecutionLimitError);
});
it("retains explicit iter and next protocols over invocation defaults", () => {
  const { v, meter, keywords, context } = fixture(), source = v.cell({}), cursor = v.cell({}), member = v.cell({});
  const unused = (): never => { throw Error("explicit protocol must win"); };
  const protocol: IterationContext<RuntimeValue> = {
    lookupIter(value) { expect(value).toBe(source); return () => cursor; }, hasNext: value => value === cursor,
    next(value) { expect(value).toBe(cursor); return member; }, hasSequenceItem: () => false, getItem: unused,
    isStopIteration: () => false, isIndexError: () => false, typeName: () => "Guest"
  };
  const invocation = { call: unused, isStopIteration: unused, iteration: { ...protocol, lookupIter: unused, hasNext: unused, next: unused } };
  expect(createIterBuiltin(v, meter, context, protocol).value.invoke([source], keywords, meter, invocation)).toBe(cursor);
  expect(createNextBuiltin(v, meter, protocol).value.invoke([cursor], keywords, meter, invocation)).toBe(member);
});
it("preserves guest next exception identity and only classifies exhaustion with a default", () => {
  const { v, meter, keywords } = fixture(), cursor = v.cell({}), fallback = v.cell({}), stop = Error("guest StopIteration"), fault = Error("guest failure");
  let failure = stop, classifications = 0;
  const unused = (): never => { throw Error("unexpected callback"); };
  const protocol: IterationContext<RuntimeValue> = {
    lookupIter: unused, hasNext: value => value === cursor, next() { throw failure; }, hasSequenceItem: () => false, getItem: unused,
    isStopIteration(error) { classifications++; return error === stop; }, isIndexError: () => false, typeName: () => "Guest"
  };
  const invocation = { call: unused, isStopIteration: unused, iteration: protocol }, builtin = createNextBuiltin(v, meter);
  expect(() => builtin.value.invoke([cursor], keywords, meter, invocation)).toThrow(stop); expect(classifications).toBe(0);
  expect(builtin.value.invoke([cursor, fallback], keywords, meter, invocation)).toBe(fallback); expect(classifications).toBe(1);
  failure = fault;
  expect(() => builtin.value.invoke([cursor, fallback], keywords, meter, invocation)).toThrow(fault); expect(classifications).toBe(2);
});
