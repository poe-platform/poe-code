import { describe, expect, it } from "vitest";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const operations: KeyOperations<number> = { hash: BigInt, equal: (a, b) => a === b };

describe("ordered mapping equality", () => {
  it("suspends value comparisons and observes later value replacements", () => {
    const a = new OrderedKeyMap<number, string>(operations, budget()), b = new OrderedKeyMap<number, string>(operations, budget());
    a.set(1, "left"); b.set(1, "right"); a.set(2, "old"); b.set(2, "other");
    const comparisons = a.compareValues(b), first = comparisons.next();
    expect(first).toEqual({ done: false, value: ["left", "right"] }); expect(Object.isFrozen(first.value)).toBe(true);
    a.set(2, "new"); b.set(2, "new");
    expect(comparisons.next(true)).toEqual({ done: true, value: true });
  });
  it("stops a suspended comparison immediately on a false response", () => {
    const a = new OrderedKeyMap<number, string>(operations, budget()), b = new OrderedKeyMap<number, string>(operations, budget());
    a.set(1, "left"); b.set(1, "right"); a.set(2, "later"); b.set(2, "different");
    const comparisons = a.compareValues(b); comparisons.next();
    expect(comparisons.next(false)).toEqual({ done: true, value: false });
  });
  it("checks cancellation when a suspended comparison resumes", () => {
    let reject = false;
    const meter = { checkpoint: () => { if (reject) throw new ExecutionLimitError("steps"); } };
    const a = new OrderedKeyMap<number, string>(operations, meter), b = new OrderedKeyMap<number, string>(operations, meter);
    a.set(1, "left"); b.set(1, "right"); const comparisons = a.compareValues(b); comparisons.next(); reject = true;
    expect(() => comparisons.next(true)).toThrow(ExecutionLimitError);
  });
  it("ignores insertion order while checking matching keys and values", () => {
    const a = new OrderedKeyMap<number, string>(operations, budget()), b = new OrderedKeyMap<number, string>(operations, budget());
    a.set(1, "a"); a.set(2, "b"); b.set(2, "b"); b.set(1, "a");
    expect(a.equals(b, (x, y) => x === y)).toBe(true); b.set(1, "changed");
    expect(a.equals(b, (x, y) => x === y)).toBe(false);
  });
  it("rejects different sizes before hashing or value equality", () => {
    let forbidden = false;
    const ops: KeyOperations<number> = { hash: k => { if (forbidden) throw new Error("hash"); return BigInt(k); }, equal: () => { throw new Error("key equality"); } };
    const a = new OrderedKeyMap<number, number>(ops, budget()), b = new OrderedKeyMap<number, number>(ops, budget());
    a.set(1, 1); forbidden = true;
    expect(a.equals(b, () => { throw new Error("value equality"); })).toBe(false);
  });
  it("distinguishes a missing key from a stored undefined value", () => {
    const a = new OrderedKeyMap<number, undefined>(operations, budget()), b = new OrderedKeyMap<number, undefined>(operations, budget());
    a.set(1, undefined); b.set(2, undefined); expect(a.equals(b, () => true)).toBe(false);
    b.clear(); b.set(1, undefined); expect(a.equals(b, () => false)).toBe(true);
  });
  it("compares values left-to-right but skips identical objects", () => {
    const a = new OrderedKeyMap<number, object>(operations, budget()), b = new OrderedKeyMap<number, object>(operations, budget());
    const shared = {}, left = {}, right = {}, calls: unknown[] = [];
    a.set(1, shared); a.set(2, left); b.set(2, right); b.set(1, shared);
    expect(a.equals(b, (x, y) => { calls.push([x, y]); return true; })).toBe(true);
    expect(calls).toEqual([[left, right]]); expect(a.equals(a, () => { throw new Error("unexpected"); })).toBe(true);
  });
  it("uses cached key hashes in a shared policy domain and rehashes across domains", () => {
    let forbidden = false;
    const ops: KeyOperations<number> = { hash: k => { if (forbidden) throw new Error("rehash"); return BigInt(k); }, equal: (a, b) => a === b };
    const a = new OrderedKeyMap<number, number>(ops, budget()), b = new OrderedKeyMap<number, number>(ops, budget());
    a.set(1, 1); b.set(1, 1); forbidden = true; expect(a.equals(b, () => true)).toBe(true);
    let calls = 0; const foreign = new OrderedKeyMap<number, number>({ hash: k => { calls++; return BigInt(k + 100); }, equal: (a, b) => a === b }, budget());
    foreign.set(1, 1); calls = 0; expect(a.equals(foreign, () => true)).toBe(true); expect(calls).toBe(1);
  });
  it("propagates value equality errors and stops at the first mismatch", () => {
    const a = new OrderedKeyMap<number, object>(operations, budget()), b = new OrderedKeyMap<number, object>(operations, budget());
    for (const key of [1, 2]) { a.set(key, {}); b.set(key, {}); }
    let count = 0; expect(a.equals(b, () => { count++; return false; })).toBe(false); expect(count).toBe(1);
    const error = new Error("comparison failed"); expect(() => a.equals(b, () => { throw error; })).toThrow(error);
  });
  it("checks the execution budget even for self comparison", () => {
    let reject = false;
    const map = new OrderedKeyMap<number, number>(operations, { checkpoint: () => { if (reject) throw new ExecutionLimitError("steps"); } });
    reject = true; expect(() => map.equals(map, () => true)).toThrow(ExecutionLimitError);
  });
  it("does not skip colliding key comparisons merely because both maps are identical", () => {
    let fail = false; const error = new Error("collision");
    const map = new OrderedKeyMap<object, number>({ hash: () => 1n, equal: () => { if (fail) throw error; return false; } }, budget());
    map.set({}, 1); map.set({}, 2); fail = true;
    expect(() => map.equals(map, () => true)).toThrow(error);
  });
});
