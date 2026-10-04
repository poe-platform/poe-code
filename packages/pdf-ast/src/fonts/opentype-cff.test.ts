import { expect, it } from "vitest";
import { PdfDocument, parseTrueTypeFont, cosArray, cosDict, cosName, cosNumber, cosStream, dictGet, dictSet, embedTrueTypeFontInCos } from "../index.js";

// Adobe CFF specification / PDF.js unit-test example, with glyph 1 replaced by
// an unhinted triangle through CFFCompiler. No external font files are needed.
const cffHex = "0100040100010101134142434445462b54696d65732d526f6d616e0001010131f81b00f81c02f81d03f819041c6f000dfb3cfb6efa7cfa16051d000000700f1d00000073111d0000002d1d0000008c12000301010813183030312e30303754696d657320526f6d616e54696d657300000000000002010102140e8b8b15f8ec8b05fbc0f95005fbc0fd50050e7d99f92a99fb7695f7738b06f79a93fc7c8c077d99f85695f75e9908fb6e8cf87393f7108b09a70adf0bf78e1400";

function openTypeFont() {
  const cff = Uint8Array.from(Buffer.from(cffHex, "hex"));
  const bytes = new Uint8Array(260 + cff.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x4f54544f); view.setUint16(4, 6);
  const tables: Array<[string, number, number]> = [["head", 108, 54], ["hhea", 164, 36], ["maxp", 200, 6], ["hmtx", 208, 8], ["cmap", 216, 40], ["CFF ", 260, cff.length]];
  tables.forEach(([tag, offset, length], index) => {
    const record = 12 + index * 16;
    for (let i = 0; i < 4; i++) bytes[record + i] = tag.charCodeAt(i);
    view.setUint32(record + 8, offset); view.setUint32(record + 12, length);
  });
  view.setUint16(126, 1000); // head.unitsPerEm
  view.setInt16(168, 800); view.setInt16(170, -200); view.setUint16(198, 2);
  view.setUint16(204, 2); // maxp.numGlyphs
  view.setUint16(208, 600); view.setUint16(212, 600);
  view.setUint16(218, 1); view.setUint16(220, 3); view.setUint16(222, 10); view.setUint32(224, 12);
  view.setUint16(228, 12); view.setUint32(232, 28); view.setUint32(240, 1);
  view.setUint32(244, 65); view.setUint32(248, 65); view.setUint32(252, 1);
  bytes.set(cff, 260);
  return bytes;
}

it("reads OpenType CFF outlines through the sfnt glyph mapping", () => {
  const font = parseTrueTypeFont(openTypeFont());
  expect(font.getGlyphId(65)).toBe(1);
  expect(font.getAdvanceWidth1000(65)).toBe(600);
  const vertices = new Set(font.getGlyphOutline(65).flatMap(segment => segment.kind === "line" ? [`${Math.round(segment.x * 1000)},${Math.round(segment.y * 1000)}`] : []));
  expect(vertices).toEqual(new Set(["600,0", "300,700", "0,0"]));
});

it("renders an embedded FontFile3 OpenType program", () => {
  const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
  const program = doc.cos.allocateObject(cosStream(openTypeFont(), { dict: cosDict({ Subtype: cosName("OpenType") }) }));
  const font = cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("TriangleOTF"), Encoding: cosName("WinAnsiEncoding"), FirstChar: cosNumber(65), Widths: cosArray([cosNumber(600)]), FontDescriptor: cosDict({ FontFile3: program }) });
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: doc.cos.allocateObject(font) }) }));
  page.setRawContentStream("BT /F1 100 Tf 10 10 Td (A) Tj ET");
  const display = PdfDocument.load(doc.save()).getPage(0).evaluateDisplayList();
  expect(display.paths).toHaveLength(1);
  expect(display.paths[0]!.segments.filter(segment => segment.kind === "line")).toHaveLength(3);
});

it("retains original OpenType bytes when PDF.js repairs an embedded charstring", () => {
  const bytes = openTypeFont();
  const start = bytes.findIndex((value, index) => value === 139 && bytes[index + 1] === 139 && bytes[index + 2] === 21);
  expect(start).toBeGreaterThan(260);
  bytes[start + 17] = 0; // Obsolete terminator repaired to endchar by PDF.js.
  const original = bytes.slice();
  expect(parseTrueTypeFont(bytes).getGlyphOutline(65).length).toBeGreaterThan(0);
  expect(bytes).toEqual(original);
});

it("rejects a CFF table extending beyond the OpenType font", () => {
  const bytes = openTypeFont();
  expect(() => parseTrueTypeFont(bytes.subarray(0, bytes.length - 1))).toThrow("OpenType CFF table is outside the font program");
});

it("embeds full OpenType CFF as FontFile3/OpenType with a Type0 descendant", () => {
  const bytes = openTypeFont(), doc = PdfDocument.create();
  const ref = embedTrueTypeFontInCos(doc.cos, parseTrueTypeFont(bytes));
  const font = doc.cos.resolveDict(ref)!;
  const descendant = doc.cos.resolveDict(doc.cos.resolveArray(dictGet(font, "DescendantFonts"))!.items[0])!;
  expect(dictGet(descendant, "Subtype")).toEqual(cosName("CIDFontType0"));
  expect(dictGet(descendant, "CIDToGIDMap")).toBeUndefined();
  const descriptor = doc.cos.resolveDict(dictGet(descendant, "FontDescriptor"))!;
  expect(dictGet(descriptor, "FontFile2")).toBeUndefined();
  const program = doc.cos.resolve(dictGet(descriptor, "FontFile3"));
  expect(program?.kind).toBe("stream");
  if (program?.kind !== "stream") throw new Error("Missing OpenType font stream");
  expect(dictGet(program.dict, "Subtype")).toEqual(cosName("OpenType"));
  expect(doc.cos.decodeStream(program)).toEqual(bytes);
});

it("round trips embedded OpenType CFF text, widths, and outlines", () => {
  const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
  page.drawText("AA", { font: doc.embedFont(openTypeFont()), size: 20, x: 10, y: 20 });
  const loaded = PdfDocument.load(doc.save()), display = loaded.getPage(0).evaluateDisplayList();
  expect(loaded.extractText()).toBe("AA");
  expect(display.paths).toHaveLength(2);
  expect(display.paths[0]!.segments.filter(segment => segment.kind === "line")).toHaveLength(3);
  expect(display.glyphs[1]!.matrix[4] - display.glyphs[0]!.matrix[4]).toBeCloseTo(12);
});

it("renders OpenType CFF through caller-backed program views", async () => {
  const {parseStoredTrueTypeFont} = await import("./stored-truetype.js");
  const bytes=openTypeFont(), data=new Uint8Array(1024*1024);data.set(bytes);let end=bytes.length;
  const storage={allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){expect(n).toBeLessThanOrEqual(4096);return data.slice(at,at+n);},async write(at:number,value:Uint8Array){data.set(value,at);}};
  const backed=await parseStoredTrueTypeFont({storage,position:0,byteLength:bytes.length});
  expect(backed).toBeDefined();
  const glyph=await backed!.getGlyphId(65), actual=[];
  for await(const segment of backed!.glyphSegments(glyph))actual.push(segment);
  expect(actual).toEqual(parseTrueTypeFont(bytes).getGlyphOutlineByGid(glyph));
  expect(data.subarray(0,bytes.length)).toEqual(bytes);
});
