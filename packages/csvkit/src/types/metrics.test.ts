import { test, expect } from "vitest";
import { Decimal, DecimalTrap } from "./decimal.js";
import { decimalPercentiles, sampleVariance } from "./metrics.js";
import reference from "../../../../docs/csvkit/csvstat-metrics-review-reference.json" with { type: "json" };

test("Agate CDF percentiles include extrema and average boundary pairs", () => {
  const data = ["8", "2", "6", "4"].map(Decimal.parse);
  const result = decimalPercentiles(data, () => {});
  expect(result).toHaveLength(101);
  expect([0, 24, 25, 26, 50, 75, 100].map(index => result[index]?.toString())).toEqual(["2", "2", "3", "4", "5", "7", "8"]);
  expect(data.map(value => value.toString())).toEqual(["8", "2", "6", "4"]);
  expect(decimalPercentiles([], () => {})).toEqual(Array(101).fill(null));
});

test("sample variance preserves Decimal increments below binary64 resolution", () => {
  expect(sampleVariance(["10000000000000000.1", "10000000000000000.2", "10000000000000000.3"].map(Decimal.parse), () => {})?.toString()).toBe("0.01");
  expect(sampleVariance([], () => {})).toBeNull();
  expect(() => sampleVariance([Decimal.parse("2")], () => {})).toThrow(DecimalTrap);
});

test("quantile sorting observes NaN traps and cooperative checkpoints", () => {
  expect(() => decimalPercentiles(["NaN", "2"].map(Decimal.parse), () => {})).toThrow(DecimalTrap);
  const reason = new Error("cancelled");
  expect(() => decimalPercentiles([Decimal.parse("2")], () => { throw reason; })).toThrow(reason);
});

test("sample variance uses Python Decimal power's preferred zero exponent", () => {
  expect(sampleVariance(["0", "-0.00"].map(Decimal.parse), () => {})?.toString()).toBe("0");
});

for (const [index, item] of reference.metrics.entries()) {
  test(`frozen Agate quantile and sample variance differential ${index}`, () => {
    const data = item.data.map(Decimal.parse);
    if (Array.isArray(item.percentiles)) {
      expect(decimalPercentiles(data, () => {}).map(value => value?.toString() ?? null)).toEqual(item.percentiles);
    } else expect(() => decimalPercentiles(data, () => {})).toThrow(DecimalTrap);
    if (typeof item.variance === "string") expect(sampleVariance(data, () => {})?.toString()).toBe(item.variance);
    else expect(() => sampleVariance(data, () => {})).toThrow(DecimalTrap);
  });
}

for (const [index, item] of reference.power2Review.differences.entries()) {
  test(`original Decimal power double-rounding sample variance ${index}`, () => {
    expect(sampleVariance([item.input, "-" + item.input].map(Decimal.parse), () => {})?.toString()).toBe(item.sampleVariance);
  });
}
