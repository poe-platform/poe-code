import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("cached-hash key intersection", () => {
  it.each([false, true])("uses destination hashes across foreign policies (left smaller: %s)", smaller => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), hashes: string[] = [];
    const a = new OrderedKeyMap<string, number>({ hash: key => { hashes.push(`a:${key}`); return 1n; }, equal: (a, b) => a === b }, meter);
    const b = new OrderedKeyMap<string, number>({ hash: key => { hashes.push(`b:${key}`); return 2n; }, equal: (a, b) => a === b }, meter);
    a.set("x", 1); b.set("x", 2); if (smaller) b.set("y", 3);
    hashes.length = 0;
    const result = a.intersectKeys(b);
    expect(hashes).toEqual([smaller ? "b:x" : "a:x"]);
    expect(result.lookup("x")).toEqual({ value: smaller ? 1 : 2 });
    expect(hashes.at(-1)).toBe("a:x");
  });

  it("observes cancellation caused by equality before publishing an in-place result", () => {
    let cancelled = false;
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    const keys = { hash: () => 1n, equal: () => { cancelled = true; return true; } };
    const a = new OrderedKeyMap<object, number>(keys, meter), b = new OrderedKeyMap<object, number>(keys, meter), key = {};
    a.set(key, 1); b.set({}, 2);
    expect(() => a.intersectKeysInPlace(b)).toThrow(ExecutionLimitError);
    cancelled = false; expect(a.snapshot()).toEqual([[key, 1]]);
  });

  it("rejects transfer allocation before destructive writes", () => {
    let reject = false;
    const meter = { checkpoint(_steps = 1, bytes = 0) { if (reject && bytes === 32) throw new ExecutionLimitError("allocation"); } };
    const keys = { hash: () => 1n, equal: (a: number, b: number) => a === b };
    const a = new OrderedKeyMap<number, number>(keys, meter), b = new OrderedKeyMap<number, number>(keys, meter);
    a.set(1, 10); a.set(2, 20); b.set(1, 30); reject = true;
    expect(() => a.intersectKeysInPlace(b)).toThrow(ExecutionLimitError);
    reject = false; expect(a.snapshot()).toEqual([[1, 10], [2, 20]]);
  });

  it("keeps adopted entries, hash buckets and links coherent for later writes", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const keys = { hash: (key: number) => BigInt(key), equal: (a: number, b: number) => a === b };
    const a = new OrderedKeyMap<number, number>(keys, meter), b = new OrderedKeyMap<number, number>(keys, meter);
    a.set(1, 10); a.set(2, 20); b.set(2, 30); a.intersectKeysInPlace(b);
    a.set(3, 40); expect(a.popitem()).toEqual([3, 40]); expect(a.lookup(2)).toEqual({ value: 30 });
    expect(a.delete(2)).toBe(true); expect(a.size).toBe(0); expect(b.lookup(2)).toEqual({ value: 30 });
  });
});
