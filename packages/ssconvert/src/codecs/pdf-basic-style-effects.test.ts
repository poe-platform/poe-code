import {expect, it, vi} from "vitest";
import {PDFDocument, PDFPage, rgb} from "pdf-lib";
import {suppliedDefaultFont} from "@poe-code/pdf";
import type {CapabilityContext, FontCapability} from "../contracts.js";
import {readGnumeric} from "./gnumeric.js";
import {writePdf} from "./pdf.js";
const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"},
  limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 6000000, cells: 10000, sheets: 4, operations: 100}};
const attributes = 'HAlign="GNM_HALIGN_GENERAL" VAlign="GNM_VALIGN_BOTTOM" WrapText="0" ShrinkToFit="0" Rotation="0" Shade="0" Indent="0" Locked="1" Hidden="0" Fore="0:0:0" Back="FFFF:FFFF:FFFF" PatternColor="0:0:0" Format="General"';
const font = '<g:Font Unit="10" Bold="0" Italic="0" Underline="0" StrikeThrough="0" Script="0">Sans</g:Font>';
async function fixture(cases: readonly {text: string; attributes?: string; font?: string; type?: string}[]) {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Cols DefaultSizePts="72"/><g:Rows DefaultSizePts="20"/><g:PrintInformation><g:paper>na_letter</g:paper><g:Margins><g:top Points="72"/><g:bottom Points="72"/><g:left Points="72"/><g:right Points="72"/></g:Margins><g:Header Left="" Middle="" Right=""/><g:Footer Left="" Middle="" Right=""/></g:PrintInformation><g:Styles>${cases.map((c, row) => `<g:StyleRegion startRow="${row}" endRow="${row}" startCol="0" endCol="0"><g:Style ${c.attributes ?? attributes}>${c.font ?? font}</g:Style></g:StyleRegion>`).join("")}</g:Styles><g:Cells>${cases.map((c, row) => `<g:Cell Row="${row}" Col="0" ValueType="${c.type ?? "60"}">${c.text}</g:Cell>`).join("")}</g:Cells></g:Sheet></g:Sheets></g:Workbook>`), context);
}
it("paints selected bold fonts, native cell sizes, foreground and solid background", async () => {
  const bytes = suppliedDefaultFont().bytes;
  const resolve = vi.fn<FontCapability["resolve"]>(async () => bytes);
  const book = await fixture([{text: "normal"}, {text: "bold", font: font.replace('Bold="0"', 'Bold="1"')},
    {text: "small", font: font.replace('Unit="10"', 'Unit="8"')}, {text: "large", font: font.replace('Unit="10"', 'Unit="14"')},
    {text: "red", attributes: attributes.replace('Fore="0:0:0"', 'Fore="FFFF:0:0"')},
    {text: "fill", attributes: attributes.replace('Back="FFFF:FFFF:FFFF"', 'Back="FFFF:FFFF:0"').replace('Shade="0"', 'Shade="1"')}]);
  const before = structuredClone(book), text = vi.spyOn(PDFPage.prototype, "drawText"), rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const pdf = await PDFDocument.load(await writePdf(book, [], {...context, fonts: {resolve}}));
    expect(pdf.getPageCount()).toBe(1);
    const calls = text.mock.calls.filter(([value]) => value !== "");
    expect(calls.map(([value]) => value)).toEqual(["normal", "bold", "small", "large", "red", "fill"]);
    expect(calls.map(([, options]) => options?.size)).toEqual([7.5, 7.5, 6, 10.5, 7.5, 7.5]);
    expect(calls[4]![1]?.color).toEqual(rgb(1, 0, 0));
    expect(rectangle.mock.calls.map(([options]) => options)).toContainEqual(expect.objectContaining({x: 74, y: 599.8, width: 72.2, height: 20.2, color: rgb(1, 1, 0)}));
    expect(resolve.mock.calls).toHaveLength(2);
    expect(resolve.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({family: "Sans", bold: false, italic: false, maxBytes: 1000000}),
      expect.objectContaining({family: "Sans", bold: true, italic: false, maxBytes: 1000000 - bytes.byteLength})]);
    expect(book).toEqual(before);
  } finally {text.mockRestore();rectangle.mockRestore();}
});
it("paints a blank solid background without requesting unused font bytes", async () => {
  const resolve = vi.fn<FontCapability["resolve"]>(async () => undefined), rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const book = await fixture([{text: "", type: "10", attributes: attributes.replace('Shade="0"', 'Shade="1"').replace('Back="FFFF:FFFF:FFFF"', 'Back="FFFF:FFFF:0"')}]);
    await writePdf(book, [], {...context, fonts: {resolve}});
    expect(rectangle).toHaveBeenCalledWith(expect.objectContaining({color: rgb(1, 1, 0)}));
    expect(resolve).not.toHaveBeenCalled();
  } finally {rectangle.mockRestore();}
});
it("shares a byte budget across separately selected regular and bold fonts", async () => {
  const bytes = suppliedDefaultFont().bytes, resolve = vi.fn<FontCapability["resolve"]>(async () => bytes);
  const book = await fixture([{text: "normal"}, {text: "bold", font: font.replace('Bold="0"', 'Bold="1"')}]);
  await expect(writePdf(book, [], {...context, fonts: {resolve}, limits: {...context.limits, inputBytes: bytes.byteLength * 2 - 1}})).rejects.toThrow("font bytes limit exceeded");
  expect(resolve.mock.calls).toHaveLength(2);
});
it("retains explicit refusal for unsupported shading and font decorations before font selection", async () => {
  const resolve = vi.fn<FontCapability["resolve"]>(async () => suppliedDefaultFont().bytes);
  for (const c of [{text: "shade", attributes: attributes.replace('Shade="0"', 'Shade="2"')},
    {text: "italic", font: font.replace('Italic="0"', 'Italic="1"')}, {text: "underline", font: font.replace('Underline="0"', 'Underline="1"')}])
    await expect(writePdf(await fixture([c]), [], {...context, fonts: {resolve}})).rejects.toThrow("styled or merged cells");
  expect(resolve).not.toHaveBeenCalled();
});
