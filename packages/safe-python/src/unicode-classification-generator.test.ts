import { describe, expect, it } from "vitest";
import { compileClassificationData } from "../scripts/unicode-classification-data.js";

describe("Unicode classification range generation", () => {
  it("retains independent Cased and Case_Ignorable properties", () => {
    const result = compileClassificationData("", "", "0041;Cased\n0301;Case_Ignorable\n0345;Cased\n0345;Case_Ignorable\n");
    expect(result.cased).toEqual([0x41, 0x41, 0x345, 0x345]);
    expect(result.caseIgnorable).toEqual([0x301, 0x301, 0x345, 0x345]);
  });
  it("uses derived lowercase/uppercase properties and the titlecase category", () => {
    const result = compileClassificationData("01C5;TITLE;Lt\n", "", "0061..0062;Lowercase\n00AA;Lowercase\n0041;Uppercase\n0042;Uppercase\n0301;Case_Ignorable\n");
    expect(result.lower).toEqual([0x61, 0x62, 0xaa, 0xaa]);
    expect(result.upper).toEqual([0x41, 0x42]);
    expect(result.title).toEqual([0x1c5, 0x1c5]);
  });
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
  it("rejects invalid derived case ranges", () => {
    expect(() => compileClassificationData("", "", "110000;Lowercase")).toThrow("invalid Unicode code point");
    expect(() => compileClassificationData("", "", "0042..0041;Uppercase")).toThrow("invalid Unicode case range");
    expect(() => compileClassificationData("", "", "0041..0042..0043;Uppercase")).toThrow("invalid Unicode case range");
  });
});
