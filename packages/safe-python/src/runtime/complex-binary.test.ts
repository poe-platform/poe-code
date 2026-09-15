import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { complexBinary } from "./complex-binary.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete complex arithmetic", () => {
  it("retains fused division numerator rounding and signed underflow", () => {
    const { meter, values: v } = fixture();
    expect(complexBinary("/", v.complex(0, 1e-308), v.complex(-1, 1e-308), v, meter)).toEqual(v.complex(0, -1e-308));
    expect(complexBinary("/", v.complex(1, 1e308), v.complex(-1, 1e-308), v, meter)).toEqual(v.complex(-7.969431103331108e-17, -1e308));
  });
  it("adds, subtracts and multiplies complex pairs", () => {
    const { meter, values: v } = fixture(), a = v.complex(1, 2), b = v.complex(3, 4);
    expect(complexBinary("+", a, b, v, meter)).toEqual(v.complex(4, 6));
    expect(complexBinary("-", a, b, v, meter)).toEqual(v.complex(-2, -2));
    expect(complexBinary("*", a, b, v, meter)).toEqual(v.complex(-5, 10));
  });
  it("preserves mixed real/complex signed zeros and avoids artificial NaNs", () => {
    const { meter, values: v } = fixture(), a = v.complex(1, -0);
    expect(complexBinary("+", a, v.integer(2), v, meter)).toEqual(v.complex(3, -0));
    expect(complexBinary("+", v.integer(2), a, v, meter)).toEqual(v.complex(3, -0));
    expect(complexBinary("-", v.integer(2), a, v, meter)).toEqual(v.complex(1, 0));
    expect(complexBinary("*", v.complex(Infinity, 1), v.integer(2), v, meter)).toEqual(v.complex(Infinity, 2));
    expect(complexBinary("/", a, v.integer(2), v, meter)).toEqual(v.complex(.5, -0));
  });
  it("uses scaled complex division for large and tiny finite divisors", () => {
    const { meter, values: v } = fixture();
    expect(complexBinary("/", v.complex(1e200, 1e200), v.complex(1e200, 1e200), v, meter)).toEqual(v.complex(1, 0));
    expect(complexBinary("/", v.complex(1e-200, 1e-200), v.complex(1e-200, 1e-200), v, meter)).toEqual(v.complex(1, 0));
    expect(complexBinary("/", v.integer(2), v.complex(1, 1), v, meter)).toEqual(v.complex(1, -1));
  });
  it("recovers infinities and zeros from indeterminate intermediate products", () => {
    const { meter, values: v } = fixture();
    expect(complexBinary("*", v.complex(1, 1), v.complex(Infinity, Infinity), v, meter)).toEqual(v.complex(NaN, Infinity));
    expect(complexBinary("/", v.complex(1, 1), v.complex(Infinity, Infinity), v, meter)).toEqual(v.complex(0, 0));
    expect(complexBinary("/", v.complex(Infinity, 1), v.complex(1, 1), v, meter)).toEqual(v.complex(Infinity, -Infinity));
  });
  it("checks zero divisors after numeric conversion", () => {
    const { meter, values: v } = fixture();
    expect(() => complexBinary("/", v.complex(1, 1), v.false, v, meter)).toThrow("division by zero");
    expect(() => complexBinary("/", v.true, v.complex(-0, 0), v, meter)).toThrow("division by zero");
    expect(() => complexBinary("/", v.integer(1n << 2000n), v.complex(0, 0), v, meter)).toThrow("int too large to convert to float");
  });
  it("declines pairs without a complex operand and unsupported operand types", () => {
    const { meter, values: v } = fixture();
    expect(complexBinary("+", v.true, v.float(2), v, meter)).toBe(v.notImplemented);
    expect(complexBinary("*", v.complex(1, 1), v.none, v, meter)).toBe(v.notImplemented);
    expect(complexBinary("-", v.string("x"), v.complex(1, 1), v, meter)).toBe(v.notImplemented);
  });
  it("checks limits and rejects unsupported arithmetic operator names", () => {
    const { meter, values: v } = fixture();
    expect(() => complexBinary("/", v.true, v.complex(0, 0), v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
    expect(() => complexBinary("**", v.true, v.true, v, meter)).toThrow("unsupported complex binary operator: **");
  });
});
