import { describe, expect, it } from "vitest";
import { runtimeInPlace } from "./runtime-inplace.js";
import { RuntimeValues } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { executeAugmentedAssignment } from "./augmented-assignment.js";
import { parseModule } from "../module.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const v = new RuntimeValues(meter), list = v.list([v.integer(1n)]);
  return { meter, v, list };
}

describe("runtime in-place operations", () => {
  it("extends in place preserving aliases and safely handles self extension", () => {
    const { meter, v, list } = fixture(), alias = list;
    expect(runtimeInPlace("+", list, list, v, meter)).toBe(alias);
    expect(alias.items.snapshot()).toEqual([v.integer(1n), v.integer(1n)]);
    expect(runtimeInPlace("+", list, v.tuple([v.true]), v, meter)).toBe(alias);
    expect(alias.items.get(2n)).toBe(v.true);
  });
  it("streams iterable additions and retains partial progress after next failure", () => {
    const { meter, v, list } = fixture(); let pulls = 0;
    const source = v.iterator({ next: () => {
      if (pulls++ === 0) return { done: false, value: v.true };
      expect(list.items.length).toBe(2);
      throw new PythonRuntimeError("ValueError", "next failed");
    } });
    expect(() => runtimeInPlace("+", list, source, v, meter)).toThrow("next failed");
    expect(list.items.snapshot()).toEqual([v.integer(1n), v.true]);
  });
  it("accepts string and bytes iterables without list concatenation restrictions", () => {
    const { meter, v, list } = fixture();
    runtimeInPlace("+", list, v.string("😀"), v, meter);
    runtimeInPlace("+", list, v.bytes(Uint8Array.of(255)), v, meter);
    expect(list.items.snapshot()).toEqual([v.integer(1n), v.string("😀"), v.integer(255n)]);
  });
  it("repeats existing slots in place and preserves cyclic member identity", () => {
    const { meter, v, list } = fixture(); list.items.clear(); list.items.append(list);
    expect(runtimeInPlace("*", list, v.integer(3n), v, meter)).toBe(list);
    expect(list.items.length).toBe(3); expect(list.items.get(2n)).toBe(list);
    expect(runtimeInPlace("*", list, v.false, v, meter)).toBe(list); expect(list.items.length).toBe(0);
  });
  it("falls back to ordinary binary operations for immutable values", () => {
    const { meter, v } = fixture(), tuple = v.tuple([v.true]);
    expect(runtimeInPlace("+", v.integer(2n), v.integer(3n), v, meter)).toEqual(v.integer(5n));
    const result = runtimeInPlace("+", tuple, tuple, v, meter);
    expect(result).toEqual(v.tuple([v.true, v.true])); expect(result).not.toBe(tuple);
  });
  it("preserves overflow and non-iterable errors without changing slots", () => {
    const { meter, v, list } = fixture();
    expect(() => runtimeInPlace("+", list, v.integer(1n), v, meter)).toThrow("'int' object is not iterable");
    expect(() => runtimeInPlace("*", list, v.integer(1n << 100n), v, meter)).toThrow("cannot fit 'int' into an index-sized integer");
    expect(list.items.length).toBe(1);
    expect(runtimeInPlace("*", list, v.float(2), v, meter)).toBe(v.notImplemented);
  });
  it("bounds extension from a live iterator over the destination list", () => {
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 10000 }), v = new RuntimeValues(meter), list = v.list([v.true]);
    const source = v.iterator(runtimeIterate(list, v, meter));
    expect(() => runtimeInPlace("+", list, source, v, meter)).toThrow(ExecutionLimitError);
  });
  it("keeps in-place mutations when augmented assignment write-back fails", () => {
    const { meter, v, list } = fixture(), node = parseModule("x += rhs").body[0];
    if (node.kind !== "augmented-assignment") throw new Error("fixture");
    expect(() => executeAugmentedAssignment(node, {
      resolve: () => ({ get: () => list, set: value => { expect(value).toBe(list); throw new Error("store failed"); } }),
      evaluate: () => v.tuple([v.true]), inplace: (operator, left, right) => runtimeInPlace(operator, left, right, v, meter)
    }, meter)).toThrow("store failed");
    expect(list.items.snapshot()).toEqual([v.integer(1n), v.true]);
  });
});
