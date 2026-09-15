import { expect, it } from "vitest";
import { createIterBuiltin, createNextBuiltin } from "./builtin-iteration.js";
import { CallableIterator } from "./callable-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const kwargs = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const next = (source: RuntimeValue, fallback?: RuntimeValue) => createNextBuiltin(v, meter).value.invoke(fallback === undefined ? [source] : [source, fallback], kwargs, meter);
  const explicit = (source: RuntimeValue) => {
    const method = runtimeNativeAttribute(source, "__next__", v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke([], kwargs, meter);
  };
  return { meter, v, kwargs, next, explicit };
}
it("preserves sentinel equality StopIteration identity for both explicit next forms", () => {
  const { v, meter, kwargs, next, explicit } = fixture(), failure = new PythonRuntimeError("StopIteration", "comparison payload");
  const context = { isCallable: () => true, call: () => v.true, equal: () => { throw failure; }, isStopIteration: (error: unknown) => error === failure };
  const cursor = createIterBuiltin(v, meter, context).value.invoke([v.cell({}), v.none], kwargs, meter);
  for (const call of [next, explicit]) {
    let caught: unknown; try { call(cursor); } catch (error) { caught = error; } expect(caught).toBe(failure);
  }
  expect(next(cursor, v.false)).toBe(v.false);
});
it("retains arbitrary guest exhaustion objects without latching a protocol iterator", () => {
  const { v, meter, next, explicit } = fixture(), failure = { kind: "GuestStop" }, source = v.cell({}); let calls = 0;
  const context: IterationContext<RuntimeValue> = {
    lookupIter: () => () => source, hasNext: () => true,
    next: () => { if (++calls < 4) throw failure; return v.true; },
    hasSequenceItem: () => false, getItem: () => v.none,
    isStopIteration: error => error === failure, isIndexError: () => false, typeName: () => "Custom"
  };
  const cursor = v.iterator(new ProtocolIterator(source, context, meter));
  for (const call of [next, explicit]) {
    let caught: unknown; try { call(cursor); } catch (error) { caught = error; } expect(caught).toBe(failure);
  }
  expect(next(cursor, v.none)).toBe(v.none); expect(next(cursor)).toBe(v.true);
});
it("host consumers still see ordinary exhaustion from guest equality faults", () => {
  const { meter } = fixture(), failure = new Error("stop"); let calls = 0;
  const cursor = new CallableIterator(1, 2, { isCallable: () => true, call: () => ++calls,
    equal: () => { throw failure; }, isStopIteration: error => error === failure }, meter);
  expect([...cursor]).toEqual([]); expect([...cursor]).toEqual([]); expect(calls).toBe(2);
});
it("callable StopIteration discards its payload and permanently exhausts", () => {
  const { v, meter, next } = fixture(), failure = new PythonRuntimeError("StopIteration", "discarded"); let calls = 0;
  const cursor = v.iterator(new CallableIterator(v.none, v.none, { isCallable: () => true,
    call() { calls++; throw failure; }, equal: () => false, isStopIteration: error => error === failure }, meter));
  for (let i = 0; i < 2; i++) expect(() => next(cursor)).toThrow(expect.objectContaining({ name: "StopIteration", message: "" }));
  expect(calls).toBe(1);
});
it("checks cancellation after sentinel exception classification", () => {
  let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  for (const equality of [true, false]) {
    cancelled = false;
    const cursor = new CallableIterator(1, 2, { isCallable: () => true,
      call: () => { if (!equality) throw new Error("stop"); return 3; },
      equal: () => { throw new Error("stop"); }, isStopIteration: () => { cancelled = true; return true; } }, meter);
    expect(() => cursor.next()).toThrow(ExecutionLimitError);
  }
});
