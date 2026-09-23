import {expect, it, vi} from "vitest";
import {PDFPage} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {suppliedDefaultFont} from "@poe-code/pdf";
import type {CapabilityContext} from "../contracts.js";
import {createFormattingCapability} from "../formatting.js";
import {readGnumeric} from "./gnumeric.js";
import {writePdf} from "./pdf.js";
const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"}, formatting: createFormattingCapability(),
  fonts: {async resolve() {return suppliedDefaultFont().bytes;}},
  limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 6000000, cells: 10000, sheets: 4, operations: 100}};
async function fixture(alignment: string, unit = 10, width = 72) {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61" Full="1.12.61"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name><g:PrintInformation><g:paper>na_letter</g:paper><g:Margins><g:top Points="72"/><g:bottom Points="72"/><g:left Points="72"/><g:right Points="72"/></g:Margins><g:Header Left="" Middle="" Right=""/><g:Footer Left="" Middle="" Right=""/></g:PrintInformation><g:Styles><g:StyleRegion startRow="0" endRow="3" startCol="0" endCol="0"><g:Style HAlign="${alignment}" VAlign="GNM_VALIGN_BOTTOM" WrapText="0" ShrinkToFit="0" Rotation="0" Shade="0" Indent="0" Locked="1" Hidden="0" Fore="0:0:0" Back="FFFF:FFFF:FFFF" PatternColor="0:0:0" Format="General"><g:Font Unit="${unit}" Bold="0" Italic="0" Underline="0" StrikeThrough="0" Script="0">Sans</g:Font></g:Style></g:StyleRegion></g:Styles><g:Cols DefaultSizePts="${width}"><g:ColInfo No="0" Unit="${width}" HardSize="1"/></g:Cols><g:Rows DefaultSizePts="20"><g:RowInfo No="0" Unit="20" HardSize="1" Count="4"/></g:Rows><g:Cells><g:Cell Row="0" Col="0" ValueType="60">alpha</g:Cell><g:Cell Row="1" Col="0" ValueType="40">-12.5</g:Cell><g:Cell Row="2" Col="0" ValueType="20">TRUE</g:Cell><g:Cell Row="3" Col="0" ValueType="50">#DIV/0!</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`), context);
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

it.each([[8, 125], [14, 113.75]] as const)("aligns Unit%s cells using rounded shaped advances", async (unit, x) => {
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    await writePdf(await fixture("GNM_HALIGN_RIGHT", unit), [], context);
    expect(draw.mock.calls.find(([text]) => text === "alpha")?.[1]?.x).toBe(x);
  } finally {draw.mockRestore();}
});
it("refuses text whose rounded display width exceeds the printable cell", async () => {
  const book = await fixture("GNM_HALIGN_RIGHT", 8, 23.4);
  // Five600/1000em glyphs are18raw points, but round to5display pixels each:
  // 18.75pt must not fit in the18.4pt available width.
  const single = {...book, sheets: book.sheets.map(sheet => ({...sheet, cells: sheet.cells.slice(0, 1)}))};
  await expect(writePdf(single, [], context)).rejects.toThrow("default-style text layout");
});

it("uses shaped advance positions instead of nominal glyph widths", async () => {
  const parsed = fontkit.create(suppliedDefaultFont().bytes), original = parsed.layout.bind(parsed);
  const layout = vi.spyOn(parsed, "layout").mockImplementation((value, features) => {
    const run = original(value, features);
    return {...run, positions: run.positions.map(position => ({...position, xAdvance: position.xAdvance - 100}))};
  });
  const create = vi.spyOn(fontkit, "create").mockReturnValue(parsed), draw = vi.spyOn(PDFPage.prototype, "drawText");
  try {
    await writePdf(await fixture("GNM_HALIGN_RIGHT"), [], context);
    expect(draw.mock.calls.find(([text]) => text === "alpha")?.[1]?.x).toBe(125);
  } finally {layout.mockRestore();create.mockRestore();draw.mockRestore();}
});
