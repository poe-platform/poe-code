import { describe, expect, it } from "vitest";
import { floatAsIntegerRatio, floatToInteger, integerToFloat } from "./numeric-conversion.js";
import { integerTrueDivide } from "./integer-arithmetic.js";

describe("numeric conversion", () => {
  it.each([[0, 0n], [-0, 0n], [3.9, 3n], [-3.9, -3n], [Number.MIN_VALUE, 0n], [-Number.MIN_VALUE, 0n], [2 ** 100, 1n << 100n]])("truncates %s to %s", (value, integer) => {
    expect(floatToInteger(value)).toBe(integer);
  });

  it("converts the full finite float range to exact integers", () => {
    const largest = ((1n << 53n) - 1n) << 971n;
    expect(floatToInteger(Number.MAX_VALUE)).toBe(largest);
    expect(floatToInteger(-Number.MAX_VALUE)).toBe(-largest);
  });

  it.each([
    [0n, 0], [1n, 1], [-1n, -1],
    [(1n << 53n) + 1n, 2 ** 53], [(1n << 53n) + 3n, 2 ** 53 + 4],
    [-((1n << 53n) + 1n), -(2 ** 53)], [-((1n << 53n) + 3n), -(2 ** 53 + 4)]
  ])("rounds integer %s to float %s", (value, result) => {
    expect(integerToFloat(value)).toBe(result);
  });

  it("checks integer conversion overflow at the binary64 rounding boundary", () => {
    const midpoint = (1n << 1024n) - (1n << 970n);
    expect(integerToFloat(midpoint - 1n)).toBe(Number.MAX_VALUE);
    expect(integerToFloat(1n - midpoint)).toBe(-Number.MAX_VALUE);
    for (const value of [midpoint, -midpoint, 10n ** 1000n]) {
      expect(() => integerToFloat(value)).toThrow(expect.objectContaining({ name: "OverflowError", message: "int too large to convert to float" }));
    }
  });

  it.each([
    [0, 0n, 1n], [-0, 0n, 1n], [0.5, 1n, 2n], [-1.25, -5n, 4n],
    [0.1, 3602879701896397n, 36028797018963968n],
    [Number.MIN_VALUE, 1n, 1n << 1074n], [-Number.MIN_VALUE, -1n, 1n << 1074n],
    [2 ** -1022, 1n, 1n << 1022n],
    [Number.MAX_VALUE, ((1n << 53n) - 1n) << 971n, 1n]
  ])("extracts the reduced exact ratio for %s", (value, numerator, denominator) => {
    expect(floatAsIntegerRatio(value)).toEqual({ numerator, denominator });
  });

  it("round-trips finite nonzero float ratios across binary exponents", () => {
    for (let exponent = -1074; exponent <= 1023; exponent += 13) {
      for (const coefficient of [-1.75, -1, 1, 1.75]) {
        const value = coefficient * 2 ** exponent;
        const { numerator, denominator } = floatAsIntegerRatio(value);
        expect(integerTrueDivide(numerator, denominator)).toBe(value);
        expect(denominator).toBeGreaterThan(0n);
        expect(denominator === 1n || (numerator & 1n) !== 0n).toBe(true);
      }
    }
  });

  it.each([Infinity, -Infinity, NaN])("rejects non-finite conversion of %s with Python errors", value => {
    const name = Number.isNaN(value) ? "ValueError" : "OverflowError";
    expect(() => floatToInteger(value)).toThrow(expect.objectContaining({ name, message: Number.isNaN(value) ? "cannot convert float NaN to integer" : "cannot convert float infinity to integer" }));
    expect(() => floatAsIntegerRatio(value)).toThrow(expect.objectContaining({ name, message: Number.isNaN(value) ? "cannot convert NaN to integer ratio" : "cannot convert Infinity to integer ratio" }));
  });
});
