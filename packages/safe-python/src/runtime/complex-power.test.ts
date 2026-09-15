import { expect, it } from "vitest";
import { complexPower } from "./complex-power.js";
import { ConstantValues } from "./constant-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, v: new ConstantValues(meter) };
}
it("uses exact complex multiplication for small integer exponents", () => {
  const { meter, v } = fixture();
  expect(complexPower(v.complex(1, 1), v.integer(3), v, meter)).toEqual(v.complex(-2, 2));
  expect(complexPower(v.complex(1, 1), v.integer(-2), v, meter)).toEqual(v.complex(0, -0.5));
  expect(complexPower(v.integer(2), v.complex(3, 0), v, meter)).toEqual(v.complex(8, 0));
  expect(complexPower(v.complex(0, 1), v.integer(100), v, meter)).toEqual(v.complex(1, 0));
});
it("handles principal branch direction and imaginary exponents", () => {
  const { meter, v } = fixture();
  expect(complexPower(v.complex(-4, -0), v.float(0.5), v, meter)).toEqual(v.complex(1.2246467991473532e-16, -2));
  expect(complexPower(v.complex(0, 1), v.complex(0, 1), v, meter)).toEqual(v.complex(Math.exp(-Math.PI / 2), 0));
});
it("handles zero bases and exponents before logarithms", () => {
  const { meter, v } = fixture();
  expect(complexPower(v.complex(NaN, Infinity), v.false, v, meter)).toEqual(v.complex(1, 0));
  expect(complexPower(v.complex(0, -0), v.float(NaN), v, meter)).toEqual(v.complex(0, 0));
  expect(() => complexPower(v.complex(0, 0), v.integer(-1), v, meter)).toThrow("zero to a negative or complex power");
  expect(() => complexPower(v.false, v.complex(1, 1), v, meter)).toThrow("zero to a negative or complex power");
});
it("reports overflow rather than publishing infinite components", () => {
  const { meter, v } = fixture();
  expect(() => complexPower(v.complex(1e300, 0), v.integer(2), v, meter)).toThrow("complex exponentiation");
  expect(() => complexPower(v.complex(Infinity, 0), v.integer(1), v, meter)).toThrow("complex exponentiation");
  expect(complexPower(v.complex(1, 0), v.float(Infinity), v, meter)).toEqual(v.complex(NaN, NaN));
});
it("converts mixed integers even for a zero exponent and declines nonnumeric pairs", () => {
  const { meter, v } = fixture();
  expect(() => complexPower(v.integer(1n << 2000n), v.complex(0, 0), v, meter)).toThrow("int too large to convert to float");
  expect(complexPower(v.none, v.complex(1, 0), v, meter)).toBe(v.notImplemented);
  expect(complexPower(v.float(2), v.float(3), v, meter)).toBe(v.notImplemented);
});
it("meters integer-power loop temporaries", () => {
  const { v } = fixture();
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 256 });
  const values = new ConstantValues(meter);
  expect(() => complexPower(v.complex(1, 1), v.integer(100), values, meter)).toThrow(ExecutionLimitError);
});
