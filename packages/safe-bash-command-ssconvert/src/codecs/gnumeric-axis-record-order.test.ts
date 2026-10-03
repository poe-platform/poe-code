import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
const context = (): CapabilityContext => ({ signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } });
for (const [container, element, property] of [["Rows", "RowInfo", "rows"], ["Cols", "ColInfo", "columns"]] as const) {
  it.each([false, true])(`applies overlapping ${container} records in order (reverse: %s)`, async reverse => {
    const records = [`<g:${element} No="1" Count="3" Unit="20" HardSize="1" Hidden="1"/>`,
      `<g:${element} No="2" Count="2" Unit="30" Collapsed="1"/>`];
    if (reverse) records.reverse();
    const input = new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name><g:${container}>${records.join("")}</g:${container}></g:Sheet></g:Sheets></g:Workbook>`);
    const book = await readGnumeric(input, context());
    const expected = [1, 2, 3].map(index => ({ index, sizePoints: index === 1 || reverse ? 20 : 30,
      hidden: index === 1 || reverse, collapsed: index !== 1 && !reverse, outlineLevel: 0 }));
    for (const actual of [book, await readGnumeric(await writeGnumeric(book, [], context()), context())]) {
      expect(actual.sheets[0]![property]?.map(({ style: _style, ...axis }) => axis)).toEqual(expected);
      expect(actual.sheets[0]![property]).toHaveLength(3);
    }
  });
}
