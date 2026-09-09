import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { constantSlice } from "./constant-slice.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete immutable slicing", () => {
  it("retains identity for full unit-stride slices", () => {
    const { meter, values: v } = fixture();
    for (const source of [v.string("abc"), v.bytes(Uint8Array.of(1, 2)), v.tuple([v.none])]) {
      expect(constantSlice(source, {}, v, meter)).toBe(source);
      expect(constantSlice(source, { lower: v.integer(-(1n << 1000n)), upper: v.integer(1n << 1000n), step: v.true }, v, meter)).toBe(source);
    }
  });
  it("slices string code points without joining surrogate pairs", () => {
    const { meter, values: v } = fixture(), source = v.stringPoints(Uint32Array.of(65, 0x10000, 0xd800, 0xdc00));
    const result = constantSlice(source, { lower: v.integer(1), step: v.integer(2) }, v, meter);
    expect(result.kind).toBe("str");
    if (result.kind === "str") expect([...result.value]).toEqual([0x10000, 0xdc00]);
  });
  it("reverses bytes and preserves explicit negative-stop semantics", () => {
    const { meter, values: v } = fixture(), source = v.bytes(Uint8Array.of(1, 2, 3));
    const reverse = constantSlice(source, { step: v.integer(-1) }, v, meter);
    const empty = constantSlice(source, { upper: v.integer(-1), step: v.integer(-1) }, v, meter);
    if (reverse.kind !== "bytes" || empty.kind !== "bytes") throw new Error("expected bytes");
    expect([...reverse.value]).toEqual([3, 2, 1]); expect([...empty.value]).toEqual([]);
  });
  it("preserves tuple members while copying selected slots", () => {
    const { meter, values: v } = fixture(), a = v.tuple([v.none]), b = v.notImplemented, source = v.tuple([a, v.true, b]);
    const result = constantSlice(source, { step: v.integer(2) }, v, meter);
    if (result.kind !== "tuple") throw new Error("expected tuple");
    expect(result).not.toBe(source); expect(result.items[0]).toBe(a); expect(result.items[1]).toBe(b);
  });
  it("accepts arbitrary-size steps and None or bool bounds", () => {
    const { meter, values: v } = fixture(), source = v.tuple([v.none, v.true, v.false]);
    expect(constantSlice(source, { lower: v.true, upper: v.none, step: v.integer(1n << 1000n) }, v, meter)).toEqual(v.tuple([v.true]));
    expect(constantSlice(source, { step: v.integer(-(1n << 1000n)) }, v, meter)).toEqual(v.tuple([v.false]));
  });
  it("validates step before bounds and receiver before the slice", () => {
    const { meter, values: v } = fixture(), source = v.tuple([]);
    expect(() => constantSlice(source, { lower: v.float(0), step: v.false }, v, meter)).toThrow("slice step cannot be zero");
    for (const parts of [{ lower: v.float(0) }, { upper: v.string("x") }, { step: v.float(1) }]) expect(() => constantSlice(source, parts, v, meter)).toThrow("slice indices must be integers or None or have an __index__ method");
    expect(() => constantSlice(v.none, { step: v.false }, v, meter)).toThrow("'NoneType' object is not subscriptable");
  });
  it("charges copied byte payload once plus its tagged value", () => {
    const { meter, values: v } = fixture(), source = v.bytes(Uint8Array.of(1, 2, 3)), step = v.integer(-1), before = meter.usage.allocatedBytes;
    constantSlice(source, { step }, v, meter);
    expect(meter.usage.allocatedBytes - before).toBe(35);
  });
  it("honors fatal exhaustion before slice evaluation", () => {
    const { values: v } = fixture();
    expect(() => constantSlice(v.none, {}, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
