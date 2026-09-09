import { describe, expect, it } from "vitest";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const equal = (a: unknown, b: unknown) => a === b;

describe("mutable list search", () => {
  it("finds the first matching index and distinguishes absence from index zero", () => {
    const list = new ListStorage([1, 2, 1], budget());
    expect(list.indexOf(1, equal)).toBe(0); expect(list.indexOf(9, equal)).toBeUndefined();
    expect(list.count(1, equal)).toBe(2); expect(list.count(9, equal)).toBe(0);
  });
  it("skips equality callbacks for identical elements", () => {
    const value = {}, list = new ListStorage([value, value], budget());
    const fail = () => { throw new Error("identity should skip equality"); };
    expect(list.indexOf(value, fail)).toBe(0); expect(list.count(value, fail)).toBe(2);
    expect(list.removeFirst(value, fail)).toBe(true); expect(list.length).toBe(1);
  });
  it("compares the resident element first and visits in order", () => {
    const list = new ListStorage([1, 2, 3], budget()), calls: unknown[] = [];
    expect(list.indexOf(8, (stored, incoming) => { calls.push([stored, incoming]); return stored === 2; })).toBe(1);
    expect(calls).toEqual([[1, 8], [2, 8]]);
  });
  it.each([
    [1n, null, 2], [-2n, null, 2], [0n, 2n, 0], [1n, -1n, undefined],
    [-(1n << 100n), 1n << 100n, 0], [1n << 100n, null, undefined], [0n, -(1n << 100n), undefined]
  ] as const)("normalizes search bounds %s:%s", (start, stop, expected) => {
    expect(new ListStorage([1, 2, 1], budget()).indexOf(1, equal, start, stop)).toBe(expected);
  });
  it("observes growth during comparisons unless an explicit stop excludes it", () => {
    for (const bounded of [false, true]) {
      const list = new ListStorage([1], budget());
      expect(list.indexOf(2, () => { list.append(2); return false; }, 0n, bounded ? 1n : null)).toBe(bounded ? undefined : 1);
    }
  });
  it("counts appended matching elements and tolerates shrinking", () => {
    const list = new ListStorage([1], budget());
    expect(list.count(2, () => { list.append(2); return true; })).toBe(2);
    expect(list.count(8, () => { list.clear(); return true; })).toBe(1);
  });
  it("removes the current numeric slot after a successful mutating comparison", () => {
    const list = new ListStorage([1, 2, 3], budget());
    expect(list.removeFirst(9, () => { list.delete(0n); return true; })).toBe(true);
    expect(list.snapshot()).toEqual([3]);
    expect(list.removeFirst(9, () => { list.clear(); return true; })).toBe(true);
    expect(list.snapshot()).toEqual([]);
  });
  it("leaves a missing value unchanged and reports absence", () => {
    const list = new ListStorage([1, 2], budget()); expect(list.removeFirst(9, equal)).toBe(false);
    expect(list.snapshot()).toEqual([1, 2]);
  });
  it("propagates comparison failures without undoing their mutations", () => {
    const list = new ListStorage([1], budget()), failure = new Error("comparison failed");
    expect(() => list.removeFirst(9, () => { list.append(2); throw failure; })).toThrow(failure);
    expect(list.snapshot()).toEqual([1, 2]);
  });
  it("checks limits after comparison before removing anything", () => {
    let reject = false;
    const list = new ListStorage([1], { checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); } });
    expect(() => list.removeFirst(9, () => { reject = true; return true; })).toThrow(ExecutionLimitError);
    reject = false; expect(list.snapshot()).toEqual([1]);
  });
  it("bounds comparisons that keep growing the list", () => {
    const list = new ListStorage([1], new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }));
    expect(() => list.count(9, () => { list.append(1); return false; })).toThrow(ExecutionLimitError);
  });
});
