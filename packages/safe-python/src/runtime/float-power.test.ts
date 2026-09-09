import { expect, it } from "vitest";
import { floatPower } from "./float-power.js";
import { ConstantValues } from "./constant-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, v: new ConstantValues(meter) };
}
it.each([
  [NaN, 0, 1], [1, NaN, 1], [NaN, 1, NaN], [2, NaN, NaN],
  [-1, Infinity, 1], [-1, -Infinity, 1], [0.5, Infinity, 0], [0.5, -Infinity, Infinity],
  [2, Infinity, Infinity], [2, -Infinity, 0], [-Infinity, 3, -Infinity],
  [-Infinity, -3, -0], [-Infinity, 0.5, Infinity], [-0, 3, -0], [-0, 2, 0],
  [0, -Infinity, Infinity], [-2, -1075, -0], [-2, 3, -8], [4, 0.5, 2]
])("handles floating power %s ** %s", (a, b, expected) => {
  const { meter, v } = fixture();
  expect(floatPower(v.float(a), v.float(b), v, meter)).toEqual(v.float(expected));
});
it("uses the principal complex branch for negative fractional powers", () => {
  const { meter, v } = fixture();
  expect(floatPower(v.integer(-4), v.float(0.5), v, meter)).toEqual(v.complex(1.2246467991473532e-16, 2));
  expect(floatPower(v.float(-1e-300), v.float(1.5), v, meter)).toEqual(v.complex(-0, -0));
  expect(() => floatPower(v.float(-1e300), v.float(1.5), v, meter)).toThrow("complex exponentiation");
});
it("reports zero division and finite-input overflow", () => {
  const { meter, v } = fixture();
  expect(() => floatPower(v.float(-0), v.integer(-1), v, meter)).toThrow("zero to a negative power");
  expect(() => floatPower(v.float(1e300), v.integer(2), v, meter)).toThrow(expect.objectContaining({ name: "OverflowError" }));
});
it("converts mixed integers before special cases and preserves rounded parity", () => {
  const { meter, v } = fixture();
  expect(floatPower(v.float(-1), v.integer((1n << 54n) + 1n), v, meter)).toEqual(v.float(1));
  expect(floatPower(v.true, v.float(3), v, meter)).toEqual(v.float(1));
  expect(() => floatPower(v.integer(1n << 2000n), v.float(0), v, meter)).toThrow("int too large to convert to float");
  expect(() => floatPower(v.float(1), v.integer(1n << 2000n), v, meter)).toThrow("int too large to convert to float");
});
it("leaves integer-only and nonreal pairs to other kernels", () => {
  const { meter, v } = fixture();
  expect(floatPower(v.integer(2), v.integer(3), v, meter)).toBe(v.notImplemented);
  for (const value of [v.none, v.string("x"), v.complex(1, 2)]) {
    expect(floatPower(value, v.float(2), v, meter)).toBe(v.notImplemented);
    expect(floatPower(v.float(2), value, v, meter)).toBe(v.notImplemented);
  }
});
it("checks execution limits before shortcut results", () => {
  const { v } = fixture();
  expect(() => floatPower(v.float(1), v.float(0), v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
});
