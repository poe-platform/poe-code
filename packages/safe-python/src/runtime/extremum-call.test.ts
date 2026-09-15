import { describe, expect, it } from "vitest";
import { extremumCall, type ExtremumCallContext } from "./extremum-call.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

class Stop extends Error {}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: ExtremumCallContext<unknown> = {
  lookupIter: value => () => (value as unknown[])[Symbol.iterator](), hasNext: () => true,
  next: value => { const item = (value as Iterator<unknown>).next(); if (item.done) throw new Stop(); return item.value; },
  hasSequenceItem: () => false, getItem: () => { throw new Error("unexpected getitem"); },
  isStopIteration: error => error instanceof Stop, isIndexError: () => false, typeName: () => "Object",
  isNone: value => value === null, callKey: (key, value) => (key as (value: unknown) => unknown)(value),
  compare: (op, a, b) => op === "min" ? Number(a) < Number(b) : Number(a) > Number(b)
};

describe("guest min/max calls", () => {
  it.each(["min", "max"] as const)("supports iterable and positional %s forms", operation => {
    const expected = operation === "min" ? 1 : 7;
    expect(extremumCall(operation, [[4, 1, 7]], new Map(), context, budget())).toBe(expected);
    expect(extremumCall(operation, [4, 1, 7], new Map(), { ...context, lookupIter: () => { throw new Error("unexpected iteration"); } }, budget())).toBe(expected);
  });
  it("acquires an iterable before key calls and retains original items", () => {
    const events: string[] = [], a = { key: 2 }, b = { key: 1 };
    expect(extremumCall("min", [[a, b]], new Map([["key", (value: unknown) => { events.push("key"); return (value as typeof a).key; }]]), {
      ...context, lookupIter: value => () => { events.push("iter"); return (value as unknown[])[Symbol.iterator](); }
    }, budget())).toBe(b); expect(events).toEqual(["iter", "key", "key"]);
  });
  it("uses None key as identity and returns an explicit undefined default", () => {
    expect(extremumCall("min", [[2, 1]], new Map([["key", null]]), context, budget())).toBe(1);
    expect(extremumCall("max", [[]], new Map([["default", undefined]]), context, budget())).toBeUndefined();
  });
  it("does not call an invalid key on an empty source", () => {
    const failure = new PythonRuntimeError("TypeError", "not callable"), ctx = { ...context, callKey: () => { throw failure; } };
    expect(extremumCall("min", [[]], new Map([["key", 0], ["default", 9]]), ctx, budget())).toBe(9);
    expect(() => extremumCall("min", [[1]], new Map([["key", 0]]), ctx, budget())).toThrow(failure);
  });
  it("rejects absent positional arguments before keywords", () => {
    expect(() => extremumCall("min", [], new Map([["x", 1]]), context, budget())).toThrow("min expected at least 1 argument, got 0");
  });
  it("rejects keyword count before unknown names", () => {
    expect(() => extremumCall("max", [[]], new Map([["x", 1], ["key", null], ["default", 9]]), context, budget())).toThrow("max() takes at most 2 keyword arguments (3 given)");
  });
  it("suggests misspelled keys before default/positional conflicts", () => {
    expect(() => extremumCall("min", [1, 2], new Map([["ke", 1], ["default", 9]]), context, budget()))
      .toThrow("min() got an unexpected keyword argument 'ke'. Did you mean 'key'?");
  });
  it.each(["min", "max"] as const)("rejects a default with multiple %s arguments", operation => {
    expect(() => extremumCall(operation, [1, 2], new Map([["default", null]]), context, budget()))
      .toThrow(`Cannot specify a default for ${operation}() with multiple positional arguments`);
  });
  it("checks cancellation after iterator acquisition before key calls", () => {
    let cancelled = false;
    expect(() => extremumCall("min", [[1]], new Map(), { ...context,
      lookupIter: () => () => { cancelled = true; return {}; }
    }, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
