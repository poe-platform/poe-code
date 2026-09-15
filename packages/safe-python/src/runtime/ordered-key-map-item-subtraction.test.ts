import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("matching-item subtraction", () => {
  it("reuses hashes and skips equality for identical values", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }); let hashes = 0;
    const keys = { hash: () => { hashes++; return 1n; }, equal: (a: string, b: string) => a === b }, value = [];
    const a = new OrderedKeyMap<string, unknown>(keys, meter), b = new OrderedKeyMap<string, unknown>(keys, meter);
    a.set("a", value); b.set("a", value); hashes = 0;
    expect(a.subtractMatchingItems(b, () => { throw new Error("unexpected equality"); }, () => { throw new Error("unexpected unmatched item"); })).toBeUndefined();
    expect(a.size).toBe(0); expect(b.size).toBe(1); expect(hashes).toBe(0);
  });

  it("reports an incoming key that no longer matches during deletion", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }); let matching = true;
    const keys = { hash: () => 1n, equal: () => matching }, left = {}, right = {};
    const a = new OrderedKeyMap<object, number>(keys, meter), b = new OrderedKeyMap<object, number>(keys, meter);
    a.set(left, 1); b.set(right, 2);
    const result = a.subtractMatchingItems(b, () => { matching = false; return true; }, () => { throw new Error("unexpected unmatched item"); });
    expect(result?.key).toBe(right); expect(a.size).toBe(1);
  });

  it("retains an incoming pair across callbacks that clear its source", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), keys = { hash: () => 1n, equal: (a: string, b: string) => a === b };
    const a = new OrderedKeyMap<string, number>(keys, meter), b = new OrderedKeyMap<string, number>(keys, meter), unmatched: unknown[] = [];
    a.set("a", 1); b.set("a", 2);
    a.subtractMatchingItems(b, () => { b.clear(); return false; }, (key, value) => unmatched.push([key, value]));
    expect(unmatched).toEqual([["a", 2]]); expect(a.size).toBe(1); expect(b.size).toBe(0);
  });

  it("observes value-comparison cancellation before removing an entry", () => {
    let cancelled = false;
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } }, keys = { hash: () => 1n, equal: () => true };
    const a = new OrderedKeyMap<string, number>(keys, meter), b = new OrderedKeyMap<string, number>(keys, meter);
    a.set("a", 1); b.set("b", 2);
    expect(() => a.subtractMatchingItems(b, () => { cancelled = true; return true; }, () => {})).toThrow(ExecutionLimitError);
    cancelled = false; expect(a.size).toBe(1);
  });
});
