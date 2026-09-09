import { describe, expect, it } from "vitest";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const list = (values = [0, 1, 2, 3, 4]) => new ListStorage(values, budget());

describe("mutable list slicing", () => {
  it("returns independent slots while preserving element identities", () => {
    const value = {}, source = new ListStorage([value], budget()), copy = source.slice();
    expect(copy).not.toBe(source); expect(copy.get(0n)).toBe(value);
    copy.clear(); expect(source.length).toBe(1);
  });
  it.each([
    [null, null, -1n, [4, 3, 2, 1, 0]],
    [1n, 5n, 2n, [1, 3]],
    [-100n, 100n, null, [0, 1, 2, 3, 4]],
    [null, null, 1n << 100n, [0]],
    [null, null, -(1n << 100n), [4]],
    [4n, 1n, null, []]
  ] as const)("reads bounds %s:%s:%s", (start, stop, step, expected) => {
    expect(list().slice(start, stop, step).snapshot()).toEqual(expected);
  });
  it.each([
    [1n, 3n, [8, 9, 10], [0, 8, 9, 10, 3, 4]],
    [1n, 4n, [8], [0, 8, 4]],
    [4n, 1n, [8, 9], [0, 1, 2, 3, 8, 9, 4]],
    [-100n, 100n, [], []]
  ] as const)("resizes a contiguous slice %s:%s", (start, stop, replacement, expected) => {
    const source = list(); source.setSlice(start, stop, null, new ListStorage(replacement, budget()));
    expect(source.snapshot()).toEqual(expected);
  });
  it("replaces extended slices in traversal order", () => {
    const source = list(); source.setSlice(null, null, -2n, list([8, 9, 10]));
    expect(source.snapshot()).toEqual([10, 1, 9, 3, 8]);
  });
  it("copies self replacement before overwriting overlapping slots", () => {
    const source = list(); source.setSlice(null, null, -1n, source);
    expect(source.snapshot()).toEqual([4, 3, 2, 1, 0]);
    source.setSlice(1n, 4n, null, source);
    expect(source.snapshot()).toEqual([4, 4, 3, 2, 1, 0, 0]);
  });
  it("rejects an extended replacement size mismatch without mutation", () => {
    const source = list();
    expect(() => source.setSlice(null, null, 2n, list([]))).toThrow(expect.objectContaining({
      name: "ValueError", message: "attempt to assign sequence of size 0 to extended slice of size 3"
    }));
    expect(source.snapshot()).toEqual([0, 1, 2, 3, 4]);
  });
  it.each([2n, -2n])("deletes extended slice with step %s in stable order", step => {
    const source = list(); source.deleteSlice(null, null, step); expect(source.snapshot()).toEqual([1, 3]);
  });
  it("deletes contiguous slices and treats empty selections as no-ops", () => {
    const source = list(); source.deleteSlice(4n, 1n); expect(source.snapshot()).toEqual([0, 1, 2, 3, 4]);
    source.deleteSlice(1n, 4n); expect(source.snapshot()).toEqual([0, 4]);
    source.deleteSlice(); expect(source.snapshot()).toEqual([]);
  });
  it("handles single-element deletions with unrepresentably large strides", () => {
    const source = list(); source.deleteSlice(null, null, -(1n << 100n));
    expect(source.snapshot()).toEqual([0, 1, 2, 3]);
  });
  it("rejects zero steps in all three operations", () => {
    const source = list();
    for (const run of [() => source.slice(null, null, 0n), () => source.deleteSlice(null, null, 0n),
      () => source.setSlice(null, null, 0n, source)]) {
      expect(run).toThrow(expect.objectContaining({ name: "ValueError", message: "slice step cannot be zero" }));
    }
    expect(source.snapshot()).toEqual([0, 1, 2, 3, 4]);
  });
  it("keeps existing iterators attached to the mutated owned slots", () => {
    const source = list(), cursor = source.iterate(); expect(cursor.next().value).toBe(0);
    source.setSlice(1n, 4n, null, list([8])); expect([...cursor]).toEqual([8, 4]);
    const again = source.iterate(); source.deleteSlice(0n, 1n); expect([...again]).toEqual([8, 4]);
  });
  it("preflights mutation work and growth before changing any slots", () => {
    let reject = false;
    const meter = { checkpoint: (steps = 1, bytes = 0) => {
      if (reject && (steps > 1 || bytes > 0)) throw new ExecutionLimitError("steps");
    } };
    const source = new ListStorage([0, 1, 2, 3, 4], meter); reject = true;
    expect(() => source.setSlice(1n, 2n, null, list([8, 9]))).toThrow(ExecutionLimitError);
    expect(() => source.deleteSlice(null, null, 2n)).toThrow(ExecutionLimitError);
    reject = false; expect(source.snapshot()).toEqual([0, 1, 2, 3, 4]);
  });
});
