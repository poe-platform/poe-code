import { describe, expect, it } from "vitest";
import { filterIterable, type FilterIterableContext } from "./filter-iterable.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

class Stop extends Error {}
class IndexEnd extends Error {}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: FilterIterableContext<unknown> = {
  lookupIter: value => () => (value as unknown[])[Symbol.iterator](), hasNext: () => true,
  next: value => { const item = (value as Iterator<unknown>).next(); if (item.done) throw new Stop(); return item.value; },
  hasSequenceItem: () => false, getItem: () => { throw new Error("unexpected item"); },
  isStopIteration: error => error instanceof Stop, isIndexError: error => error instanceof IndexEnd, typeName: () => "Source",
  isTruthPredicate: value => value === null || value === Boolean,
  truth: value => Boolean(value), call: (fn, value) => (fn as (value: unknown) => unknown)(value)
};

describe("guest filter construction", () => {
  it.each([0, 1, 3, 4])("rejects %s positional arguments before inspecting inputs", count => {
    expect(() => filterIterable(Array(count).fill(null), new Map(), {
      ...context, lookupIter: () => { throw new Error("unexpected lookup"); }
    }, budget())).toThrow(expect.objectContaining({ name: "TypeError", message: `filter expected 2 arguments, got ${count}` }));
  });
  it.each([0, 2, 3])("rejects keywords before checking %s arguments", count => {
    expect(() => filterIterable(Array(count).fill(null), new Map([["function", null], ["iterable", []]]), context, budget()))
      .toThrow(expect.objectContaining({ name: "TypeError", message: "filter() takes no keyword arguments" }));
  });
  it("acquires the iterator eagerly but consumes and calls lazily", () => {
    const events: string[] = [];
    const iterator = filterIterable([(value: unknown) => { events.push("call"); return value; }, [0, 2]], new Map(), {
      ...context, lookupIter: value => () => { events.push("iter"); return (value as unknown[])[Symbol.iterator](); },
      next(value) { events.push("next"); return context.next(value); }
    }, budget());
    expect(events).toEqual(["iter"]);
    expect(iterator.next()).toEqual({ done: false, value: 2 });
    expect(events).toEqual(["iter", "next", "call", "next", "call"]);
  });
  it("propagates iterator initialization failure without testing the predicate", () => {
    const failure = new Error("iter failed");
    expect(() => filterIterable([0, []], new Map(), { ...context,
      lookupIter: () => () => { throw failure; },
      isTruthPredicate: () => { throw new Error("unexpected inspection"); }
    }, budget())).toThrow(failure);
  });
  it("supports legacy indexed iteration and direct None truth", () => {
    const indices: bigint[] = [];
    const iterator = filterIterable([null, [0, 3]], new Map(), { ...context,
      lookupIter: () => undefined, hasSequenceItem: () => true,
      getItem: (value, index) => { indices.push(index); if (index === 2n) throw new IndexEnd(); return (value as unknown[])[Number(index)]; }
    }, budget());
    expect([...iterator]).toEqual([3]); expect(indices).toEqual([0n, 1n, 2n]);
  });
  it("delays invalid predicate errors until an item is available", () => {
    const failure = new PythonRuntimeError("TypeError", "not callable"), ctx = { ...context, call: () => { throw failure; } };
    expect(filterIterable([0, []], new Map(), ctx, budget()).next().done).toBe(true);
    expect(() => filterIterable([0, [1]], new Map(), ctx, budget()).next()).toThrow(failure);
  });
  it("checks cancellation after iter before inspecting the predicate", () => {
    let reject = false;
    expect(() => filterIterable([null, []], new Map(), { ...context,
      lookupIter: () => () => { reject = true; return {}; },
      isTruthPredicate: () => { throw new Error("unexpected inspection"); }
    }, { checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
