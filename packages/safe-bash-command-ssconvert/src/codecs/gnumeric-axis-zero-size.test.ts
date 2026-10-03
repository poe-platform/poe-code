import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
const context = (): CapabilityContext => ({ signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } });
for (const [container, element, property, base] of [["Rows", "RowInfo", "rows", 12.75], ["Cols", "ColInfo", "columns", 48]] as const) {
  for (const custom of [false, true]) for (const prior of [false, true]) {
    it.each([0, -0.5, 0.25])(`${container} Unit=%s preserves first-axis geometry (custom: ${custom}, prior: ${prior})`, async unit => {
      const input = new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name><g:${container}${custom ? ' DefaultSizePts="25"' : ""}>${prior ? `<g:${element} No="1" Unit="40"/>` : ""}<g:${element} No="2" Unit="60"/><g:${element} No="3" Unit="35"/><g:${element} No="1" Count="2" Unit="${unit}" HardSize="1" Hidden="1" Collapsed="1" OutlineLevel="2"/></g:${container}></g:Sheet></g:Sheets></g:Workbook>`);
      const book = await readGnumeric(input, context());
      const expected = unit > 0 ? unit : prior ? 40 : custom ? 25 : base;
      for (const actual of [book, await readGnumeric(await writeGnumeric(book, [], context()), context())]) {
        expect(actual.sheets[0]![property]?.map(({ style: _style, ...axis }) => axis)).toEqual([
          ...[1, 2].map(index => ({ index, sizePoints: expected, hidden: true, collapsed: true, outlineLevel: 2 })),
          { index: 3, sizePoints: 35, hidden: false, collapsed: false, outlineLevel: 0 }
        ]);
      }
    });
  }
}

for (const [container, element, property, view, fallback] of [["Rows", "RowInfo", "rows", "defaultRowHeight", 12.75], ["Cols", "ColInfo", "columns", "defaultColumnWidth", 48]] as const) {
  it.each([0, -0.5, -1, 25])(`${container} preserves native default when DefaultSizePts=%s is rejected`, async size => {
    const input = new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name><g:${container} DefaultSizePts="${size}"><g:${element} No="1" Count="2" Unit="0"/></g:${container}></g:Sheet></g:Sheets></g:Workbook>`);
    const book = await readGnumeric(input, context());
    const expected = size > 0 ? size : fallback;
    expect(book.sheets[0]!.view?.[view]).toBe(expected);
    expect(book.sheets[0]![property]?.map(axis => axis.sizePoints)).toEqual([expected, expected]);
  });
}
