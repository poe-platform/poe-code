import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

interface Key { id: number; side: string }
function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), calls: string[] = [];
  const keys = { hash: (key: Key) => BigInt(key.id), equal: (a: Key, b: Key) => { calls.push(`${a.side}:${b.side}`); return a.id === b.id; } };
  const map = (size: number, side: string) => {
    const result = new OrderedKeyMap<Key, number>(keys, meter);
    for (let id = 0; id < size; id++) result.set({ id, side }, id);
    return result;
  };
  return { meter, calls, map };
}

describe("cached-hash key difference", () => {
  it.each([7, 8])("selects binary lookup direction at the copy threshold (%i left entries)", size => {
    const { calls, map } = fixture(), a = map(size, "left"), b = map(1, "right");
    const result = a.differenceKeys(b);
    expect(result.size).toBe(size - 1); expect(calls).toEqual([size === 7 ? "right:left" : "left:right"]);
    expect(a.size).toBe(size); expect(b.size).toBe(1);
  });

  it.each([15, 16])("selects the in-place pre-intersection threshold (%i right entries)", size => {
    const { calls, map } = fixture(), a = map(1, "left"), b = map(size, "right");
    a.subtractKeysInPlace(b);
    expect(a.size).toBe(0); expect(calls).toEqual([size === 15 ? "left:right" : "right:left"]);
    expect(b.size).toBe(size);
  });

  it("uses foreign destination hashes in both strategies", () => {
    const { meter } = fixture(), calls: string[] = [];
    const a = new OrderedKeyMap<number, number>({ hash: key => { calls.push(`a:${key}`); return BigInt(key); }, equal: (a, b) => a === b }, meter);
    const b = new OrderedKeyMap<number, number>({ hash: key => { calls.push(`b:${key}`); return BigInt(key + 100); }, equal: (a, b) => a === b }, meter);
    a.set(1, 10); a.set(2, 20); b.set(1, 30); calls.length = 0;
    expect(a.differenceKeys(b).snapshot()).toEqual([[2, 20]]); expect(calls).toEqual(["b:1", "b:2"]);
    calls.length = 0; a.subtractKeysInPlace(b); expect(a.snapshot()).toEqual([[2, 20]]); expect(calls).toEqual(["a:1"]);
  });

  it("leaves the receiver intact if pre-intersection equality fails", () => {
    const { meter } = fixture(); let fail = false;
    const keys = { hash: (key: Key) => BigInt(key.id), equal: (a: Key, b: Key) => { if (fail) throw new Error("comparison failed"); return a.id === b.id; } };
    const a = new OrderedKeyMap<Key, number>(keys, meter), b = new OrderedKeyMap<Key, number>(keys, meter);
    const key = { id: 0, side: "left" }; a.set(key, 1);
    for (let id = 0; id < 16; id++) b.set({ id, side: "right" }, id);
    fail = true; expect(() => a.subtractKeysInPlace(b)).toThrow("comparison failed"); expect(a.snapshot()).toEqual([[key, 1]]);
  });

  it("checks cancellation before removing the current matching entry", () => {
    let cancelled = false;
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    const keys = { hash: () => 1n, equal: () => { cancelled = true; return true; } };
    const a = new OrderedKeyMap<string, number>(keys, meter), b = new OrderedKeyMap<string, number>(keys, meter);
    a.set("a", 1); b.set("b", 2);
    expect(() => a.subtractKeysInPlace(b)).toThrow(ExecutionLimitError);
    cancelled = false; expect(a.snapshot()).toEqual([["a", 1]]);
  });
});
