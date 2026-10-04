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
