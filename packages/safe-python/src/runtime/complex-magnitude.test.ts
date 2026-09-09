import { expect, it } from "vitest";
import { complexMagnitude } from "./complex-magnitude.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 });
it("rounds finite magnitudes without host hypot's intermediate rounding", () => {
  for (const [real, imaginary, expected] of [
    [3, 4, 5],
    [1.043114513343057e-289, 1.5834849371630372e-289, 1.8961836499055544e-289],
    [0.003024118836492562, 0.0031173830411717063, 0.00434319833332696],
    [1.9489279631616928e280, 3.0851370139689486e280, 3.649162999998058e280],
    [1e308, 1e308, 1.4142135623730951e308],
  ]) {
    expect(complexMagnitude(real!, imaginary!, budget())).toBe(expected);
    expect(complexMagnitude(-imaginary!, -real!, budget())).toBe(expected);
  }
});
it("rounds subnormals and retains finite values at the overflow boundary", () => {
  expect(complexMagnitude(5e-324, 5e-324, budget())).toBe(5e-324);
  expect(complexMagnitude(1e-323, 1e-323, budget())).toBe(1.5e-323);
  // High-precision Decimal references: even math.hypot can double-round
  // subnormal outputs on the CPython platform used for the differential audit.
  expect(complexMagnitude(6.96397573623543e-309, 7.191042370905013e-309, budget())).toBe(1.0010397016853373e-308);
  expect(complexMagnitude(9.24870316994797e-309, 8.137375159466126e-309, budget())).toBe(1.231890355558083e-308);
  expect(complexMagnitude(1.0653048269569357e-308, 7.63421376667607e-309, budget())).toBe(1.310605422196479e-308);
  expect(complexMagnitude(2.2250738585072014e-308, 5e-324, budget())).toBe(2.2250738585072014e-308);
  expect(complexMagnitude(Number.MAX_VALUE, 1e292, budget())).toBe(Number.MAX_VALUE);
  expect(complexMagnitude(Number.MAX_VALUE, Number.MIN_VALUE, budget())).toBe(Number.MAX_VALUE);
  expect(() => complexMagnitude(1.7e308, 1.7e308, budget())).toThrow("absolute value too large");
});
it("gives infinities priority over NaNs and always clears zero's sign", () => {
  expect(complexMagnitude(Infinity, NaN, budget())).toBe(Infinity);
  expect(complexMagnitude(NaN, -Infinity, budget())).toBe(Infinity);
  expect(complexMagnitude(NaN, 0, budget())).toBeNaN();
  expect(complexMagnitude(-0, -0, budget())).toBe(0);
  expect(complexMagnitude(-3, -0, budget())).toBe(3);
});
it("observes work, allocation and cancellation limits", () => {
  expect(() => complexMagnitude(3, 4, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 100000 }))).toThrow(ExecutionLimitError);
  expect(() => complexMagnitude(3, 4, new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 64 }))).toThrow(ExecutionLimitError);
  const controller = new AbortController();
  controller.abort();
  expect(() => complexMagnitude(Infinity, 0, new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
