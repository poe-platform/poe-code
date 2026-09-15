import { describe, expect, it } from "vitest";
import { stableSort } from "./stable-sort.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const numeric = { key: (value: number) => value, less: (a: number, b: number) => a < b };

describe("metered stable sorting", () => {
  it.each([[], [1], [4, 3, 2, 1], [1, 2, 3, 4], [3, 1, 2, 1, 0]].map(input => ({ input })))("sorts $input without mutating input", ({ input }) => {
    const before = [...input], result = stableSort(input, numeric, budget());
    expect(result).toEqual([...input].sort((a, b) => a - b)); expect(input).toEqual(before); expect(result).not.toBe(input);
  });
  it.each([false, true])("preserves equal-key identity order with reverse=%s", reverse => {
    const values = [{ key: 2, id: 0 }, { key: 1, id: 1 }, { key: 2, id: 2 }, { key: 1, id: 3 }];
    const result = stableSort(values, { key: v => v.key, less: numeric.less, reverse }, budget());
    expect(result.map(v => v.id)).toEqual(reverse ? [0, 2, 1, 3] : [1, 3, 0, 2]);
    for (const v of result) expect(v).toBe(values[v.id]);
  });
  it("evaluates every key once in source order before comparing", () => {
    const events: unknown[] = [];
    expect(stableSort([3, 1, 2], {
      key: value => { events.push(value); return value; },
      less: (a, b) => { expect(events.slice(0, 3)).toEqual([3, 1, 2]); events.push([a, b]); return a < b; }
    }, budget())).toEqual([1, 2, 3]);
    expect(events.filter(v => typeof v === "number")).toEqual([3, 1, 2]);
  });
  it("captures source slots before keys can mutate the host source", () => {
    const input = [3, 1, 2];
    expect(stableSort(input, { ...numeric, key: value => { input.length = 0; return value; } }, budget())).toEqual([1, 2, 3]);
  });
  it("stops immediately at key failure before comparisons", () => {
    const failure = new Error("key failed"), calls: number[] = [];
    expect(() => stableSort([1, 2, 3], {
      key: value => { calls.push(value); if (value === 2) throw failure; return value; },
      less: () => { throw new Error("unexpected comparison"); }
    }, budget())).toThrow(failure); expect(calls).toEqual([1, 2]);
  });
  it("propagates comparison failures without changing source slots", () => {
    const input = [3, 1, 2], failure = new Error("less failed");
    expect(() => stableSort(input, { ...numeric, less: () => { throw failure; } }, budget())).toThrow(failure);
    expect(input).toEqual([3, 1, 2]);
  });
  it("uses linear comparisons for a single ascending or strict descending run", () => {
    for (const reverse of [false, true]) {
      const input = Array.from({ length: 1000 }, (_, i) => reverse ? 1000 - i : i); let comparisons = 0;
      stableSort(input, { ...numeric, less: (a, b) => { comparisons++; return a < b; } }, budget());
      expect(comparisons).toBe(999);
    }
  });
  it("checks resource limits after comparator callbacks", () => {
    let reject = false;
    expect(() => stableSort([2, 1], { ...numeric, less: () => { reject = true; return true; } }, {
      checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); }
    })).toThrow(ExecutionLimitError);
  });
  it("rejects slot allocation before reading source items", () => {
    let read = false;
    const input = [1]; Object.defineProperty(input, 0, { get: () => { read = true; return 1; } });
    expect(() => stableSort(input, numeric, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1 }))).toThrow(ExecutionLimitError);
    expect(read).toBe(false);
  });
});
