import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
// Gnumeric value_get_as_gstring classifies standard errors; unknown errors use
// '#' and go_strescape. Native XLSX import retains that wire text verbatim.
const cases = [
  ["Python exception (<class 'AttributeError'>: 'float' object has no attribute 'split')", '#"Python exception (<class \'AttributeError\'>: \'float\' object has no attribute \'split\')"'],
  ['custom "quote" \\ path', '#"custom \\"quote\\" \\\\ path"'],
  ["é漢\nnext", '#"é漢\nnext"'],
  ["", '#""'],
  ["#VALUE!", "#VALUE!"],
  ["#DIV/0!", "#DIV/0!"],
  ["#REF!", "#REF!"],
  ["#NAME?", "#NAME?"],
  ["#NUM!", "#NUM!"],
  ["#N/A", "#N/A"],
  ["#NULL!", "#NULL!"]
] as const;
for (const edition of ["2006", "2008"] as const)
it.each(cases)(`writes native custom-error syntax in ${edition}: %s`, async (message, wire) => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "error", value: message } },
    { row: 1, column: 0, formula: "=PY_CAPWORDS(12.5)", value: { kind: "error", value: message } }
  ] }] };
  const before = structuredClone(book), bytes = await createXlsxWriter(edition)(book, [], context);
  const codec = createZipCodec(), archive = await codec.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(e => e.name === "xl/worksheets/sheet1.xml")!;
  let xml = ""; const decoder = new TextDecoder();
  for await (const chunk of codec.decodeZipEntry(entry, limits, context.signal)) xml += decoder.decode(chunk, { stream: true });
  xml += decoder.decode();
  const escaped = wire.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;");
  expect(xml.split(`<v>${escaped}</v>`)).toHaveLength(3);
  const imported = await readXlsx(bytes, context);
  expect(imported.sheets[0]!.cells.map(cell => cell.value)).toEqual([{ kind: "error", value: wire }, { kind: "error", value: wire }]);
  expect(book).toEqual(before);
});
