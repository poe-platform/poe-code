import { describe, expect, it } from "vitest";
import { compileUnicodeNames } from "../scripts/unicode-data.js";

describe("Unicode name data generation", () => {
  it("sorts explicit names and aliases into a compact searchable table", () => {
    expect(compileUnicodeNames(
      "# names\n0042 ; LATIN CAPITAL LETTER B\n0041 ; LATIN CAPITAL LETTER A\n",
      "0000;NULL;control # alias\n0041;A LETTER;abbreviation\n"
    )).toEqual({
      names: "A LETTER=41\nLATIN CAPITAL LETTER A=41\nLATIN CAPITAL LETTER B=42\nNULL=0\n",
      ranges: []
    });
  });

  it("retains algorithmic names as ranges and follows Python's Tangut omission", () => {
    expect(compileUnicodeNames(
      "3400..4DBF ; CJK UNIFIED IDEOGRAPH-*\n18CFF ; KHITAN SMALL SCRIPT CHARACTER-*\n17000..187F7 ; TANGUT IDEOGRAPH-*\n",
      ""
    )).toEqual({
      names: "",
      ranges: [["CJK UNIFIED IDEOGRAPH-", 0x3400, 0x4dbf], ["KHITAN SMALL SCRIPT CHARACTER-", 0x18cff, 0x18cff]]
    });
  });

  it("rejects conflicting names instead of silently changing a character", () => {
    expect(() => compileUnicodeNames("0041;NAME\n0042;NAME", ""))
      .toThrow("conflicting Unicode name NAME");
  });
});
