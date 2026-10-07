import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, dictGet, dictSet, renderDisplayListToBitmap, renderDisplayListToSvg } from "../index.js";
import { STANDARD_FONT_CFF_BASE64 } from "./standard-font-data.js";

it.each(["cid_cff.pdf", "cff_bluescale_small_zones.pdf", "text_clip_cff_cid.pdf"])("evaluates embedded CID CFF from PDF.js %s", name => {
  const doc = PdfDocument.load(readFileSync(new URL(`../fixtures/pdfjs-${name}`, import.meta.url)));
  const display = doc.getPage(0).evaluateDisplayList();
  expect(display.glyphs.length).toBeGreaterThan(5);
  expect(display.glyphs.some(glyph => (glyph.outline?.segments.length ?? 0) > 0)).toBe(true);
  if (name === "cid_cff.pdf") expect(doc.extractText()).toContain("processor reference chart");
  if (name === "text_clip_cff_cid.pdf") expect(doc.extractText()).toContain("ABC123");
});

it.each([false, true])("renders a simple embedded CFF font (Differences: %s)", remap => {
  const doc = PdfDocument.create(); const page = doc.addPage([200,100]);
  const fontBytes = Uint8Array.from(atob(STANDARD_FONT_CFF_BASE64["Times-Italic"]), char => char.charCodeAt(0));
  const program = doc.cos.allocateObject(cosStream(fontBytes, {dict: cosDict({Subtype: cosName("Type1C")})}));
  const font = doc.cos.allocateObject(cosDict({
    Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("EmbeddedItalic"),
    FirstChar: cosNumber(65), LastChar: cosNumber(65), Widths: cosArray([cosNumber(611)]),
    Encoding: remap ? cosDict({BaseEncoding: cosName("WinAnsiEncoding"), Differences: cosArray([cosNumber(65),cosName("B")])}) : cosName("WinAnsiEncoding"),
    FontDescriptor: cosDict({Type:cosName("FontDescriptor"),FontName:cosName("EmbeddedItalic"),Flags:cosNumber(32),FontBBox:cosArray([-500,-300,1200,1000].map(n=>cosNumber(n))),ItalicAngle:cosNumber(-12),Ascent:cosNumber(800),Descent:cosNumber(-200),CapHeight:cosNumber(700),StemV:cosNumber(80),FontFile3:program}),
  }));
  dictSet(page.pageDict,"Resources",cosDict({Font:cosDict({F1:font})}));
  page.setRawContentStream("BT /F1 50 Tf 30 30 Td (AA) Tj ET");
  const display = PdfDocument.load(doc.save()).getPage(0).evaluateDisplayList();
  expect(display.glyphs.map(g=>g.unicode).join("")).toBe(remap ? "BB" : "AA");
  expect(display.glyphs[0]!.outline?.segments.length).toBeGreaterThan(10);
  expect(display.glyphs[1]!.bbox[0]-display.glyphs[0]!.bbox[0]).toBeCloseTo(30.55,2);
});

it("resolves the base and accent glyphs in a CFF seac composition", async () => {
  const { CFFParser, Stream } = await import("../vendor/pdfjs-fonts.mjs");
  const { createCffGlyphRenderer } = await import("./cff.js");
  const bytes = Uint8Array.from(atob(STANDARD_FONT_CFF_BASE64["Times-Italic"]), char => char.charCodeAt(0));
  const cff = new CFFParser(new Stream(bytes), {}, false).parse();
  const gid = cff.charset.charset.indexOf("Aacute");
  expect(gid).toBeGreaterThan(0);
  // Type 2 endchar operands: adx=0, ady=0, bchar=A (65), achar=acute (194).
  cff.charStrings.objects[gid] = Uint8Array.of(139, 139, 204, 247, 86, 14);
  const render = createCffGlyphRenderer(cff);
  expect(render(gid).length).toBeGreaterThan(render(cff.charset.charset.indexOf("A")).length);
  expect([...render.segments(gid)]).toEqual(render(gid));
});

it("paints CID outlines without relying on Unicode mappings", () => {
  const doc = PdfDocument.load(readFileSync(new URL("../fixtures/pdfjs-cff_bluescale_small_zones.pdf", import.meta.url)));
  const display = doc.getPage(0).evaluateDisplayList();
  const bitmap = renderDisplayListToBitmap(display, { dpi: 72 });
  let ink = 0;
  // Independent MuPDF rendering places the first P in this rectangle.
  for (let y = 38; y < 78; y++) for (let x = 18; x < 42; x++) {
    if (bitmap.data[(y * bitmap.width + x) * 4]! < 128) ink++;
  }
  expect(ink).toBeGreaterThan(100);
  expect(renderDisplayListToSvg(display).split("<path ").length - 1).toBeGreaterThanOrEqual(12);
});

it("keeps embedded program bytes unchanged when PDF.js repairs a charstring", async () => {
  const { CFFParser, Stream } = await import("../vendor/pdfjs-fonts.mjs");
  const { parseEmbeddedCffFont } = await import("./cff.js");
  const bytes = Uint8Array.from(atob(STANDARD_FONT_CFF_BASE64["Times-Italic"]), char => char.charCodeAt(0));
  const cff = new CFFParser(new Stream(bytes), {}, false).parse();
  const glyph = cff.charStrings.objects[cff.charset.charset.indexOf("A")]!;
  glyph[glyph.length - 1] = 0; // PDF.js repairs this obsolete terminator to endchar.
  const original = bytes.slice();
  parseEmbeddedCffFont(bytes, "WinAnsiEncoding", new Map());
  expect(bytes).toEqual(original);
});

it("selects an embedded CFF glyph through the font Encoding CMap", () => {
  const doc = PdfDocument.load(readFileSync(new URL("../fixtures/pdfjs-text_clip_cff_cid.pdf", import.meta.url)));
  const page = doc.getPage(0);
  const resources = doc.cos.resolveDict(dictGet(page.pageDict, "Resources"))!;
  const fonts = doc.cos.resolveDict(dictGet(resources, "Font"))!;
  const font = doc.cos.resolveDict(dictGet(fonts, "F2"))!;
  const source = "1 begincodespacerange <0000> <FFFF> endcodespacerange ";
  dictSet(font, "Encoding", doc.cos.allocateObject(cosStream(new TextEncoder().encode(source + "1 begincidchar <0101> 68 endcidchar"))));
  dictSet(font, "ToUnicode", doc.cos.allocateObject(cosStream(new TextEncoder().encode(source + "1 beginbfchar <0101> <005A> endbfchar"))));
  page.setRawContentStream("BT /F2 20 Tf 10 10 Td <0101> Tj ET");
  const display = PdfDocument.load(doc.save()).getPage(0).evaluateDisplayList();
  expect(display.glyphs[0]!.charCode).toBe(257);
  expect(display.glyphs[0]!.unicode).toBe("Z");
  expect(display.glyphs[0]!.outline!.segments).toHaveLength(23);
});

it("omits orphan close segments for width-only CFF space glyphs in outlines and SVG", async () => {
  const { CFFParser, Stream } = await import("../vendor/pdfjs-fonts.mjs");
  const { createCffGlyphRenderer } = await import("./cff.js");
  const bytes = Uint8Array.from(atob(STANDARD_FONT_CFF_BASE64["Helvetica"]), char => char.charCodeAt(0));
  const cff = new CFFParser(new Stream(bytes), {}, false).parse();
  const spaceGid = cff.charset.charset.indexOf("space");
  expect(spaceGid).toBeGreaterThan(0);
  const render = createCffGlyphRenderer(cff);
  expect(render(spaceGid)).toEqual([]);
  expect([...render.segments(spaceGid)]).toEqual([]);

  const doc = PdfDocument.create();
  const page = doc.addPage([200, 100]);
  const font = doc.cos.allocateObject(cosDict({
    Type: cosName("Font"),
    Subtype: cosName("Type1"),
    BaseFont: cosName("Helvetica"),
    Encoding: cosName("WinAnsiEncoding"),
  }));
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: font }) }));
  page.setRawContentStream("BT /F1 24 Tf 20 40 Td (A B) Tj ET");
  const display = PdfDocument.load(doc.save()).getPage(0).evaluateDisplayList();
  const svg = renderDisplayListToSvg(display);
  expect(svg).not.toContain('d="Z"');
});
