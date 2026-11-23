import { describe, expect, it } from "vitest";
import { gnumericNumber } from "./gnumeric-number.js";

describe("Gnumeric number serialization", () => {
  it.each([
    [1e-20, "9.9999999999999995e-21"],
    [-1e-20, "-9.9999999999999995e-21"],
    [1e-7, "9.9999999999999995e-08"],
    [1e-6, "9.9999999999999995e-07"],
    [1e-5, "1.0000000000000001e-05"],
    [1e-4, "0.0001"],
    [1e21, "1e+21"],
    [0.9999999999999999, "0.99999999999999989"],
    [Number.MIN_VALUE, "4.9406564584124654e-324"],
    [Number.MAX_VALUE, "1.7976931348623157e+308"],
  ] as const)("formats %s with C-locale %.17g precision", (value, expected) => {
    expect(gnumericNumber(value)).toBe(expected);
    expect(Number(gnumericNumber(value))).toBe(value);
  });

  it("rounds at the requested precision and retains shortest mode", () => {
    expect(gnumericNumber(1e-20, false, 6)).toBe("1e-20");
    expect(gnumericNumber(1e-20, true)).toBe("1e-20");
    expect(gnumericNumber(-0)).toBe("0");
  });
});
