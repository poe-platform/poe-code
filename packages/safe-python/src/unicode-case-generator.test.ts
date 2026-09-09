import { expect, it } from "vitest";
import { compileCaseMappings } from "../scripts/unicode-case-data.js";

it("overrides simple uppercase mappings with unconditional full mappings", () => {
  const row = Array<string>(15).fill(""); row[0] = "0061"; row[12] = "0041";
  const data = compileCaseMappings(row.join(";"), "00DF;00DF;0053 0073;0053 0053;\n0069;0069;0130;0130;tr;", "");
  expect(data.upper[0x61]).toEqual([0x41]);
  expect(data.upper[0xdf]).toEqual([0x53, 0x53]);
  expect(data.upper[0x69]).toBeUndefined();
});

it("uses common/full folding and ignores simple-only and Turkic mappings", () => {
  const data = compileCaseMappings("", "", "0041;C;0061;\n00DF;F;0073 0073;\n1E9E;S;00DF;\n0049;T;0131;");
  expect(data.casefold).toEqual({ 65: [97], 223: [115, 115] });
});

it("rejects malformed or out-of-range case mapping points", () => {
  for (const mapping of ["110000", "00XX", "-001"]) {
    expect(() => compileCaseMappings("", "", `0041;C;${mapping};`)).toThrow("invalid Unicode case code point");
  }
});
