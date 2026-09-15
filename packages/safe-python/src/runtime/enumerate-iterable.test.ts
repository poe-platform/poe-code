import { describe, expect, it } from "vitest";
import { enumerateIterable, type EnumerateIterableContext } from "./enumerate-iterable.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

class Stop extends Error {}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: EnumerateIterableContext<unknown, readonly [bigint, unknown]> = {
  lookupIter: value => () => (value as unknown[])[Symbol.iterator](), hasNext: () => true,
  next: value => { const item = (value as Iterator<unknown>).next(); if (item.done) throw new Stop(); return item.value; },
  hasSequenceItem: () => false, getItem: () => { throw new Error("unexpected item"); },
  isStopIteration: error => error instanceof Stop, isIndexError: () => false, typeName: () => "Source",
  index: value => BigInt(value as number), pair: (index, value) => [index, value]
};

describe("guest enumerate construction", () => {
  it("defaults start without converting a guest value", () => {
    const iterator = enumerateIterable([["a"]], new Map(), { ...context, index: () => { throw new Error("unexpected index"); } }, budget());
    expect([...iterator]).toEqual([[0n, "a"]]);
  });
  it.each([false, true])("accepts both keyword orders (start first: %s)", reverse => {
    const keywords = new Map<string, unknown>(reverse ? [["start", -4n], ["iterable", [1, 2]]] : [["iterable", [1, 2]], ["start", -4n]]);
    expect([...enumerateIterable([], keywords, context, budget())]).toEqual([[-4n, 1], [-3n, 2]]);
  });
  it("converts start before acquiring the iterator and never pulls at construction", () => {
    const events: string[] = [];
    const iterator = enumerateIterable([[1]], new Map([["start", 1n << 100n]]), { ...context,
      index: value => { events.push("index"); return value as bigint; },
      lookupIter: value => () => { events.push("iter"); return (value as unknown[])[Symbol.iterator](); }
    }, budget());
    expect(events).toEqual(["index", "iter"]); expect(iterator.next().value).toEqual([1n << 100n, 1]);
  });
  it("stops before iterator lookup if index conversion fails", () => {
    const failure = new Error("index failed");
    expect(() => enumerateIterable([[], null], new Map(), { ...context,
      index: () => { throw failure; }, lookupIter: () => { throw new Error("unexpected lookup"); }
    }, budget())).toThrow(failure);
  });
  it.each([
    { args: [], keys: [], message: "enumerate() missing required argument 'iterable'" },
    { args: [], keys: ["start"], message: "'start' is an invalid keyword argument for enumerate()" },
    { args: [[]], keys: ["iterable"], message: "'iterable' is an invalid keyword argument for enumerate()" },
    { args: [[], 0, 1], keys: [], message: "enumerate() takes at most 2 arguments (3 given)" },
    { args: [], keys: ["x", "y", "z"], message: "enumerate() missing required argument 'iterable'" },
    { args: [], keys: ["start", "x"], message: "'x' is an invalid keyword argument for enumerate()" }
  ])("preserves argument error precedence: $message", ({ args, keys, message }) => {
    expect(() => enumerateIterable(args, new Map(keys.map(key => [key, null])), context, budget()))
      .toThrow(expect.objectContaining({ name: "TypeError", message }));
  });
  it("checks cancellation after index conversion before iterator acquisition", () => {
    let cancelled = false;
    expect(() => enumerateIterable([[], 1], new Map(), { ...context,
      index: () => { cancelled = true; return 1n; }, lookupIter: () => { throw new Error("unexpected lookup"); }
    }, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
