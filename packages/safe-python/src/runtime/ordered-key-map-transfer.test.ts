import { describe, expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

describe("private key-storage transfer", () => {
  it("empties the source and keeps subsequent mutations independent", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), keys = { hash: (key: number) => BigInt(key), equal: (a: number, b: number) => a === b };
    const a = new OrderedKeyMap<number, number>(keys, meter), b = new OrderedKeyMap<number, number>(keys, meter);
    a.set(1, 10); b.set(2, 20); a.takeContents(b);
    expect(a.snapshot()).toEqual([[2, 20]]); expect(b.size).toBe(0);
    b.set(3, 30); expect(a.popitem()).toEqual([2, 20]); expect(b.snapshot()).toEqual([[3, 30]]);
    a.set(4, 40); expect(a.lookup(4)).toEqual({ value: 40 });
  });

  it("rejects transfers between different execution meters", () => {
    const keys = { hash: () => 1n, equal: () => true }, make = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
    const a = new OrderedKeyMap<number, number>(keys, make()), b = new OrderedKeyMap<number, number>(keys, make());
    b.set(1, 2); expect(() => a.takeContents(b)).toThrow("cannot transfer keys across execution domains");
    expect(a.size).toBe(0); expect(b.size).toBe(1);
  });

  it("rejects sealed sources without modifying either storage", () => {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), keys = { hash: () => 1n, equal: () => true };
    const a = new OrderedKeyMap<number, number>(keys, meter), b = new OrderedKeyMap<number, number>(keys, meter);
    b.set(1, 2); b.seal(); expect(() => a.takeContents(b)).toThrow("key storage is sealed");
    expect(a.size).toBe(0); expect(b.size).toBe(1);
  });

  it("rejects transfer allocation before destroying old entries", () => {
    let reject = false;
    const meter = { checkpoint(_steps = 1, bytes = 0) { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); } }, keys = { hash: (key: number) => BigInt(key), equal: (a: number, b: number) => a === b };
    const a = new OrderedKeyMap<number, number>(keys, meter), b = new OrderedKeyMap<number, number>(keys, meter);
    a.set(1, 10); b.set(2, 20); reject = true;
    expect(() => a.takeContents(b)).toThrow(ExecutionLimitError); reject = false;
    expect(a.snapshot()).toEqual([[1, 10]]); expect(b.snapshot()).toEqual([[2, 20]]);
  });
});
