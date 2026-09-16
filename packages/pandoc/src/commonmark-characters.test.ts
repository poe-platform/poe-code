import { expect, it } from "vitest";
import { unicodePunctuation, unicodeWhitespace } from "./commonmark-characters.js";

// Original scalar facts from CommonMark §2.1: Unicode P/S and Zs categories.
it.each(["!", "_", "$", "€", "—", "。", "☀", "😀", "𐄀"])("classifies punctuation/symbol %s", (char) => {
  expect(unicodePunctuation(char)).toBe(true);
});
it.each(["a", "α", "中", "1", "\u0301", "\u200b", " "])("excludes non-punctuation %s", (char) => {
  expect(unicodePunctuation(char)).toBe(false);
});
it.each([" ", "\t", "\n", "\r", "\f", "\u00a0", "\u2003", "\u3000"])("classifies Unicode whitespace %s", (char) => {
  expect(unicodeWhitespace(char)).toBe(true);
});
it.each(["\v", "\u0085", "\u200b", "a"])("excludes non-whitespace %s", (char) => {
  expect(unicodeWhitespace(char)).toBe(false);
});
