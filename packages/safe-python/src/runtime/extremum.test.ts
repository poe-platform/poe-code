import { describe, expect, it } from "vitest";
import { selectExtremum, type ExtremumContext } from "./extremum.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: ExtremumContext<number, number> = { key: value => value, compare: (operation, candidate, best) => operation === "min" ? candidate < best : candidate > best };

describe("minimum/maximum selection", () => {
  it.each(["min", "max"] as const)("selects %s with one key call per item", operation => {
    const seen: number[] = [];
    expect(selectExtremum(operation, [4, 1, 7, 2][Symbol.iterator](), { ...context, key: value => { seen.push(value); return value; } }, budget())).toBe(operation === "min" ? 1 : 7);
    expect(seen).toEqual([4, 1, 7, 2]);
  });
  it.each(["min", "max"] as const)("keeps the first %s tie and returns its original object", operation => {
    const first = {}, second = {};
    expect(selectExtremum(operation, [first, second][Symbol.iterator](), { ...context, key: () => 3 }, budget())).toBe(first);
  });
  it("compares candidate keys on the left using the requested ordering", () => {
    const comparisons: unknown[] = [];
    expect(selectExtremum("max", [3, 2, 4][Symbol.iterator](), { ...context, compare: (op, candidate, best) => {
      comparisons.push([op, candidate, best]); return candidate > best;
    } }, budget())).toBe(4);
    expect(comparisons).toEqual([["max", 2, 3], ["max", 4, 3]]);
  });
  it.each(["min", "max"] as const)("rejects empty %s without a default", operation => {
    expect(() => selectExtremum(operation, [][Symbol.iterator](), context, budget())).toThrow(`${operation}() iterable argument is empty`);
  });
  it("returns defaults untouched without calling key", () => {
    const value = {};
    expect(selectExtremum("min", [][Symbol.iterator](), { key: () => { throw new Error("unexpected key"); }, compare: () => false }, budget(), { value })).toBe(value);
  });
  it("distinguishes undefined defaults and elements from absence", () => {
    const ctx: ExtremumContext<undefined, undefined> = { key: value => value, compare: () => false };
    expect(selectExtremum("max", [][Symbol.iterator](), ctx, budget(), { value: undefined })).toBeUndefined();
    expect(selectExtremum("max", [undefined][Symbol.iterator](), ctx, budget())).toBeUndefined();
  });
  it("does not compare a singleton or treat the default as a candidate", () => {
    expect(selectExtremum("min", [7][Symbol.iterator](), { ...context, compare: () => { throw new Error("unexpected compare"); } }, budget(), { value: -99 })).toBe(7);
  });
  it.each(["key", "compare"])("propagates %s errors after consuming the failing item without closing", phase => {
    const failure = new Error(phase), source = [1, 2, 3][Symbol.iterator]();
    Object.assign(source, { return: () => { throw new Error("unexpected close"); } });
    expect(() => selectExtremum("min", source, { ...context,
      key: value => { if (phase === "key" && value === 2) throw failure; return value; },
      compare: () => { throw failure; }
    }, budget())).toThrow(failure);
    expect(source.next().value).toBe(3);
  });
  it("checks cancellation after a key callback before comparison", () => {
    let cancelled = false;
    expect(() => selectExtremum("max", [1, 2][Symbol.iterator](), { ...context,
      key: value => { if (value === 2) cancelled = true; return value; }, compare: () => { throw new Error("unexpected compare"); }
    }, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
  it("bounds infinite input", () => {
    expect(() => selectExtremum("min", { next: () => ({ done: false, value: 1 }) }, context,
      new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
  });
});
