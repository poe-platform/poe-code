import { expect, it } from "vitest";
import { CompensatedSum } from "./compensated-sum.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 });
it("recovers low-order values lost by ordinary repeated addition", () => {
  for (const items of [[1e16, 1, -1e16], [1, 1e16, -1e16], [1e16, -1e16, 1]]) {
    const sum = new CompensatedSum(0, budget());
    for (const item of items) sum.add(item);
    expect(sum.toNumber()).toBe(1);
  }
});
it("accumulates small contributions and exposes a nondestructive total", () => {
  const sum = new CompensatedSum(0, budget());
  for (let i = 0; i < 10000; i++) sum.add(0.1);
  expect(sum.toNumber()).toBe(1000);
  expect(sum.toNumber()).toBe(1000);
  sum.add(-1000); expect(sum.toNumber()).toBeCloseTo(0, 10);
});
it("preserves negative zero unless an actual addition changes its sign", () => {
  const sum = new CompensatedSum(-0, budget());
  expect(sum.toNumber()).toBe(-0);
  sum.add(-0); expect(sum.toNumber()).toBe(-0);
  sum.add(0); expect(sum.toNumber()).toBe(0);
});
it("does not turn infinite or overflowed totals into NaN from compensation", () => {
  for (const items of [[Infinity], [1e308, 1e308], [-Infinity], [-1e308, -1e308]]) {
    const sum = new CompensatedSum(0, budget());
    for (const item of items) sum.add(item);
    expect(sum.toNumber()).toBe(items[0]! < 0 ? -Infinity : Infinity);
  }
  for (const items of [[NaN], [Infinity, -Infinity]]) {
    const sum = new CompensatedSum(0, budget());
    for (const item of items) sum.add(item);
    expect(sum.toNumber()).toBeNaN();
  }
});
it("charges fixed storage and observes cancellation before mutating state", () => {
  const meter = budget(), sum = new CompensatedSum(1, meter), allocated = meter.usage.allocatedBytes;
  for (let i = 0; i < 100; i++) sum.add(i);
  expect(meter.usage.allocatedBytes).toBe(allocated);
  let cancelled = false;
  const guarded = new CompensatedSum(1, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
  cancelled = true; expect(() => guarded.add(2)).toThrow(ExecutionLimitError);
  expect(() => guarded.toNumber()).toThrow(ExecutionLimitError);
  cancelled = false; expect(guarded.toNumber()).toBe(1);
});
