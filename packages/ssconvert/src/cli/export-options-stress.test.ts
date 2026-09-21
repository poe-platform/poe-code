import { expect, it } from "vitest";
import { exportOptionPairs } from "./export-options.js";
import { validateImageOptions } from "../conversion/image-options.js";
import { cNumber } from "../conversion/c-number.js";

it("keeps hexadecimal significands finite when their exponent cancels their size", () => {
  expect(validateImageOptions([`resolution=0x1${"0".repeat(300)}p-1200`])).toBe(1);
  expect(cNumber("0x0p100000")).toBe(0);
});

it.each([
  ["-0x2p2tail", -8], ["+0x.8p1", 1], ["0x1p+ 2", 1],
  ["0x1p1024", Infinity], ["0x1p-1074", Number.MIN_VALUE],
  ["0x3p-1075", 2 * Number.MIN_VALUE], ["0x1p-1075", 0],
  ["0x1.00000000000008p0", 1], ["0x1.00000000000018p0", 1 + 2 ** -51],
  ["\u00a01", 0], ["1e+oops", 1], ["1e309", Infinity]
])("matches C numeric prefix %s", (text, expected) => {
  expect(cNumber(text as string)).toBe(expected);
});

it("keeps grammar failures lazy after a previously yielded pair", () => {
  const pairs = exportOptionPairs("resolution=0 broken'");
  expect(pairs.next().value).toEqual(["resolution", "0"]);
  expect(() => pairs.next()).toThrow("Syntax error");
  expect(() => validateImageOptions(["resolution=0 broken'"])).toThrow('Invalid export option "resolution=0"');
});

it.each(["1", "10000", "9999.999", "10000junk"])("accepts inclusive image bounds %s", text => {
  expect(() => validateImageOptions([`resolution=${text}`])).not.toThrow();
});

it.each(["0.999999", "10000.001", "nan", "inf", "1e309", "0x1p1024", "0b10", "", "\u00a01"])
("rejects invalid image resolution %s", text => {
  expect(() => validateImageOptions([`resolution='${text}'`])).toThrow("Invalid export option");
});
