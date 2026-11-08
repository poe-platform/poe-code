import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readGnumeric } from "./gnumeric.js";
function input(unit: string | undefined): Uint8Array {
  const sections = ([['Rows', 'RowInfo'], ['Cols', 'ColInfo']] as const).map(([container, axis]) =>
    `<g:${container} DefaultSizePts="30"><g:${axis} No="2" Unit="40" HardSize="1" Hidden="1"/><g:${axis} No="3" Unit="30" Collapsed="1" OutlineLevel="2"/><g:${axis} No="2" Count="2"${unit === undefined ? '' : ` Unit="${unit}"`} Collapsed="1" OutlineLevel="7"/></g:${container}>`).join('');
  return new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name>${sections}</g:Sheet></g:Sheets></g:Workbook>`);
}
function context(messages: string[]): CapabilityContext {
  return { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 },
    async diagnostic(diagnostic) { messages.push(diagnostic.message); } };
}
it.each([undefined, 'garbage', '-1', '-2'])("ignores rejected axis size %s without overwriting metadata", async unit => {
  const messages: string[] = [];
  const book = await readGnumeric(input(unit), context(messages));
  for (const axes of [book.sheets[0]!.rows, book.sheets[0]!.columns]) {
    expect(axes?.map(({ style: _style, ...axis }) => axis)).toEqual([
      { index: 2, sizePoints: 40, hidden: true, collapsed: false, outlineLevel: 0 },
      { index: 3, sizePoints: 30, hidden: false, collapsed: true, outlineLevel: 2 }
    ]);
  }
  expect(messages).toEqual(Array(2).fill('File is most likely corrupted.\nThe problem was detected in xml_sax_colrow.\nThe failed check was: size > -1\n'));
});
it("still applies valid rejected-setter zero sizes and copies their flags", async () => {
  const messages: string[] = [];
  const book = await readGnumeric(input('0'), context(messages));
  for (const axes of [book.sheets[0]!.rows, book.sheets[0]!.columns]) {
    expect(axes?.map(({ style: _style, ...axis }) => axis)).toEqual([2, 3].map(index => ({ index, sizePoints: 40, hidden: false, collapsed: true, outlineLevel: 7 })));
  }
  expect(messages).toEqual([]);
});
it("keeps invalid-size intervals subject to resource admission", async () => {
  const ctx = context([]);
  await expect(readGnumeric(input(undefined), { ...ctx, limits: { ...ctx.limits, workbookNodes: 3 } })).rejects.toMatchObject({ code: "resource-limit" });
});
