import { describe, expect, it } from "vitest";
import { floatFma } from "./float-fma.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function meter() { return new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }); }

describe("binary64 fused multiply-add kernel", () => {
  it("rounds only once across cancellation and intermediate overflow", () => {
    expect(floatFma(1e308, 1e-308, -1, meter())).toBe(-7.969431103331108e-17);
    expect(floatFma(1e308, 2, -1e308, meter())).toBe(1e308);
  });
  it("preserves signed underflow and rounds subnormal ties to even", () => {
    expect(Object.is(floatFma(1e-308, -1e-308, 0, meter()), -0)).toBe(true);
    expect(floatFma(Number.MIN_VALUE, .5, Number.MIN_VALUE, meter())).toBe(2 * Number.MIN_VALUE);
    expect(floatFma(1, 1, -1, meter())).toBe(0);
    expect(Object.is(floatFma(-0, 1, -0, meter()), -0)).toBe(true);
  });
  it("retains hardware-style infinity and NaN results for internal arithmetic", () => {
    expect(floatFma(1e308, 2, 1e308, meter())).toBe(Infinity);
    expect(floatFma(-1e308, 2, -1e308, meter())).toBe(-Infinity);
    expect(floatFma(Infinity, 2, 1, meter())).toBe(Infinity);
    expect(floatFma(1e308, 2, -Infinity, meter())).toBe(-Infinity);
    expect(Number.isNaN(floatFma(Infinity, 0, 1, meter()))).toBe(true);
  });
  it("checks execution limits before arithmetic", () => {
    expect(() => floatFma(1, 2, 3, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
