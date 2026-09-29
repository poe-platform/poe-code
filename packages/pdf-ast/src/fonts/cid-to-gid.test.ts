import { expect, it } from "vitest";
import { PdfDocument, renderDisplayListToBitmap, renderDisplayListToSvg, parseTrueTypeFont, embedTrueTypeFontInCos, cosArray, cosName, cosNumber, cosStream, cosDict, dictGet, dictSet, type PdfCosNode } from "../index.js";

// Existing in-memory triangle font from document.test.ts.
function triangleFont(notdef = false) {
  const buf = new ArrayBuffer(512);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, 7);
  const writeTag = (off: number, tag: string, tOff: number, tLen: number) => {
    for (let i = 0; i < 4; i++) u8[off + i] = tag.charCodeAt(i);
    dv.setUint32(off + 8, tOff);
    dv.setUint32(off + 12, tLen);
  };
  writeTag(12, "head", 140, 54);
  writeTag(28, "maxp", 196, 6);
  writeTag(44, "hhea", 204, 36);
  writeTag(60, "hmtx", 240, 8);
  writeTag(76, "loca", 248, 6);
  writeTag(92, "glyf", 256, 32);
  writeTag(108, "cmap", 300, 44);
  dv.setUint16(140 + 18, 1000);
  dv.setInt16(140 + 50, 0);
  dv.setUint16(196 + 4, 2);
  dv.setInt16(204 + 4, 800);
  dv.setInt16(204 + 6, -200);
  dv.setUint16(204 + 34, 2);
  dv.setUint16(240, 500);
  dv.setUint16(244, 700);
  dv.setUint16(248, 0);
  dv.setUint16(250, 0);
  dv.setUint16(252, 12);
  dv.setInt16(256, 1);
  dv.setInt16(258, 100);
  dv.setInt16(260, 0);
  dv.setInt16(262, 600);
  dv.setInt16(264, 700);
  dv.setUint16(266, 2);
  dv.setUint16(268, 0);
  u8[270] = 0x01 | 0x02 | 0x20;
  u8[271] = 0x01 | 0x02 | 0x04 | 0x10;
  u8[272] = 0x01 | 0x02 | 0x04;
  u8[273] = 100;
  u8[274] = 250;
  u8[275] = 250;
  u8[276] = 250;
  u8[277] = 250;
  dv.setUint16(300, 0);
  dv.setUint16(302, 1);
  dv.setUint16(304, 3);
  dv.setUint16(306, 1);
  dv.setUint32(308, 12);
  const f4 = 312;
  dv.setUint16(f4, 4);
  dv.setUint16(f4 + 2, 32);
  dv.setUint16(f4 + 6, 4);
  dv.setUint16(f4 + 14, 0x0041);
  dv.setUint16(f4 + 16, 0xffff);
  dv.setUint16(f4 + 18, 0);
  dv.setUint16(f4 + 20, 0x0041);
  dv.setUint16(f4 + 22, 0xffff);
  dv.setInt16(f4 + 24, -64);
  dv.setInt16(f4 + 26, 1);
  dv.setUint16(f4 + 28, 0);
  dv.setUint16(f4 + 30, 0);

  if (notdef) dv.setUint16(250, 12); // Put the triangle in glyph zero, leaving glyph one empty.
  return parseTrueTypeFont(u8);
}

function evaluate(cid: number, mapping: PdfCosNode | undefined, unicode = "Z", notdef = false) {
  const doc = PdfDocument.create();
  const page = doc.addPage([200, 100]);
  const reference = embedTrueTypeFontInCos(doc.cos, triangleFont(notdef), new Map([[cid, unicode]]));
  const font = doc.cos.resolveDict(reference)!;
  const descendant = doc.cos.resolveDict(doc.cos.resolveArray(dictGet(font, "DescendantFonts"))!.items[0])!;
  if (mapping) dictSet(descendant, "CIDToGIDMap", mapping.kind === "stream" ? doc.cos.allocateObject(mapping) : mapping);
  else descendant.entries.splice(descendant.entries.findIndex(entry => entry.key.decoded === "CIDToGIDMap"), 1);
  dictSet(descendant, "W", cosArray([cosNumber(cid), cosArray([cosNumber(900)])]));
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: reference }) }));
  page.setRawContentStream(`BT /F1 100 Tf 10 10 Td <${cid.toString(16).padStart(4, "0")}> Tj ET`);
  return PdfDocument.load(doc.save()).getPage(0).evaluateDisplayList();
}

it("selects the mapped glyph independently of its ToUnicode text", () => {
  const display = evaluate(2, cosStream(Uint8Array.of(0, 0, 0, 0, 0, 1)));
  expect(display.glyphs[0]!.unicode).toBe("Z");
  expect(display.glyphs[0]!.advanceWidth).toBeCloseTo(90);
  expect(display.paths).toHaveLength(1);
  expect(display.paths[0]!.segments.filter(segment => segment.kind === "line")).toHaveLength(2);
});

it("honors an explicit glyph zero mapping even when ToUnicode matches another glyph", () => {
  const display = evaluate(1, cosStream(Uint8Array.of(0, 0, 0, 0)), "A");
  expect(display.glyphs[0]!.unicode).toBe("A");
  expect(display.paths).toHaveLength(0);
});

it("uses glyph zero when the CID is outside the mapping stream", () => {
  expect(evaluate(1, cosStream(Uint8Array.of(0, 0)), "A").paths).toHaveLength(0);
});

it.each([undefined, cosName("Identity")])("retains identity CID mapping when CIDToGIDMap is %s", mapping => {
  expect(evaluate(1, mapping).paths).toHaveLength(1);
});

it("paints the embedded .notdef outline for an explicit glyph zero mapping", () => {
  expect(evaluate(1, cosStream(Uint8Array.of(0, 0, 0, 0)), "Z", true).paths).toHaveLength(1);
});

it("does not synthesize a fallback letter for an empty mapped glyph", () => {
  const display = evaluate(1, cosStream(Uint8Array.of(0, 0, 0, 0)), "A");
  const bitmap = renderDisplayListToBitmap(display, { dpi: 72 });
  expect(bitmap.data.every(value => value === 255)).toBe(true);
  expect(renderDisplayListToSvg(display)).not.toContain("<path ");
});
