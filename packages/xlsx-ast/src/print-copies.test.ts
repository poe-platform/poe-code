import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { gnode, readXlsxMetadata } from "./xlsx-metadata.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 100000 } };
for (const copies of [0, 1, 2, 65535, 0xffffffff]) it(`imports and edits ${copies} XLSX print copies`, async () => {
  const records = readXlsxMetadata({ name: "worksheet", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: {}, text: "", children: [
    { name: "pageSetup", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: { copies: String(copies) }, text: "", children: [] }] });
  expect(metadataNode(records[0]!.data)!.children.find(node => node.name === "copies")?.attributes.value).toBe(String(copies));
  for (const edition of ["2006", "2008"] as const) {
    const input = { sheets: [{ id: "s", name: "Data", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained" as const, data: gnode("PrintInformation", {}, [gnode("copies", { value: copies })]) }] }] };
    const output = await readXlsx(await createXlsxWriter(edition)(input, [], context), context);
    const print = metadataNode(output.sheets[0]!.unsupportedRecords!.find(record => record.kind === "PrintInformation")!.data)!;
    expect(print.children.find(node => node.name === "copies")?.attributes.value).toBe(String(copies));
    const next = copies === 0xffffffff ? 0 : copies + 1;
    const edited = { ...output, sheets: output.sheets.map(sheet => ({ ...sheet, unsupportedRecords: sheet.unsupportedRecords!.map(record => record.kind === "PrintInformation" ? {
      ...record, data: gnode("PrintInformation", {}, [gnode("copies", { value: next })])
    } : record) })) };
    const reopened = await readXlsx(await createXlsxWriter(edition)(edited, [], context), context);
    const changed = metadataNode(reopened.sheets[0]!.unsupportedRecords!.find(record => record.kind === "PrintInformation")!.data)!;
    expect(changed.children.find(node => node.name === "copies")?.attributes.value).toBe(String(next));
  }
});
