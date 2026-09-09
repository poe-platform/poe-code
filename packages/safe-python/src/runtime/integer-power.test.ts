import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { integerPower } from "./integer-power.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete integer exponentiation", () => {
  it.each([[2n, 100n, 1n << 100n], [-3n, 5n, -243n], [0n, 0n, 1n], [0n, 123n, 0n], [-1n, (1n << 1000n) + 1n, -1n]])("keeps %s ** %s exact", (a, b, result) => {
    const { meter, values: v } = fixture();
    expect(integerPower(v.integer(a), v.integer(b), v, meter)).toEqual({ kind: "int", value: result });
  });
  it("returns integer results for boolean operands", () => {
    const { meter, values: v } = fixture();
    expect(integerPower(v.false, v.false, v, meter)).toEqual({ kind: "int", value: 1n });
    expect(integerPower(v.true, v.true, v, meter)).toEqual({ kind: "int", value: 1n });
  });
  it("converts negative powers to floats with signed underflow", () => {
    const { meter, values: v } = fixture();
    for (const [a, b, expected] of [[2, -3, .125], [-2, -3, -.125], [-2, -1075, -0]]) {
      expect(integerPower(v.integer(a), v.integer(b), v, meter)).toEqual({ kind: "float", value: expected });
    }
    expect(integerPower(v.integer(-1), v.integer(-(2n ** 54n + 1n)), v, meter)).toEqual({ kind: "float", value: 1 });
  });
  it("preserves float conversion and zero-division precedence for negative powers", () => {
    const { meter, values: v } = fixture();
    expect(() => integerPower(v.false, v.integer(-1), v, meter)).toThrow("zero to a negative power");
    expect(() => integerPower(v.false, v.integer(-(1n << 2000n)), v, meter)).toThrow("int too large to convert to float");
    expect(() => integerPower(v.integer(1n << 2000n), v.integer(-1), v, meter)).toThrow("int too large to convert to float");
  });
  it("declines noninteger pairs without coercion", () => {
    const { meter, values: v } = fixture();
    for (const other of [v.float(2), v.complex(2, 0), v.none, v.string("2")]) {
      expect(integerPower(v.true, other, v, meter)).toBe(v.notImplemented);
      expect(integerPower(other, v.true, v, meter)).toBe(v.notImplemented);
    }
  });
  it("rejects explosive result sizes before constructing them and latches failure", () => {
    const { values: v } = fixture(), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100 });
    expect(() => integerPower(v.integer(2), v.integer(1n << 1000n), v, meter)).toThrow(ExecutionLimitError);
    expect(() => meter.checkpoint(0, 0)).toThrow(ExecutionLimitError);
  });
  it("checks limits on entry and during exponentiation", () => {
    const { values: v } = fixture();
    expect(() => integerPower(v.false, v.false, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
    expect(() => integerPower(v.integer(3), v.integer(100), v, new ExecutionBudget({ maxSteps: 3, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
  });
});
