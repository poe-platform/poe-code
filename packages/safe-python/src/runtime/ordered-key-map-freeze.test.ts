import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("sealed key storage", () => {
  function fixture() {
    const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
    const keys = { hash: (n: number) => BigInt(n === -1 ? -2 : n), equal: (a: number, b: number) => a === b };
    const map = new OrderedKeyMap<number, number>(keys, meter); map.set(1, 10);
    return { meter, map };
  }
  it.each([
    (map: OrderedKeyMap<number, number>) => map.set(1, 20),
    (map: OrderedKeyMap<number, number>) => map.setdefault(2, 20),
    (map: OrderedKeyMap<number, number>) => map.delete(1),
    (map: OrderedKeyMap<number, number>) => map.pop(1),
    (map: OrderedKeyMap<number, number>) => map.popitem(),
    (map: OrderedKeyMap<number, number>) => map.clear(),
    (map: OrderedKeyMap<number, number>) => map.update(map.copy()),
    (map: OrderedKeyMap<number, number>) => map.mergeKeysInPlace(map, "^"),
    (map: OrderedKeyMap<number, number>) => map.subtractKeysInPlace(map),
    (map: OrderedKeyMap<number, number>) => map.intersectKeysInPlace(map)
  ])("rejects mutators after sealing", mutate => {
    const { map } = fixture(); map.seal();
    expect(() => mutate(map)).toThrow("key storage is sealed"); expect(map.lookup(1)).toEqual({ value: 10 });
  });
  it("leaves copies mutable and caches order-independent hashes only after sealing", () => {
    const { meter, map } = fixture();
    expect(map.keySetHash()).toBe(-558064481276695278n);
    map.set(2, 20); map.set(3, 30); map.seal();
    expect(map.keySetHash()).toBe(-272375401224217160n);
    const before = meter.usage.steps; expect(map.keySetHash()).toBe(-272375401224217160n);
    expect(meter.usage.steps - before).toBe(1);
    const copy = map.copy(); copy.clear(); expect(copy.keySetHash()).toBe(133146708735736n);
    expect(map.size).toBe(3);
  });

  it("observes cancellation before rejecting an in-place intersection on sealed storage", () => {
    let cancelled = false;
    const map = new OrderedKeyMap<number, number>({ hash: () => 1n, equal: () => true }, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    map.seal(); cancelled = true;
    expect(() => map.intersectKeysInPlace(map)).toThrow(ExecutionLimitError);
  });

  it("rechecks sealing when a trusted equality callback seals the receiver", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const map = new OrderedKeyMap<object, number>({ hash: () => 1n, equal: () => { map.seal(); return true; } }, meter), key = {};
    map.set(key, 1); expect(() => map.set({}, 2)).toThrow("key storage is sealed");
    expect(map.snapshot()).toEqual([[key, 1]]);
  });
});
