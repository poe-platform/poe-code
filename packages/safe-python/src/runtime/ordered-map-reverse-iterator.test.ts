import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 1000000 });
  const map = new OrderedKeyMap<number, string>({ hash: BigInt, equal: (a, b) => a === b }, meter);
  for (let i = 1; i <= 3; i++) map.set(i, String(i));
  return { map, meter };
}

describe("ordered mapping reverse iteration", () => {
  it("visits keys, values and items in reverse insertion order", () => {
    const { map } = fixture(), keys = map.reversed(key => key);
    expect(keys[Symbol.iterator]()).toBe(keys); expect(keys.lengthHint()).toBe(3);
    expect([...keys]).toEqual([3, 2, 1]);
    expect([...map.reversed((_key, value) => value)]).toEqual(["3", "2", "1"]);
    expect([...map.reversed((key, value) => [key, value])]).toEqual([[3, "3"], [2, "2"], [1, "1"]]);
  });
  it("sees value-only updates without changing key order", () => {
    const { map } = fixture(), it = map.reversed((_key, value) => value); expect(it.next().value).toBe("3");
    map.set(2, "updated"); expect(it.next().value).toBe("updated"); expect(it.lengthHint()).toBe(1);
  });
  it("skips deleted pending entries and does not visit newly appended replacements", () => {
    const { map } = fixture(), it = map.reversed(key => key); expect(it.next().value).toBe(3);
    map.delete(2); map.set(4, "4"); expect([...it]).toEqual([1]);
  });
  it("can traverse past several deleted pending entries", () => {
    const { map } = fixture(), it = map.reversed(key => key); expect(it.next().value).toBe(3);
    map.delete(2); map.delete(1); map.set(4, "4"); map.set(5, "5");
    expect(it.next()).toEqual({ done: true, value: undefined }); expect(it.lengthHint()).toBe(0);
  });
  it("latches size errors after observation but permits unobserved restoration", () => {
    const { map } = fixture(), failed = map.reversed(key => key), restored = map.reversed(key => key);
    map.set(4, "4"); expect(failed.lengthHint()).toBe(0);
    expect(() => failed.next()).toThrow("dictionary changed size during iteration"); map.delete(4);
    expect(() => failed.next()).toThrow("dictionary changed size during iteration");
    expect([...restored]).toEqual([3, 2, 1]);
  });
  it("stays exhausted after new insertions", () => {
    const { map } = fixture(), it = map.reversed(key => key); expect([...it]).toEqual([3, 2, 1]);
    map.clear(); map.set(9, "9"); expect(it.next()).toEqual({ done: true, value: undefined });
  });
  it("advances before a projection error", () => {
    const { map } = fixture(), error = new Error("failed"), it = map.reversed(key => { if (key === 3) throw error; return key; });
    expect(() => it.next()).toThrow(error); expect(it.next().value).toBe(2);
  });
  it("uses fixed cursor storage rather than allocating a reversed snapshot", () => {
    const { map, meter } = fixture(); for (let i = 4; i < 1000; i++) map.set(i, String(i));
    const before = meter.usage.allocatedBytes; const it = map.reversed(key => key);
    expect(meter.usage.allocatedBytes - before).toBe(48); expect(it.next().value).toBe(999);
  });
});
