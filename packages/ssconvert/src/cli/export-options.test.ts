import { expect, it } from "vitest";
import { exportOptionPairs } from "./export-options.js";
import { validateImageOptions } from "../conversion/image-options.js";

it("stops at the C string terminator, including inside quoted strings", () => {
  expect([...exportOptionPairs("sheet=one\0bad")]).toEqual([["sheet", "one"]]);
  expect(() => [...exportOptionPairs("sheet='one\0'")]).toThrow("Quoted string not terminated");
});

it.each([
  ["-!_.,:;|/$%#@~=", [["-!_.,:;|/$%#@~", ""]]],
  ["\u2003'𝟘' \t= ''sheet=last", [["𝟘", ""], ["sheet", "last"]]],
  ["sheet=a=b", [["sheet", "a=b"]]], ["sheet=", [["sheet", ""]]],
  ["sheet='a\\nb'", [["sheet", "anb"]]]
] as const)("preserves the source grammar for %s", (text, expected) => {
  expect([...exportOptionPairs(text)]).toEqual(expected);
});

it.each(["0x1p2junk", "+0x2tail", "0x.8p1", "0x1p", "0x2710junk"])
("accepts C hexadecimal numeric prefixes: %s", value => {
  expect(() => validateImageOptions([`resolution=${value}`])).not.toThrow();
});

it("uses C locale numeric whitespace rather than Unicode trim", () => {
  expect(() => validateImageOptions(["resolution='\u00a02'"])).toThrow('Invalid export option "resolution=\u00a02"');
});

it("defaults to 100 and preserves ordered duplicate image options", () => {
  expect(validateImageOptions([])).toBe(100);
  expect(validateImageOptions(["resolution=1", "resolution='0x1p2'resolution=10000tail"])).toBe(10000);
  expect(() => validateImageOptions(["resolution=0 resolution=100"])).toThrow('Invalid export option "resolution=0"');
  expect(() => validateImageOptions(["sheet=Sheet resolution=100"])).toThrow('Invalid export option "sheet=Sheet" for image export');
});
