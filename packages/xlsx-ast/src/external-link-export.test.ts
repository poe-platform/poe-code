import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { createXlsxWriter } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };

it.each(["2006", "2008"] as const)("exports external-reference relationships in XLSX %s", async edition => {
  const bytes = await createXlsxWriter(edition)({ sheets: [{ id: "Here", name: "Here", cells: [
    { row: 0, column: 0, formula: "=['linked.xls']Other!$A$1+1", value: { kind: "number", value: 999 } },
    { row: 0, column: 1, formula: "=SUM(['linked.xls']Other!$A$1:$B$2)", value: { kind: "number", value: 999 } }
  ] }] }, [], { ...context, externalReferences: { resolve() { throw new Error("Export must not fetch links"); } } });
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, limits, context.signal);
  const parts = new Map<string, string>();
  for (const entry of archive.entries) {
    let text = ""; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) text += new TextDecoder().decode(chunk);
    parts.set(entry.name, text);
  }
  expect(parts.get("xl/externalLinks/externalLink1.xml")).toContain('<sheetName val="Other"');
  expect(parts.get("xl/externalLinks/_rels/externalLink1.xml.rels")).toContain('Target="linked.xls"');
  expect(parts.get("xl/workbook.xml")).toContain("<externalReference ");
  expect(parts.get("xl/worksheets/sheet1.xml")).toContain("[1]");
});

it("warns when an external name has no exported definition", async () => {
  const warnings: string[] = [];
  await createXlsxWriter("2008")({ sheets: [{ id: "Here", name: "Here", cells: [
    { row: 0, column: 0, formula: "=['linked.xls']Rate+1", value: { kind: "number", value: 999 } }
  ] }] }, [], { ...context, diagnostic: async diagnostic => { warnings.push(diagnostic.message); } });
  expect(warnings).toContain("XLSX writer does not export definition for external name 'Rate' in 'linked.xls'");
});

it("does not create an external relationship for an explicit current-workbook reference", async () => {
  const bytes = await createXlsxWriter("2008")({ sheets: [{ id: "Here", name: "Here", cells: [
    { row: 0, column: 0, formula: "=[]Here!B1", value: { kind: "number", value: 999 } },
    { row: 0, column: 1, value: { kind: "number", value: 42 } }
  ] }] }, [], context);
  const archive = await createZipCodec().readZipArchive(bytes, limits, context.signal);
  expect(archive.entries.some(entry => entry.name.startsWith("xl/externalLinks/"))).toBe(false);
});
