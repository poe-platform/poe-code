import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { renderPdf, pdfCapabilities, suppliedDefaultFont } from "./index.js";

const font = {...suppliedDefaultFont(), id: "mono"};
const paragraph = {kind: "paragraph" as const, runs: [{text: "Hello PDF", font: "mono", size: 12}]};
describe("public PDF byte engine", () => {
  it("embeds supplied fonts in PDF 1.7 with exact page geometry and no active content", async () => {
    const bytes = await renderPdf({blocks: [paragraph], fonts: [font], page: {width: 300, height: 400, margin: 30}});
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe("%PDF-1.7");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPages()[0]!.getSize()).toEqual({width: 300, height: 400});
    const source = new TextDecoder("latin1").decode(bytes);
    expect(source).toContain("/FontFile2");
    for (const key of ["/Encrypt", "/JavaScript", "/EmbeddedFiles"]) expect(source).not.toContain(key);
    expect(pdfCapabilities().profile).toBe("PDF-1.7-supplied-fonts-ltr");
  });
  it("paginates advancing lines and tables and emits URI links", async () => {
    const bytes = await renderPdf({fonts: [font], page: {width: 180, height: 140, margin: 20}, blocks: [
      {kind: "paragraph", runs: [{text: "linked", font: "mono", size: 12, link: "https://example.com"}]},
      ...Array.from({length: 8}, () => ({kind: "table" as const, rows: [[paragraph, paragraph]], widths: [0.5, 0.5]}))
    ]});
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const streams = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFRawStream => object instanceof PDFRawStream);
    const operators = streams.map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join("\n");
    expect(operators.includes("1 1 1 rg")).toBe(true);
    expect(pdf.getPages()[0]!.node.get(PDFName.of("Annots"))).toBeDefined();
  });
  it("rejects absent glyphs, unsupported scripts and unsafe links", async () => {
    for (const text of ["مرحبا", "a\u0301", "😀"]) await expect(renderPdf({fonts: [font], blocks: [{...paragraph, runs: [{text, font: "mono", size: 12}]}]})).rejects.toMatchObject({code: "E_CAPABILITY"});
    await expect(renderPdf({fonts: [font], blocks: [{...paragraph, runs: [{text: "x", font: "mono", size: 12, link: "javascript:alert(1)"}]}]})).rejects.toMatchObject({code: "E_CAPABILITY"});
  });
  it("admits limits and cancellation before expensive font work", async () => {
    await expect(renderPdf({fonts: [font], blocks: [paragraph]}, {limits: {fontBytes: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
    await expect(renderPdf({fonts: [font], blocks: [paragraph]}, {limits: {pages: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
    await expect(renderPdf({fonts: [font], blocks: [paragraph]}, {signal: AbortSignal.abort()})).rejects.toMatchObject({code: "E_CANCELLED"});
    await expect(renderPdf({fonts: [font], blocks: [paragraph]}, {limits: {outputBytes: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
  });
});
