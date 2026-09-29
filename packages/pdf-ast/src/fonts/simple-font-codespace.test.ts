import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../index.js";

// PDF.js Font.charsToGlyphs uses byte codes for simple fonts, independently of
// ToUnicode's codespace. The original issue17069 fixture has this mismatch.
it.each(["Type1", "TrueType", "Type3"])("keeps %s codes single-byte with a two-byte ToUnicode codespace", subtype => {
  const doc = PdfDocument.create(), page = doc.addPage([200, 100]);
  const cmap = cosStream(new TextEncoder().encode(
    "1 begincodespacerange <0000> <FFFF> endcodespacerange " +
    "3 beginbfchar <41> <00660069> <20> <0020> <42> <D83DDE00> endbfchar"
  ));
  const font = cosDict({
    Type: cosName("Font"), Subtype: cosName(subtype), BaseFont: cosName("Helvetica"),
    Encoding: cosName("WinAnsiEncoding"), ToUnicode: doc.cos.allocateObject(cmap),
    FirstChar: cosNumber(32), Widths: cosArray(Array.from({ length: 35 }, () => cosNumber(600))),
  });
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: doc.cos.allocateObject(font) }) }));
  // Include odd-length strings and TJ fragments as in the original fixture.
  page.setRawContentStream("BT /F1 10 Tf 5 Tw 10 30 Td [(A) ( B)] TJ ET");
  const loaded = PdfDocument.load(doc.save());
  const glyphs = loaded.getPage(0).evaluateDisplayList().glyphs;
  expect(glyphs.map(g => g.unicode)).toEqual(["fi", " ", "😀"]);
  expect(glyphs.map(g => g.matrix[4])).toEqual([10, 16, 27]);
  expect(loaded.extractText()).toBe("fi 😀");
});

it("retains PDF.js issue17069's original Test doc text and glyph positions", () => {
  const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue17069.pdf", import.meta.url))));
  const glyphs = doc.getPage(0).evaluateDisplayList().glyphs.filter(g => g.fontName === "AIDKDS+Calibri");
  // The original content follows the label with a separate ( )Tj.
  expect(glyphs.map(g => g.unicode).join("")).toBe("Test doc ");
  expect(glyphs).toHaveLength(9);
  expect(glyphs[0]!.matrix[4]).toBeCloseTo(72);
  expect(doc.extractText()).toContain("Test doc");
  expect(PdfDocument.load(doc.save()).extractText()).toContain("Test doc");
});
