import { test, expect } from "vitest";
import { portableLocale } from "./portable-locale.js";

test("portable C formatting rounds binary floats half-even and keeps fixed notation", () => {
  expect(portableLocale.formatNumber("0.0625", "C", "%.3f", true)).toBe("0.062");
  expect(portableLocale.formatNumber("2.675", "C", "%.2f", true)).toBe("2.67");
  expect(portableLocale.formatNumber("1000000000000000000000", "C", "%.3f", true)).toBe("1000000000000000000000.000");
  expect(portableLocale.formatNumber("-0", "C", "%.3f", true)).toBe("-0.000");
});

test.each([
  ["1234567.1255", true, "1,234,567.126"],
  ["1234567.1245", true, "1,234,567.124"],
  ["1234567.1000", false, "1234567.1"],
  ["999.9999", true, "1,000"],
  ["-1230", true, "-1,230"],
  ["9007199254740993", true, "9,007,199,254,740,993"],
  ["-0.0001", true, "-0"],
  ["1e-100", true, "0"],
] as const)("portable decimal pattern formats %s (grouping %s)", (value, grouping, expected) => {
  expect(portableLocale.formatNumber(value, "C", "#,##0.###", grouping)).toBe(expected);
});
