import { expect, it } from "vitest";
import { alphaRanges, decimalRanges, digitRanges, numericRanges, printableRanges, lowerRanges, upperRanges, titleRanges, casedRanges, caseIgnorableRanges } from "../unicode-classification-data.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { isUnicodeCharacter } from "./unicode-character-classification.js";

it("retains sorted, disjoint, coalesced generated intervals", () => {
  for (const ranges of [alphaRanges, decimalRanges, digitRanges, numericRanges, printableRanges, lowerRanges, upperRanges, titleRanges, casedRanges, caseIgnorableRanges]) {
    const invalid: number[] = [];
    for (let index = 0; index < ranges.length; index += 2) {
      if (ranges[index] > ranges[index + 1] || ranges[index] < 0 || ranges[index + 1] > 0x10ffff
        || (index > 0 && ranges[index] <= ranges[index - 1] + 1)) invalid.push(index);
    }
    expect(ranges.length % 2).toBe(0); expect(invalid).toEqual([]);
  }
});

it("performs bounded binary lookup without per-call allocation", () => {
  const meter = new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 0 });
  expect(isUnicodeCharacter(0x4e00, "isnumeric", meter)).toBe(true);
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(() => isUnicodeCharacter(0x10ffff, "isprintable", new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
});

it.each([-1, 0x110000, 1.5, NaN, Infinity])("rejects invalid code point %s", point => {
  expect(isUnicodeCharacter(point, "isprintable")).toBe(false);
});
