import { expect, it } from "vitest";
import { createIterBuiltin, createNextBuiltin } from "./builtin-iteration.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import type { IterationContext } from "./protocol-iterator.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const kwargs = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const source = v.cell({}), cursor = v.cell({}), events: string[] = [];
  const protocol: IterationContext<RuntimeValue> = {
    lookupIter(value) { expect(this).toBe(protocol); expect(value).toBe(source); events.push("iter"); return () => cursor; },
    hasNext(value) { expect(this).toBe(protocol); events.push("hasNext"); return value === cursor; },
    next(value) { expect(this).toBe(protocol); expect(value).toBe(cursor); events.push("next"); return v.true; },
    hasSequenceItem() { expect(this).toBe(protocol); events.push("sequence"); return true; },
    getItem(value, index) { expect(this).toBe(protocol); expect(value).toBe(source); events.push(String(index)); if (index === 2n) throw new PythonRuntimeError("IndexError", "end"); return v.integer(index); },
    typeName: () => "Custom",
    isStopIteration: error => error instanceof PythonRuntimeError && error.name === "StopIteration",
    isIndexError: error => error instanceof PythonRuntimeError && error.name === "IndexError"
  };
  const unused = (): never => { throw new Error("unexpected sentinel operation"); };
  const iter = (value: RuntimeValue) => createIterBuiltin(v, meter, { isCallable: unused, call: unused, equal: unused, isStopIteration: unused }, protocol).value.invoke([value], kwargs, meter);
  const next = (...args: RuntimeValue[]) => createNextBuiltin(v, meter, protocol).value.invoke(args, kwargs, meter);
  return { v, meter, kwargs, source, cursor, protocol, events, iter, next };
}

it("returns the guest iter result itself without invoking next or a second iter", () => {
  const { iter, next, source, cursor, events, v } = fixture();
  expect(iter(source)).toBe(cursor); expect(events).toEqual(["iter", "hasNext"]);
  expect(next(cursor)).toBe(v.true); expect(events).toEqual(["iter", "hasNext", "hasNext", "next"]);
});
it("rejects invalid iter results without sequence fallback", () => {
  const { iter, source, protocol, v, events } = fixture();
  protocol.lookupIter = () => () => v.none;
  expect(() => iter(source)).toThrow("iter() returned non-iterator of type 'Custom'");
  expect(events).toEqual(["hasNext"]);
});
it("does not fall back when iter lookup or invocation fails", () => {
  const { iter, source, protocol, events } = fixture(), failure = new PythonRuntimeError("TypeError", "iteration disabled");
  protocol.lookupIter = () => { throw failure; }; expect(() => iter(source)).toThrow(failure);
  protocol.lookupIter = () => () => { throw failure; }; expect(() => iter(source)).toThrow(failure);
  expect(events).toEqual([]);
});
it("wraps indexed fallback once and latches exhaustion", () => {
  const { iter, next, source, protocol, events, v } = fixture(); protocol.lookupIter = () => undefined;
  const result = iter(source); expect(events).toEqual(["sequence"]);
  expect(next(result)).toEqual(v.integer(0)); expect(next(result)).toEqual(v.integer(1));
  expect(next(result, v.none)).toBe(v.none); expect(next(result, v.none)).toBe(v.none);
  expect(events).toEqual(["sequence", "0", "1", "2"]);
});
it("checks next without requiring iter and preserves exact exception payloads", () => {
  const { next, cursor, protocol, v } = fixture(), failure = new PythonRuntimeError("StopIteration", "guest payload");
  protocol.lookupIter = () => { throw new Error("must not lookup iter"); };
  protocol.next = () => { throw failure; };
  expect(() => next(cursor)).toThrow(failure); expect(next(cursor, v.false)).toBe(v.false);
  protocol.next = () => v.true; expect(next(cursor)).toBe(v.true);
  protocol.next = () => { throw new PythonRuntimeError("IndexError", "not exhaustion"); };
  expect(() => next(cursor, v.none)).toThrow("not exhaustion");
});
it("recognizes configured guest StopIteration subclasses without swallowing other errors", () => {
  const { next, cursor, protocol, v } = fixture(), stop = new Error("guest stop");
  protocol.isStopIteration = error => error === stop; protocol.next = () => { throw stop; };
  expect(next(cursor, v.none)).toBe(v.none); expect(() => next(cursor)).toThrow(stop);
});
it("rejects missing protocols and keeps exact builtin fast paths", () => {
  const { iter, next, source, protocol, events, v } = fixture();
  protocol.lookupIter = () => undefined; protocol.hasSequenceItem = () => false;
  expect(() => iter(source)).toThrow("'Custom' object is not iterable");
  expect(() => next(source)).toThrow("'Custom' object is not an iterator"); events.length = 0;
  expect(next(iter(v.list([v.true])))).toBe(v.true); expect(events).toEqual([]);
});
it("checks cancellation after guest next and exception classification", () => {
  const { cursor, protocol, v, kwargs } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const builtin = createNextBuiltin(v, meter, protocol);
  protocol.next = () => { cancelled = true; return v.true; };
  expect(() => builtin.value.invoke([cursor], kwargs, meter)).toThrow(ExecutionLimitError);
  cancelled = false; protocol.next = () => { throw new Error("stop"); };
  protocol.isStopIteration = () => { cancelled = true; return true; };
  expect(() => builtin.value.invoke([cursor, v.none], kwargs, meter)).toThrow(ExecutionLimitError);
});
