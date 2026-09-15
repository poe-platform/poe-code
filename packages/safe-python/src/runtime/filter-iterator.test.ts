import { describe, expect, it } from "vitest";
import { FilterIterator, type FilterIterationContext } from "./filter-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

class Stop extends Error {}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const items = (...values: unknown[]) => values[Symbol.iterator]();
const context: FilterIterationContext<unknown> = {
  isTruthPredicate: fn => fn === null || fn === Boolean,
  call: (fn, value) => (fn as (value: unknown) => unknown)(value),
  truth: value => Boolean(value), isStopIteration: error => error instanceof Stop
};

describe("filter iteration", () => {
  it("calls lazily and returns the original accepted element", () => {
    const first = {}, second = {}, calls: unknown[] = [];
    const iterator = new FilterIterator((value: unknown) => { calls.push(value); return value === second; }, items(first, second), context, budget());
    expect(calls).toEqual([]); expect(iterator[Symbol.iterator]()).toBe(iterator);
    expect(iterator.next().value).toBe(second); expect(calls).toEqual([first, second]); expect(iterator.next().done).toBe(true);
  });
  it.each([null, Boolean])("uses direct truth for None and exact bool", predicate => {
    const iterator = new FilterIterator(predicate, items(0, 1, "", "yes"), { ...context,
      call: () => { throw new Error("unexpected predicate call"); }
    }, budget());
    expect([...iterator]).toEqual([1, "yes"]);
  });
  it("truth-tests predicate results instead of returning them", () => {
    const token = {}, seen: unknown[] = [];
    const iterator = new FilterIterator(() => token, items(9), { ...context, truth: value => { seen.push(value); return true; } }, budget());
    expect(iterator.next().value).toBe(9); expect(seen).toEqual([token]);
  });
  it("does not validate predicate callability for empty inputs", () => {
    const failure = new PythonRuntimeError("TypeError", "not callable"), ctx = { ...context, call: () => { throw failure; } };
    expect(new FilterIterator(0, items(), ctx, budget()).next().done).toBe(true);
    expect(() => new FilterIterator(0, items(1), ctx, budget()).next()).toThrow(failure);
  });
  it.each(["predicate", "truth"] as const)("can resume after StopIteration in %s", phase => {
    let calls = 0;
    const iterator = new FilterIterator((value: unknown) => { if (phase === "predicate" && ++calls === 1) throw new Stop(); return value; }, items(1, 2), {
      ...context, truth: () => { if (phase === "truth" && ++calls === 1) throw new Stop(); return true; }
    }, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next()).toEqual({ done: false, value: 2 });
  });
  it("can resume when a custom source resumes after done", () => {
    let calls = 0;
    const iterator = new FilterIterator(null, { next: () => ++calls === 1 ? { done: true, value: undefined } : { done: false, value: calls } }, context, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next().value).toBe(2);
  });
  it("propagates errors after consuming the failed element", () => {
    const failure = new Error("predicate failed"), source = items(1, 2);
    expect(() => new FilterIterator(() => { throw failure; }, source, context, budget()).next()).toThrow(failure);
    expect(source.next().value).toBe(2);
  });
  it("can return undefined when the guest predicate accepts it", () => {
    expect(new FilterIterator(() => true, items(undefined), context, budget()).next()).toEqual({ done: false, value: undefined });
  });
  it("bounds infinite rejection loops", () => {
    const iterator = new FilterIterator(null, { next: () => ({ done: false, value: 0 }) }, context,
      new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }));
    expect(() => iterator.next()).toThrow(ExecutionLimitError);
  });
  it("checks limits after predicate calls before truth conversion", () => {
    let reject = false, truthCalls = 0;
    const iterator = new FilterIterator(() => { reject = true; return true; }, items(1), {
      ...context, truth: () => { truthCalls++; return true; }
    }, { checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); } });
    expect(() => iterator.next()).toThrow(ExecutionLimitError); expect(truthCalls).toBe(0);
  });
});
