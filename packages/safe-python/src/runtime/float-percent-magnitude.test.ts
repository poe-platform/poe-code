import { expect, it } from "vitest";
import { floatPercentMagnitude } from "./float-percent-magnitude.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const render = (value: number, code: string, precision: bigint | null = null, alternate = false) => floatPercentMagnitude(value, code.charCodeAt(0), precision, alternate, budget());
it("uses default precision for fixed, scientific and general formats", () => {
  expect(render(-12.5, "f")).toBe("12.500000");
  expect(render(-12.5, "e")).toBe("1.250000e+01");
  expect(render(-12.5, "g")).toBe("12.5");
  expect(render(1e100, "E", 2n)).toBe("1.00E+100");
  expect(render(1e-100, "e", 2n)).toBe("1.00e-100");
});
it("selects general notation using the rounded exponent", () => {
  expect(render(999.5, "g", 3n)).toBe("1e+03");
  expect(render(999.4, "g", 3n)).toBe("999");
  expect(render(0.000099999, "g", 3n)).toBe("0.0001");
  expect(render(0.0000099999, "g", 3n)).toBe("1e-05");
  expect(render(0.0001, "g", 1n)).toBe("0.0001");
});
it("treats general precision zero as one significant digit", () => {
  expect(render(12, "g", 0n)).toBe("1e+01");
  expect(render(0, "g", 0n)).toBe("0");
  expect(render(1, "g", 0n, true)).toBe("1.");
});
it("keeps alternate decimal points and significant trailing zeros", () => {
  expect(render(12, "f", 0n, true)).toBe("12.");
  expect(render(12, "e", 0n, true)).toBe("1.e+01");
  expect(render(12, "g", 5n, true)).toBe("12.000");
  expect(render(100000, "G", 3n, true)).toBe("1.00E+05");
  expect(render(0.0001, "g", 3n, true)).toBe("0.000100");
});
it("preserves integral zeros while removing only insignificant fractional zeros", () => {
  expect(render(100, "g", 6n)).toBe("100");
  expect(render(100.5, "g", 6n)).toBe("100.5");
  expect(render(-0, "f", 2n)).toBe("0.00");
  expect(render(-0, "e", 2n)).toBe("0.00e+00");
  expect(render(-0, "g", 3n, true)).toBe("0.00");
});
it("renders nonfinite magnitudes with case and without precision-dependent allocation", () => {
  for (const code of ["e", "f", "g", "E", "F", "G"]) {
    const upper = code === code.toUpperCase();
    expect(render(-Infinity, code, 1000000000n, true)).toBe(upper ? "INF" : "inf");
    expect(render(NaN, code, 1000000000n, true)).toBe(upper ? "NAN" : "nan");
  }
});
it("supports high precision and validates metadata and resource limits", () => {
  expect(render(1.25, "e", 200n)).toBe("1.25" + "0".repeat(198) + "e+00");
  expect(render(1.25, "g", 200n)).toBe("1.25");
  expect(render(1.25, "g", 1000000000n)).toBe("1.25");
  expect(() => render(1, "x")).toThrow(RangeError);
  expect(() => render(1, "f", -1n)).toThrow(RangeError);
  expect(() => render(1, "e", 1n << 60n)).toThrow(ExecutionLimitError);
});
