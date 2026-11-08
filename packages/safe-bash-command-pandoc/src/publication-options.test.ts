import {expect, it, vi} from "vitest";
import {PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream} from "pdf-lib";
import {inflateRawSync} from "node:zlib";
import {convert, writeDocument} from "./index.js";
import type {ConversionOptions, Document} from "./types.js";

const document: Document = {blocks: [{t: "Para", c: [{t: "Str", c: "Original publication"}]}], metadata: {}, resources: []};
it("uses typed PDF geometry and text size options", async () => {
  const result = await writeDocument(document, {to: "pdf", pdf: {pageSize: "letter", orientation: "landscape", margin: 36, font: "mono", fontSize: 18, lineHeight: 1.2}}, {yield: async () => {}});
  if(result.kind !== "binary") throw new Error("Expected PDF");
  const pdf = await PDFDocument.load(result.bytes);
  expect(pdf.getPages()[0]!.getSize()).toEqual({width: 792, height: 612});
  const streams = pdf.getPages()[0]!.node.Contents() as PDFArray;
  const content = new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(streams.get(0)) as PDFRawStream).decode());
  expect(content).toContain("18 Tf");
});
it.each([{font: "serif"}, {font: "sans"}, {lineHeight: 4}, {margin: 145}, {fontSize: 5}, {orientation: "diagonal"}])("rejects unavailable or invalid PDF option %j before acquiring input", async pdf => {
  const acquire = vi.fn();
  const chunks = (async function* () {acquire(); yield new TextEncoder().encode("input");})();
  await expect(convert([{chunks}], {from: "commonmark", to: "pdf", pdf} as ConversionOptions, {})).rejects.toMatchObject({code: ["serif", "sans"].includes(String("font" in pdf ? pdf.font : "")) ? "E_CAPABILITY" : "E_OPTION"});
  expect(acquire).not.toHaveBeenCalled();
});
it("passes typed EPUB publication metadata and chapter selection", async () => {
  const book: Document = {...document, blocks: [{t: "Header", c: [2, ["first", [], []], [{t: "Str", c: "First"}]]}, ...document.blocks, {t: "Header", c: [2, ["second", [], []], [{t: "Str", c: "Second"}]]}], metadata: {title: {t: "MetaString", c: "Reader title"}}};
  const result = await writeDocument(book, {to: "epub", epub: {title: "Explicit title", language: "fr", identifier: "urn:original:publication", chapterLevel: 2}}, {yield: async () => {}});
  if(result.kind !== "binary") throw new Error("Expected EPUB");
  const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  const entries = new Map<string, string>();
  let offset = 0;
  while(view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true), size = view.getUint32(offset + 18, true);
    const name = new TextDecoder().decode(result.bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    const payload = result.bytes.subarray(start, start + size);
    entries.set(name, new TextDecoder().decode(view.getUint16(offset + 8, true) === 0 ? payload : inflateRawSync(payload)));
    offset = start + size;
  }
  expect(entries.get("EPUB/package.opf")).toContain("<dc:title>Explicit title</dc:title>");
  expect(entries.get("EPUB/package.opf")).toContain("<dc:language>fr</dc:language>");
  expect(entries.get("EPUB/package.opf")).toContain("urn:original:publication");
  expect(entries.has("EPUB/chapter-2.xhtml")).toBe(true);
});
it("rejects EPUB chapter options before input acquisition", async () => {
  const acquire = vi.fn();
  const chunks = (async function* () {acquire(); yield new TextEncoder().encode("input");})();
  await expect(convert([{chunks}], {from: "commonmark", to: "epub", epub: {chapterLevel: 7}}, {})).rejects.toMatchObject({code: "E_OPTION"});
  expect(acquire).not.toHaveBeenCalled();
});
