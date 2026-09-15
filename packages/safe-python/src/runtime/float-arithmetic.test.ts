import { describe, expect, it } from "vitest";
import { floatDivmod, floatTrueDivide } from "./float-arithmetic.js";

describe("Python float division", () => {
  it.each([
    [7, 3, 2, 1], [-7, 3, -3, 2], [7, -3, -3, -2], [-7, -3, 2, -1],
    [1, 0.1, 9, 0.09999999999999995], [-1, 0.1, -10, 5.551115123125783e-17],
    [1, -0.1, -10, -5.551115123125783e-17],
    [1.1764705882352942, 0.043478260869565216, 27, 0.00255754475703332],
    [0, -3, -0, -0], [-0, 3, -0, 0], [-0, -3, 0, -0],
    [6, -3, -2, -0], [-6, 3, -2, 0],
    [3, Infinity, 0, 3], [-3, Infinity, -1, Infinity],
    [3, -Infinity, -1, -Infinity], [-3, -Infinity, 0, -3],
    [Number.MIN_VALUE, 2, 0, Number.MIN_VALUE],
    [-Number.MIN_VALUE, 2, -1, 2],
    [Number.MAX_VALUE, Number.MIN_VALUE, Infinity, 0]
  ])("divmod(%s, %s) preserves quotient %s and remainder %s", (a, b, quotient, remainder) => {
    const result = floatDivmod(a, b);
    expect(result.quotient).toBe(quotient);
    expect(result.remainder).toBe(remainder);
  });

  it.each([[Infinity, 3], [-Infinity, -3], [Infinity, Infinity], [NaN, 1], [1, NaN]])("propagates NaN in divmod(%s, %s)", (a, b) => {
    const result = floatDivmod(a, b);
    expect(result.quotient).toBeNaN();
    expect(result.remainder).toBeNaN();
  });

  it.each([
    [1, 0.1, 10], [0, -3, -0], [-0, -3, 0],
    [Number.MAX_VALUE, Number.MIN_VALUE, Infinity],
    [-Number.MIN_VALUE, 2, -0], [3, -Infinity, -0],
    [Infinity, -3, -Infinity], [Infinity, Infinity, NaN], [NaN, 3, NaN]
  ])("true division %s / %s is %s", (a, b, result) => {
    expect(floatTrueDivide(a, b)).toBe(result);
  });

  it("raises zero division even for NaN or infinite numerators", () => {
    for (const a of [0, -0, 1, -1, Infinity, -Infinity, NaN]) for (const b of [0, -0]) {
      for (const operation of [floatDivmod, floatTrueDivide]) {
        expect(() => operation(a, b)).toThrow(expect.objectContaining({ name: "ZeroDivisionError", message: "division by zero" }));
      }
    }
  });
});
