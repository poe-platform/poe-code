import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { constantModularPower } from "./constant-modular-power.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete integer three-argument power", () => {
  it.each([[38n, -1n, 97n, 23n], [2n, 10n, 1000n, 24n], [-2n, -3n, -5n, -2n], [0n, 0n, 7n, 1n]])("computes pow(%s, %s, %s)", (a, b, c, expected) => {
    const { meter, values: v } = fixture();
    expect(constantModularPower(v.integer(a), v.integer(b), v.integer(c), v, meter)).toEqual({ kind: "int", value: expected });
  });
  it("accepts bool operands but always produces an integer", () => {
    const { meter, values: v } = fixture();
    expect(constantModularPower(v.true, v.false, v.integer(3), v, meter)).toEqual({ kind: "int", value: 1n });
    expect(constantModularPower(v.true, v.true, v.true, v, meter)).toEqual({ kind: "int", value: 0n });
  });
  it("declines noninteger operands before numeric validation", () => {
    const { meter, values: v } = fixture();
    for (const other of [v.none, v.float(2), v.complex(2, 0), v.string("2"), v.tuple([])]) {
      expect(constantModularPower(other, v.true, v.false, v, meter)).toBe(v.notImplemented);
      expect(constantModularPower(v.true, other, v.false, v, meter)).toBe(v.notImplemented);
      expect(constantModularPower(v.true, v.true, other, v, meter)).toBe(v.notImplemented);
    }
  });
  it("preserves numeric errors and checks limits inside the kernel", () => {
    const { values: v, meter } = fixture();
    expect(() => constantModularPower(v.false, v.integer(-1), v.false, v, meter)).toThrow("pow() 3rd argument cannot be 0");
    expect(() => constantModularPower(v.integer(2), v.integer(-1), v.integer(4), v, meter)).toThrow("base is not invertible for the given modulus");
    expect(() => constantModularPower(v.integer(2), v.integer(1n << 100n), v.integer(7), v, new ExecutionBudget({ maxSteps: 4, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
