import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const map = new OrderedKeyMap<number, string>({ hash: key => BigInt(key), equal: (a, b) => a === b }, meter);
  map.set(1, "a"); map.set(2, "b");
  return { map, meter };
}

describe("ordered mapping forward iteration", () => {
  it("captures size immediately and projects keys, values or pairs", () => {
    const { map } = fixture();
    const keys = map.iterate(key => key), values = map.iterate((_key, value) => value);
    expect(keys[Symbol.iterator]()).toBe(keys); expect(keys.lengthHint()).toBe(2);
    expect([...keys]).toEqual([1, 2]); expect([...values]).toEqual(["a", "b"]);
    expect([...map.iterate((key, value) => [key, value])]).toEqual([[1, "a"], [2, "b"]]);
  });
  it("observes value updates without invalidating iteration", () => {
    const { map } = fixture(), it = map.iterate((_key, value) => value);
    expect(it.next()).toEqual({ done: false, value: "a" });
    map.set(2, "updated"); expect(it.lengthHint()).toBe(1);
    expect(it.next()).toEqual({ done: false, value: "updated" });
  });
  it("latches observed size errors even if the size is later restored", () => {
    const { map } = fixture(), it = map.iterate(key => key); map.set(3, "c");
    expect(it.lengthHint()).toBe(0);
    expect(() => it.next()).toThrow("dictionary changed size during iteration");
    map.delete(3);
    expect(() => it.next()).toThrow("dictionary changed size during iteration"); expect(it.lengthHint()).toBe(0);
  });
  it("allows size restoration before next observes a mismatch", () => {
    const { map } = fixture(), it = map.iterate(key => key); map.set(3, "c");
    expect(it.lengthHint()).toBe(0); map.delete(3); expect(it.lengthHint()).toBe(2);
    expect([...it]).toEqual([1, 2]);
  });
  it("detects extra keys after a yielded key is deleted and replaced", () => {
    const { map } = fixture(), it = map.iterate(key => key); expect(it.next().value).toBe(1);
    map.delete(1); map.set(3, "c"); expect(it.next().value).toBe(2);
    expect(() => it.next()).toThrow("dictionary keys changed during iteration");
    expect(it.next()).toEqual({ done: true, value: undefined }); expect(it.lengthHint()).toBe(0);
  });
  it("can visit a replacement for a not-yet-yielded key", () => {
    const { map } = fixture(), it = map.iterate(key => key); expect(it.next().value).toBe(1);
    map.delete(2); map.set(3, "c"); expect([...it]).toEqual([3]);
  });
  it("stays exhausted after subsequent insertions", () => {
    const { map } = fixture(), it = map.iterate(key => key); expect([...it]).toEqual([1, 2]);
    map.set(3, "c"); expect(it.next()).toEqual({ done: true, value: undefined }); expect(it.lengthHint()).toBe(0);
  });
  it("advances before trusted projection errors and does not repeat the entry", () => {
    const { map } = fixture(), error = new Error("projection failed");
    const it = map.iterate(key => { if (key === 1) throw error; return key; });
    expect(() => it.next()).toThrow(error); expect(it.next().value).toBe(2);
  });
  it("checks the budget before invoking the projection", () => {
    let reject = false, calls = 0;
    const meter = { checkpoint: () => { if (reject) throw new ExecutionLimitError("steps"); } };
    const map = new OrderedKeyMap<number, number>({ hash: BigInt, equal: (a, b) => a === b }, meter);
    map.set(1, 1); const it = map.iterate(key => { calls++; return key; }); reject = true;
    expect(() => it.next()).toThrow(ExecutionLimitError); expect(calls).toBe(0);
  });
});
