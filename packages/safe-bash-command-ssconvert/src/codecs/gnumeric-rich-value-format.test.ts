import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { renderCellText } from "../formatting/cell-text.js";
import { cellValueFormat } from "../workbook/value-format.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 1000 } };
async function source(format: string) {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Cells>` +
    `<g:Cell Row="0" Col="0" ValueType="60" ValueFormat="${format}">é😀</g:Cell>` +
    '<g:Cell Row="0" Col="1" ValueType="40" ValueFormat="0.00">2.5</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>'), context);
}

it("keeps numeric value precedence and unparsed metadata fallback", () => {
  const style = { gnumericValueFormat: "@[bold=1:0:6]" };
  const richText = [{ start: 0, end: 6, attributes: { bold: 1 } }];
  expect(cellValueFormat({ style, richText, value: { kind: "number", value: 2.5, format: "0.00" } })).toBe("0.00");
  expect(cellValueFormat({ style })).toBe(style.gnumericValueFormat);
  expect(cellValueFormat({ style, richText })).toBeUndefined();
});

// go_format_new_from_XL dispatches @[...] to GO_FMT_MARKUP, not number formats.
for (const format of ["@[bold=1:0:6]", "@[family=Font]Name:0:6]"]) {
  it(`renders rich ValueFormat ${format} while retaining ordinary number-format fallback`, async () => {
    const book = await source(format), cells = book.sheets[0]!.cells, before = structuredClone(book);
    await expect(renderCellText(cells[0]!, book, context, "preserve")).resolves.toBe("é😀");
    await expect(renderCellText(cells[1]!, book, context, "preserve")).resolves.toBe("2.50");
    expect(new TextDecoder().decode(await writeGnumeric(book, [], context))).toContain(`ValueFormat="${format}"`);
    expect(book).toEqual(before);
  });

  for (const profile of ["strict", "extended"] as const) it(`exports rich ValueFormat ${format} through ${profile} ODF`, async () => {
    const book = await source(format), output = await createOdfWriter(profile)(book, [], context);
    const read = await readOdf(output, context);
    expect(read.sheets[0]!.cells[0]!.richText).toEqual(book.sheets[0]!.cells[0]!.richText);
    expect(read.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "é😀" });
  });

  for (const edition of ["2006", "2008"] as const) it(`does not turn rich ValueFormat ${format} into an XLSX ${edition} number format`, async () => {
    const book = await source(format), read = await readXlsx(await createXlsxWriter(edition)(book, [], context), context);
    expect(read.sheets[0]!.cells[0]!.format ?? "General").toBe("General");
    expect(read.sheets[0]!.cells[0]!.richText).toEqual(book.sheets[0]!.cells[0]!.richText);
  });
}
