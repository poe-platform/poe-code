import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";

describe("PDF.js explicit simple-font widths", () => {
  const cases = ["Type1", "TrueType", "Type3"].flatMap(subtype =>
    [false, true].flatMap(mapped => [undefined, 300].map(missingWidth => ({ subtype, mapped, missingWidth }))));
  it.each(cases)("uses MissingWidth=$missingWidth for $subtype (ToUnicode=$mapped)", ({ subtype, mapped, missingWidth }) => {
    const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
    const font = cosDict({
      Type: cosName("Font"), Subtype: cosName(subtype), BaseFont: cosName("Helvetica"),
      FirstChar: cosNumber(65), LastChar: cosNumber(65), Widths: cosArray([cosNumber(600)]),
      ...(missingWidth === undefined ? {} : { FontDescriptor: cosDict({ MissingWidth: cosNumber(missingWidth) }) }),
      ...(subtype === "Type3" ? { CharProcs: cosDict({}) } : {}),
    });
    if (mapped) dictSet(font, "ToUnicode", cosStream(new TextEncoder().encode(
      "1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <42> <0041> endbfchar"
    )));
    dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: font }) }));
    page.setRawContentStream("BT /F1 10 Tf 5 Tw 10 30 Td (AB A) Tj ET");
    const glyphs = page.evaluateDisplayList().glyphs;
    const missingAdvance = (missingWidth ?? 0) / 100;
    expect(glyphs.map(glyph => glyph.advanceWidth)).toEqual([6, missingAdvance, missingAdvance + 5, 6]);
    expect(glyphs.map(glyph => glyph.matrix[4])).toEqual([10, 16, 16 + missingAdvance, 21 + missingAdvance * 2]);
    expect(glyphs[1]!.unicode).toBe(mapped ? "A" : "B");
  });

  it("preserves word spacing in PDF.js's unchanged Type3WordSpacing fixture", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-Type3WordSpacing.pdf", import.meta.url))));
    const glyphs = doc.getPage(0).evaluateDisplayList().glyphs;
    expect(glyphs).toHaveLength(66);
    for (let line = 0; line < 6; line++) {
      const spacing = 50 - line * 10;
      expect(glyphs[line * 11]!.advanceWidth).toBe(spacing);
      expect(glyphs[line * 11 + 1]!.matrix[4]).toBe(spacing);
      expect(glyphs[line * 11 + 10]!.matrix[4]).toBe(spacing * 3 + 70);
    }
  });
});
