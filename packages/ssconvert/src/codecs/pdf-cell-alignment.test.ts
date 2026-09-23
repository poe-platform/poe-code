import {expect, it, vi} from "vitest";
import {PDFPage} from "pdf-lib";
import {suppliedDefaultFont} from "@poe-code/pdf";
import type {CapabilityContext} from "../contracts.js";
import {createFormattingCapability} from "../formatting.js";
import {readGnumeric} from "./gnumeric.js";
import {writePdf} from "./pdf.js";
const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"}, formatting: createFormattingCapability(),
  fonts: {async resolve() {return suppliedDefaultFont().bytes;}},
  limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 6000000, cells: 10000, sheets: 4, operations: 100}};
async function fixture(alignment: string) {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61" Full="1.12.61"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name><g:PrintInformation><g:paper>na_letter</g:paper><g:Margins><g:top Points="72"/><g:bottom Points="72"/><g:left Points="72"/><g:right Points="72"/></g:Margins><g:Header Left="" Middle="" Right=""/><g:Footer Left="" Middle="" Right=""/></g:PrintInformation><g:Styles><g:StyleRegion startRow="0" endRow="3" startCol="0" endCol="0"><g:Style HAlign="${alignment}" VAlign="GNM_VALIGN_BOTTOM" WrapText="0" ShrinkToFit="0" Rotation="0" Shade="0" Indent="0" Locked="1" Hidden="0" Fore="0:0:0" Back="FFFF:FFFF:FFFF" PatternColor="0:0:0" Format="General"><g:Font Unit="10" Bold="0" Italic="0" Underline="0" StrikeThrough="0" Script="0">Sans</g:Font></g:Style></g:StyleRegion></g:Styles><g:Cols DefaultSizePts="72"><g:ColInfo No="0" Unit="72" HardSize="1"/></g:Cols><g:Rows DefaultSizePts="20"><g:RowInfo No="0" Unit="20" HardSize="1" Count="4"/></g:Rows><g:Cells><g:Cell Row="0" Col="0" ValueType="60">alpha</g:Cell><g:Cell Row="1" Col="0" ValueType="40">-12.5</g:Cell><g:Cell Row="2" Col="0" ValueType="20">TRUE</g:Cell><g:Cell Row="3" Col="0" ValueType="50">#DIV/0!</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`), context);
}
it.each([
  ["GNM_HALIGN_GENERAL", [76.75, 121.25, 101.25, 94.5]],
  ["GNM_HALIGN_LEFT", [76.75, 76.75, 76.75, 76.75]],
  ["GNM_HALIGN_RIGHT", [121.25, 121.25, 125.75, 112.25]],
  ["GNM_HALIGN_CENTER", [99, 99, 101.25, 94.5]]
] as const)("prints four value kinds with native %s alignment and numeric minus", async (alignment, positions) => {
  const book = await fixture(alignment), before = structuredClone(book), draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    await writePdf(book, [], context);
    const cells = draw.mock.calls.filter(([text]) => text !== "");
    expect(cells.map(([text]) => text)).toEqual(["alpha", "−12.5", "TRUE", "#DIV/0!"]);
    // The supplied monospaced fixture has 600/1000em advances. Native cell
    // layout excludes 5pt from width and adds its 4.75pt leading inset.
    expect(cells.map(([, options]) => options?.x)).toEqual(positions);
    expect(cells.map(([, options]) => options?.size)).toEqual([7.5, 7.5, 7.5, 7.5]);
    expect(book).toEqual(before);
  } finally {draw.mockRestore();}
});
