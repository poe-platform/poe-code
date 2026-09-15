import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("ordered mapping shallow copies", () => {
  it("preserves key/value identity and order while isolating storage mutations", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const map = new OrderedKeyMap<object, object>({ hash: () => 1n, equal: (a, b) => a === b }, meter);
    const a = {}, b = {}, value = { mutable: 1 }; map.set(a, value); map.set(b, value);
    const copy = map.copy(); expect(copy).not.toBe(map);
    const rows = copy.snapshot(); expect(rows[0][0]).toBe(a); expect(rows[0][1]).toBe(value); expect(rows[1][0]).toBe(b);
    copy.delete(a); expect(map.size).toBe(2); value.mutable = 2; expect(copy.lookup(b)?.value).toEqual({ mutable: 2 });
    map.clear(); expect(copy.popitem()).toEqual([b, value]); expect(copy.size).toBe(0);
  });
  it("uses cached hashes and never invokes equality while copying", () => {
    let forbidden = false;
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const map = new OrderedKeyMap<number, number>({
      hash: key => { if (forbidden) throw new Error("rehash"); return BigInt(key % 2); },
      equal: (a, b) => { if (forbidden) throw new Error("compare"); return a === b; }
    }, meter);
    for (let i = 0; i < 10; i++) map.set(i, i);
    forbidden = true; const copy = map.copy();
    expect(copy.snapshot()).toEqual(map.snapshot()); expect(copy.popitem()).toEqual([9, 9]);
  });
  it("copies only live entries after deletion and reinsertion", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const map = new OrderedKeyMap<number, string>({ hash: BigInt, equal: (a, b) => a === b }, meter);
    map.set(1, "a"); map.set(2, "b"); map.set(3, "c"); map.delete(2); map.set(2, "new");
    const copy = map.copy(); expect(copy.snapshot()).toEqual([[1, "a"], [3, "c"], [2, "new"]]);
    expect(copy.popitem()).toEqual([2, "new"]); expect(copy.popitem()).toEqual([3, "c"]); expect(copy.popitem()).toEqual([1, "a"]);
    expect(map.size).toBe(3);
  });
  it("returns an independently mutable empty copy", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const map = new OrderedKeyMap<number, number>({ hash: BigInt, equal: (a, b) => a === b }, meter), copy = map.copy();
    copy.set(1, 1); expect(map.size).toBe(0); expect(copy.size).toBe(1);
  });
  it("leaves the source unchanged when copy allocation fails partway through", () => {
    let remaining = Infinity;
    const meter = { checkpoint: (_steps = 1, bytes = 0) => { if (bytes > remaining) throw new ExecutionLimitError("allocation"); remaining -= bytes; } };
    const map = new OrderedKeyMap<number, number>({ hash: BigInt, equal: (a, b) => a === b }, meter);
    map.set(1, 1); map.set(2, 2); remaining = 64 + 136;
    expect(() => map.copy()).toThrow(ExecutionLimitError);
    remaining = Infinity; expect(map.snapshot()).toEqual([[1, 1], [2, 2]]); expect(map.popitem()).toEqual([2, 2]);
  });
});
