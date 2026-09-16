import {expect, it} from "vitest";
import {PDFDocument, PDFDict, PDFArray, PDFName, PDFRawStream, PDFRef, PDFNumber, decodePDFRawStream} from "pdf-lib";
import {renderPdf, suppliedDefaultFont, pdfCapabilities} from "./index.js";
const fonts = [suppliedDefaultFont()];
const paragraph = {kind: "paragraph" as const, runs: [{text: "AéΩЖ()\\"}]};
it("emits deterministic Unicode metadata, without clock-derived fields", async () => {
  const document = {fonts, blocks: [paragraph], metadata: {title: "Café (東京) \\", author: "Zoë", subject: "Résumé", keywords: ["α", "β"]}};
  const first = await renderPdf(document); const second = await renderPdf(document);
  expect(first.length === second.length && first.every((byte, i) => byte === second[i])).toBe(true);
  const pdf = await PDFDocument.load(first, {updateMetadata: false});
  expect(pdf.getTitle()).toBe(document.metadata.title); expect(pdf.getAuthor()).toBe("Zoë");
  expect(pdf.getSubject()).toBe("Résumé"); expect(pdf.getKeywords()).toBe("α β");
  expect(pdf.getCreationDate()).toBeUndefined(); expect(pdf.getModificationDate()).toBeUndefined();
});
it("records flat Unicode outlines against the actual pages and parent identity", async () => {
  const bytes = await renderPdf({fonts, blocks: [{...paragraph, outline: "First (é)"}, {...paragraph, breakBefore: true, outline: "Second Ω"}]});
  const pdf = await PDFDocument.load(bytes, {updateMetadata: false});
  const root = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  expect(root.lookup(PDFName.of("Count"), PDFNumber).asNumber()).toBe(2);
  const firstRef = root.get(PDFName.of("First")) as PDFRef;
  const first = pdf.context.lookup(firstRef, PDFDict);
  const secondRef = first.get(PDFName.of("Next")) as PDFRef;
  const second = pdf.context.lookup(secondRef, PDFDict);
  expect(root.get(PDFName.of("Last"))).toBe(secondRef); expect(second.get(PDFName.of("Prev"))).toBe(firstRef);
  expect(first.lookup(PDFName.of("Title"))!.toString()).toBe("<FEFF004600690072007300740020002800E90029>");
  for (const [i, entry] of [first, second].entries()) {
    expect(entry.get(PDFName.of("Parent"))).toBe(pdf.catalog.get(PDFName.of("Outlines")));
    expect(entry.lookup(PDFName.of("Dest"), PDFArray).get(0)).toBe(pdf.getPages()[i]!.ref);
  }
});
it("declares untagged accessibility and unverified conformance explicitly", () => {
  expect(pdfCapabilities()).toMatchObject({accessibility: {tagged: false, readingOrder: "not-guaranteed", pdfUA: false}, conformance: {pdfA: false}, text: {unicodeMapping: "supported-scalars", extraction: "not-guaranteed"}});
});
// Independent cmap format 4/12 lookup from the supplied original font bytes.
function glyphId(cp: number): number {
  const bytes = fonts[0]!.bytes; const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let base = 0;
  for (let i = 0; i < view.getUint16(4); i++) {const at = 12 + i * 16; if (view.getUint32(at) === 0x636d6170) base = view.getUint32(at + 8);}
  for (let i = 0; i < view.getUint16(base + 2); i++) {
    const at = base + view.getUint32(base + 8 + i * 8); const format = view.getUint16(at);
    if (format === 12) for (let j = 0; j < view.getUint32(at + 12); j++) {
      const group = at + 16 + j * 12; const start = view.getUint32(group); const end = view.getUint32(group + 4);
      if (cp >= start && cp <= end) return view.getUint32(group + 8) + cp - start;
    }
    if (format === 4) {
      const count = view.getUint16(at + 6) / 2;
      for (let j = 0; j < count; j++) {
        const end = view.getUint16(at + 14 + j * 2); const start = view.getUint16(at + 16 + count * 2 + j * 2);
        if (cp < start || cp > end) continue;
        const delta = view.getInt16(at + 16 + count * 4 + j * 2); const rangeAt = at + 16 + count * 6 + j * 2; const range = view.getUint16(rangeAt);
        if (!range) return (cp + delta) & 65535;
        const raw = view.getUint16(rangeAt + range + 2 * (cp - start)); return raw ? (raw + delta) & 65535 : 0;
      }
    }
  }
  throw new Error("Original font lacks test scalar");
}
it("maps each emitted text code to its font glyph and one Unicode scalar independently", async () => {
  const pdf = await PDFDocument.load(await renderPdf({fonts, blocks: [paragraph]}));
  const font = pdf.getPages()[0]!.node.Resources()!.lookup(PDFName.of("Font"), PDFDict).values()[0]!;
  const dict = pdf.context.lookup(font, PDFDict);
  const cmap = pdf.context.lookup(dict.get(PDFName.of("ToUnicode"))) as PDFRawStream;
  const mappings = new TextDecoder().decode(decodePDFRawStream(cmap).decode());
  const operators = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFRawStream => object instanceof PDFRawStream).map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).filter(text => text.includes(" Tj")).join("\n");
  for (const scalar of paragraph.runs[0]!.text) {
    const cp = scalar.codePointAt(0)!; const gid = glyphId(cp).toString(16).padStart(4, "0").toUpperCase();
    expect(operators).toContain(`<${gid}> Tj`);
    expect(mappings).toContain(`<${gid}> <${cp.toString(16).padStart(4, "0").toUpperCase()}>`);
  }
});
it("round-trips escaped URI strings and exact page-tree parent references", async () => {
  const uri = "https://example.com/a(b)?x=\\value";
  const bytes = await renderPdf({fonts, blocks: [{kind: "paragraph", runs: [{text: "link", link: uri}]}, {...paragraph, breakBefore: true}]});
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  const parentRef = pages[0]!.node.get(PDFName.of("Parent"))!;
  const parent = pdf.context.lookup(parentRef, PDFDict);
  expect(parent.lookup(PDFName.of("Count"), PDFNumber).asNumber()).toBe(2);
  const kids = parent.lookup(PDFName.of("Kids"), PDFArray);
  for (let i = 0; i < pages.length; i++) {expect(kids.get(i)).toBe(pages[i]!.ref); expect(pages[i]!.node.get(PDFName.of("Parent"))).toBe(parentRef);}
  const annotation = pdf.context.lookup(pages[0]!.node.Annots()!.get(0), PDFDict);
  const action = annotation.lookup(PDFName.of("A"), PDFDict);
  const text = action.lookup(PDFName.of("URI")) as import("pdf-lib").PDFString;
  expect(text.decodeText()).toBe(uri);
});
it("rejects malformed Unicode and exhausted metadata before encoding", async () => {
  for (const title of ["\ud800", "\udc00"]) await expect(renderPdf({fonts, blocks: [], metadata: {title}})).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(renderPdf({fonts, blocks: [], metadata: {title: "a".repeat(100)}}, {limits: {outputBytes: 100}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("rejects unsupported outline programs before the font parser", async () => {
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const {vi} = await import("vitest");
  const bytes = new Uint8Array(fonts[0]!.bytes); const view = new DataView(bytes.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {const at = 12 + i * 16; if (view.getUint32(at) === 0x676c7966) view.setUint32(at, 0x43464620);}
  const parse = vi.spyOn(fontkit, "create");
  try {
    const result = await renderPdf({fonts: [{id: "original-unsupported", bytes}], blocks: []}).then(() => "accepted", error => error.code as string);
    expect(result).toBe("E_CAPABILITY"); expect(parse).not.toHaveBeenCalled();
  } finally {parse.mockRestore();}
});
