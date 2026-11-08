import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { createXlsxWriter } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };

// ECMA-376 sml.xsd uses ST_Formula (derived from ST_Xstring) for
// validation formula1/formula2 and conditional-format formula elements.
for (const edition of ["2006", "2008"] as const)
it.each([
  ['A\0\x01\ufffe\ud800Z', 'A_x0000__x0001__xFFFE__xD800_Z'],
  ['_x0000_', '_x005F_x0000_'],
  ['_x005F_x0000_', '_x005F_x005F_x005F_x0000_'],
  ['é😀&<\r', 'é😀&amp;&lt;&#13;'],
])(`encodes validation and conditional formula strings in ${edition}: %s`, async (value, wire) => {
  const expression = { name: "Expression0", text: `="${value}"`, attributes: {}, children: [] };
  const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [{
    source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: {
      name: "Styles", attributes: {}, children: [{ name: "StyleRegion",
        attributes: { startRow: "0", endRow: "0", startCol: "0", endCol: "0" }, children: [{ name: "Style", attributes: {}, children: [
          { name: "Validation", attributes: { Type: "GNM_VALIDATION_TYPE_CUSTOM" }, children: [expression, { ...expression, name: "Expression1" }] },
          { name: "Condition", attributes: { Operator: "0" }, children: [expression, { ...expression, name: "Expression1" }, { name: "Style", attributes: { Back: "FFFF:0000:0000", Shade: "1" }, children: [] }] }
        ] }] }]
    }
  }] }] };
  const before = structuredClone(book);
  const bytes = await createXlsxWriter(edition)(book, [], context);
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/worksheets/sheet1.xml")!;
  let xml = ""; const decoder = new TextDecoder();
  for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += decoder.decode(chunk, { stream: true });
  xml += decoder.decode();
  expect(xml).toContain(`<formula1>&quot;${wire}&quot;</formula1><formula2>&quot;${wire}&quot;</formula2>`);
  expect(xml).toContain(`<formula>&quot;${wire}&quot;</formula><formula>&quot;${wire}&quot;</formula>`);
  expect(book).toEqual(before);
});
