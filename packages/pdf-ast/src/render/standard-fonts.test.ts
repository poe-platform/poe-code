import { expect, it } from "vitest";
import { PdfDocument, cosDict, cosName, dictSet } from "../index.js";

const standardFonts = [
  "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique", "Symbol", "ZapfDingbats",
];

function pageWithText(font: string, content = "BT /F1 30 Tf 10 50 Td (aBg) Tj ET") {
  const doc = PdfDocument.create(); const page = doc.addPage([180, 90]);
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName(font) }) }) }));
  page.setRawContentStream(content);
  return page;
}

it.each(standardFonts)("renders %s using real font outlines", font => {
  const display = pageWithText(font).evaluateDisplayList();
  expect(display.glyphs.filter(glyph => glyph.outline).length).toBeGreaterThan(0);
  expect(display.glyphs.some(glyph => glyph.outline?.segments.some(seg => seg.kind === "cubic"))).toBe(true);
  expect(display.paths).toHaveLength(0);
});

it("preserves distinct lowercase forms and serif, sans, and fixed-width faces", () => {
  const outlines = ["Helvetica", "Times-Roman", "Courier"].map(font => pageWithText(font, "BT /F1 30 Tf 10 50 Td (aA) Tj ET").evaluateDisplayList().glyphs.map(glyph => glyph.outline!));
  expect(outlines.every(paths => paths.length === 2)).toBe(true);
  expect(new Set(outlines.map(paths => JSON.stringify(paths[0]!.segments))).size).toBe(3);
});

it("preserves standard-font weight and slant", () => {
  const outlines = standardFonts.slice(0, 4).map(font => pageWithText(font, "BT /F1 30 Tf 10 50 Td (a) Tj ET").evaluateDisplayList().glyphs.map(glyph => glyph.outline!));
  expect(outlines.every(paths => paths.length === 1)).toBe(true);
  expect(new Set(outlines.map(paths => JSON.stringify(paths[0]!.segments))).size).toBe(4);
});

it("applies text matrices, fill/stroke modes, and invisible text to real outlines", () => {
  const display = pageWithText("Helvetica", "BT /F1 20 Tf 2 Tr 0 1 -1 0 70 10 Tm (a) Tj 3 Tr (b) Tj ET").evaluateDisplayList();
  expect(display.glyphs.filter(glyph => glyph.outline)).toHaveLength(1);
  expect(display.glyphs[0]!.outline).toMatchObject({ fillColor: { r: 0, g: 0, b: 0 }, strokeColor: { r: 0, g: 0, b: 0 } });
  expect(display.glyphs.map(glyph => glyph.unicode).join("")).toBe("ab");
});

it("uses the standard font's real advance widths", () => {
  // Adobe/PDF.js AFM widths: Helvetica H=722,e=556,l=222,o=556; Times H=722,e=444,l=278,o=500.
  const helvetica = pageWithText("Helvetica", "BT /F1 10 Tf 10 50 Td (Hello!) Tj ET").evaluateDisplayList();
  const times = pageWithText("Times-Roman", "BT /F1 10 Tf 10 50 Td (Hello!) Tj ET").evaluateDisplayList();
  expect(helvetica.glyphs[5]!.matrix[4]).toBeCloseTo(32.78, 5);
  expect(times.glyphs[5]!.matrix[4]).toBeCloseTo(32.22, 5);
});

it("preserves Symbol/Dingbats Unicode and accented Latin outlines", () => {
  const symbol = pageWithText("Symbol", "BT /F1 30 Tf 10 50 Td (abW) Tj ET").evaluateDisplayList();
  expect(symbol.glyphs.map(glyph => glyph.unicode).join("")).toBe("αβΩ");
  expect(symbol.glyphs.every(glyph => glyph.outline?.segments.length)).toBe(true);
  const accents = pageWithText("Helvetica", "BT /F1 30 Tf 10 50 Td <e980> Tj ET").evaluateDisplayList();
  expect(accents.glyphs.map(glyph => glyph.unicode).join("")).toBe("é€");
  expect(accents.glyphs.every(glyph => glyph.outline?.segments.length)).toBe(true);
});
