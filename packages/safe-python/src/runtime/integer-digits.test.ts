import { expect, it, vi } from "vitest";
import { integerDigits } from "./integer-digits.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 });
it("renders zero and signed integers in each supported radix without prefixes", () => {
  for (const radix of [2, 8, 10, 16] as const) expect(integerDigits(0n, radix, budget())).toBe("0");
  expect(integerDigits(-255n, 16, budget())).toBe("-ff");
  expect(integerDigits(255n, 2, budget())).toBe("11111111");
  expect(integerDigits(-255n, 8, budget())).toBe("-377");
  expect(integerDigits(255n, 10, budget())).toBe("255");
});
it("retains integer precision beyond binary64", () => {
  expect(integerDigits(123456789012345678901234567890n, 10, budget())).toBe("123456789012345678901234567890");
});
it("enforces the default decimal digit boundary excluding the sign", () => {
  for (const sign of [1n, -1n]) {
    expect(integerDigits(sign * (10n ** 4300n - 1n), 10, budget())).toBe((sign < 0n ? "-" : "") + "9".repeat(4300));
    expect(() => integerDigits(sign * 10n ** 4300n, 10, budget())).toThrow("Exceeds the limit (4300 digits) for integer string conversion; use sys.set_int_max_str_digits() to increase the limit");
  }
});
it("accepts explicit decimal limits and zero to disable the conversion limit", () => {
  expect(integerDigits(10n ** 4300n, 10, budget(), 0)).toBe("1" + "0".repeat(4300));
  expect(integerDigits(-999n, 10, budget(), 3)).toBe("-999");
  expect(() => integerDigits(1000n, 10, budget(), 3)).toThrow("Exceeds the limit (3 digits)");
  expect(integerDigits(1n, 10, budget(), Number.MAX_SAFE_INTEGER)).toBe("1");
});
it("does not apply the decimal limit to power-of-two radices", () => {
  expect(integerDigits(1n << 200n, 16, budget(), 1)).toBe("1" + "0".repeat(50));
  expect(integerDigits(1n << 600n, 8, budget(), 1)).toBe("1" + "0".repeat(200));
});
it("validates host conversion settings", () => {
  for (const limit of [-1, 0.5, Infinity, NaN]) expect(() => integerDigits(1n, 10, budget(), limit)).toThrow(RangeError);
  expect(() => integerDigits(1n, 3 as 10, budget())).toThrow(RangeError);
});
it("checks cancellation and allocation budgets", () => {
  const controller = new AbortController(); controller.abort();
  expect(() => integerDigits(0n, 10, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100 });
  expect(() => integerDigits(1n << 1000n, 2, meter)).toThrow(ExecutionLimitError);
  expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
});
it("rejects output admission and digit-limit failures before host decimal conversion", () => {
  const value = 10n ** 100n, spy = vi.spyOn(BigInt.prototype, "toString");
  try {
    const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 250 });
    expect(() => integerDigits(value, 10, meter)).toThrow(ExecutionLimitError);
    expect(() => integerDigits(value, 10, budget(), 10)).toThrow("Exceeds the limit");
    expect(spy).toHaveBeenCalledWith(16);
    expect(spy).not.toHaveBeenCalledWith(10);
  } finally { spy.mockRestore(); }
});
