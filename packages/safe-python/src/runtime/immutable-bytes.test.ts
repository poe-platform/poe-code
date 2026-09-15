import { describe, expect, it } from "vitest";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = (bytes = 100000) => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: bytes });
const bytes = (values: number[]) => ImmutableBytes.copyOf(Uint8Array.from(values), budget());

describe("immutable byte storage", () => {
  it("owns a snapshot of all byte values", () => {
    const input = Uint8Array.from({ length: 256 }, (_, index) => index), value = ImmutableBytes.copyOf(input, budget());
    input.fill(0);
    expect([...value]).toEqual(Array.from({ length: 256 }, (_, index) => index));
    expect(value.length).toBe(256); expect(Object.isFrozen(value)).toBe(true);
  });
  it("returns independent mutable exports without exposing internal storage", () => {
    const value = bytes([1, 2, 3]), first = value.toUint8Array(budget()), second = value.toUint8Array(budget());
    first[0] = 99;
    expect([...value]).toEqual([1, 2, 3]); expect([...second]).toEqual([1, 2, 3]);
  });
  it("indexes with exact negative indices", () => {
    const value = bytes([0, 127, 255]);
    expect(value.byteAt(0n, budget())).toBe(0);
    expect(value.byteAt(-1n, budget())).toBe(255);
    expect(value.byteAt(-3n, budget())).toBe(0);
  });
  it.each([-4n, 3n, -(1n << 63n), (1n << 63n) - 1n])("reports ordinary index bounds for %s", index => {
    expect(() => bytes([1, 2, 3]).byteAt(index, budget())).toThrow("index out of range");
  });
  it.each([-(1n << 63n) - 1n, 1n << 63n])("rejects oversized index %s before sequence bounds", index => {
    expect(() => bytes([]).byteAt(index, budget())).toThrow("cannot fit 'int' into an index-sized integer");
  });
  it("slices with forward, reverse and arbitrary-size strides", () => {
    const value = bytes([0, 1, 2, 3, 4]);
    expect([...value.slice(null, null, -1n, budget())]).toEqual([4, 3, 2, 1, 0]);
    expect([...value.slice(1n, 5n, 2n, budget())]).toEqual([1, 3]);
    expect([...value.slice(null, null, 1n << 100n, budget())]).toEqual([0]);
    expect([...value.slice(null, null, -(1n << 100n), budget())]).toEqual([4]);
    expect([...value.slice(100n, -100n, 1n, budget())]).toEqual([]);
    expect(() => value.slice(null, null, 0n, budget())).toThrow("slice step cannot be zero");
  });
  it("does not let exported slice data mutate either sequence", () => {
    const original = bytes([1, 2, 3]), sliced = original.slice(null, null, -1n, budget());
    sliced.toUint8Array(budget()).fill(0);
    expect([...original]).toEqual([1, 2, 3]); expect([...sliced]).toEqual([3, 2, 1]);
  });
  it("compares unsigned bytes lexicographically", () => {
    expect(bytes([255]).compare(bytes([127, 255]), budget())).toBe(1);
    expect(bytes([1]).compare(bytes([1, 0]), budget())).toBe(-1);
    expect(bytes([0, 255]).compare(bytes([0, 255]), budget())).toBe(0);
    expect(bytes([]).compare(bytes([]), budget())).toBe(0);
  });
  it("charges owned storage before allocation", () => {
    const denied = budget(2);
    expect(() => ImmutableBytes.copyOf(Uint8Array.of(1, 2, 3), denied)).toThrow(ExecutionLimitError);
    expect(denied.usage.allocatedBytes).toBe(0);
    const allowed = budget(3); ImmutableBytes.copyOf(Uint8Array.of(1, 2, 3), allowed);
    expect(allowed.usage.allocatedBytes).toBe(3);
  });
  it("charges exports and slices without double-copying their output buffers", () => {
    const value = bytes([1, 2, 3]), exportBudget = budget(3), sliceBudget = budget(2);
    value.toUint8Array(exportBudget); expect(exportBudget.usage.allocatedBytes).toBe(3);
    value.slice(0n, 2n, 1n, sliceBudget); expect(sliceBudget.usage.allocatedBytes).toBe(2);
    expect(() => value.toUint8Array(budget(2))).toThrow(ExecutionLimitError);
  });
});
