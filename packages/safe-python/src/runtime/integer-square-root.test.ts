import { expect, it } from "vitest";
import { integerSquareRoot } from "./integer-square-root.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000000, maxAllocatedBytes: 10000000 });
it("returns floor square roots including zero and adjacent nonsquares", () => {
  const meter = budget();
  for (let root = 0n; root < 100n; root++) {
    expect(integerSquareRoot(root * root, meter)).toBe(root);
    if (root > 0n) expect(integerSquareRoot(root * root - 1n, meter)).toBe(root - 1n);
    expect(integerSquareRoot(root * root + 2n * root, meter)).toBe(root);
  }
});
it("handles arbitrary-size perfect squares and their neighbors without floats", () => {
  const meter = budget();
  for (const bits of [53n, 64n, 1024n, 20000n]) {
    const root = (1n << bits) + 12345n, square = root * root;
    expect(integerSquareRoot(square, meter)).toBe(root);
    expect(integerSquareRoot(square - 1n, meter)).toBe(root - 1n);
    expect(integerSquareRoot(square + 1n, meter)).toBe(root);
  }
});
it("rejects negative inputs with Python's domain diagnostic", () => {
  expect(() => integerSquareRoot(-1n, budget())).toThrow("isqrt() argument must be nonnegative");
});
it("bounds work and allocations before performing large arithmetic", () => {
  const value = 1n << 20000n;
  expect(() => integerSquareRoot(value, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 10000000 }))).toThrow(ExecutionLimitError);
  expect(() => integerSquareRoot(value, new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 64 }))).toThrow(ExecutionLimitError);
  const meter = budget(), result = integerSquareRoot(value + 123n, meter);
  expect(result).toBe(1n << 10000n);
  expect(meter.usage.steps).toBeLessThan(10000000);
});
