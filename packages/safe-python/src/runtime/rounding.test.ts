import { describe, expect, it } from "vitest";
import { floatRound, integerRound } from "./rounding.js";

describe("Python numeric rounding", () => {
  it.each([[0.5, 0n], [1.5, 2n], [2.5, 2n], [3.5, 4n], [-0.5, 0n], [-1.5, -2n], [-2.5, -2n], [-3.5, -4n], [1.6, 2n], [-1.6, -2n], [-0, 0n]])("rounds %s to integer %s with ties to even", (value, expected) => {
    expect(floatRound(value)).toBe(expected);
  });

  it.each([
    [2.675, 2n, 2.67], [1.25, 1n, 1.2], [1.75, 1n, 1.8], [-1.25, 1n, -1.2],
    [125, -1n, 120], [135, -1n, 140], [-125, -1n, -120],
    [0.5, 0n, 0], [-0.5, 0n, -0], [-0, 8n, -0],
    [Number.MIN_VALUE, 323n, 0], [-Number.MIN_VALUE, 323n, -0],
    [Number.MIN_VALUE, 324n, Number.MIN_VALUE], [1e308, -308n, 1e308]
  ])("rounds float %s at %s digits to %s", (value, digits, expected) => {
    expect(floatRound(value, digits)).toBe(expected);
  });

  it.each([[125n, -1n, 120n], [135n, -1n, 140n], [-125n, -1n, -120n], [-135n, -1n, -140n], [500n, -3n, 0n], [501n, -3n, 1000n], [1500n, -3n, 2000n]])("rounds integer %s at %s digits to %s", (value, digits, expected) => {
    expect(integerRound(value, digits)).toBe(expected);
  });

  it("does not allocate powers proportional to unbounded ndigits", () => {
    const huge = 10n ** 100n;
    expect(floatRound(1.23, huge)).toBe(1.23);
    expect(floatRound(-1.23, -huge)).toBe(-0);
    expect(integerRound(123n, huge)).toBe(123n);
    expect(integerRound(123n, -huge)).toBe(0n);
    expect(integerRound(0n, -huge)).toBe(0n);
  });

  it("keeps integer rounding exact beyond float range", () => {
    const base = 10n ** 1000n;
    expect(integerRound(base + 15n, -1n)).toBe(base + 20n);
    expect(integerRound(-base - 25n, -1n)).toBe(-base - 20n);
    expect(integerRound(base)).toBe(base);
    expect(floatRound(Number.MAX_VALUE)).toBe(((1n << 53n) - 1n) << 971n);
  });

  it("preserves non-finite floats with digits but rejects integer rounding", () => {
    for (const value of [Infinity, -Infinity, NaN]) {
      for (const digits of [0n, 10n ** 100n, -(10n ** 100n)]) expect(floatRound(value, digits)).toBe(value);
      expect(() => floatRound(value)).toThrow(expect.objectContaining({ name: Number.isNaN(value) ? "ValueError" : "OverflowError" }));
    }
  });

  it("reports rounding overflow separately from conversion overflow", () => {
    for (const value of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
      expect(() => floatRound(value, -308n)).toThrow(expect.objectContaining({ name: "OverflowError", message: "rounded value too large to represent" }));
      expect(floatRound(value, -309n)).toBe(value < 0 ? -0 : 0);
    }
  });
});
