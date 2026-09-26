import { test, expect } from "vitest";
import { portableLocale } from "./portable-locale.js";

test("portable C formatting rounds binary floats half-even and keeps fixed notation", () => {
  expect(portableLocale.formatNumber("0.0625", "C", "%.3f", true)).toBe("0.062");
  expect(portableLocale.formatNumber("2.675", "C", "%.2f", true)).toBe("2.67");
  expect(portableLocale.formatNumber("1000000000000000000000", "C", "%.3f", true)).toBe("1000000000000000000000.000");
  expect(portableLocale.formatNumber("-0", "C", "%.3f", true)).toBe("-0.000");
});
