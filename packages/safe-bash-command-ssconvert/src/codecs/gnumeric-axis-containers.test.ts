import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
const context = (): CapabilityContext => ({ signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } });
function xml(content: string): Uint8Array {
  return new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name>${content}</g:Sheet></g:Sheets></g:Workbook>`);
}
for (const [container, element, property, view, fallback] of [["Rows", "RowInfo", "rows", "defaultRowHeight", 12.75], ["Cols", "ColInfo", "columns", "defaultColumnWidth", 48]] as const) {
  for (const reverse of [false, true]) it.each([30, 0, undefined])(`${container} retains ordered sections (reverse: ${reverse}, next default: %s)`, async next => {
    const first = `<g:${container} DefaultSizePts="20"><g:${element} No="1" Count="2" Unit="0" HardSize="1"/></g:${container}>`;
    const later = `<g:${container}${next === undefined ? "" : ` DefaultSizePts="${next}"`}><g:${element} No="2" Unit="40" HardSize="1" Hidden="1"/><g:${element} No="3" Unit="0" Collapsed="1" OutlineLevel="2"/></g:${container}>`;
    const book = await readGnumeric(xml(reverse ? later + first : first + later), context());
    for (const actual of [book, await readGnumeric(await writeGnumeric(book, [], context()), context())]) {
      expect(actual.sheets[0]!.view?.[view]).toBe(reverse || next !== 30 ? 20 : 30);
      expect(actual.sheets[0]![property]?.map(({ style: _style, ...axis }) => axis)).toEqual([
        { index: 1, sizePoints: 20, hidden: false, collapsed: false, outlineLevel: 0 },
        { index: 2, sizePoints: reverse ? 20 : 40, hidden: !reverse, collapsed: false, outlineLevel: 0 },
        { index: 3, sizePoints: next === 30 ? 30 : reverse ? fallback : 20, hidden: false, collapsed: true, outlineLevel: 2 }
      ]);
    }
  });
}
it("charges repeated overlapping sections against the shared axis budget", async () => {
  const section = '<g:Rows><g:RowInfo No="0" Count="8" Unit="20"/></g:Rows>';
  const ctx = context();
  await expect(readGnumeric(xml(section.repeat(3)), { ...ctx, limits: { ...ctx.limits, workbookNodes: 20 } })).rejects.toMatchObject({ code: "resource-limit" });
});
it("ignores foreign axis sections and keeps undeclared defaults absent", async () => {
  const book = await readGnumeric(xml('<f:Rows xmlns:f="urn:foreign" DefaultSizePts="90"><f:RowInfo No="0" Unit="90"/></f:Rows>'), context());
  expect(book.sheets[0]!.rows).toEqual([]);
  expect(book.sheets[0]!.view?.defaultRowHeight).toBeUndefined();
});

for (const [container, property, view] of [["Rows", "rows", "defaultRowHeight"], ["Cols", "columns", "defaultColumnWidth"]] as const) {
  it(`${container} preserves cell-allocated dimensions before a late default`, async () => {
    const book = await readGnumeric(xml(`<g:${container} DefaultSizePts="30"/><g:Cells><g:Cell Row="0" Col="0" ValueType="60">A</g:Cell></g:Cells><g:${container} DefaultSizePts="55"/>`), context());
    for (const actual of [book, await readGnumeric(await writeGnumeric(book, [], context()), context())]) {
      expect(actual.sheets[0]!.view?.[view]).toBe(55);
      expect(actual.sheets[0]![property]?.find(axis => axis.index === 0)?.sizePoints).toBe(30);
    }
  });
}
