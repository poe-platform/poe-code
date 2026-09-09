import { describe, expect, it } from "vitest";
import { ListStorage } from "./list-storage.js";
import { compareLists, type ListComparisonContext } from "./list-comparison.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const list = (values: number[]) => new ListStorage(values, budget());
const context: ListComparisonContext<number, boolean> = {
  equal: (a, b) => a === b,
  order: (op, a, b) => op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b,
  boolean: value => value
};

describe("list rich comparison", () => {
  it.each([
    ["==", true, false, false], ["!=", false, true, true],
    ["<", false, true, true], ["<=", true, true, true],
    [">", false, false, false], [">=", true, false, false]
  ] as const)("compares equal lists, unequal elements and prefixes with %s", (op, same, different, prefix) => {
    expect(compareLists(op, list([1, 2]), list([1, 2]), context, budget())).toBe(same);
    expect(compareLists(op, list([1, 2]), list([1, 3]), context, budget())).toBe(different);
    expect(compareLists(op, list([1]), list([1, 2]), context, budget())).toBe(prefix);
  });
  it("shortcuts unequal initial lengths only for equality/inequality", () => {
    const calls: string[] = [], ctx = { ...context, equal: () => { calls.push("eq"); return false; } };
    expect(compareLists("==", list([1]), list([2, 3]), ctx, budget())).toBe(false);
    expect(compareLists("!=", list([1]), list([2, 3]), ctx, budget())).toBe(true); expect(calls).toEqual([]);
    expect(compareLists("<", list([1]), list([2, 3]), ctx, budget())).toBe(true); expect(calls).toEqual(["eq"]);
  });
  it("skips equality for identical elements including self comparisons", () => {
    const value = {}, source = new ListStorage([value], budget());
    const ctx = { equal: () => { throw new Error("identity comparison"); }, order: () => false, boolean: (v: boolean) => v };
    expect(compareLists("==", source, source, ctx, budget())).toBe(true);
    expect(compareLists("<", source, new ListStorage([value], budget()), ctx, budget())).toBe(false);
  });
  it("compares equality first, then preserves the raw ordering result", () => {
    const result = {}, calls: unknown[] = [];
    const ctx: ListComparisonContext<number, object> = {
      equal: (a, b) => { calls.push(["==", a, b]); return false; },
      order: (op, a, b) => { calls.push([op, a, b]); return result; },
      boolean: () => { throw new Error("must not coerce rich result"); }
    };
    expect(compareLists("<=", list([1]), list([2]), ctx, budget())).toBe(result);
    expect(calls).toEqual([["==", 1, 2], ["<=", 1, 2]]);
  });
  it("rechecks lengths after a false equality callback shrinks both lists", () => {
    const left = list([1]), right = list([2]);
    expect(compareLists("==", left, right, { ...context, equal: () => { left.clear(); right.clear(); return false; } }, budget())).toBe(true);
  });
  it("rereads current slots for ordering after a false equality result", () => {
    const left = list([1]), right = list([2]);
    expect(compareLists("<", left, right, { ...context, equal: () => { left.set(0n, 9); return false; } }, budget())).toBe(false);
  });
  it("observes growth when earlier elements compare equal", () => {
    const left = list([1]), right = list([2]);
    expect(compareLists("<", left, right, { ...context, equal: (a) => { if (a === 3) return false; left.append(3); right.append(4); return true; } },
      new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 10000 }))).toBe(true);
  });
  it("propagates equality errors without undoing mutations or calling ordering", () => {
    const left = list([1]), failure = new Error("eq failed");
    expect(() => compareLists("<", left, list([2]), { ...context, equal: () => { left.clear(); throw failure; } }, budget())).toThrow(failure);
    expect(left.length).toBe(0);
  });
  it("checks the budget after ordering callbacks before returning", () => {
    let reject = false;
    expect(() => compareLists("<", list([1]), list([2]), { ...context, order: () => { reject = true; return true; } },
      { checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
  it("terminates callbacks that extend equal prefixes forever", () => {
    const left = list([1]), right = list([2]);
    expect(() => compareLists("==", left, right, { ...context, equal: () => { left.append(1); right.append(2); return true; } },
      new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
  });
});
