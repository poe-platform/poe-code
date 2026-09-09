import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { constantConcat } from "./constant-concat.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete immutable sequence concatenation", () => {
  it("concatenates string code points without combining separate surrogates", () => {
    const { meter, values: v } = fixture(), left = v.stringPoints(Uint32Array.of(0xd800)), right = v.stringPoints(Uint32Array.of(0xdc00, 0x10000));
    const result = constantConcat(left, right, v, meter);
    if (result.kind !== "str") throw new Error("expected string");
    expect([...result.value]).toEqual([0xd800, 0xdc00, 0x10000]);
    expect([...left.value]).toEqual([0xd800]); expect([...right.value]).toEqual([0xdc00, 0x10000]);
  });
  it("concatenates bytes into owned storage without a second payload copy", () => {
    const { meter, values: v } = fixture(), left = v.bytes(Uint8Array.of(0, 255)), right = v.bytes(Uint8Array.of(128));
    const before = meter.usage.allocatedBytes, result = constantConcat(left, right, v, meter);
    expect(meter.usage.allocatedBytes - before).toBe(35);
    if (result.kind !== "bytes") throw new Error("expected bytes");
    expect([...result.value]).toEqual([0, 255, 128]);
    result.value.toUint8Array(meter).fill(1);
    expect([...result.value]).toEqual([0, 255, 128]);
    expect([...left.value]).toEqual([0, 255]);
  });
  it("copies tuple slots while retaining member identities", () => {
    const { meter, values: v } = fixture(), a = v.tuple([v.none]), b = v.slice({}), left = v.tuple([a]), right = v.tuple([b]);
    const result = constantConcat(left, right, v, meter);
    if (result.kind !== "tuple") throw new Error("expected tuple");
    expect(result.items).toEqual([a, b]); expect(result.items[0]).toBe(a); expect(result.items[1]).toBe(b);
    expect(Object.isFrozen(result.items)).toBe(true); expect(result).not.toBe(left); expect(result).not.toBe(right);
  });
  it("reuses the nonempty operand when concatenating an empty exact sequence", () => {
    const { meter, values: v } = fixture();
    for (const [source, empty] of [[v.string("abc"), v.string("")], [v.bytes(Uint8Array.of(1)), v.bytes(new Uint8Array())], [v.tuple([v.none]), v.tuple([])]] as const) {
      const before = meter.usage.allocatedBytes;
      expect(constantConcat(source, empty, v, meter)).toBe(source);
      expect(constantConcat(empty, source, v, meter)).toBe(source);
      expect(meter.usage.allocatedBytes).toBe(before);
    }
  });
  it("declines mismatched or nonsequence operands for caller dispatch", () => {
    const { meter, values: v } = fixture();
    expect(constantConcat(v.string("a"), v.bytes(Uint8Array.of(97)), v, meter)).toBe(v.notImplemented);
    expect(constantConcat(v.tuple([]), v.none, v, meter)).toBe(v.notImplemented);
    expect(constantConcat(v.true, v.true, v, meter)).toBe(v.notImplemented);
  });
  it("charges only owned string storage and final tuple slots", () => {
    const { meter, values: v } = fixture(), a = v.string("ab"), b = v.string("c"), left = v.tuple([v.none]), right = v.tuple([v.true]);
    let before = meter.usage.allocatedBytes;
    constantConcat(a, b, v, meter); expect(meter.usage.allocatedBytes - before).toBe(32 + 3 * 4);
    before = meter.usage.allocatedBytes;
    constantConcat(left, right, v, meter); expect(meter.usage.allocatedBytes - before).toBe(32 + 2 * 8);
  });
  it("checks limits before allocating concatenated payloads", () => {
    const { values: v } = fixture(), a = v.bytes(Uint8Array.of(1, 2)), b = v.bytes(Uint8Array.of(3, 4));
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 3 });
    expect(() => constantConcat(a, b, v, meter)).toThrow(ExecutionLimitError);
    expect(meter.usage.allocatedBytes).toBe(0);
    expect(() => constantConcat(v.none, v.none, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
