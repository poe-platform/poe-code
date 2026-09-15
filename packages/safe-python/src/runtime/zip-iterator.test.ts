import { describe, expect, it } from "vitest";
import { ZipIterator } from "./zip-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const tuple = <Value>(values: readonly Value[]) => values;
const items = (...values: number[]) => values[Symbol.iterator]();

describe("zip iteration", () => {
  it("yields ordered independent rows and stops at the shortest source", () => {
    const iterator = new ZipIterator([items(1, 2, 3), items(4, 5)], false, tuple, budget());
    expect(iterator[Symbol.iterator]()).toBe(iterator); expect([...iterator]).toEqual([[1, 4], [2, 5]]);
  });
  it("exhausts immediately for zero inputs without constructing a tuple", () => {
    const iterator = new ZipIterator([], true, () => { throw new Error("unexpected tuple"); }, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next().done).toBe(true);
  });
  it("captures the input iterator slots at construction", () => {
    const sources = [items(1)], iterator = new ZipIterator(sources, false, tuple, budget());
    sources[0] = items(9); sources.push(items(8)); expect([...iterator]).toEqual([[1]]);
  });
  it.each([
    [[items(1), items()], "zip() argument 2 is shorter than argument 1"],
    [[items(1), items(2), items()], "zip() argument 3 is shorter than arguments 1-2"],
    [[items(), items(1)], "zip() argument 2 is longer than argument 1"],
    [[items(), items(), items(1)], "zip() argument 3 is longer than arguments 1-2"]
  ] as const)("reports strict mismatch for %s", (sources, message) => {
    expect(() => new ZipIterator(sources, true, tuple, budget()).next()).toThrow(expect.objectContaining({ name: "ValueError", message }));
  });
  it("consumes a longer strict input once per mismatch and permits retry", () => {
    const source = items(1, 2), iterator = new ZipIterator([items(), source], true, tuple, budget());
    expect(() => iterator.next()).toThrow("longer"); expect(() => iterator.next()).toThrow("longer");
    expect(iterator.next().done).toBe(true);
  });
  it("preserves left-to-right consumption when a later input is exhausted", () => {
    const source = items(1, 2, 3), iterator = new ZipIterator([source, items()], false, tuple, budget());
    expect(iterator.next().done).toBe(true); expect(source.next().value).toBe(2);
  });
  it("does not impose sticky exhaustion on resumable guest input adapters", () => {
    let calls = 0;
    const source = { next: () => ++calls === 1 ? { done: true as const, value: undefined } : { done: false as const, value: calls } };
    const iterator = new ZipIterator([source, items(4)], false, tuple, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next().value).toEqual([2, 4]);
  });
  it("propagates a strict probe error without converting it to a mismatch", () => {
    const failure = new Error("next failed");
    const iterator = new ZipIterator([items(), { next: () => { throw failure; } }], true, tuple, budget());
    expect(() => iterator.next()).toThrow(failure);
  });
  it("does not request later inputs or construct a tuple after a failure", () => {
    const failure = new Error("next failed");
    const iterator = new ZipIterator([{ next: () => { throw failure; } }, { next: () => { throw new Error("too far"); } }], false,
      () => { throw new Error("unexpected tuple"); }, budget());
    expect(() => iterator.next()).toThrow(failure);
  });
  it("supports repeated references to the same input iterator", () => {
    const source = items(1, 2, 3), iterator = new ZipIterator([source, source], true, tuple, budget());
    expect(iterator.next().value).toEqual([1, 2]); expect(() => iterator.next()).toThrow("argument 2 is shorter");
  });
  it("reserves each row before advancing input iterators", () => {
    let reject = false, calls = 0;
    const iterator = new ZipIterator([{ next: () => { calls++; return { done: false, value: 1 }; } }], false, tuple, {
      checkpoint: (_steps, bytes = 0) => { if (reject && bytes) throw new ExecutionLimitError("allocation"); }
    });
    reject = true; expect(() => iterator.next()).toThrow(ExecutionLimitError); expect(calls).toBe(0);
  });
});
