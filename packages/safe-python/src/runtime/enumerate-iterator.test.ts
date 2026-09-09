import { describe, expect, it } from "vitest";
import { EnumerateIterator } from "./enumerate-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const pair = (index: bigint, value: unknown) => [index, value] as const;

describe("enumerate iteration", () => {
  it.each([0n, -3n, (1n << 63n) - 1n, -(1n << 100n), 1n << 100n])("counts exactly from %s", start => {
    const iterator = new EnumerateIterator(["a", "b"][Symbol.iterator](), start, pair, budget());
    expect(iterator[Symbol.iterator]()).toBe(iterator);
    expect([...iterator]).toEqual([[start, "a"], [start + 1n, "b"]]);
  });
  it("does not consume the input or create pairs at construction", () => {
    const iterator = new EnumerateIterator({ next: () => { throw new Error("next"); } }, 0n,
      () => { throw new Error("pair"); }, budget());
    expect(() => iterator.next()).toThrow("next");
  });
  it("does not increment or latch on a resumable source stop", () => {
    let calls = 0;
    const iterator = new EnumerateIterator({ next: () => ++calls === 1 ? { done: true, value: undefined } : { done: false, value: "a" } }, 7n, pair, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next().value).toEqual([7n, "a"]);
  });
  it("preserves the index when source next raises", () => {
    let calls = 0;
    const iterator = new EnumerateIterator({ next: () => { if (++calls === 1) throw new Error("source"); return { done: false, value: 5 }; } }, 2n, pair, budget());
    expect(() => iterator.next()).toThrow("source"); expect(iterator.next().value).toEqual([2n, 5]);
  });
  it("reads the index after reentrant input advancement", () => {
    let calls = 0;
    const seen: unknown[] = [];
    const iterator: EnumerateIterator<string, readonly [bigint, unknown]> = new EnumerateIterator({ next: () => {
      if (++calls === 1) { seen.push(iterator.next().value); return { done: false, value: "outer" }; }
      return { done: false, value: "inner" };
    } }, 4n, pair, budget());
    expect(iterator.next().value).toEqual([5n, "outer"]); expect(seen).toEqual([[4n, "inner"]]);
  });
  it("advances before result construction, preserving consumed progress on failure", () => {
    let calls = 0;
    const iterator = new EnumerateIterator(["a", "b"][Symbol.iterator](), 0n, (index, value) => {
      if (++calls === 1) throw new Error("pair failed"); return pair(index, value);
    }, budget());
    expect(() => iterator.next()).toThrow("pair failed"); expect(iterator.next().value).toEqual([1n, "b"]);
  });
  it("returns undefined if that is the supplied guest result representation", () => {
    expect(new EnumerateIterator([1][Symbol.iterator](), 0n, () => undefined, budget()).next()).toEqual({ done: false, value: undefined });
  });
  it("checks cancellation after pulling input before constructing the pair", () => {
    let cancelled = false;
    const iterator = new EnumerateIterator({ next: () => { cancelled = true; return { done: false, value: 1 }; } }, 0n,
      () => { throw new Error("unexpected pair"); }, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    expect(() => iterator.next()).toThrow(ExecutionLimitError);
  });
});
