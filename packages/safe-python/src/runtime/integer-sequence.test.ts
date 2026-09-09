import { describe, expect, it } from "vitest";
import { createRange, normalizeSlice, rangeItem, rangeIndexOf, rangesEqual, sliceRange } from "./integer-sequence.js";

describe("integer sequence indexing", () => {
  it.each([
    [null, null, null, 0n, 5n, 1n, 5n],
    [null, null, -1n, 4n, -1n, -1n, 5n],
    [null, -1n, -1n, 4n, 4n, -1n, 0n],
    [-100n, 100n, 1n, 0n, 5n, 1n, 5n],
    [100n, -100n, -2n, 4n, -1n, -2n, 3n],
    [4n, 1n, 1n, 4n, 1n, 1n, 0n],
    [-3n, -1n, null, 2n, 4n, 1n, 2n]
  ])("normalizes slice(%s, %s, %s)", (start, stop, step, expectedStart, expectedStop, expectedStep, length) => {
    expect(normalizeSlice(5n, start, stop, step)).toEqual({ start: expectedStart, stop: expectedStop, step: expectedStep, length });
  });

  it("handles empty sequences and arbitrarily large bounds", () => {
    expect(normalizeSlice(0n, null, null, -1n)).toEqual({ start: -1n, stop: -1n, step: -1n, length: 0n });
    const huge = 10n ** 100n;
    expect(normalizeSlice(huge, -huge * 2n, huge * 2n, 3n)).toEqual({ start: 0n, stop: huge, step: 3n, length: (huge + 2n) / 3n });
    expect(normalizeSlice(5n, null, null, huge).length).toBe(1n);
  });

  it("rejects invalid slice lengths and zero steps", () => {
    expect(() => normalizeSlice(-1n)).toThrow(expect.objectContaining({ name: "ValueError", message: "length should not be negative" }));
    expect(() => normalizeSlice(0n, null, null, 0n)).toThrow(expect.objectContaining({ name: "ValueError", message: "slice step cannot be zero" }));
  });

  it.each([[0n, 10n, 3n, 4n], [10n, 0n, -3n, 4n], [0n, 10n, -1n, 0n], [10n, 0n, 1n, 0n], [2n, 2n, 5n, 0n]])("constructs range(%s, %s, %s) with length %s", (start, stop, step, length) => {
    const range = createRange(start, stop, step);
    expect(range).toEqual({ start, stop, step, length });
    expect(Object.isFrozen(range)).toBe(true);
  });

  it("indexes and searches enormous ranges without materializing them", () => {
    const huge = 10n ** 100n;
    const range = createRange(-huge, huge, 2n);
    expect(range.length).toBe(huge);
    expect(rangeItem(range, 0n)).toBe(-huge);
    expect(rangeItem(range, -1n)).toBe(huge - 2n);
    expect(rangeItem(range, -huge)).toBe(-huge);
    expect(rangeIndexOf(range, 0n)).toBe(huge / 2n);
    expect(rangeIndexOf(range, 1n)).toBeUndefined();
    expect(rangeIndexOf(range, huge)).toBeUndefined();
    expect(rangeIndexOf(range, -huge - 2n)).toBeUndefined();
  });

  it("finds indices in descending ranges", () => {
    const range = createRange(10n, -10n, -3n);
    expect(rangeIndexOf(range, -8n)).toBe(6n);
    expect(rangeIndexOf(range, 11n)).toBeUndefined();
    expect(rangeIndexOf(range, 9n)).toBeUndefined();
    expect(rangeItem(range, -2n)).toBe(-5n);
  });

  it("rejects invalid range steps and indices", () => {
    expect(() => createRange(0n, 1n, 0n)).toThrow(expect.objectContaining({ name: "ValueError", message: "range() arg 3 must not be zero" }));
    for (const index of [-4n, 3n, 10n ** 100n]) {
      expect(() => rangeItem(createRange(0n, 3n), index)).toThrow(expect.objectContaining({ name: "IndexError", message: "range object index out of range" }));
    }
    expect(() => rangeItem(createRange(0n, 0n), 0n)).toThrow(expect.objectContaining({ name: "IndexError" }));
  });

  it("preserves slice-derived range attributes even for empty or singleton results", () => {
    expect(sliceRange(createRange(2n, 10n, 3n), null, null, -1n)).toEqual(createRange(8n, -1n, -3n));
    expect(sliceRange(createRange(2n, 10n, 3n), 2n, 1n)).toEqual(createRange(8n, 5n, 3n));
    expect(sliceRange(createRange(2n, 3n, 8n), null, null, -1n)).toEqual(createRange(2n, -6n, -8n));
    expect(sliceRange(createRange(0n, 0n), null, null, -1n)).toEqual(createRange(-1n, -1n, -1n));
  });

  it("compares ranges by sequence contents rather than their attributes", () => {
    expect(rangesEqual(createRange(0n, 0n), createRange(3n, 1n, 8n))).toBe(true);
    expect(rangesEqual(createRange(2n, 3n), createRange(2n, 10n, 9n))).toBe(true);
    expect(rangesEqual(createRange(0n, 3n, 2n), createRange(0n, 4n, 2n))).toBe(true);
    expect(rangesEqual(createRange(0n, 3n, 2n), createRange(0n, 6n, 3n))).toBe(false);
    expect(rangesEqual(createRange(0n, 1n), createRange(1n, 2n))).toBe(false);
    expect(rangesEqual(createRange(0n, 1n), createRange(0n, 2n))).toBe(false);
  });
});
