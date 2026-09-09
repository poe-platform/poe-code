import { describe, expect, it } from "vitest";
import { mapIterables, type MapIterableContext } from "./map-iterables.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

class Stop extends Error {}
interface Source { values: unknown[]; index: number; id: number }
const source = (id: number, ...values: unknown[]): Source => ({ id, values, index: 0 });
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: MapIterableContext<unknown> = {
  lookupIter: value => () => value, hasNext: () => true,
  next: value => { const item = value as Source; if (item.index === item.values.length) throw new Stop(); return item.values[item.index++]; },
  hasSequenceItem: () => false, getItem: () => { throw new Error("unexpected item"); },
  isStopIteration: error => error instanceof Stop, isIndexError: () => false, typeName: () => "Source",
  truth: value => Boolean(value), call: (fn, args) => (fn as (...args: unknown[]) => unknown)(...args)
};

describe("guest map construction", () => {
  it("binds strict before acquiring inputs and calls the mapper only on next", () => {
    const events: unknown[] = [], first = source(0, 1), second = source(1, 2);
    const iterator = mapIterables([(a: unknown, b: unknown) => { events.push("call"); return Number(a) + Number(b); }, first, second], new Map([["strict", true]]), {
      ...context, truth: () => { events.push("truth"); return true; },
      lookupIter: value => () => { events.push((value as Source).id); return value; }
    }, budget());
    expect(events).toEqual(["truth", 0, 1]); expect(first.index).toBe(0); expect(second.index).toBe(0);
    expect(iterator.next().value).toBe(3); expect(events).toEqual(["truth", 0, 1, "call"]);
  });
  it.each([0, 1])("converts strict before rejecting %s positional arguments", count => {
    let converted = false;
    expect(() => mapIterables(Array(count).fill(null), new Map([["strict", true]]), { ...context, truth: () => { converted = true; return true; } }, budget()))
      .toThrow(expect.objectContaining({ name: "TypeError", message: "map() must have at least two arguments." }));
    expect(converted).toBe(true);
  });
  it("rejects bad keywords before checking positional arity", () => {
    expect(() => mapIterables([], new Map([["stric", true]]), context, budget())).toThrow(expect.objectContaining({
      message: "map() got an unexpected keyword argument 'stric'. Did you mean 'strict'?"
    }));
    expect(() => mapIterables([], new Map([["strict", true], ["x", true]]), context, budget())).toThrow(expect.objectContaining({
      message: "map() takes at most 1 keyword argument (2 given)"
    }));
  });
  it("stops iterator creation at its first error without calling the mapper", () => {
    const events: number[] = [], failure = new Error("iter failed");
    expect(() => mapIterables([() => { throw new Error("unexpected call"); }, source(0), source(1), source(2)], new Map(), {
      ...context, lookupIter: value => () => { const item = value as Source; events.push(item.id); if (item.id === 1) throw failure; return value; }
    }, budget())).toThrow(failure); expect(events).toEqual([0, 1]);
  });
  it("permits a non-callable mapper until a complete input row is available", () => {
    const failure = new PythonRuntimeError("TypeError", "not callable"), ctx = { ...context, call: () => { throw failure; } };
    expect(mapIterables([null, source(0)], new Map(), ctx, budget()).next().done).toBe(true);
    expect(() => mapIterables([null, source(0, 1)], new Map(), ctx, budget()).next()).toThrow(failure);
  });
  it("connects strict mismatch detection to guest input iterators", () => {
    const iterator = mapIterables([(...args: unknown[]) => args, source(0, 1, 2), source(1, 3)], new Map([["strict", true]]), context, budget());
    expect(iterator.next().value).toEqual([1, 3]); expect(() => iterator.next()).toThrow("map() argument 2 is shorter than argument 1");
  });
  it("checks limits after strict conversion before validating arity", () => {
    let reject = false;
    expect(() => mapIterables([], new Map([["strict", true]]), { ...context, truth: () => { reject = true; return true; } }, {
      checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); }
    })).toThrow(ExecutionLimitError);
  });
});
