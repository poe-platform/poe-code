import { describe, expect, it } from "vitest";
import { ConstantValues, type ConstantValue } from "./constant-values.js";
import { constantComparison } from "./constant-comparison.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 10000000 });
  const values = new ConstantValues(meter);
  return { meter, values, compare: (op: string, a: ConstantValue, b: ConstantValue) => constantComparison(op, a, b, values, meter, 10000) };
}

describe("concrete constant comparisons", () => {
  it("separates object identity from value equality", () => {
    const { values: v, compare } = fixture(), a = v.integer(1000), b = v.integer(1000), nan = v.float(NaN);
    expect(compare("==", a, b)).toBe(v.true); expect(compare("is", a, b)).toBe(v.false);
    expect(compare("is not", a, a)).toBe(v.false);
    expect(compare("is", nan, nan)).toBe(v.true); expect(compare("==", nan, nan)).toBe(v.false);
  });
  it("uses singleton identity fallback without coercing NotImplemented", () => {
    const { values: v, compare } = fixture();
    for (const a of [v.none, v.ellipsis, v.notImplemented]) {
      expect(compare("==", a, a)).toBe(v.true);
      expect(compare("!=", a, a)).toBe(v.false);
      expect(compare("==", a, v.integer(0))).toBe(v.false);
    }
  });
  it("compares strings by code point, not UTF-16 or normalization", () => {
    const { values: v, compare } = fixture();
    expect(compare("<", v.string("\uffff"), v.string("😀"))).toBe(v.true);
    expect(compare("==", v.string("é"), v.string("e\u0301"))).toBe(v.false);
    expect(compare("<", v.stringPoints(Uint32Array.of(0xd800)), v.stringPoints(Uint32Array.of(0x10000)))).toBe(v.true);
    expect(compare("<=", v.string(""), v.string(""))).toBe(v.true);
  });
  it("compares bytes lexicographically and declines cross-type equality", () => {
    const { values: v, compare } = fixture();
    expect(compare(">", v.bytes(Uint8Array.of(255)), v.bytes(Uint8Array.of(127, 255)))).toBe(v.true);
    expect(compare("<", v.bytes(Uint8Array.of(1)), v.bytes(Uint8Array.of(1, 0)))).toBe(v.true);
    expect(compare("==", v.bytes(Uint8Array.of(65)), v.string("A"))).toBe(v.false);
  });
  it("uses tuple identity shortcuts only for members", () => {
    const { values: v, compare } = fixture(), nan = v.float(NaN), a = v.tuple([nan]), b = v.tuple([nan]), c = v.tuple([v.float(NaN)]);
    expect(compare("==", a, b)).toBe(v.true);
    expect(compare("<=", a, b)).toBe(v.true);
    expect(compare("==", a, c)).toBe(v.false);
    expect(compare("!=", a, c)).toBe(v.true);
    expect(compare("<", a, c)).toBe(v.false);
    expect(compare(">=", a, c)).toBe(v.false);
  });
  it("compares tuple prefixes and the first unequal element", () => {
    const { values: v, compare } = fixture();
    expect(compare("<", v.tuple([v.integer(1)]), v.tuple([v.true, v.none]))).toBe(v.true);
    expect(compare(">", v.tuple([v.integer(2), v.none]), v.tuple([v.integer(1), v.notImplemented]))).toBe(v.true);
    expect(compare("==", v.tuple([v.complex(1, 0)]), v.tuple([v.true]))).toBe(v.true);
    expect(compare("==", v.tuple([]), v.none)).toBe(v.false);
  });
  it("reports the unequal member types for unsupported tuple ordering", () => {
    const { values: v, compare } = fixture();
    expect(() => compare("<", v.tuple([v.none]), v.tuple([v.integer(1)]))).toThrow("'<' not supported between instances of 'NoneType' and 'int'");
    expect(() => compare(">=", v.complex(0, 0), v.integer(0))).toThrow("'>=' not supported between instances of 'complex' and 'int'");
    expect(() => compare("<", v.notImplemented, v.ellipsis)).toThrow("'<' not supported between instances of 'NotImplementedType' and 'ellipsis'");
  });
  it("handles deeply nested tuple equality and ordering without host recursion", () => {
    const { values: v, compare } = fixture();
    let a: ConstantValue = v.integer(1), b: ConstantValue = v.integer(1), c: ConstantValue = v.integer(2);
    for (let i = 0; i < 5000; i++) { a = v.tuple([a]); b = v.tuple([b]); c = v.tuple([c]); }
    expect(compare("==", a, b)).toBe(v.true);
    // Ordering rechecks unequal pairs at each level, so use shared inner
    // identities here; exhaustive adversarial CPU behavior stays budgeted.
    expect(compare("<", v.tuple([a, v.integer(1)]), v.tuple([a, v.integer(2)]))).toBe(v.true);
    expect(compare("!=", a, c)).toBe(v.true);
  });
  it("checks limits and rejects unknown comparison operators", () => {
    const { values: v, compare } = fixture();
    expect(() => constantComparison("is", v.none, v.none, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
    expect(() => compare("in", v.none, v.none)).toThrow("unsupported constant comparison operator: in");
  });
});
