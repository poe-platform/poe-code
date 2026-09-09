import { describe, expect, it } from "vitest";
import { compileClassificationData } from "../scripts/unicode-classification-data.js";

describe("Unicode classification range generation", () => {
  it("uses Letter categories rather than the broader Alphabetic property", () => {
    const result = compileClassificationData("0041;A;Lu\n0042;B;Lu\n0061;a;Ll\n0301;MARK;Mn\n2160;ROMAN;Nl\n", "");
    expect(result.alpha).toEqual([65, 66, 97, 97]);
    expect(result.printable).toEqual([32, 32, 65, 66, 97, 97, 0x301, 0x301, 0x2160, 0x2160]);
  });
  it("includes Han numeric properties and cumulative decimal/digit/numeric sets", () => {
    const result = compileClassificationData("", "4E00;Numeric\n0030..0031;Decimal\n00B2;Digit\n0032;Decimal # adjacent\n");
    expect(result.decimal).toEqual([48, 50]);
    expect(result.digit).toEqual([48, 50, 0xb2, 0xb2]);
    expect(result.numeric).toEqual([48, 50, 0xb2, 0xb2, 0x4e00, 0x4e00]);
  });
  it("expands First/Last rows as ranges without materializing individual points", () => {
    const result = compileClassificationData("3400;<CJK, First>;Lo\n4DBF;<CJK, Last>;Lo\nE000;<PRIVATE, First>;Co\nF8FF;<PRIVATE, Last>;Co\n", "");
    expect(result.alpha).toEqual([0x3400, 0x4dbf]);
    expect(result.printable).toEqual([32, 32, 0x3400, 0x4dbf]);
  });
  it("rejects incomplete or inconsistent paired ranges", () => {
    for (const input of ["3400;<CJK, First>;Lo", "3400;<CJK, First>;Lo\n4DBF;<OTHER, Last>;Lo", "3400;<CJK, First>;Lo\n4DBF;<CJK, Last>;Co", "4DBF;<CJK, Last>;Lo"]) {
      expect(() => compileClassificationData(input, "")).toThrow("Unicode category range");
    }
  });
  it("rejects invalid code points and descending numeric ranges", () => {
    expect(() => compileClassificationData("110000;INVALID;Lo", "")).toThrow("invalid Unicode code point");
    expect(() => compileClassificationData("", "0041ZZ;Numeric")).toThrow("invalid Unicode code point");
    expect(() => compileClassificationData("", "0039..0030;Decimal")).toThrow("invalid Unicode numeric range");
    expect(() => compileClassificationData("", "0030..0031..0032;Decimal")).toThrow("invalid Unicode numeric range");
  });
});
