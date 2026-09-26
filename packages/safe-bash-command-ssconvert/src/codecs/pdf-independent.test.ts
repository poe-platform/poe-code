import { expect, it, vi } from "vitest";
import { PDFDocument, PDFDict, PDFName, PDFPage, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { writePdf } from "./pdf.js";
import { readGnumeric } from "./gnumeric.js";
import { encodeGraphImage } from "../rendering/images/codecs.js";
async function originalPng(ctx: CapabilityContext) {
  return Buffer.from(await encodeGraphImage({ width: 1, height: 1, commands: [], raster: { width: 1, height: 1, rgba: new Uint8Array([10, 20, 30, 255]) } }, "png", ctx)).toString("base64");
}

function context(): CapabilityContext {
  return { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 10000, sheets: 10, operations: 100 } };
}

it("does not propagate the first row override into unspecified printed rows", async () => {
  const book: Workbook = { sheets: [{ id: "one", name: "One", rows: [{ index: 0, sizePoints: 100 }],
    cells: [{ row: 0, column: 0, value: { kind: "blank" } }, { row: 34, column: 0, value: { kind: "blank" } }] }] };
  // 100 + 34 * 12.75 = 533.5 points, below the measured default printable height.
  const pdf = await PDFDocument.load(await writePdf(book, [], context()));
  expect(pdf.getPageCount()).toBe(1);
});

it("clips a tall workbook graph on both native page boundaries", async () => {
  const ctx = context();
  const book = await readGnumeric(new TextEncoder().encode('<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects><g:SheetObjectGraph Name="tall" AnchorMode="1" ObjectBound="A1:C55" ObjectOffset="0 0 100 700"><GogObject type="GogGraph"><property name="style" type="GogStyle"><line dash="none" auto-dash="0"/><fill type="pattern" auto-type="0" is-auto="0"><pattern type="solid" auto-pattern="0" back="ff:00:00:ff"/></fill></property></GogObject></g:SheetObjectGraph></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>'), ctx);
  const pdf = await PDFDocument.load(await writePdf(book, [], ctx));
  expect(pdf.getPageCount()).toBe(2);
  for (const [index, page] of pdf.getPages().entries()) {
    const streams = page.node.Contents() as PDFArray;
    const content = streams.asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join("\n");
    // Independently measured native page-1/page-2 graph positions and clips.
    expect(content).toContain("W\nn");
    expect(content).toContain(`1 0 0 1 74.5 ${page.getHeight() - (index ? -478.75 : 120.5) - 700} cm`);
    expect(content).toContain("0 700 l\n100 700 l\n100 0 l");
  }
});

it("does not propagate the first column override into unspecified printed columns", async () => {
  const book: Workbook = { sheets: [{ id: "one", name: "One", columns: [{ index: 0, sizePoints: 100 }],
    cells: [{ row: 0, column: 0, value: { kind: "blank" } }, { row: 0, column: 7, value: { kind: "blank" } }] }] };
  // 100 + 7 * 48 = 436 points, below the measured default printable width.
  const pdf = await PDFDocument.load(await writePdf(book, [], context()));
  expect(pdf.getPageCount()).toBe(1);
});

it("uses measured Gnumeric workbook default margins for pagination", async () => {
  const book: Workbook = { sheets: [{ id: "one", name: "One", cells: [{ row: 0, column: 0, value: { kind: "blank" } }, { row: 49, column: 0, value: { kind: "blank" } }] }] };
  expect((await PDFDocument.load(await writePdf(book, [], context()))).getPageCount()).toBe(2);
});

it("paints the default worksheet header and page footer", async () => {
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    await writePdf({ sheets: [{ id: "one", name: "Worksheet title", cells: [{ row: 0, column: 0, value: { kind: "blank" } }] }] }, [], context());
    expect(draw.mock.calls.map(call => call[0])).toContain("Worksheet title");
    expect(draw.mock.calls.map(call => call[0])).toContain("Page 1");
  } finally { draw.mockRestore(); }
});

it.each(["A4", "a4", "iso_a4_210x297mm", "Letter", "US-Letter", "USLetter"])("accepts source-mapped paper alias %s", async alias => {
  const book: Workbook = { sheets: [{ id: "one", name: "One", cells: [{ row: 0, column: 0, value: { kind: "blank" } }] }] };
  const pdf = await PDFDocument.load(await writePdf(book, [`paper=${alias}`], context()));
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(alias.toLowerCase().includes("letter") ? 612 : 210 * 72 / 25.4);
});

it("rejects a foreign-namespace Content element rather than embedding it", async () => {
  const ctx = context();
  const book = await readGnumeric(new TextEncoder().encode('<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" xmlns:fake="urn:fake"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects><g:SheetObjectImage Name="pic" AnchorMode="2" ObjectOffset="0 0 20 20" ObjectBound="A1:A1"><fake:Content>AAAA</fake:Content></g:SheetObjectImage></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>'), ctx);
  await expect(writePdf(book, ["object=pic"], ctx)).rejects.toThrow("PDF image payload");
});

it("honors cancellation raised while formatting without serializing a PDF", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel during formatting");
  const ctx: CapabilityContext = { ...context(), signal: controller.signal, formatting: { async format() { controller.abort(reason); return "cell"; } } };
  const book: Workbook = { sheets: [{ id: "one", name: "One", cells: [{ row: 0, column: 0, value: { kind: "string", value: "cell" } }] }] };
  await expect(writePdf(book, [], ctx)).rejects.toBe(reason);
});

it("produces identical bytes across repeated empty-text workbook exports", async () => {
  const book: Workbook = { sheets: [{ id: "one", name: "One", cells: [{ row: 0, column: 0, value: { kind: "blank" } }] }] };
  expect(await writePdf(book, [], context())).toEqual(await writePdf(book, [], context()));
});

it("prints an image-only workbook page with an embedded image resource", async () => {
  const ctx = context();
  const png = await originalPng(ctx);
  const book = await readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects><g:SheetObjectImage Name="pic" AnchorMode="2" ObjectOffset="0 0 20 20" ObjectBound="A1:A1"><Content>${png}</Content></g:SheetObjectImage></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`), ctx);
  const pdf = await PDFDocument.load(await writePdf(book, [], ctx));
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"), PDFDict).keys()).toHaveLength(1);
});

it("embeds a deterministic font subset with non-ASCII text", async () => {
  const book: Workbook = { sheets: [{ id: "one", name: "One", cells: [{ row: 0, column: 0, value: { kind: "string", value: "Workbook café Ω" } }] }] };
  const first = await writePdf(book, [], context());
  expect(first).toEqual(await writePdf(book, [], context()));
  const pdf = await PDFDocument.load(first);
  const fonts = pdf.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  expect(new Set(fonts.values().map(value => value.toString())).size).toBe(1);
});

it("rejects an undersized output budget before returning bytes", async () => {
  const ctx = context();
  await expect(writePdf({ sheets: [] }, [], { ...ctx, limits: { ...ctx.limits, outputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit", exitCode: 1 });
});

it("does not claim unqualified hidden-axis object placement", async () => {
  const ctx = context();
  const original = await readGnumeric(new TextEncoder().encode('<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects><g:SheetObjectGraph Name="graph" AnchorMode="0" ObjectOffset="0 0 1 1" ObjectBound="A1:A1"><GogObject type="GogGraph"/></g:SheetObjectGraph></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>'), ctx);
  const book: Workbook = { ...original, sheets: original.sheets.map(sheet => ({ ...sheet, columns: [{ index: 0, hidden: true, sizePoints: 100 }] })) };
  await expect(writePdf(book, ["object=graph paper=fit"], ctx)).rejects.toThrow("hidden-axis object placement");
});

it("admits PNG dimensions before asking pdf-lib to parse the payload", async () => {
  const ctx = context();
  const header = new Uint8Array(33);
  header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(header.buffer);
  view.setUint32(16, 100000); view.setUint32(20, 100000);
  const payload = btoa(String.fromCharCode(...header));
  const book = await readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects><g:SheetObjectImage Name="pic" AnchorMode="2" ObjectOffset="0 0 20 20" ObjectBound="A1:A1"><Content>${payload}</Content></g:SheetObjectImage></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`), ctx);
  const parser = vi.spyOn(PDFDocument.prototype, "embedPng").mockRejectedValue(new Error("parser reached"));
  try {
    await expect(writePdf(book, ["object=pic"], ctx)).rejects.toMatchObject({ code: "resource-limit" });
    expect(parser).not.toHaveBeenCalled();
  } finally { parser.mockRestore(); }
});

it("bounds malformed compressed scanlines before entering an unbounded PNG embedder", async () => {
  const ctx = context();
  const bytes = await encodeGraphImage({ width: 2, height: 1, commands: [], raster: { width: 2, height: 1, rgba: new Uint8Array([10,20,30,255,40,50,60,255]) } }, "png", ctx);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(16, 1);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(29, (crc ^ 0xffffffff) >>> 0);
  const encoded = Buffer.from(bytes).toString("base64");
  const book = await readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects><g:SheetObjectImage Name="pic" AnchorMode="2" ObjectOffset="0 0 20 20" ObjectBound="A1:A1"><Content>${encoded}</Content></g:SheetObjectImage></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`), ctx);
  await expect(writePdf(book, ["object=pic"], ctx)).rejects.toMatchObject({ code: "resource-limit" });
});

it("paints an embedded raster at object dimensions rather than intrinsic pixel dimensions", async () => {
  const ctx = context();
  const encoded = await originalPng(ctx);
  const book = await readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects><g:SheetObjectImage Name="pic" AnchorMode="2" ObjectOffset="0 0 20 30" ObjectBound="A1:A1"><Content>${encoded}</Content></g:SheetObjectImage></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`), ctx);
  const pdf = await PDFDocument.load(await writePdf(book, ["object=pic"], ctx));
  const streams = pdf.getPage(0).node.Contents() as PDFArray;
  const content = streams.asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join("");
  expect(content).toContain("20 0 0 30");
});

it("preserves original RGB and transparent alpha in separate owned image streams", async () => {
  const ctx = context();
  const encoded = Buffer.from(await encodeGraphImage({ width: 2, height: 1, commands: [], raster: { width: 2, height: 1, rgba: new Uint8Array([10, 20, 30, 0, 40, 50, 60, 128]) } }, "png", ctx)).toString("base64");
  const book = await readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>One</g:Name><g:Objects><g:SheetObjectImage Name="pic" AnchorMode="2" ObjectOffset="0 0 20 30" ObjectBound="A1:A1"><Content>${encoded}</Content></g:SheetObjectImage></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`), ctx);
  const first = await writePdf(book, ["object=pic"], ctx);
  expect(first).toEqual(await writePdf(book, ["object=pic"], ctx));
  const pdf = await PDFDocument.load(first);
  const resources = pdf.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  const image = pdf.context.lookup(resources.values()[0]!) as PDFRawStream;
  expect(decodePDFRawStream(image).decode()).toEqual(new Uint8Array([10, 20, 30, 40, 50, 60]));
  const alpha = pdf.context.lookup(image.dict.get(PDFName.of("SMask"))) as PDFRawStream;
  expect(decodePDFRawStream(alpha).decode()).toEqual(new Uint8Array([0, 128]));
  expect(alpha.dict.lookup(PDFName.of("ColorSpace"), PDFName).asString()).toBe("/DeviceGray");
});
