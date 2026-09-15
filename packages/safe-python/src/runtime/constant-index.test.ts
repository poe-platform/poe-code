import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { constantIndex } from "./constant-index.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete integer indexing", () => {
  it("indexes string code points rather than host UTF-16 units", () => {
    const { meter, values: v } = fixture(), text = v.stringPoints(Uint32Array.of(65, 0x10000, 0xd800, 0xdc00));
    for (const [index, point] of [[1, 0x10000], [-1, 0xdc00], [-2, 0xd800]]) {
      const result = constantIndex(text, v.integer(index), v, meter);
      expect(result.kind).toBe("str");
      if (result.kind === "str") expect([...result.value]).toEqual([point]);
    }
  });
  it("returns integer byte values and accepts bool indices", () => {
    const { meter, values: v } = fixture(), bytes = v.bytes(Uint8Array.of(0, 255));
    expect(constantIndex(bytes, v.true, v, meter)).toEqual({ kind: "int", value: 255n });
    expect(constantIndex(bytes, v.false, v, meter)).toEqual({ kind: "int", value: 0n });
    expect(constantIndex(bytes, v.integer(-1), v, meter)).toEqual({ kind: "int", value: 255n });
  });
  it("returns the exact tuple member without copying or allocation", () => {
    const { meter, values: v } = fixture(), member = v.tuple([v.notImplemented]), tuple = v.tuple([v.none, member]);
    const key = v.integer(-1), before = meter.usage.allocatedBytes;
    expect(constantIndex(tuple, key, v, meter)).toBe(member);
    expect(meter.usage.allocatedBytes).toBe(before);
    expect(constantIndex(tuple, v.false, v, meter)).toBe(v.none);
  });
  it("validates signed index-size overflow before normalizing negatives", () => {
    const { meter, values: v } = fixture();
    for (const value of [v.string(""), v.bytes(new Uint8Array()), v.tuple([])]) {
      for (const index of [1n << 63n, -(1n << 63n) - 1n, 1n << 1000n]) expect(() => constantIndex(value, v.integer(index), v, meter)).toThrow("cannot fit 'int' into an index-sized integer");
    }
  });
  it("preserves type-specific range errors at valid index-size boundaries", () => {
    const { meter, values: v } = fixture();
    for (const [value, message] of [[v.string("a"), "string index out of range"], [v.bytes(Uint8Array.of(0)), "index out of range"], [v.tuple([v.none]), "tuple index out of range"]] as const) {
      for (const index of [1n, -2n, (1n << 63n) - 1n, -(1n << 63n)]) expect(() => constantIndex(value, v.integer(index), v, meter)).toThrow(expect.objectContaining({ name: "IndexError", message }));
    }
  });
  it("rejects noninteger keys without numeric coercion", () => {
    const { meter, values: v } = fixture(), key = v.float(0);
    expect(() => constantIndex(v.string("a"), key, v, meter)).toThrow("string indices must be integers, not 'float'");
    expect(() => constantIndex(v.bytes(new Uint8Array()), key, v, meter)).toThrow("byte indices must be integers or slices, not float");
    expect(() => constantIndex(v.tuple([]), v.none, v, meter)).toThrow("tuple indices must be integers or slices, not NoneType");
  });
  it("rejects nonsubscriptable receivers before inspecting keys", () => {
    const { meter, values: v } = fixture();
    expect(() => constantIndex(v.none, v.integer(1n << 1000n), v, meter)).toThrow("'NoneType' object is not subscriptable");
    expect(() => constantIndex(v.notImplemented, v.none, v, meter)).toThrow("'NotImplementedType' object is not subscriptable");
  });
  it("checks the execution budget before accessing the receiver", () => {
    const { values: v } = fixture();
    expect(() => constantIndex(v.none, v.none, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
