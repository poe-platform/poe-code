import { expect, it } from "vitest";
import type { UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const record = (bytes: string, opcode = 0x225): UnsupportedRecord => ({ source: "biff",
  kind: opcode === 0x25 ? "DEFAULTROWHEIGHT_v0" : "DEFAULTROWHEIGHT_v2", disposition: "retained", data: { opcode, bytes } });
async function roundtrip(saved: UnsupportedRecord, height: number | null = 12.75) {
  const diagnostics: string[] = [];
  const context: CapabilityContext = { signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 },
    diagnostic: async diagnostic => { diagnostics.push(diagnostic.message); } };
  const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [],
    view: height === null ? {} : { defaultRowHeight: height }, unsupportedRecords: [saved] }] };
  const result = await readXlsx(await createXlsxWriter("2006")(book, [], context), context);
  return { diagnostics, height: result.sheets[0]!.view?.defaultRowHeight };
}
for (const [opcode, bytes] of [[0x25, "ff00"], [0x225, "0000ff00"]] as const) {
  it(`exports understood BIFF ${opcode} default height without a false loss warning`, async () => {
    expect(await roundtrip(record(bytes, opcode))).toEqual({ diagnostics: [], height: 12.75 });
  });
  it(`uses edited canonical BIFF ${opcode} height instead of replaying stale bytes`, async () => {
    expect(await roundtrip(record(bytes, opcode), 24)).toEqual({ diagnostics: [], height: 24 });
  });
}
for (const bytes of ["0100ff00", "0200ff00", "0400ff00", "0800ff00", "0080ff00", "00000000", "0000ff", "0000ff0000", "0000gg00"]) {
  it(`retains loss diagnostics for unrepresented or malformed row-height bytes ${bytes}`, async () => {
    expect((await roundtrip(record(bytes))).diagnostics).toContain("XLSX writer does not export sheet 'Data' record 'DEFAULTROWHEIGHT_v2'");
  });
}
it("does not infer preservation from a record name or a missing normalized height", async () => {
  for (const saved of [record("ff80", 0x25), { ...record("0000ff00"), source: "other" },
    { ...record("0000ff00"), data: { opcode: 0x25, bytes: "0000ff00" } }]) {
    expect((await roundtrip(saved)).diagnostics).toHaveLength(1);
  }
  const saved = record("0000ff00");
  // A canonical field is required even when the writer's fallback happens to match.
  const missing = await roundtrip(saved, null);
  expect(missing.diagnostics).toHaveLength(1);
});
