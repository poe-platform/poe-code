import { expect, it } from "vitest";
import type { ImportedValue, UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import { createXlsxWriter } from "./xlsx.js";
import { gnode } from "./xlsx-metadata.js";
const flags = [["PRINTHEADERS", 0x2a, "titles", "headings"], ["PRINTGRIDLINES", 0x2b, "grid", "gridLines"],
  ["HCENTER", 0x83, "hcenter", "horizontalCentered"], ["VCENTER", 0x84, "vcenter", "verticalCentered"]] as const;
async function exportFlag(record: UnsupportedRecord, field: string, value: number | null) {
  const diagnostics: string[] = [];
  const context: CapabilityContext = { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 },
    diagnostic: async diagnostic => { diagnostics.push(diagnostic.message); } };
  const normalized: ImportedValue[] = value === null ? [] : [gnode(field, { value })];
  const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [record,
    { source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained", data: gnode("PrintInformation", {}, normalized) }] }] };
  const bytes = await createXlsxWriter("2006")(book, [], context), zip = createZipCodec();
  const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
  const archive = await zip.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/worksheets/sheet1.xml")!;
  let xml = ""; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += new TextDecoder().decode(chunk);
  return { diagnostics, xml };
}
for (const [kind, opcode, field, attribute] of flags) {
  for (const value of [0, 1]) it(`exports ${kind}=${value} without a false loss warning and permits canonical edits`, async () => {
    const record: UnsupportedRecord = { source: "biff", kind, disposition: "retained", data: { opcode, bytes: value ? "0100" : "0000" } };
    for (const current of [value, 1 - value]) {
      const result = await exportFlag(record, field, current);
      expect(result.diagnostics).toEqual([]);
      expect(result.xml.includes(`${attribute}="1"`)).toBe(current === 1);
    }
  });
  it(`keeps ${kind} warnings for malformed, unknown or unrepresented records`, async () => {
    for (const bytes of ["0200", "00", "000000", "gg00"]) {
      expect((await exportFlag({ source: "biff", kind, disposition: "retained", data: { opcode, bytes } }, field, 0)).diagnostics).toHaveLength(1);
    }
    for (const [source, code, value] of [["other", opcode, 0], ["biff", 0, 0], ["biff", opcode, null]] as const) {
      expect((await exportFlag({ source, kind, disposition: "retained", data: { opcode: code, bytes: "0000" } }, field, value)).diagnostics).toHaveLength(1);
    }
  });
}
