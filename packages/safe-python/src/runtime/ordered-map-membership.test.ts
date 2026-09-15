import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const map = new OrderedKeyMap<number, unknown>({ hash: key => BigInt(key % 2), equal: (a, b) => a === b }, meter);
  return { map, meter };
}

describe("ordered mapping membership", () => {
  it("checks colliding keys without allocating presence records", () => {
    const { map, meter } = fixture(); map.set(1, undefined); map.set(3, "x"); const before = meter.usage.allocatedBytes;
    expect(map.containsKey(1)).toBe(true); expect(map.containsKey(3)).toBe(true); expect(map.containsKey(5)).toBe(false);
    expect(meter.usage.allocatedBytes).toBe(before);
  });
  it("hashes even when key membership is tested on empty storage", () => {
    const error = new Error("hash failed");
    const map = new OrderedKeyMap<number, unknown>({ hash: () => { throw error; }, equal: () => true }, fixture().meter);
    expect(() => map.containsKey(1)).toThrow(error);
  });
  it("compares values stored-first in insertion order and stops at a match", () => {
    const { map } = fixture(), first = {}, second = {}, needle = {}, calls: unknown[] = [];
    map.set(1, first); map.set(2, second); map.set(3, {});
    expect(map.containsValue(needle, (stored, incoming) => { calls.push([stored, incoming]); return stored === second; })).toBe(true);
    expect(calls).toEqual([[first, needle], [second, needle]]);
  });
  it("uses value identity without invoking equality or hashing the needle", () => {
    const { map } = fixture(), value = {}; map.set(1, value);
    expect(map.containsValue(value, () => { throw new Error("equality"); })).toBe(true);
    expect(map.containsValue({}, () => false)).toBe(false);
  });
  it("checks an item's key before comparing its value and retains undefined", () => {
    const { map, meter } = fixture(); map.set(1, undefined); const before = meter.usage.allocatedBytes;
    expect(map.containsItem(2, undefined, () => { throw new Error("unexpected equality"); })).toBe(false);
    expect(map.containsItem(1, undefined, () => false)).toBe(true);
    expect(map.containsItem(1, 3, (stored, incoming) => stored === undefined && incoming === 3)).toBe(true);
    expect(meter.usage.allocatedBytes).toBe(before);
  });
  it("detects size changes during value equality before visiting further entries", () => {
    const { map } = fixture(), first = {}, appended = {}, needle = {}; map.set(1, first);
    expect(() => map.containsValue(needle, stored => { if (stored === first) map.set(2, appended); return stored === appended; })).toThrow("dictionary changed size during iteration");
  });
  it("propagates value equality errors", () => {
    const { map } = fixture(), error = new Error("comparison failed"); map.set(1, {});
    expect(() => map.containsValue({}, () => { throw error; })).toThrow(error);
    expect(() => map.containsItem(1, {}, () => { throw error; })).toThrow(error);
  });
  it("checks limits for all membership modes before doing work", () => {
    let fail = false;
    const map = new OrderedKeyMap<number, unknown>({ hash: BigInt, equal: () => true }, { checkpoint: () => { if (fail) throw new ExecutionLimitError("steps"); } });
    fail = true;
    expect(() => map.containsKey(1)).toThrow(ExecutionLimitError);
    expect(() => map.containsValue(1, () => true)).toThrow(ExecutionLimitError);
    expect(() => map.containsItem(1, 1, () => true)).toThrow(ExecutionLimitError);
  });
});
