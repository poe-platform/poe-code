import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { createXlsxStyles } from "./xlsx-write-styles.js";
import { createXlsxXml, metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { gnode } from "./xlsx-metadata.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 10000 } };
const input = (shade: number) => ({ sheets: [{ id: "s", name: "Data", cells: [{ row: 0, column: 0, value: { kind: "number" as const, value: 1 },
  style: { gnumeric: gnode("Style", { Shade: shade, Back: "FFFF:FFFF:0", PatternColor: "FFFF:0:0" }) } }] }] });
const expected = [...Array.from({ length: 19 }, (_, i) => i), 14, 7, 4, 4, 2, 1];
for (const edition of ["2006", "2008"] as const) for (const [shade, normalized] of expected.entries()) it(`exports XLSX${edition} shade${shade} with native fallback${normalized}`, async () => {
  const bytes = await createXlsxWriter(edition)(input(shade), [], context), book = await readXlsx(bytes, context);
  const style = metadataNode(book.sheets[0]!.cells[0]!.style!.gnumeric)!;
  expect(Number(style.attributes.Shade)).toBe(normalized);
});
for (const shade of [-1, 25, 26, 1.5, Infinity, NaN]) it(`rejects invalid XLSX fill shade${shade}`, async () => {
  await expect(createXlsxWriter("2008")(input(shade), [], context)).rejects.toThrow("fill pattern");
});

for (const [index, pattern] of ["lightVertical", "darkHorizontal", "lightGray", "lightGray", "darkGray", "solid"].entries()) it(`preserves differential fill fallback${index + 19}`, () => {
  const xml = createXlsxXml(context), styles = createXlsxStyles(xml.element, "2008", "http://schemas.openxmlformats.org/spreadsheetml/2006/main", xml.charge);
  styles.differential(metadataNode(gnode("Style", { Shade: index + 19, Back: "FFFF:FFFF:0" }))!);
  expect(styles.serialize()).toContain(`<dxf><fill><patternFill patternType="${pattern}"><fgColor rgb="FFFFFF00"/>`);
});
it("rejects invalid differential fill patterns", () => {
  const xml = createXlsxXml(context), styles = createXlsxStyles(xml.element, "2008", "http://schemas.openxmlformats.org/spreadsheetml/2006/main", xml.charge);
  styles.differential(metadataNode(gnode("Style", { Shade: 25 }))!);
  expect(() => styles.serialize()).toThrow("fill pattern");
});

it("preserves inactive fill colors for shade zero", async () => {
  const book = await readXlsx(await createXlsxWriter("2008")(input(0), [], context), context);
  const style = metadataNode(book.sheets[0]!.cells[0]!.style!.gnumeric)!;
  expect(style.attributes.Back).toBe("FFFF:FFFF:0");
  expect(style.attributes.PatternColor).toBe("FFFF:0:0");
});
