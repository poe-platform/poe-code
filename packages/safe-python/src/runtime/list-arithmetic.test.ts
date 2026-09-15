import { describe, expect, it } from "vitest";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("list concatenation and repetition", () => {
  it("concatenates into independent slots and preserves element identities", () => {
    const a = {}, b = {}, left = new ListStorage([a], budget()), right = new ListStorage([b], budget());
    const result = left.concat(right); left.clear(); right.clear();
    expect(result.get(0n)).toBe(a); expect(result.get(1n)).toBe(b);
  });
  it("creates a new list even when concatenating an empty operand", () => {
    const list = new ListStorage([1], budget()), empty = new ListStorage<number>([], budget());
    expect(list.concat(empty)).not.toBe(list); expect(empty.concat(list)).not.toBe(list);
    expect(empty.concat(empty)).not.toBe(empty);
  });
  it.each([-3n, 0n, 1n, 3n])("repeats %s times without aliasing slots", count => {
    const item = {}, list = new ListStorage([item], budget()), result = list.repeat(count);
    expect(result).not.toBe(list); expect(result.length).toBe(count < 0n ? 0 : Number(count));
    for (const value of result.iterate()) expect(value).toBe(item);
    result.clear(); expect(list.length).toBe(1);
  });
  it("repeats in place while preserving the list and its live cursors", () => {
    const list = new ListStorage([1, 2], budget()), cursor = list.iterate(); cursor.next();
    list.repeatInPlace(3n); expect(list.snapshot()).toEqual([1, 2, 1, 2, 1, 2]);
    expect([...cursor]).toEqual([2, 1, 2, 1, 2]);
    list.repeatInPlace(1n); expect(list.length).toBe(6);
    list.repeatInPlace(-2n); expect(list.length).toBe(0);
  });
  it("allows empty lists with any representable count but still produces a new result", () => {
    const list = new ListStorage([], budget());
    expect(list.repeat((1n << 63n) - 1n)).not.toBe(list);
    list.repeatInPlace((1n << 63n) - 1n); expect(list.length).toBe(0);
  });
  it.each([-(1n << 100n), 1n << 100n])("validates count %s even for empty lists", count => {
    const list = new ListStorage([], budget());
    for (const run of [() => list.repeat(count), () => list.repeatInPlace(count)]) {
      expect(run).toThrow(expect.objectContaining({ name: "OverflowError", message: "cannot fit 'int' into an index-sized integer" }));
    }
  });
  it("raises guest MemoryError for index-sized product overflow", () => {
    const list = new ListStorage([1, 2], budget());
    for (const run of [() => list.repeat((1n << 63n) - 1n), () => list.repeatInPlace((1n << 63n) - 1n)]) {
      expect(run).toThrow(expect.objectContaining({ name: "MemoryError", message: "" }));
    }
    expect(list.snapshot()).toEqual([1, 2]);
  });
  it("terminates unrepresentable host slot growth before allocating", () => {
    const list = new ListStorage([1], budget()); expect(() => list.repeat(1n << 40n)).toThrow(ExecutionLimitError);
  });
  it("preflights in-place growth before mutating the original", () => {
    let reject = false;
    const list = new ListStorage([1, 2], { checkpoint: (_steps, bytes = 0) => {
      if (reject && bytes > 0) throw new ExecutionLimitError("allocation");
    } });
    reject = true; expect(() => list.repeatInPlace(4n)).toThrow(ExecutionLimitError);
    reject = false; expect(list.snapshot()).toEqual([1, 2]);
  });
});
