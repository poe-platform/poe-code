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

for (const edition of ["2006", "2008"] as const) it(`${edition} transports BIFF workbook protection flags and legacy verifier`, async () => {
  for (const bytes of ["", "ff", "0100", "0000", "0200"]) {
    const diagnostics: string[] = [];
    const records: UnsupportedRecord[] = ([["PROTECT", 0x12, bytes], ["WINDOWPROTECT", 0x19, "0100"], ["PASSWORD", 0x13, "3412"]] as const).map(([kind, opcode, value]) =>
      ({ source: "biff", kind: String(kind), disposition: "retained", data: { opcode, bytes: value } }));
    const output = await readXlsx(await createXlsxWriter(edition)({ sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: records }, [],
      { ...context, diagnostic: async item => { diagnostics.push(item.message); } }), context);
    const protection = output.unsupportedRecords?.find(item => item.kind === "workbookProtection");
    expect(metadataNode(protection?.data)?.attributes).toEqual({ lockStructure: bytes.length < 4 || bytes === "0100" ? "1" : "0", lockWindows: "1", workbookPassword: "1234" });
    expect(diagnostics).toEqual([]);
  }
});
it("retains malformed BIFF workbook protection warnings", async () => {
  const diagnostics: string[] = [];
  await createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: [
    { source: "biff", kind: "PROTECT", disposition: "retained", data: { opcode: 0x12, bytes: "zzzz" } },
    { source: "biff", kind: "PASSWORD", disposition: "retained", data: { opcode: 0x13, bytes: "000001" } }
  ] }, [], { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
  expect(diagnostics).toHaveLength(2);
});
it("uses later BIFF workbook records and clears a zero password verifier", async () => {
  const records: UnsupportedRecord[] = ["3412", "0000"].map(bytes => ({ source: "biff", kind: "PASSWORD", disposition: "retained", data: { opcode: 0x13, bytes } }));
  const output = await readXlsx(await createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: records }, [], context), context);
  expect(metadataNode(output.unsupportedRecords?.find(item => item.kind === "workbookProtection")?.data)?.attributes).toEqual({});
});
