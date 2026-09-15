import {expect, it} from "vitest";
import {compileCodecNames} from "../scripts/unicode-data.js";

it("preserves source order for CPython's internal alias and sequence names", () => {
  expect(compileCodecNames(
    "# aliases\n0000;NULL;control\n0000;NUL;abbreviation # second\n",
    "# sequences\nKEYCAP NUMBER SIGN;0023 FE0F 20E3\nKEYCAP DIGIT ONE;0031 FE0F 20E3\n"
  )).toEqual({aliases: ["NULL", "NUL"], sequences: ["KEYCAP NUMBER SIGN", "KEYCAP DIGIT ONE"]});
});

it("rejects alias data that would overlap the pinned sequence allocation", () => {
  expect(() => compileCodecNames("0000;NULL;control\n".repeat(512), ""))
    .toThrow("Unicode aliases overlap named sequences");
});
