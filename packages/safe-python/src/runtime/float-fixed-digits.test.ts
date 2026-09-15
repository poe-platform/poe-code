import { expect, it, vi } from "vitest";
import { floatFixedDigits } from "./float-fixed-digits.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
it("rounds the exact binary value using ties to even", () => {
  for (const [value, precision, expected] of [[2.5, 0n, "2"], [3.5, 0n, "4"], [1.25, 1n, "1.2"], [1.75, 1n, "1.8"], [2.675, 2n, "2.67"], [9.999, 2n, "10.00"]] as const) expect(floatFixedDigits(value, precision, budget())).toBe(expected);
});
it("renders magnitudes without signs, including negative zero", () => {
  expect(floatFixedDigits(-1.25, 2n, budget())).toBe("1.25");
  expect(floatFixedDigits(-0, 3n, budget())).toBe("0.000");
  expect(floatFixedDigits(0, 0n, budget())).toBe("0");
});
it("does not use scientific notation for large finite values", () => {
  expect(floatFixedDigits(1e21, 2n, budget())).toBe("1000000000000000000000.00");
  expect(floatFixedDigits(1e30, 0n, budget())).toBe("1000000000000000019884624838656");
});
it("retains exact binary fractions beyond the host formatting precision limit", () => {
  const exact = "0.1000000000000000055511151231257827021181583404541015625";
  expect(floatFixedDigits(0.1, 55n, budget())).toBe(exact);
  expect(floatFixedDigits(0.1, 200n, budget())).toBe(exact + "0".repeat(145));
});
it("rounds subnormal values and supports precision beyond their exact expansion", () => {
  expect(floatFixedDigits(Number.MIN_VALUE, 323n, budget())).toBe("0." + "0".repeat(323));
  expect(floatFixedDigits(Number.MIN_VALUE, 324n, budget())).toBe("0." + "0".repeat(323) + "5");
  const exact = floatFixedDigits(Number.MIN_VALUE, 1074n, budget());
  expect(exact.endsWith("265533447265625")).toBe(true);
  expect(floatFixedDigits(Number.MIN_VALUE, 1200n, budget())).toBe(exact + "0".repeat(126));
});
it("rejects nonfinite inputs and invalid host precision", () => {
  for (const value of [Infinity, -Infinity, NaN]) expect(() => floatFixedDigits(value, 2n, budget())).toThrow(RangeError);
  expect(() => floatFixedDigits(1, -1n, budget())).toThrow(RangeError);
});
it("preflights large output and never delegates to host fixed formatting", () => {
  const fixed = vi.spyOn(Number.prototype, "toFixed");
  try {
    expect(floatFixedDigits(2.675, 2n, budget())).toBe("2.67");
    expect(() => floatFixedDigits(1, 1n << 60n, budget())).toThrow(ExecutionLimitError);
    expect(() => floatFixedDigits(1, 1000000n, new ExecutionBudget({ maxSteps: 10000000, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
    expect(fixed).not.toHaveBeenCalled();
  } finally { fixed.mockRestore(); }
});
