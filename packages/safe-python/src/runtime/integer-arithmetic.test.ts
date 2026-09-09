import { describe, expect, it } from "vitest";
import { integerDivmod, integerTrueDivide } from "./integer-arithmetic.js";

describe("Python integer division", () => {
  it.each([
    [7n, 3n, 2n, 1n], [-7n, 3n, -3n, 2n], [7n, -3n, -3n, -2n],
    [-7n, -3n, 2n, -1n], [-6n, 3n, -2n, 0n], [0n, -3n, 0n, 0n]
  ])("divmod(%s, %s) floors and uses the divisor's remainder sign", (a, b, quotient, remainder) => {
    expect(integerDivmod(a, b)).toEqual({ quotient, remainder });
  });

  it("preserves exact quotient/remainder identities for large signed operands", () => {
    const values = [1n, 3n, 97n, (1n << 53n) + 1n, (1n << 4096n) - 1n];
    for (const magnitudeA of values) for (const magnitudeB of values) {
      for (const signA of [-1n, 1n]) for (const signB of [-1n, 1n]) {
        const a = magnitudeA * signA, b = magnitudeB * signB;
        const { quotient, remainder } = integerDivmod(a, b);
        expect(quotient * b + remainder).toBe(a);
        expect(remainder === 0n || (remainder > 0n) === (b > 0n)).toBe(true);
        expect(remainder < 0n ? -remainder : remainder).toBeLessThan(magnitudeB);
      }
    }
  });

  it("divides huge integers without first converting either operand to float", () => {
    const huge = 10n ** 1000n;
    expect(integerTrueDivide(huge, huge)).toBe(1);
    expect(integerTrueDivide(huge, 3n * huge)).toBe(1 / 3);
    expect(integerTrueDivide(-huge, 7n * huge)).toBe(-1 / 7);
    // Rounding either operand first changes the correctly rounded ratio.
    expect(integerTrueDivide(9007199254740993n, 3n)).toBe(3002399751580331);
    expect(integerTrueDivide(3n, 9007199254740993n)).not.toBe(3 / Number(9007199254740993n));
    expect(integerTrueDivide(9007199254740993n, 9007199254740992n)).toBe(1);
    expect(integerTrueDivide(9007199254740995n, 9007199254740992n)).toBe(1 + 2 ** -51);
  });

  it.each([0, 1, 51, 52, 100, 1022])("rounds halfway to an even significand at exponent %s", exponent => {
    const scale = 1n << BigInt(exponent);
    expect(integerTrueDivide(((1n << 53n) + 1n) * scale, 1n << 53n)).toBe(2 ** exponent);
    expect(integerTrueDivide(((1n << 53n) + 3n) * scale, 1n << 53n)).toBe((1 + 2 ** -51) * 2 ** exponent);
  });

  it("rounds subnormal values and preserves underflow signs", () => {
    const denominator = 1n << 1075n;
    expect(integerTrueDivide(1n, denominator)).toBe(0);
    expect(integerTrueDivide(-1n, denominator)).toBe(-0);
    expect(integerTrueDivide(3n, denominator)).toBe(2 * Number.MIN_VALUE);
    expect(integerTrueDivide(5n, denominator)).toBe(2 * Number.MIN_VALUE);
    expect(integerTrueDivide(7n, denominator)).toBe(4 * Number.MIN_VALUE);
    expect(integerTrueDivide(1n, denominator - 1n)).toBe(Number.MIN_VALUE);
    expect(integerTrueDivide(1n, denominator + 1n)).toBe(0);
    expect(integerTrueDivide(-1n, 1n << 10000n)).toBe(-0);
    expect(integerTrueDivide((1n << 53n) - 1n, denominator)).toBe(2 ** -1022);
  });

  it.each([[0n, 1n, 0], [0n, -1n, -0], [1n, -2n, -0.5], [-1n, -2n, 0.5]])("preserves result signs for %s / %s", (a, b, expected) => {
    expect(integerTrueDivide(a, b)).toBe(expected);
  });

  it("rejects overflow only after correct rounding at the largest finite float", () => {
    const midpoint = (1n << 1024n) - (1n << 970n);
    expect(integerTrueDivide(midpoint - 1n, 1n)).toBe(Number.MAX_VALUE);
    expect(integerTrueDivide(1n - midpoint, 1n)).toBe(-Number.MAX_VALUE);
    for (const a of [midpoint, -midpoint, 1n << 10000n]) {
      expect(() => integerTrueDivide(a, 1n)).toThrow(expect.objectContaining({ name: "OverflowError", message: "integer division result too large for a float" }));
    }
  });

  it("uses Python numeric faults rather than host bigint division errors", () => {
    for (const a of [0n, 1n, -1n]) {
      expect(() => integerDivmod(a, 0n)).toThrow(expect.objectContaining({ name: "ZeroDivisionError", message: "integer division or modulo by zero" }));
      expect(() => integerTrueDivide(a, 0n)).toThrow(expect.objectContaining({ name: "ZeroDivisionError", message: "division by zero" }));
    }
  });
});
