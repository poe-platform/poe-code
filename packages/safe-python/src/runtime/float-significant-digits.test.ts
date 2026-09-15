import { expect, it, vi } from "vitest";
import { floatSignificantDigits } from "./float-significant-digits.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
it("returns normalized unsigned digits and a decimal exponent", () => {
  expect(floatSignificantDigits(123.5, 4n, budget())).toEqual({ digits: "1235", exponent: 2 });
  expect(floatSignificantDigits(-0.0125, 3n, budget())).toEqual({ digits: "125", exponent: -2 });
  expect(floatSignificantDigits(-0, 3n, budget())).toEqual({ digits: "000", exponent: 0 });
});
it("rounds ties to even from the exact binary value", () => {
  expect(floatSignificantDigits(1.25, 2n, budget())).toEqual({ digits: "12", exponent: 0 });
  expect(floatSignificantDigits(1.75, 2n, budget())).toEqual({ digits: "18", exponent: 0 });
  expect(floatSignificantDigits(2.675, 3n, budget())).toEqual({ digits: "267", exponent: 0 });
  expect(floatSignificantDigits(1.2500000000000002, 2n, budget())).toEqual({ digits: "13", exponent: 0 });
});
it("propagates decimal carry into the exponent", () => {
  expect(floatSignificantDigits(9.999, 3n, budget())).toEqual({ digits: "100", exponent: 1 });
  expect(floatSignificantDigits(999.5, 3n, budget())).toEqual({ digits: "100", exponent: 3 });
  expect(floatSignificantDigits(0.000099999, 3n, budget())).toEqual({ digits: "100", exponent: -4 });
});
it("handles subnormals and maximum finite values", () => {
  expect(floatSignificantDigits(Number.MIN_VALUE, 17n, budget())).toEqual({ digits: "49406564584124654", exponent: -324 });
  expect(floatSignificantDigits(Number.MAX_VALUE, 17n, budget())).toEqual({ digits: "17976931348623157", exponent: 308 });
  expect(floatSignificantDigits(Number.MAX_VALUE, 1n, budget())).toEqual({ digits: "2", exponent: 308 });
});
it("extends exact digits with zeros beyond host precision limits", () => {
  expect(floatSignificantDigits(0.1, 200n, budget())).toEqual({ digits: "1000000000000000055511151231257827021181583404541015625" + "0".repeat(145), exponent: -1 });
  expect(floatSignificantDigits(1, 5000n, budget())).toEqual({ digits: "1" + "0".repeat(4999), exponent: 0 });
});
it("rejects nonfinite inputs and nonpositive precision", () => {
  for (const value of [Infinity, -Infinity, NaN]) expect(() => floatSignificantDigits(value, 3n, budget())).toThrow(RangeError);
  for (const precision of [0n, -1n]) expect(() => floatSignificantDigits(1, precision, budget())).toThrow(RangeError);
});
it("precharges requested output and avoids host precision formatting", () => {
  const precision = vi.spyOn(Number.prototype, "toPrecision");
  try {
    expect(floatSignificantDigits(2.675, 3n, budget()).digits).toBe("267");
    expect(() => floatSignificantDigits(1, 1n << 60n, budget())).toThrow(ExecutionLimitError);
    expect(() => floatSignificantDigits(1, 1000000n, budget())).toThrow(ExecutionLimitError);
    expect(precision).not.toHaveBeenCalled();
  } finally { precision.mockRestore(); }
});
