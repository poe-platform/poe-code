import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
interface Key { name: string; hash: bigint }
const key = (name: string, hash = 0n): Key => ({ name, hash });

describe("ordered Python-key mapping storage", () => {
  it("distinguishes missing entries from stored undefined and preserves original keys", () => {
    const map = new OrderedKeyMap<Key, number | undefined>({ hash: k => k.hash, equal: (a, b) => a.name === b.name }, budget());
    const first = key("a"), equal = key("a"), second = key("b");
    map.set(first, 1); map.set(second, 2); map.set(equal, undefined);
    expect(map.size).toBe(2); expect(map.lookup(equal)).toEqual({ value: undefined });
    expect(map.lookup(key("missing"))).toBeUndefined();
    const rows = map.snapshot(); expect(rows).toEqual([[first, undefined], [second, 2]]); expect(rows[0][0]).toBe(first);
    expect(Object.isFrozen(rows)).toBe(true); expect(Object.isFrozen(rows[0])).toBe(true); expect(Object.isFrozen(first)).toBe(false);
  });
  it("resolves collisions and appends a deleted then reinserted key", () => {
    const map = new OrderedKeyMap<Key, number>({ hash: k => k.hash, equal: (a, b) => a.name === b.name }, budget());
    const a = key("a"), b = key("b"), c = key("c", 1n);
    map.set(a, 1); map.set(b, 2); map.set(c, 3);
    expect(map.delete(key("a"))).toBe(true); expect(map.delete(a)).toBe(false);
    map.set(a, 4); expect(map.snapshot()).toEqual([[b, 2], [c, 3], [a, 4]]);
    map.clear(); expect(map.size).toBe(0); expect(map.lookup(a)).toBeUndefined();
  });
  it("hashes once per operation and compares stored keys first, skipping identical keys", () => {
    const calls: unknown[] = [], a = key("a"), other = key("a");
    const map = new OrderedKeyMap<Key, number>({ hash: k => { calls.push(k); return k.hash; }, equal: (x, y) => { calls.push([x, y]); return x.name === y.name; } }, budget());
    map.set(a, 1); calls.length = 0;
    expect(map.lookup(a)).toEqual({ value: 1 }); expect(calls).toEqual([a]); calls.length = 0;
    expect(map.lookup(other)).toEqual({ value: 1 }); expect(calls).toEqual([other, [a, other]]);
  });
  it("does not compare keys with different hashes", () => {
    const map = new OrderedKeyMap<Key, number>({ hash: k => k.hash, equal: () => { throw new Error("unexpected equality"); } }, budget());
    map.set(key("a", 1n), 1); expect(map.lookup(key("a", 2n))).toBeUndefined();
  });
  it("restarts when equality removes the candidate and replaces its bucket", () => {
    const stored = key("a"), replacement = key("a"), probe = key("a");
    let mutated = false;
    const map = new OrderedKeyMap<Key, number>({ hash: k => k.hash, equal: () => {
      if (!mutated) { mutated = true; map.clear(); map.set(replacement, 2); }
      return true;
    } }, budget());
    map.set(stored, 1); expect(map.lookup(probe)).toEqual({ value: 2 });
    expect(map.snapshot()[0][0]).toBe(replacement);
  });
  it("reads a value updated by equality and does not overwrite a removed candidate", () => {
    const stored = key("a"), probe = key("a"); let update = true;
    const map = new OrderedKeyMap<Key, number>({ hash: k => k.hash, equal: () => { if (update) { update = false; map.set(stored, 7); } return true; } }, budget());
    map.set(stored, 1); expect(map.lookup(probe)).toEqual({ value: 7 });
    expect(map.size).toBe(1);
  });
  it("propagates hash/equality failures without inserting the requested item", () => {
    const failure = new Error("failed");
    const map = new OrderedKeyMap<Key, number>({ hash: k => { if (k.name === "hash-error") throw failure; return k.hash; }, equal: () => { throw failure; } }, budget());
    const first = key("a"); map.set(first, 1);
    expect(() => map.set(key("hash-error"), 2)).toThrow(failure);
    expect(() => map.set(key("b"), 2)).toThrow(failure);
    expect(map.snapshot()).toEqual([[first, 1]]);
  });
  it("bounds pathological mutation during equality", () => {
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100000 });
    const map = new OrderedKeyMap<Key, number>({ hash: k => k.hash, equal: () => { map.clear(); map.set(key("a"), 1); return true; } }, meter);
    map.set(key("a"), 1); expect(() => map.lookup(key("a"))).toThrow(ExecutionLimitError);
  });
  it("reserves new-entry storage before mutating the map", () => {
    let reject = false;
    const meter = { checkpoint: (_steps = 1, bytes = 0) => { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); } };
    const map = new OrderedKeyMap<Key, number>({ hash: k => k.hash, equal: (a, b) => a.name === b.name }, meter);
    map.set(key("a"), 1); reject = true;
    expect(() => map.set(key("b"), 2)).toThrow(ExecutionLimitError);
    reject = false; expect(map.size).toBe(1); expect(map.lookup(key("b"))).toBeUndefined();
  });
});
