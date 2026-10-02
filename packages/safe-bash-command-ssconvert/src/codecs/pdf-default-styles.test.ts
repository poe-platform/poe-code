import {expect, it} from "vitest";
import {suppliedDefaultFont} from "@poe-code/pdf";
import type {CapabilityContext} from "../contracts.js";
import {readGnumeric} from "./gnumeric.js";
import {cellPrintStyle} from "../rendering/print/cell-style.js";
import type {ImportedValue} from "../workbook.js";
import {writePdf} from "./pdf.js";
import {pdfText} from "./pdf-text.test-support.js";
const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"}, fonts: {async resolve() {return suppliedDefaultFont().bytes;}},
  limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 10000, sheets: 4, operations: 100}};
const attributes = 'HAlign="GNM_HALIGN_GENERAL" VAlign="GNM_VALIGN_BOTTOM" WrapText="0" ShrinkToFit="0" Rotation="0" Shade="0" Indent="0" Locked="1" Hidden="0" Fore="0:0:0" Back="FFFF:FFFF:FFFF" PatternColor="0:0:0" Format="General"';
const font = '<g:Font Unit="10" Bold="0" Italic="0" Underline="0" StrikeThrough="0" Script="0">Sans</g:Font>';
async function fixture(axis: "h" | "v" = "h", style = attributes, child = font, value = "cell", type = "60") {
  const cells = Array.from({length: 4}, (_, index) => `<g:Cell Row="${axis === "h" ? index : 0}" Col="${axis === "v" ? index : 0}" ValueType="${type}">${value}${type === "60" ? index : ""}</g:Cell>`).join("");
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Rows DefaultSizePts="20"/><g:PrintInformation><g:paper>na_letter</g:paper><g:Header Left="" Middle="" Right=""/><g:Footer Left="" Middle="" Right=""/><g:${axis}PageBreaks><g:break pos="2" type="manual"/></g:${axis}PageBreaks></g:PrintInformation><g:Styles><g:StyleRegion startRow="0" endRow="3" startCol="0" endCol="3"><g:Style ${style}>${child}</g:Style></g:StyleRegion></g:Styles><g:Cells>${cells}</g:Cells></g:Sheet></g:Sheets></g:Workbook>`), context);
}
it.each(["h", "v"] as const)("prints materialized default styles with %s breaks and supplied fonts", async axis => {
  const book = await fixture(axis);expect(book.sheets[0]!.cells[0]!.style).toBeDefined();
  const before = structuredClone(book);
  const {pdf, runs} = await pdfText(await writePdf(book, [], context));
  expect(pdf.getPageCount()).toBe(2);expect(pdf.getPages().map(p => p.getSize())).toEqual([{width: 612, height: 792}, {width: 612, height: 792}]);
  expect(runs.map(run => run.text)).toEqual(["cell0", "cell1", "cell2", "cell3"]);
  expect(book).toEqual(before);
});
it("requires explicit fonts for materialized Sans styles", async () => {
  const {fonts: ignoredFonts, ...withoutFonts} = context;
  await expect(writePdf(await fixture(), [], withoutFonts)).rejects.toThrow("styled or merged cells");
});
it.each([['WrapText="0"', 'WrapText="1"'], ['HAlign="GNM_HALIGN_GENERAL"', 'HAlign="GNM_HALIGN_FILL"']])("retains refusal for unsupported materialized style %s", async (before, after) => {
  await expect(writePdf(await fixture("h", attributes.replace(before, after)), [], context)).rejects.toThrow("styled or merged cells");
});
it("refuses unknown font effects and borders without publishing a style approximation", async () => {
  for (const child of [font+'<g:StyleBorder/>', font.replace('>Sans<', '>Serif<')])
    await expect(writePdf(await fixture("h", attributes, child), [], context)).rejects.toThrow("styled or merged cells");
});
it("refuses styled multiline text and horizontal overflow", async () => {
  for (const value of ["line&#10;next", "an original long text exceeding one cell"])
    await expect(writePdf(await fixture("h", attributes, font, value), [], context)).rejects.toThrow("PDF default-style text layout");
});

it("rejects foreign namespaces,duplicate attributes and unsupported style owners", async () => {
  const style = (await fixture()).sheets[0]!.cells[0]!.style!;
  const node = style.gnumeric as Readonly<Record<string, ImportedValue>>;
  const attrs = node.attributes as readonly ImportedValue[];
  const cases = [
    {gnumeric: {...node, namespace: "urn:foreign"}},
    {gnumeric: {...node, attributes: [attrs[0]!, ...attrs.slice(0, -1)]}},
    {...style, xlsx: {}},
    {gnumeric: {...node, text: "unsupported retained effect"}}
  ];
  for (const candidate of cases) expect(() => cellPrintStyle(candidate, () => {})).toThrow("styled or merged cells");
});
it("charges retained style text and propagates work cancellation", async () => {
  const style = (await fixture()).sheets[0]!.cells[0]!.style!;
  expect(() => cellPrintStyle(style, amount => {if ((amount ?? 1) > 1) throw new Error("style work refused");})).toThrow("style work refused");
});
it("refuses a cell shorter than the selected font metrics", async () => {
  const book = await fixture(), sheet = book.sheets[0]!;
  await expect(writePdf({...book, sheets: [{...sheet, view: {...sheet.view, defaultRowHeight: 5}}]}, [], context)).rejects.toThrow("PDF default-style text layout");
});

it("applies the native default96dpi scale to materialized cell fonts", async () => {
  const {runs} = await pdfText(await writePdf(await fixture(), [], context));
  expect(runs.map(run => run.size)).toEqual([7.5, 7.5, 7.5, 7.5]);
});
it("retains the native print origin,leading grid and scaled text margin", async () => {
  const {runs} = await pdfText(await writePdf(await fixture("v"), [], context));
  expect(runs.map(run => run.glyphs[0]!.x)).toEqual([76.75, 124.75, 76.75, 124.75]);
});
