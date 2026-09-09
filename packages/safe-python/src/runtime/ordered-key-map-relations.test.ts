import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("key disjointness and streaming intersection", () => {
  it("chooses the smaller disjointness source and uses foreign destination hashes", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), events: string[] = [];
    const a = new OrderedKeyMap<string, number>({ hash: key => { events.push(`a:${key}`); return 1n; }, equal: (a, b) => a === b }, meter);
    const b = new OrderedKeyMap<string, number>({ hash: key => { events.push(`b:${key}`); return 2n; }, equal: (a, b) => a === b }, meter);
    a.set("a", 1); b.set("a", 2); b.set("b", 3); events.length = 0;
    expect(a.isKeyDisjointFrom(b)).toBe(false); expect(events).toEqual(["b:a"]);
    events.length = 0; expect(b.isKeyDisjointFrom(a)).toBe(false); expect(events).toEqual(["b:a"]);
  });

  it("hashes each generic input once and retains incoming key identities", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }); let hashes = 0;
    const keys = { hash: () => { hashes++; return 1n; }, equal: (a: { id: number }, b: { id: number }) => a.id === b.id };
    const map = new OrderedKeyMap<{ id: number }, number>(keys, meter), stored = { id: 1 }, incoming = { id: 1 };
    map.set(stored, 7); map.seal(); hashes = 0;
    const iterator = [incoming, { id: 2 }][Symbol.iterator]();
    const result = map.intersectKeysFrom(() => iterator, 8);
    expect(hashes).toBe(1); expect(result.snapshot()[0][0]).toBe(incoming); expect(result.snapshot()[0][1]).toBe(8);
    expect(iterator.next().value).toEqual({ id: 2 });
    result.clear(); expect(map.size).toBe(1);
  });

  it("does not acquire input iteration when result allocation fails", () => {
    let reject = false, called = false;
    const map = new OrderedKeyMap<number, number>({ hash: () => 1n, equal: () => true }, { checkpoint(_steps = 1, bytes = 0) { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); } });
    reject = true;
    expect(() => map.intersectKeysFrom(() => { called = true; return [1][Symbol.iterator](); }, 0)).toThrow(ExecutionLimitError);
    expect(called).toBe(false);
  });

  it("observes iterator cancellation before hashing or returning a result", () => {
    let cancelled = false, hashes = 0;
    const map = new OrderedKeyMap<number, number>({ hash: () => { hashes++; return 1n; }, equal: () => true }, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    expect(() => map.intersectKeysFrom(() => ({ next() { cancelled = true; return { done: false, value: 1 }; } }), 0)).toThrow(ExecutionLimitError);
    expect(hashes).toBe(0);
  });
});
