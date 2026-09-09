import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  const map = new OrderedKeyMap<number, string>({ hash: BigInt, equal: (a, b) => a === b }, meter);
  return { map, meter };
}

describe("ordered mapping popitem storage", () => {
  it("removes the most recently inserted entry, not the most recently updated", () => {
    const { map } = fixture(); map.set(1, "a"); map.set(2, "b"); map.set(1, "updated");
    const pair = map.popitem(); expect(pair).toEqual([2, "b"]); expect(Object.isFrozen(pair)).toBe(true);
    expect(map.popitem()).toEqual([1, "updated"]); expect(map.popitem()).toBeUndefined();
  });
  it.each([1, 2, 3])("unlinks deleted entry %i before removing the tail", removed => {
    const { map } = fixture(); for (let i = 1; i <= 3; i++) map.set(i, String(i));
    map.delete(removed);
    for (const i of [3, 2, 1].filter(i => i !== removed)) expect(map.popitem()).toEqual([i, String(i)]);
    expect(map.size).toBe(0); expect(map.snapshot()).toEqual([]);
  });
  it("updates links across pop, reinsertion and clear", () => {
    const { map } = fixture(); map.set(1, "a"); map.set(2, "b"); map.set(3, "c");
    map.pop(2); map.setdefault(2, "new"); expect(map.popitem()).toEqual([2, "new"]);
    map.clear(); expect(map.popitem()).toBeUndefined(); map.set(4, "d"); expect(map.popitem()).toEqual([4, "d"]);
  });
  it("does not rehash or compare the stored key", () => {
    let forbidden = false;
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 });
    const map = new OrderedKeyMap<object, number>({ hash: () => { if (forbidden) throw new Error("rehash"); return 1n; }, equal: () => { throw new Error("compare"); } }, meter);
    const key = {}; map.set(key, 1); forbidden = true;
    const pair = map.popitem(); expect(pair).toEqual([key, 1]); expect(pair![0]).toBe(key);
  });
  it("does not remove the entry if pair storage cannot be reserved", () => {
    let reject = false;
    const map = new OrderedKeyMap<number, string>({ hash: BigInt, equal: (a, b) => a === b }, {
      checkpoint: (_steps = 1, bytes = 0) => { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); }
    });
    map.set(1, "a"); reject = true; expect(() => map.popitem()).toThrow(ExecutionLimitError);
    reject = false; expect(map.snapshot()).toEqual([[1, "a"]]); expect(map.popitem()).toEqual([1, "a"]);
  });
  it("invalidates live iteration through the normal size check", () => {
    const { map } = fixture(); map.set(1, "a"); const iterator = map.iterate(key => key); map.popitem();
    expect(() => iterator.next()).toThrow("dictionary changed size during iteration");
  });
  it("uses bounded steps independently of map size", () => {
    const { map, meter } = fixture(); for (let i = 0; i < 1000; i++) map.set(i, String(i));
    const before = meter.usage.steps; expect(map.popitem()).toEqual([999, "999"]);
    expect(meter.usage.steps - before).toBeLessThanOrEqual(3);
  });
});
