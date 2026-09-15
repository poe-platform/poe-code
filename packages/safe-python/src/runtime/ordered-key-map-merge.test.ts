import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("set-style storage merges", () => {
  it.each(["|", "^"] as const)("rehashes foreign-domain %s inputs with the destination policy", operator => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), hashes: string[] = [];
    const a = new OrderedKeyMap<string, number>({ hash: key => { hashes.push(key); return 1n; }, equal: (a, b) => a === b }, meter);
    const b = new OrderedKeyMap<string, number>({ hash: () => 2n, equal: (a, b) => a === b }, meter);
    a.set("a", 1); b.set("a", 2); b.set("b", 3); hashes.length = 0;
    a.mergeKeysInPlace(b, operator); expect(hashes).toEqual(["a", "b"]);
    expect(a.snapshot()).toEqual(operator === "|" ? [["a", 1], ["b", 3]] : [["b", 3]]);
  });

  it("performs xor discard and insertion lookups separately", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }); let comparisons = 0;
    const keys = { hash: () => 1n, equal: () => ++comparisons === 2 };
    const a = new OrderedKeyMap<string, number>(keys, meter), b = new OrderedKeyMap<string, number>(keys, meter);
    a.set("a", 1); b.set("b", 2); a.mergeKeysInPlace(b, "^");
    expect(comparisons).toBe(2); expect(a.snapshot()).toEqual([["a", 1]]);
  });

  it.each(["|", "^"] as const)("allows source clearing during %s equality without dictionary mutation errors", operator => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const keys = { hash: () => 1n, equal: () => { b.clear(); return false; } };
    const a = new OrderedKeyMap<string, number>(keys, meter), b = new OrderedKeyMap<string, number>(keys, meter);
    a.set("a", 1); b.set("b", 2); a.mergeKeysInPlace(b, operator);
    expect(a.snapshot()).toEqual([["a", 1], ["b", 2]]); expect(b.size).toBe(0);
  });

  it.each(["|", "^"] as const)("checks cancellation after %s equality before writing", operator => {
    let cancelled = false;
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    const keys = { hash: () => 1n, equal: () => { cancelled = true; return false; } };
    const a = new OrderedKeyMap<string, number>(keys, meter), b = new OrderedKeyMap<string, number>(keys, meter);
    a.set("a", 1); b.set("b", 2);
    expect(() => a.mergeKeysInPlace(b, operator)).toThrow(ExecutionLimitError);
    cancelled = false; expect(a.snapshot()).toEqual([["a", 1]]);
  });
});
