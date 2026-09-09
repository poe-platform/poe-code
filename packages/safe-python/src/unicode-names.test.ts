import { describe, expect, it } from "vitest";
import { lookupUnicodeName } from "./unicode-names.js";

describe("Python Unicode character name lookup", () => {
  it.each([
    ["LATIN CAPITAL LETTER A", "A"], ["latin capital letter a", "A"],
    ["SNAKE", "🐍"], ["BELL", "🔔"], ["NULL", "\0"],
    ["NUL", "\0"], ["LINE FEED", "\n"], ["LF", "\n"],
    ["HANGUL SYLLABLE GA", "가"], ["HANGUL SYLLABLE HIH", "힣"],
    ["CJK UNIFIED IDEOGRAPH-4E00", "一"], ["cjk unified ideograph-4e00", "一"],
    ["CJK COMPATIBILITY IDEOGRAPH-F900", "豈"],
    ["NUSHU CHARACTER-1B170", "𛅰"], ["EGYPTIAN HIEROGLYPH-13460", "\u{13460}"],
    ["KHITAN SMALL SCRIPT CHARACTER-18B00", "\u{18b00}"],
    ["TODHRI LETTER A", "\u{105c0}"],
    ["ZERO WIDTH NO-BREAK SPACE", "\uFEFF"]
  ])("resolves %s", (name, value) => {
    expect(lookupUnicodeName(name)).toBe(value);
  });

  it.each([
    "", "NOT A UNICODE NAME", " LATIN CAPITAL LETTER A", "LATIN CAPITAL LETTER A ",
    "LATIN  CAPITAL LETTER A", "LATIN_CAPITAL_LETTER_A", "KELVIN SIGN",
    "CJK UNIFIED IDEOGRAPH-04E00", "CJK UNIFIED IDEOGRAPH-4E0G",
    "CJK UNIFIED IDEOGRAPH-110000", "CJK UNIFIED IDEOGRAPH-2FFFF",
    "KEYCAP DIGIT ONE", "TANGUT IDEOGRAPH-17000", "<control>", "__proto__"
  ])("rejects unknown or non-character name %j", (name) => {
    expect(lookupUnicodeName(name)).toBeUndefined();
  });
});
