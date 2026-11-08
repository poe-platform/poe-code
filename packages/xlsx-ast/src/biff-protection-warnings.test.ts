import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { ImportedValue, UnsupportedRecord } from "@poe-code/spreadsheet-ast";
import { createXlsxWriter } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 100000 } };
async function warnings(record: UnsupportedRecord, view: Record<string, ImportedValue>) {
  const result: string[] = [];
  await createXlsxWriter("2006")({ sheets: [{ id: "s", name: "Data", cells: [], view, unsupportedRecords: [record] }] }, [],
    { ...context, diagnostic: async item => { result.push(item.message); } });
  return result;
}
for (const original of ["0000", "0100"]) it(`recognizes represented PROTECT=${original} including edits`, async () => {
  for (const Protected of ["0", "1"]) expect(await warnings({ source: "biff", kind: "PROTECT", disposition: "retained",
    data: { opcode: 0x12, bytes: original } }, { gnumeric: { Protected } })).toEqual([]);
});
for (const flags of ["0000", "ff7f", "0044"]) it(`recognizes represented SHEETPROTECTION=${flags} including edits`, async () => {
  for (const formatCells of [true, false]) expect(await warnings({ source: "biff", kind: "SHEETPROTECTION", disposition: "retained",
    data: { opcode: 0x867, bytes: "670800000000000000000000020001ffffffff" + flags + "0000" } }, { protectedAllow: { formatCells } })).toEqual([]);
});
it("retains malformed, unknown and unrepresented protection warnings", async () => {
  for (const bytes of ["", "00", "0200", "010000", "gggg"]) expect(await warnings({ source: "biff", kind: "PROTECT", disposition: "retained",
    data: { opcode: 0x12, bytes } }, { gnumeric: { Protected: "1" } })).toHaveLength(1);
  const canonical = "670800000000000000000000020001ffffffff00440000";
  for (const bytes of ["", canonical.slice(0, -2), canonical + "00", canonical.slice(0, 38) + "zzzz0000",
    canonical.slice(0, 40) + "800000", canonical.slice(0, -2) + "01", "00" + canonical.slice(2)]) {
    expect(await warnings({ source: "biff", kind: "SHEETPROTECTION", disposition: "retained", data: { opcode: 0x867, bytes } },
      { protectedAllow: { formatCells: true } })).toHaveLength(1);
  }
  for (const [kind, opcode, bytes] of [["PROTECT", 0x12, "0100"], ["SHEETPROTECTION", 0x867, canonical]] as const) {
    const record: UnsupportedRecord = { source: "biff", kind, disposition: "retained", data: { opcode, bytes } };
    expect(await warnings(record, {})).toHaveLength(1);
    expect(await warnings({ ...record, source: "other" }, { gnumeric: { Protected: "1" }, protectedAllow: {} })).toHaveLength(1);
    expect(await warnings({ ...record, data: { opcode: 0, bytes } }, { gnumeric: { Protected: "1" }, protectedAllow: {} })).toHaveLength(1);
  }
});
