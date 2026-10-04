import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 100000 } };
const attributes = { workbookPassword: "1234", workbookPasswordCharacterSet: "UTF-8", revisionsPassword: "ABCD", revisionsPasswordCharacterSet: "UTF-8",
  lockStructure: "1", lockWindows: "0", lockRevision: "true", workbookAlgorithmName: "SHA-512", workbookHashValue: "AQIDBA==", workbookSaltValue: "BQYHCA==",
  workbookSpinCount: "100000", revisionsAlgorithmName: "SHA-256", revisionsHashValue: "AQIDBA==", revisionsSaltValue: "BQYHCA==", revisionsSpinCount: "20000" };
const record: UnsupportedRecord = { source: "xl/workbook.xml", kind: "workbookProtection", disposition: "retained",
  data: { name: "workbookProtection", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes, children: [], text: "" } };
for (const edition of ["2006", "2008"] as const) it(`${edition} retains editable workbook protection metadata without loss warnings`, async () => {
  const diagnostics: string[] = [];
  const ctx = { ...context, diagnostic: async (item: { message: string }) => { diagnostics.push(item.message); } };
  const input: Workbook = { sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: [record] };
  const imported = await readXlsx(await createXlsxWriter(edition)(input, [], ctx), ctx);
  expect(diagnostics).toEqual([]);
  const retained = imported.unsupportedRecords!.find(item => item.kind === "workbookProtection")!;
  expect(metadataNode(retained.data)?.attributes).toEqual(attributes);
  const edited = { ...imported, unsupportedRecords: imported.unsupportedRecords!.map(item => item === retained ? { ...item,
    data: { name: "workbookProtection", namespace: metadataNode(item.data)!.namespace, children: [], text: "", attributes: { ...attributes, lockStructure: "0", workbookPassword: "FFFF" } } } : item) };
  const output = await readXlsx(await createXlsxWriter(edition)(edited, [], ctx), ctx);
  expect(metadataNode(output.unsupportedRecords!.find(item => item.kind === "workbookProtection")!.data)?.attributes)
    .toEqual({ ...attributes, lockStructure: "0", workbookPassword: "FFFF" });
  expect(diagnostics).toEqual([]);
});
it("keeps warnings for unrepresented workbook protection fields and duplicate records", async () => {
  for (const mutation of ["attribute", "child", "namespace", "duplicate"]) {
    const data = metadataNode(record.data)!;
    const changed: UnsupportedRecord = { ...record, data: { name: data.name, namespace: data.namespace, attributes: data.attributes, text: data.text, children: [], ...(mutation === "attribute" ? { attributes: { ...attributes, futureFlag: "1" } } : {}),
      ...(mutation === "namespace" ? { namespace: "urn:other" } : {}), ...(mutation === "child" ? { children: [{ name: "future", namespace: data.namespace, attributes: {}, text: "", children: [] }] } : {}) } };
    const diagnostics: string[] = [];
    await createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: mutation === "duplicate" ? [record, changed] : [changed] }, [],
      { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
    expect(diagnostics, mutation).toHaveLength(1);
  }
});
