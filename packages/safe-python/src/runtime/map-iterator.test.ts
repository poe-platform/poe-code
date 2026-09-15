import { describe, expect, it } from "vitest";
import { MapIterator, type MapIterationContext } from "./map-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

class Stop extends Error {}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const items = (...values: unknown[]) => values[Symbol.iterator]();
const context: MapIterationContext<unknown> = {
  call: (fn, args) => (fn as (...args: unknown[]) => unknown)(...args),
  isStopIteration: error => error instanceof Stop
};

describe("map iteration", () => {
  it("calls the function lazily once for each complete row", () => {
    const calls: unknown[][] = [];
    const iterator = new MapIterator((...args: unknown[]) => { calls.push(args); return args.join(":"); }, [items(1, 2), items(3, 4)], false, context, budget());
    expect(calls).toEqual([]); expect(iterator[Symbol.iterator]()).toBe(iterator);
    expect([...iterator]).toEqual(["1:3", "2:4"]); expect(calls).toEqual([[1, 3], [2, 4]]);
  });
  it("requires at least one input iterator", () => {
    expect(() => new MapIterator(null, [], false, context, budget())).toThrow(expect.objectContaining({ name: "TypeError", message: "map() must have at least two arguments." }));
  });
  it("does not test callability until a complete row exists", () => {
    const failure = new PythonRuntimeError("TypeError", "not callable"), ctx = { ...context, call: () => { throw failure; } };
    expect([...new MapIterator(null, [items()], false, ctx, budget())]).toEqual([]);
    expect(() => new MapIterator(null, [items(1)], false, ctx, budget()).next()).toThrow(failure);
  });
  it.each([
    [[items(1), items()], "map() argument 2 is shorter than argument 1"],
    [[items(1), items(2), items()], "map() argument 3 is shorter than arguments 1-2"],
    [[items(), items(1)], "map() argument 2 is longer than argument 1"],
    [[items(), items(), items(1)], "map() argument 3 is longer than arguments 1-2"]
  ] as const)("uses map-specific strict mismatch errors", (sources, message) => {
    expect(() => new MapIterator(() => { throw new Error("unexpected callback"); }, sources, true, context, budget()).next())
      .toThrow(expect.objectContaining({ name: "ValueError", message }));
  });
  it("does not latch exhaustion when the mapping function raises StopIteration", () => {
    let calls = 0;
    const iterator = new MapIterator((value: unknown) => { if (++calls === 1) throw new Stop(); return value; }, [items(1, 2)], true, context, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next()).toEqual({ done: false, value: 2 });
  });
  it("propagates function errors after consuming the entire input row", () => {
    const failure = new Error("call failed"), left = items(1, 2), right = items(3, 4);
    const iterator = new MapIterator(() => { throw failure; }, [left, right], false, context, budget());
    expect(() => iterator.next()).toThrow(failure); expect(left.next().value).toBe(2); expect(right.next().value).toBe(4);
  });
  it("preserves undefined mapping results as values", () => {
    const iterator = new MapIterator(() => undefined, [items(1)], false, context, budget());
    expect(iterator.next()).toEqual({ done: false, value: undefined });
  });
  it("keeps guest context binding when invoking the mapper", () => {
    const ctx = { ...context, value: 7, call() { return this.value; } };
    expect(new MapIterator(null, [items(1)], false, ctx, budget()).next().value).toBe(7);
  });
  it("does not reinterpret fatal budget failures as exhaustion", () => {
    let reject = false;
    const iterator = new MapIterator(() => { reject = true; return 1; }, [items(1)], false, context, {
      checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); }
    });
    expect(() => iterator.next()).toThrow(ExecutionLimitError);
  });
});
