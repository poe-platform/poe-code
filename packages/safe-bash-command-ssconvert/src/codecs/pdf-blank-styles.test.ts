import {expect, it, vi} from "vitest";
import {PDFPage} from "pdf-lib";
import {suppliedDefaultFont} from "safe-bash-pdf-engine";
import type {CapabilityContext} from "../contracts.js";
import {createFormattingCapability} from "../formatting.js";
import {readGnumeric} from "./gnumeric.js";
import {writePdf} from "./pdf.js";
import {pdfText} from "./pdf-text.test-support.js";
const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"}, formatting: createFormattingCapability(),
  fonts: {async resolve() {return suppliedDefaultFont().bytes;}},
  limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 6000000, cells: 10000, sheets: 4, operations: 100}};
const region = (style: string, start = 0, end = 3) => `<g:StyleRegion startRow="${start}" endRow="${end}" startCol="${start}" endCol="${end}"><g:Style ${style}/></g:StyleRegion>`;
async function fixture(styles: string, merges = "", cells = '<g:Cell Row="0" Col="0" ValueType="60">start</g:Cell><g:Cell Row="3" Col="3" ValueType="60">end</g:Cell>') {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name><g:PrintInformation><g:Header Left="" Middle="" Right=""/><g:Footer Left="" Middle="" Right=""/></g:PrintInformation><g:Styles>${styles}</g:Styles><g:Cols DefaultSizePts="48"/><g:Rows DefaultSizePts="20"/><g:MergedRegions>${merges}</g:MergedRegions><g:Cells>${cells}</g:Cells></g:Sheet></g:Sheets></g:Workbook>`), context);
}
it.each([["", 16], [region('', 1, 2), 12], [region('Shade="1" Back="0:0:FFFF"', 1, 2), 16]])("paints retained blank backgrounds with replacing overlays %s", async (overlay, count) => {
  const book = await fixture(region('Shade="1" Back="FFFF:0:0"') + overlay), before = structuredClone(book);
  const rectangles = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const result = await pdfText(await writePdf(book, [], context));
    expect(rectangles).toHaveBeenCalledTimes(count);
    expect(result.runs.map(run => run.text)).toEqual(["start", "end"]);
    expect(book).toEqual(before);
  } finally {rectangles.mockRestore();}
});
it("paints an unallocated merged corner using its full merged rectangle", async () => {
  const book = await fixture(region('Shade="1" Back="0:0:FFFF"', 1, 1), '<g:Merge>B2:C3</g:Merge>');
  const rectangles = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    await writePdf(book, [], context);
    expect(rectangles).toHaveBeenCalledTimes(1);
    expect(rectangles.mock.calls[0]![0]).toMatchObject({width: 96.2, height: 40.2});
  } finally {rectangles.mockRestore();}
});
it("does not expand print bounds for a large retained blank style region", async () => {
  const book = await fixture(region('Shade="1" Back="FFFF:0:0"', 0, 255));
  const rectangles = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const {pdf} = await pdfText(await writePdf(book, [], context));
    expect(pdf.getPageCount()).toBe(1);
    expect(rectangles).toHaveBeenCalledTimes(16);
  } finally {rectangles.mockRestore();}
});
it("renders retained diagonals on unallocated cells", async () => {
  const styles = region('', 1, 1).replace('<g:Style />', '<g:Style><g:StyleBorder><g:Diagonal Style="1" Color="FFFF:0:0"/></g:StyleBorder></g:Style>');
  const lines = vi.spyOn(PDFPage.prototype, "drawLine");
  try {
    await writePdf(await fixture(styles), [], context);
    expect(lines).toHaveBeenCalledTimes(1);
    expect(lines.mock.calls[0]![0]).toMatchObject({thickness: 1});
  } finally {lines.mockRestore();}
});
it("keeps a styled empty sheet limited to the native A1 fallback", async () => {
  const rectangles = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    await writePdf(await fixture(region('Shade="1" Back="FFFF:0:0"'), '', ''), [], context);
    expect(rectangles).toHaveBeenCalledTimes(1);
    expect(rectangles.mock.calls[0]![0]).toMatchObject({width: 48.2, height: 20.2});
  } finally {rectangles.mockRestore();}
});
it("skips hidden blank axes while retaining the visible painted area", async () => {
  const book = await fixture(region('Shade="1" Back="FFFF:0:0"'));
  const hidden = {...book, sheets: book.sheets.map(sheet => ({...sheet, rows: [{index: 1, hidden: true}], columns: [{index: 1, hidden: true}]}))};
  const rectangles = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    await writePdf(hidden, [], context);
    expect(rectangles).toHaveBeenCalledTimes(9);
  } finally {rectangles.mockRestore();}
});
it.each(["Top", "Bottom", "Left", "Right"])("prints retained %s edges on blank cells", async side => {
  const styles = region('', 1, 1).replace('<g:Style />', `<g:Style><g:StyleBorder><g:${side} Style="1" Color="FFFF:0:0"/></g:StyleBorder></g:Style>`);
  const lines = vi.spyOn(PDFPage.prototype, "drawLine");
  try {
    await writePdf(await fixture(styles), [], context);
    expect(lines).toHaveBeenCalledTimes(1);
    expect(lines.mock.calls[0]![0]).toMatchObject({thickness: 1});
  } finally {lines.mockRestore();}
});
it("keeps the earlier bottom edge when the next cell requests a thicker top edge", async () => {
  const styles = region('', 1, 1).replace('<g:Style />','<g:Style><g:StyleBorder><g:Bottom Style="1" Color="FFFF:0:0"/></g:StyleBorder></g:Style>') +
    '<g:StyleRegion startRow="2" endRow="2" startCol="1" endCol="1"><g:Style><g:StyleBorder><g:Top Style="5" Color="0:0:FFFF"/></g:StyleBorder></g:Style></g:StyleRegion>';
  const lines = vi.spyOn(PDFPage.prototype, "drawLine");
  try {
    await writePdf(await fixture(styles), [], context);
    expect(lines).toHaveBeenCalledTimes(1);
    expect(lines.mock.calls[0]![0]).toMatchObject({thickness:1,color:{red:1,green:0,blue:0}});
  } finally {lines.mockRestore();}
});
