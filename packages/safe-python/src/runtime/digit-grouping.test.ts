import { expect, it } from "vitest";
import { DigitGrouping } from "./digit-grouping.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
it("counts repeating western and Indian grouping boundaries", () => {
  const meter = budget(), western = new DigitGrouping([3, 0], meter), indian = new DigitGrouping([3, 2, 0], meter);
  expect(western.separatorCount(0, meter)).toBe(0);
  expect(western.isBoundary(0, meter)).toBe(false);
  expect(western.minimumDigits(0n, 0, 1, meter)).toBe(0);
  expect([1, 3, 4, 6, 7, 10].map(n => western.separatorCount(n, meter))).toEqual([0, 0, 1, 1, 2, 3]);
  expect([3, 4, 5, 6, 7, 8].map(n => indian.separatorCount(n, meter))).toEqual([0, 1, 1, 2, 2, 3]);
  expect([1, 2, 3, 4, 5, 6, 7].filter(n => indian.isBoundary(n, meter))).toEqual([3, 5, 7]);
});
it("honors stop, repeat, implicit terminators and ignored trailing bytes", () => {
  const meter = budget();
  for (const pattern of [[], [0], [127], [0, 3]]) expect(new DigitGrouping(pattern, meter).separatorCount(100, meter)).toBe(0);
  expect(new DigitGrouping([3, 2, 127, 1], meter).separatorCount(100, meter)).toBe(2);
  expect(new DigitGrouping([3, 2], meter).separatorCount(10, meter)).toBe(4);
  expect(new DigitGrouping([3, 0, 1], meter).isBoundary(6, meter)).toBe(true);
});
it("finds the minimum zero-padded digit count with multi-point separators", () => {
  const meter = budget(), grouping = new DigitGrouping([3, 0], meter);
  expect(grouping.minimumDigits(8n, 4, 1, meter)).toBe(7);
  expect(grouping.minimumDigits(8n, 4, 2, meter)).toBe(6);
  expect(grouping.minimumDigits(8n, 4, 0, meter)).toBe(8);
  expect(grouping.minimumDigits(1n, 4, 1, meter)).toBe(4);
});
it("snapshots grouping metadata and calculates huge widths without linear scans", () => {
  const meter = budget(), input = [3, 2, 0], grouping = new DigitGrouping(input, meter);
  input[0] = 1;
  expect(grouping.isBoundary(1, meter)).toBe(false);
  const bounded = new ExecutionBudget({ maxSteps: 500, maxAllocatedBytes: 10000 });
  expect(grouping.minimumDigits(4294967295n, 1, 1, bounded)).toBe(2863311531);
});
it("validates normalized dimensions and preflights excessive widths", () => {
  const meter = budget(), grouping = new DigitGrouping([3], meter);
  for (const n of [-1, 1.5, 128, NaN]) expect(() => new DigitGrouping([n], meter)).toThrow(RangeError);
  expect(() => grouping.separatorCount(-1, meter)).toThrow(RangeError);
  expect(() => grouping.minimumDigits(-1n, 1, 1, meter)).toThrow(RangeError);
  expect(() => grouping.minimumDigits(1n << 64n, 1, 1, budget())).toThrow(ExecutionLimitError);
});
