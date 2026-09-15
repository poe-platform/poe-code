import { expect, it } from "vitest";
import { isUnicodeWhitespace } from "./unicode-whitespace.js";

it("recognizes Python whitespace including non-ASCII separators and control separators", () => {
  const expected = [9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 0x85, 0xa0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
    0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
  const actual: number[] = [];
  for (let point = 0; point <= 0x10ffff; point++) if (isUnicodeWhitespace(point)) actual.push(point);
  expect(actual).toEqual(expected);
});
