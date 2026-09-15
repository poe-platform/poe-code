import { describe, expect, it } from "vitest";
import { searchRange, type RangeSearchContext } from "./range-search.js";
import { createRange } from "./integer-sequence.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: RangeSearchContext<unknown> = {
  exactInteger: value => typeof value === "bigint" ? value : typeof value === "boolean" ? value ? 1n : 0n : undefined,
  integer: value => value, equal: (left, right) => Number(left) === Number(right)
};

describe("guest range searches", () => {
  it("finds exact integer indices beyond machine width without iteration", () => {
    const end = 1n << 200n, range = createRange(0n, end), meter = budget();
    expect(searchRange("index", range, end - 1n, { ...context, integer: () => { throw new Error("unexpected wrapping"); } }, meter)).toBe(end - 1n);
    expect(meter.usage.steps).toBeLessThan(10);
  });
  it.each(["contains", "count"] as const)("uses exact bool arithmetic for %s", operation => {
    const ctx = { ...context, equal: () => { throw new Error("unexpected equality"); } };
    expect(searchRange(operation, createRange(0n, 2n), true, ctx, budget())).toBe(operation === "contains" ? true : 1n);
    expect(searchRange(operation, createRange(2n, 5n), false, ctx, budget())).toBe(operation === "contains" ? false : 0n);
  });
  it("uses generic equality for float and subclass-like values", () => {
    const seen: unknown[] = [], needle = {};
    expect(searchRange("index", createRange(3n, -2n, -1n), needle, { ...context,
      equal: (value, other) => { expect(other).toBe(needle); seen.push(value); return value === 1n; }
    }, budget())).toBe(2n);
    expect(seen).toEqual([3n, 2n, 1n]);
    expect(searchRange("contains", createRange(0n, 3n), 2.0, context, budget())).toBe(true);
  });
  it("counts all matches from user equality rather than assuming uniqueness", () => {
    expect(searchRange("count", createRange(0n, 5n), {}, { ...context, equal: () => true }, budget())).toBe(5n);
  });
  it.each(["contains", "index"] as const)("short-circuits generic %s at the first match", operation => {
    let calls = 0;
    expect(searchRange(operation, createRange(0n, 5n), {}, { ...context, equal: () => { calls++; return true; } }, budget()))
      .toBe(operation === "contains" ? true : 0n);
    expect(calls).toBe(1);
  });
  it("preserves distinct exact and generic missing-index messages", () => {
    expect(() => searchRange("index", createRange(0n, 3n), 7n, context, budget())).toThrow("range.index(x): x not in range");
    expect(() => searchRange("index", createRange(0n, 3n), 7.0, context, budget())).toThrow("sequence.index(x): x not in sequence");
  });
  it("does not compare empty ranges", () => {
    expect(searchRange("count", createRange(0n, 0n), {}, { ...context, equal: () => { throw new Error("unexpected comparison"); } }, budget())).toBe(0n);
  });
  it("propagates comparison errors unchanged", () => {
    const failure = new Error("equality failed");
    expect(() => searchRange("contains", createRange(0n, 3n), {}, { ...context, equal: () => { throw failure; } }, budget())).toThrow(failure);
  });
  it("bounds generic searches over huge ranges", () => {
    expect(() => searchRange("count", createRange(0n, 1n << 200n), {}, { ...context, equal: () => false },
      new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
  });
  it("checks cancellation after wrapping before equality", () => {
    let cancelled = false;
    expect(() => searchRange("contains", createRange(0n, 3n), {}, { ...context,
      integer: value => { cancelled = true; return value; }, equal: () => { throw new Error("unexpected comparison"); }
    }, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
