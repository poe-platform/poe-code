import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

interface Key { name: string }
function fixture() {
  const calls: unknown[] = [];
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const map = new OrderedKeyMap<Key, number | undefined>({
    hash: key => { calls.push(key); return 1n; },
    equal: (a, b) => { calls.push([a, b]); return a.name === b.name; }
  }, meter);
  return { map, calls };
}

describe("ordered key-map default and removal operations", () => {
  it("setdefault hashes once and inserts only when absent", () => {
    const { map, calls } = fixture(), first = { name: "a" }, probe = { name: "a" };
    expect(map.setdefault(first, 1)).toBe(1); expect(calls).toEqual([first]); calls.length = 0;
    expect(map.setdefault(probe, 2)).toBe(1); expect(calls).toEqual([probe, [first, probe]]);
    expect(map.snapshot()).toEqual([[first, 1]]); expect(map.snapshot()[0][0]).toBe(first);
  });
  it("setdefault retains stored undefined and appends genuinely new keys", () => {
    const { map } = fixture(), a = { name: "a" }, b = { name: "b" };
    map.set(a, undefined); expect(map.setdefault({ name: "a" }, 1)).toBeUndefined();
    expect(map.setdefault(b, 2)).toBe(2); expect(map.snapshot()).toEqual([[a, undefined], [b, 2]]);
  });
  it("pop hashes once, returns the current value, and preserves absence", () => {
    const { map, calls } = fixture(), stored = { name: "a" }, probe = { name: "a" };
    map.set(stored, undefined); calls.length = 0;
    const result = map.pop(probe); expect(result).toEqual({ value: undefined }); expect(Object.isFrozen(result)).toBe(true);
    expect(calls).toEqual([probe, [stored, probe]]); expect(map.size).toBe(0); calls.length = 0;
    expect(map.pop(probe)).toBeUndefined(); expect(calls).toEqual([]);
  });
  it("removes only the matching collision and allows reinsertion at the end", () => {
    const { map } = fixture(), a = { name: "a" }, b = { name: "b" };
    map.set(a, 1); map.set(b, 2); expect(map.pop({ name: "a" })).toEqual({ value: 1 });
    map.setdefault(a, 3); expect(map.snapshot()).toEqual([[b, 2], [a, 3]]);
  });
  it.each(["setdefault", "pop"] as const)("%s revalidates a candidate replaced by equality", operation => {
    const stored = { name: "a" }, replacement = { name: "a" }; let changed = false;
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 });
    const map = new OrderedKeyMap<Key, number>({ hash: () => 1n, equal: () => {
      if (!changed) { changed = true; map.clear(); map.set(replacement, 7); }
      return true;
    } }, meter);
    map.set(stored, 1);
    if (operation === "pop") { expect(map.pop({ name: "a" })).toEqual({ value: 7 }); expect(map.size).toBe(0); }
    else { expect(map.setdefault({ name: "a" }, 9)).toBe(7); expect(map.snapshot()[0][0]).toBe(replacement); }
  });
  it("does not remove an item if its result allocation is rejected", () => {
    let reject = false;
    const map = new OrderedKeyMap<Key, number>({ hash: () => 1n, equal: () => true }, {
      checkpoint: (_steps = 1, bytes = 0) => { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); }
    });
    const key = { name: "a" }; map.set(key, 1); reject = true;
    expect(() => map.pop(key)).toThrow(ExecutionLimitError);
    reject = false; expect(map.lookup(key)).toEqual({ value: 1 });
  });
  it("does not insert a default when its storage allocation is rejected", () => {
    let reject = false;
    const map = new OrderedKeyMap<Key, number>({ hash: () => 1n, equal: () => true }, {
      checkpoint: (_steps = 1, bytes = 0) => { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); }
    });
    reject = true; expect(() => map.setdefault({ name: "a" }, 1)).toThrow(ExecutionLimitError);
    reject = false; expect(map.size).toBe(0);
  });
  it("setdefault hashes on empty maps while pop skips the empty-map hash", () => {
    const error = new Error("unhashable");
    const map = new OrderedKeyMap<Key, number>({ hash: () => { throw error; }, equal: () => true }, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000 }));
    expect(map.pop({ name: "a" })).toBeUndefined();
    expect(() => map.setdefault({ name: "a" }, 1)).toThrow(error);
    expect(map.size).toBe(0);
  });
  it("pop propagates hash failures on nonempty maps", () => {
    const error = new Error("unhashable");
    const map = new OrderedKeyMap<Key, number>({ hash: key => { if (key.name === "bad") throw error; return 1n; }, equal: () => true }, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000 }));
    map.set({ name: "a" }, 1);
    expect(() => map.pop({ name: "bad" })).toThrow(error); expect(map.size).toBe(1);
  });
});
