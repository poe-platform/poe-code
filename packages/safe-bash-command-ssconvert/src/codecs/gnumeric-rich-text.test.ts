import { expect, it } from "vitest";
import { readGnumericRichText, writeGnumericRichText } from "./gnumeric-rich-text.js";

// goffice go-format.c finds the range colon before looking for the closing ].
for (const family of ["Font]Name", "Font[Name]=", "Font]]=Name"]) {
  it(`reads closing brackets inside the font family ${family}`, () => {
    expect(readGnumericRichText(`@[family=${family}:0:6][bold=1:0:6]`)).toEqual([
      { start: 0, end: 6, attributes: { family } }, { start: 0, end: 6, attributes: { bold: 1 } }
    ]);
  });
  it(`writes the native representation of ${family}`, () => {
    expect(writeGnumericRichText([{ start: 0, end: 6, attributes: { family } }])).toBe(`@[family=${family}:0:6]`);
  });
}

it("still refuses a colon in a font family and malformed attribute ranges", () => {
  expect(() => writeGnumericRichText([{ start: 0, end: 6, attributes: { family: "Font:Name" } }])).toThrow("invalid rich text attribute value");
  for (const source of ["@[family=Font]Name]", "@[family=Font]Name:0:6", "@[family=Font]Name:0:6][bold=1]"])
    expect(readGnumericRichText(source)).toBeUndefined();
});
