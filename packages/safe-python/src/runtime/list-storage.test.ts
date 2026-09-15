import { describe, expect, it } from "vitest";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("mutable list storage", () => {
  it("captures the reserved source length before reading element getters", () => {
    const input = [1, 2];
    Object.defineProperty(input, 0, { get: () => { input.push(3); return 1; } });
    expect(new ListStorage(input, budget()).snapshot()).toEqual([1, 2]);
  });
  it("copies input slots, shares elements, and exposes only detached snapshots", () => {
    const member = {}, input = [member], list = new ListStorage(input, budget()); input.length = 0;
    const snapshot = list.snapshot(); expect(snapshot).toEqual([member]); expect(snapshot[0]).toBe(member); expect(Object.isFrozen(snapshot)).toBe(true);
    list.append({}); expect(snapshot).toHaveLength(1); expect(list.length).toBe(2); expect(Object.isFrozen(member)).toBe(false);
  });
  it("gets and replaces negative-indexed elements without copying their values", () => {
    const list = new ListStorage([1, 2, 3], budget()); expect(list.get(-1n)).toBe(3);
    list.set(-2n, 9); expect(list.snapshot()).toEqual([1, 9, 3]);
  });
  it.each([[-99n, [9, 1, 2]], [-1n, [1, 9, 2]], [1n, [1, 9, 2]], [99n, [1, 2, 9]]] as const)("clips insertion index %s", (index, expected) => {
    const list = new ListStorage([1, 2], budget()); list.insert(index, 9); expect(list.snapshot()).toEqual(expected);
  });
  it("pops and deletes arbitrary positions while retaining remaining order", () => {
    const list = new ListStorage([1, 2, 3, 4], budget()); expect(list.pop(1n)).toBe(2); list.delete(-1n);
    expect(list.snapshot()).toEqual([1, 3]); expect(list.pop()).toBe(3); expect(list.pop()).toBe(1);
    expect(() => list.pop()).toThrow("pop from empty list");
  });
  it("uses operation-specific bounds and index conversion errors", () => {
    const list = new ListStorage<number>([], budget());
    expect(() => list.get(0n)).toThrow("list index out of range");
    expect(() => list.set(0n, 1)).toThrow("list assignment index out of range");
    expect(() => list.delete(0n)).toThrow("list assignment index out of range");
    const huge = 1n << 100n;
    expect(() => list.get(huge)).toThrow("cannot fit 'int' into an index-sized integer");
    expect(() => list.pop(huge)).toThrow("Python int too large to convert to C ssize_t");
    expect(() => list.insert(huge, 1)).toThrow("Python int too large to convert to C ssize_t");
    list.append(1); expect(() => list.pop(1n)).toThrow("pop index out of range");
  });
  it("reverses in place and clears without retaining element slots", () => {
    const list = new ListStorage([1, 2, 3, 4, 5], budget()); list.reverse(); expect(list.snapshot()).toEqual([5, 4, 3, 2, 1]);
    list.clear(); expect(list.length).toBe(0); list.reverse(); list.append(9); expect(list.snapshot()).toEqual([9]);
  });
  it("reserves append/insert storage before modifying slots", () => {
    let reject = false;
    const meter = { checkpoint: (_steps = 1, bytes = 0) => { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); } };
    const list = new ListStorage([1, 2], meter); reject = true;
    expect(() => list.append(3)).toThrow(ExecutionLimitError); expect(() => list.insert(0n, 3)).toThrow(ExecutionLimitError);
    reject = false; expect(list.snapshot()).toEqual([1, 2]);
  });
  it("preflights shifting work before a removal or reversal mutates storage", () => {
    let reject = false;
    const meter = { checkpoint: (steps = 1) => { if (reject && steps > 1) throw new ExecutionLimitError("steps"); } };
    const list = new ListStorage([1, 2, 3, 4, 5], meter); reject = true;
    expect(() => list.pop(0n)).toThrow(ExecutionLimitError); expect(() => list.reverse()).toThrow(ExecutionLimitError);
    reject = false; expect(list.snapshot()).toEqual([1, 2, 3, 4, 5]);
  });
});
