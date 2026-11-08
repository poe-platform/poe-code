import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { UnsupportedRecord } from "@poe-code/spreadsheet-ast";
import { createBiffWriter, readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
const definitions = [["WINDOWPROTECT", 0x19], ["PROTECT", 0x12], ["PASSWORD", 0x13]] as const;
const record = (kind: string, opcode: number, bytes: string): UnsupportedRecord => ({ source: "biff", kind, disposition: "retained", data: { opcode, bytes } });
for (const [kind, opcode] of definitions) for (const revision of [7, 8] as const) {
  it(`preserves editable workbook ${kind} in BIFF${revision}`, async () => {
    for (const bytes of ["0100", "3412", "FFFF"]) {
      const diagnostics: string[] = [];
      const book = await readBiff(await createBiffWriter(revision)({ sheets: [{ id: "s", name: "Data", cells: [] }],
        unsupportedRecords: [record(kind, opcode, bytes)] }, [], { ...context, diagnostic: async item => { diagnostics.push(item.message); } }), context);
      expect(book.unsupportedRecords!.find(r => r.kind === kind)?.data).toMatchObject({ opcode, bytes: bytes.toLowerCase() });
      expect(diagnostics).toEqual([]);
      const edited = { ...book, unsupportedRecords: book.unsupportedRecords!.map(r => r.kind === kind ? record(kind, opcode, "0000") : r) };
      const output = await readBiff(await createBiffWriter(revision)(edited, [], context), context);
      expect(output.unsupportedRecords!.find(r => r.kind === kind)?.data).toMatchObject({ opcode, bytes: "0000" });
    }
  });
}
it("retains native presence-only PROTECT and applies later record edits", async () => {
  for (const bytes of ["", "ff"]) {
    const input = { sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: [record("PROTECT", 0x12, "0000"), record("PROTECT", 0x12, bytes)] };
    const diagnostics: string[] = [];
    const output = await readBiff(await createBiffWriter(8)(input, [], { ...context, diagnostic: async item => { diagnostics.push(item.message); } }), context);
    expect(output.unsupportedRecords!.find(r => r.kind === "PROTECT")?.data).toMatchObject({ opcode: 0x12, bytes });
    expect(diagnostics).toEqual([]);
  }
});
it("keeps malformed workbook protection warnings and does not reuse sheet settings", async () => {
  for (const [kind, opcode] of definitions) for (const bytes of ["0", "zzzz", "010000"]) {
    const diagnostics: string[] = [];
    const output = await readBiff(await createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells: [],
      view: { gnumeric: { Protected: "1" }, protectedPasswordHash: 65535 } }], unsupportedRecords: [record(kind, opcode, bytes)] }, [],
    { ...context, diagnostic: async item => { diagnostics.push(item.message); } }), context);
    expect(output.unsupportedRecords!.find(r => r.kind === kind)?.data).toMatchObject({ opcode, bytes: "0000" });
    expect(diagnostics).toContain("Unsupported Excel BIFF export metadata: " + kind);
  }
});

for (const revision of [7, 8] as const) it(`transports XLSX workbook protection into BIFF${revision}`, async () => {
  for (const password of ["1", "1234", "ffff", "0000"]) {
    const diagnostics: string[] = [];
    const input = { sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: [{ source: "xl/workbook.xml", kind: "workbookProtection", disposition: "retained" as const,
      data: { name: "workbookProtection", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes: { lockStructure: "true", lockWindows: "1", workbookPassword: password }, children: [], text: "" } }] };
    const output = await readBiff(await createBiffWriter(revision)(input, [], { ...context, diagnostic: async item => { diagnostics.push(item.message); } }), context);
    const hash = Number.parseInt(password, 16), expected = ["0100", "0100", (hash & 255).toString(16).padStart(2, "0") + (hash >> 8).toString(16).padStart(2, "0")];
    for (const [index, [kind, opcode]] of definitions.entries()) expect(output.unsupportedRecords!.find(r => r.kind === kind)?.data).toMatchObject({ opcode, bytes: expected[index] });
    expect(diagnostics).toEqual([]);
  }
});
it("keeps warnings for modern or malformed XLSX workbook protection", async () => {
  for (const attributes of [{ workbookAlgorithmName: "SHA-512" }, { workbookPassword: "garbage" }, { lockStructure: "yes" }, { lockRevision: "true" }] as readonly Record<string, string>[]) {
    const diagnostics: string[] = [];
    await createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells: [] }], unsupportedRecords: [{ source: "xl/workbook.xml", kind: "workbookProtection", disposition: "retained",
      data: { name: "workbookProtection", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main", attributes, children: [], text: "" } }] }, [],
      { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
    expect(diagnostics).toContain("Unsupported Excel BIFF export metadata: workbookProtection");
  }
});
