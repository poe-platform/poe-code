import { expect, it } from "vitest";
import { getStandardFontOutlines } from "./standard-outlines.js";

it("supports canonical Unicode equivalents of Adobe glyph names", () => {
  const font = getStandardFontOutlines("Symbol");
  expect(font.getGlyphOutline(0x03a9)).toEqual(font.getGlyphOutline(0x2126));
  expect(font.getGlyphOutline(0x03bc)).toEqual(font.getGlyphOutline(0x00b5));
  expect(font.getGlyphOutline(0x0394).length).toBeGreaterThan(0);
});
it("falls back to bundled Symbol and Dingbats outlines for missing Unicode characters", () => {
  const font = getStandardFontOutlines("Helvetica");
  expect(font.getGlyphOutline(0x03b1)).toEqual(getStandardFontOutlines("Symbol").getGlyphOutline(0x03b1));
  expect(font.getGlyphOutline(0x2708)).toEqual(getStandardFontOutlines("ZapfDingbats").getGlyphOutline(0x2708));
  expect(font.getGlyphOutline(0x03b1).length).toBeGreaterThan(0);
});

it("does not replace ordinary Latin glyphs with compatibility forms", () => {
  const segments = getStandardFontOutlines("Helvetica").getGlyphOutline(0x61);
  const yValues = segments.flatMap(segment => segment.kind === "cubic" ? [segment.y1, segment.y2, segment.y] : segment.kind === "move" || segment.kind === "line" ? [segment.y] : []);
  // Lowercase a reaches the baseline; the feminine ordinal U+00AA does not.
  expect(Math.min(...yValues)).toBeLessThan(0.05);
});
