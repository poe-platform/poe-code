import { describe, expect, it } from "vitest";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { ExecutionBudget } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("direct ordered-map updates", () => {
  it("overwrites existing values, retaining destination keys and insertion order", () => {
    const operations: KeyOperations<{ id: number }> = { hash: k => BigInt(k.id), equal: (a, b) => a.id === b.id };
    const meter = budget(), target = new OrderedKeyMap(operations, meter), source = new OrderedKeyMap(operations, meter);
    const original = { id: 1 }, equal = { id: 1 }, next = { id: 2 };
    target.set(original, "old"); source.set(equal, "new"); source.set(next, "second"); target.update(source);
    expect(target.snapshot()).toEqual([[original, "new"], [next, "second"]]); expect(target.snapshot()[0][0]).toBe(original);
    expect(source.snapshot()[0][0]).toBe(equal);
  });
  it("reuses hashes when both maps share their operations object", () => {
    let forbidden = false;
    const operations: KeyOperations<number> = { hash: k => { if (forbidden) throw new Error("rehash"); return BigInt(k); }, equal: (a, b) => a === b };
    const source = new OrderedKeyMap<number, number>(operations, budget()), target = new OrderedKeyMap<number, number>(operations, budget());
    source.set(1, 2); forbidden = true; target.update(source); expect(target.snapshot()).toEqual([[1, 2]]);
  });
  it("rehashes for a destination with a different hash policy", () => {
    const source = new OrderedKeyMap<number, number>({ hash: BigInt, equal: (a, b) => a === b }, budget());
    const calls: number[] = [], target = new OrderedKeyMap<number, number>({ hash: k => { calls.push(k); return BigInt(k + 100); }, equal: (a, b) => a === b }, budget());
    source.set(1, 2); target.update(source); expect(calls).toEqual([1]); expect(target.lookup(1)).toEqual({ value: 2 });
  });
  it("does nothing for self-updates, even with keys whose hash now raises", () => {
    let forbidden = false;
    const map = new OrderedKeyMap<number, number>({ hash: k => { if (forbidden) throw new Error("rehash"); return BigInt(k); }, equal: (a, b) => a === b }, budget());
    map.set(1, 1); forbidden = true; map.update(map); expect(map.snapshot()).toEqual([[1, 1]]);
  });
  it("reports source size mutation after preserving the current successful insertion", () => {
    let changed = false;
    const operations: KeyOperations<number> = { hash: () => 1n, equal: (a, b) => {
      if (!changed) { changed = true; source.set(3, 3); }
      return a === b;
    } };
    const source = new OrderedKeyMap<number, number>(operations, budget()), target = new OrderedKeyMap<number, number>(operations, budget());
    source.set(2, 2); target.set(1, 1);
    expect(() => target.update(source)).toThrow("dict mutated during update");
    expect(target.snapshot()).toEqual([[1, 1], [2, 2]]); expect(source.size).toBe(2);
  });
  it("captures an incoming value before equality updates the source value", () => {
    let changed = false;
    const operations: KeyOperations<number> = { hash: () => 1n, equal: (a, b) => {
      if (!changed) { changed = true; source.set(2, 99); }
      return a === b;
    } };
    const source = new OrderedKeyMap<number, number>(operations, budget()), target = new OrderedKeyMap<number, number>(operations, budget());
    source.set(2, 2); target.set(1, 1); target.update(source);
    expect(target.lookup(2)).toEqual({ value: 2 }); expect(source.lookup(2)).toEqual({ value: 99 });
  });
  it("preserves earlier merged entries after destination equality fails", () => {
    const error = new Error("equality failed"); let fail = false;
    const operations: KeyOperations<number> = { hash: k => k === 3 ? 1n : BigInt(k), equal: (a, b) => { if (fail) throw error; return a === b; } };
    const source = new OrderedKeyMap<number, number>(operations, budget()), target = new OrderedKeyMap<number, number>(operations, budget());
    target.set(1, 1); source.set(2, 2); source.set(3, 3); fail = true;
    expect(() => target.update(source)).toThrow(error); expect(target.snapshot()).toEqual([[1, 1], [2, 2]]);
  });
});
