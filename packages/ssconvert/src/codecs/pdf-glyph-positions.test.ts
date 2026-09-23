import {expect, it, vi} from "vitest";
import fontkit from "@pdf-lib/fontkit";
import {suppliedDefaultFont} from "@poe-code/pdf";
import type {CapabilityContext} from "../contracts.js";
import {readGnumeric} from "./gnumeric.js";
import {writePdf} from "./pdf.js";
import {pdfText} from "./pdf-text.test-support.js";

const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"}, fonts: {async resolve() {return suppliedDefaultFont().bytes;}},
  limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 6000000, cells: 100, sheets: 4, operations: 100}};
async function fixture(value: string, size: number, width = 72) {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Cols DefaultSizePts="${width}"/><g:Rows DefaultSizePts="20"/><g:PrintInformation><g:paper>na_letter</g:paper><g:Margins><g:top Points="72"/><g:bottom Points="72"/><g:left Points="72"/><g:right Points="72"/></g:Margins><g:Header Left="" Middle="" Right=""/><g:Footer Left="" Middle="" Right=""/></g:PrintInformation><g:Styles><g:StyleRegion startRow="0" endRow="0" startCol="0" endCol="0"><g:Style HAlign="GNM_HALIGN_LEFT" VAlign="GNM_VALIGN_BOTTOM" WrapText="0" ShrinkToFit="0" Rotation="0" Shade="0" Indent="0" Locked="1" Hidden="0" Fore="0:0:0" Back="FFFF:FFFF:FFFF" PatternColor="0:0:0" Format="General"><g:Font Unit="${size}" Bold="0" Italic="0" Underline="0" StrikeThrough="0" Script="0">Sans</g:Font></g:Style></g:StyleRegion></g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="60">${value}</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`), context);
}
it.each([[8, [76.75, 80.5, 84.25]], [14, [76.75, 82.75, 88.75]]] as const)("paints Unit%s glyphs at rounded display advances", async (size, xs) => {
  const book = await fixture("AAA", size), original = structuredClone(book);
  const {runs} = await pdfText(await writePdf(book, [], context));
  expect(runs.map(run => run.text)).toEqual(["AAA"]);
  expect(runs[0]!.glyphs.map(glyph => glyph.x)).toEqual(xs);
  expect(book).toEqual(original);
});
it("paints the shaped horizontal and vertical offsets without changing Unicode mappings", async () => {
  const parsed = fontkit.create(suppliedDefaultFont().bytes), original = parsed.layout.bind(parsed);
  const layout = vi.spyOn(parsed, "layout").mockImplementation((value, features) => {
    const run = original(value, features);
    return {...run, positions: run.positions.map((position, i) => ({...position,
      xAdvance: i === 0 ? 400 : 600, xOffset: i === 0 ? 100 : -100, yOffset: i === 0 ? 200 : -200}))};
  });
  const create = vi.spyOn(fontkit, "create").mockReturnValue(parsed);
  try {
    const {runs} = await pdfText(await writePdf(await fixture("AB", 10), [], context));
    expect(runs.map(run => run.text)).toEqual(["AB"]);
    expect(runs[0]!.glyphs.map(glyph => glyph.x)).toEqual([77.5, 79]);
    expect(runs[0]!.glyphs[0]!.y - runs[0]!.glyphs[1]!.y).toBe(3);
  } finally {layout.mockRestore();create.mockRestore();}
});

it("fits the positioned glyphs when discarded nominal advances would overflow", async () => {
  // Rounded advances total18pt, and the final nominal glyph ends at18.3pt.
  // Both fit18.5pt; the old sum of three nominal advances was18.9pt.
  const {runs} = await pdfText(await writePdf(await fixture("AAA", 14, 23.5), [], context));
  expect(runs[0]!.text).toBe("AAA");
  expect(runs[0]!.glyphs.map(glyph => glyph.x)).toEqual([76.75, 82.75, 88.75]);
});
