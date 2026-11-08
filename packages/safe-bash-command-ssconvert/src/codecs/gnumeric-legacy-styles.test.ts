import {metadataNode} from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import {expect, it} from "vitest";
import {readGnumeric, writeGnumeric} from "./gnumeric.js";
import {cellPrintStyle} from "../rendering/print/cell-style.js";
import type {CapabilityContext} from "../contracts.js";
const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"},
  limits: {inputBytes: 1000000, outputBytes: 1000000, workbookWork: 100000, cells: 100, sheets: 4, operations: 100}};
function fixture(version: number, patch: string) {
  const ns = version < 8 ? `http://www.gnome.org/gnumeric/v${version}` : `http://www.gnumeric.org/v${version}.dtd`;
  return new TextEncoder().encode(`<gnm:Workbook xmlns:gnm="${ns}"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">S</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>S</gnm:Name><gnm:Styles><gnm:StyleRegion startRow="0" endRow="0" startCol="0" endCol="1"><gnm:Style HAlign="GNM_HALIGN_RIGHT" Shade="1" Back="FFFF:0:0"><gnm:Font Unit="16" Bold="1">DejaVu Serif</gnm:Font></gnm:Style></gnm:StyleRegion><gnm:StyleRegion startRow="0" endRow="0" startCol="0" endCol="0">${patch}</gnm:StyleRegion></gnm:Styles><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="60">first</gnm:Cell><gnm:Cell Row="0" Col="1" ValueType="60">second</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>`);
}
it.each([2,3,4,5,6,10])("honors XML v%i partial style replacement or merging", async version => {
  const book = await readGnumeric(fixture(version, '<gnm:Style Fore="0:0:FFFF"><gnm:Font Italic="1"/></gnm:Style>'), context);
  const cells = book.sheets[0]!.cells;
  const first = cellPrintStyle(cells[0]!.style, () => {}), second = cellPrintStyle(cells[1]!.style, () => {});
  expect(second).toMatchObject({alignment: "right", family: "DejaVu Serif", bold: true, italic: false, size: 16, background: [1,0,0]});
  expect(first).toEqual(version >= 3 && version <= 5 ? {...second, italic: true, foreground: [0,0,1]} : {...cellPrintStyle(undefined, () => {}), italic: true, foreground: [0,0,1]});
});
it.each(['<gnm:Style/>', '<gnm:Style><gnm:Font/></gnm:Style>'])("keeps earlier effects for an empty legacy patch: %s", async patch => {
  const book = await readGnumeric(fixture(4, patch), context);
  expect(cellPrintStyle(book.sheets[0]!.cells[0]!.style, () => {})).toEqual(cellPrintStyle(book.sheets[0]!.cells[1]!.style, () => {}));
});
it("lets explicit legacy values clear prior font and fill effects", async () => {
  const book = await readGnumeric(fixture(4, '<gnm:Style Shade="0"><gnm:Font Bold="0" Unit="10">Sans</gnm:Font></gnm:Style>'), context);
  expect(cellPrintStyle(book.sheets[0]!.cells[0]!.style, () => {})).toEqual({...cellPrintStyle(undefined, () => {}), alignment: "right"});
});

it("materializes inherited styles when a legacy workbook is written as modern XML", async () => {
  const original = await readGnumeric(fixture(4, '<gnm:Style Fore="0:0:FFFF"><gnm:Font Italic="1"/></gnm:Style>'), context);
  const reopened = await readGnumeric(await writeGnumeric(original, [], context), context);
  expect(reopened.sheets[0]!.cells.map(cell => cellPrintStyle(cell.style, () => {})))
    .toEqual(original.sheets[0]!.cells.map(cell => cellPrintStyle(cell.style, () => {})));
});

it.each([
  ['<gnm:Top Style="2"/>', {Top: {Style: "2"}, Left: {Style: "1", Color: "0:0:FFFF"}}],
  ['<gnm:Top Style="0"/>', {Top: {Style: "0"}, Left: {Style: "1", Color: "0:0:FFFF"}}],
  ['<gnm:Top Color="FFFF:0:0"/>', {Top: {Style: "1", Color: "0:FFFF:0"}, Left: {Style: "1", Color: "0:0:FFFF"}}]
])("replaces only a specified legacy border side: %s", async (patch, expected) => {
  const bytes = fixture(4, `<gnm:Style><gnm:StyleBorder>${patch}</gnm:StyleBorder></gnm:Style>`);
  const source = new TextDecoder().decode(bytes).replace('</gnm:Font>', '</gnm:Font><gnm:StyleBorder><gnm:Top Style="1" Color="0:FFFF:0"/><gnm:Left Style="1" Color="0:0:FFFF"/></gnm:StyleBorder>');
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const borders = metadataNode(book.sheets[0]!.cells[0]!.style!.gnumeric)!.children.find(node => node.name === "StyleBorder")!;
  expect(Object.fromEntries(borders.children.map(node => [node.name, node.attributes]))).toEqual(expected);
});

it.each([4,10].flatMap(version => [
  {name: "-adobe-helvetica-bold-o-normal", bold: false, italic: false},
  {name: "-foundry-bold-i-normal", bold: true, italic: true},
  {name: "-foundry-bold-o-normal", bold: true, italic: true},
  {name: "-foundry-bold-r-normal", bold: true, italic: false},
  {name: "-foundry-medium-i-normal", bold: false, italic: true},
  {name: "-foundry--bold-i", bold: true, italic: false},
  {name: "-", bold: false, italic: false},
  {name: "-foundry-Bold-Italic", bold: false, italic: false}
].map(font => ({version, ...font}))))("decodes native X11 hints for XML $version: $name", async ({version,name,bold,italic}) => {
  const book = await readGnumeric(fixture(version, `<gnm:Style><gnm:Font Bold="0" Italic="0">${name}</gnm:Font></gnm:Style>`), context);
  const style = cellPrintStyle(book.sheets[0]!.cells[0]!.style, () => {});
  expect(style).toMatchObject({family: version === 4 ? "DejaVu Serif" : "Sans", size: version === 4 ? 16 : 10, bold, italic});
  const reopened = await readGnumeric(await writeGnumeric(book, [], context), context);
  expect(cellPrintStyle(reopened.sheets[0]!.cells[0]!.style, () => {})).toEqual(style);
});

it("keeps explicit font effects when an X11 name supplies no overriding hint", async () => {
  const book = await readGnumeric(fixture(10, '<gnm:Style><gnm:Font Bold="1" Italic="1">-foundry-medium-r-normal</gnm:Font></gnm:Style>'), context);
  expect(cellPrintStyle(book.sheets[0]!.cells[0]!.style, () => {})).toMatchObject({family: "Sans", bold: true, italic: true});
});
it("charges work while decoding long X11 font components", async () => {
  const bytes = fixture(4, `<gnm:Style><gnm:Font>-${"a".repeat(512)}-bold-i</gnm:Font></gnm:Style>`);
  await expect(readGnumeric(bytes, {...context, limits: {...context.limits, workbookWork: 100}})).rejects.toThrow("XML relationship work");
});

it.each([4,10].flatMap(version => [
  ['Fit="0"', "0"], ['Fit="1"', "1"], ['Fit="1" WrapText="0"', "0"],
  ['WrapText="0" Fit="1"', "1"], ['Fit="-1"', "1"], ['Fit="2"', "1"],
  ['Fit=""', "0"], ['Fit="+1"', "1"], ['Fit=" 1"', "1"],
  ['Fit="4294967296"', "0"], ['Fit="9223372036854775807"', "1"], ['Fit="-9223372036854775808"', "0"]
].map(([attrs, expected]) => ({version, attrs, expected}))))("normalizes ordered wrap aliases for XML $version: $attrs", async ({version,attrs,expected}) => {
  const book = await readGnumeric(fixture(version, `<gnm:Style ${attrs}/>`), context);
  const reopened = await readGnumeric(await writeGnumeric(book, [], context), context);
  for (const workbook of [book, reopened]) {
    const attributes = metadataNode(workbook.sheets[0]!.cells[0]!.style!.gnumeric)!.attributes;
    expect(attributes.WrapText).toBe(expected);
    expect(attributes).not.toHaveProperty("Fit");
  }
});

it.each([3,4,5])("preserves inherited empty-range styles across modern XML export from v%i", async version => {
  const original = await readGnumeric(fixture(version, '<gnm:Style Fore="0:0:FFFF"><gnm:Font Italic="1"/></gnm:Style>'), context);
  const expected = original.sheets[0]!.cells.map(cell => cellPrintStyle(cell.style, () => {}));
  const empty = {...original, sheets: original.sheets.map(sheet => ({...sheet, cells: []}))};
  const reopened = await readGnumeric(await writeGnumeric(empty, [], context), context);
  const populated = {...reopened, sheets: reopened.sheets.map(sheet => ({...sheet, cells: original.sheets[0]!.cells.map(({row,column,value}) => ({row,column,value}))}))};
  const result = await readGnumeric(await writeGnumeric(populated, [], context), context);
  expect(result.sheets[0]!.cells.map(cell => cellPrintStyle(cell.style, () => {}))).toEqual(expected);
});

it.each([3,5])("preserves intersecting and disjoint empty style rectangles with base extent %i", async extent => {
  const regions = [
    [0,0,extent,extent,'Shade="1" Back="FFFF:0:0"'],
    [1,1,3,3,'Fore="0:0:FFFF"'],
    [2,0,2,5,'HAlign="GNM_HALIGN_RIGHT"'],
    [0,2,5,2,'Back="0:FFFF:0"'],
    [4,4,5,5,'HAlign="GNM_HALIGN_CENTER"']
  ].map(([r,c,er,ec,attrs]) => `<gnm:StyleRegion startRow="${r}" startCol="${c}" endRow="${er}" endCol="${ec}"><gnm:Style ${attrs}/></gnm:StyleRegion>`).join("");
  const cells = Array.from({length: 36}, (_, i) => `<gnm:Cell Row="${Math.floor(i / 6)}" Col="${i % 6}" ValueType="60">x</gnm:Cell>`).join("");
  const source = `<gnm:Workbook xmlns:gnm="http://www.gnome.org/gnumeric/v4"><gnm:Sheets><gnm:Sheet><gnm:Name>S</gnm:Name><gnm:Styles>${regions}</gnm:Styles><gnm:Cells>${cells}</gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>`;
  const original = await readGnumeric(new TextEncoder().encode(source), context);
  const empty = {...original, sheets: original.sheets.map(sheet => ({...sheet, cells: []}))};
  const reopened = await readGnumeric(await writeGnumeric(empty, [], context), context);
  const populated = {...reopened, sheets: reopened.sheets.map(sheet => ({...sheet, cells: original.sheets[0]!.cells.map(({row,column,value}) => ({row,column,value}))}))};
  const result = await readGnumeric(await writeGnumeric(populated, [], context), context);
  expect(result.sheets[0]!.cells.map(cell => cellPrintStyle(cell.style, () => {})))
    .toEqual(original.sheets[0]!.cells.map(cell => cellPrintStyle(cell.style, () => {})));
});

it("keeps full-sheet empty style ranges compact under a zero-cell budget", async () => {
  const input = new TextDecoder().decode(fixture(4, '<gnm:Style Fore="0:0:FFFF"/>'))
    .replaceAll('endRow="0"', 'endRow="65535"').replaceAll('endCol="1"', 'endCol="255"');
  const original = await readGnumeric(new TextEncoder().encode(input), context);
  const empty = {...original, sheets: original.sheets.map(sheet => ({...sheet, cells: []}))};
  const reopened = await readGnumeric(await writeGnumeric(empty, [], context),
    {...context, limits: {...context.limits, cells: 0, workbookWork: 5000}});
  expect(reopened.sheets[0]!.cells).toEqual([]);
  const styles = reopened.sheets[0]!.unsupportedRecords!.find(record => record.kind === "Styles")!;
  expect((styles.data as {children: unknown[]}).children).toHaveLength(2);
});
