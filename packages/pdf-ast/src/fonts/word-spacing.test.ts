import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../index.js";

it.each([
  { name: "single byte 32 mapped to A", code: 32, byteLength: 1, unicode: "A", composite: false, spacing: 5 },
  { name: "single byte 65 mapped to Unicode space", code: 65, byteLength: 1, unicode: " ", composite: false, spacing: 0 },
  { name: "two-byte code 32 mapped to space", code: 32, byteLength: 2, unicode: " ", composite: true, spacing: 0 },
  { name: "one-byte composite code 32 mapped to A", code: 32, byteLength: 1, unicode: "A", composite: true, spacing: 5 },
  { name: "four-byte composite code 32 mapped to space", code: 32, byteLength: 4, unicode: " ", composite: true, spacing: 0 },
  { name: "ordinary single-byte space", code: 32, byteLength: 1, unicode: " ", composite: false, spacing: 5 },
])("applies PDF.js Font.charsToGlyphs space semantics: $name", ({ code, byteLength, unicode, composite, spacing }) => {
  const doc = PdfDocument.create(), page = doc.addPage([200, 100]);
  const hex = code.toString(16).padStart(byteLength * 2, "0");
  const codespace = `1 begincodespacerange <${hex}> <${hex}> endcodespacerange `;
  const toUnicode = doc.cos.allocateObject(cosStream(new TextEncoder().encode(codespace + `1 beginbfchar <${hex}> <${unicode.charCodeAt(0).toString(16).padStart(4, "0")}> endbfchar`)));
  const font = cosDict({ Type: cosName("Font"), Subtype: cosName(composite ? "Type0" : "Type1"), BaseFont: cosName("Helvetica"), ToUnicode: toUnicode });
  if (composite) {
    dictSet(font, "Encoding", doc.cos.allocateObject(cosStream(new TextEncoder().encode(codespace + `1 begincidchar <${hex}> 1 endcidchar`))));
    dictSet(font, "DescendantFonts", cosArray([cosDict({ Type: cosName("Font"), Subtype: cosName("CIDFontType2"), W: cosArray([cosNumber(1), cosArray([cosNumber(600)])]) })]));
  } else {
    dictSet(font, "FirstChar", cosNumber(code));
    dictSet(font, "Widths", cosArray([cosNumber(600)]));
  }
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: doc.cos.allocateObject(font) }) }));
  page.setRawContentStream(`BT /F1 10 Tf 5 Tw 10 30 Td <${hex}${hex}> Tj ET`);
  const glyphs = PdfDocument.load(doc.save()).getPage(0).evaluateDisplayList().glyphs;
  expect(glyphs).toHaveLength(2);
  expect(glyphs[0]!.unicode).toBe(unicode);
  expect(glyphs[1]!.matrix[4] - glyphs[0]!.matrix[4]).toBeCloseTo(6 + spacing);
});
