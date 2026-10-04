import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { Binary, readBiffRecords, readCfb } from "./biff-binary.js";
import { readBiffMetadata } from "./biff-metadata.js";
import { createBiffWriter, readBiff } from "./biff.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
const names = ["objects", "scenarios", "formatCells", "formatColumns", "formatRows", "insertColumns", "insertRows",
  "insertHyperlinks", "deleteColumns", "deleteRows", "selectLockedCells", "sort", "autoFilter", "pivotTables", "selectUnlockedCells"];

it.each(names.map((name, bit) => ({ name, bit })))("imports and exports the independent $name permission bit", async ({ bit }) => {
  const bytes = new Uint8Array(23); new DataView(bytes.buffer).setUint16(19, 1 << bit, true);
  const result = readBiffMetadata([{ opcode: 0x867, offset: 0, data: new Binary(bytes) }], 8, 1252, context);
  const expected = Object.fromEntries(names.map((name, index) => [name, index === bit]));
  expect(result.view.protectedAllow).toEqual(expected);
  const book = { sheets: [{ id: "s", name: "Data", cells: [], view: { gnumeric: { Protected: "1" }, protectedAllow: expected } }] };
  const output = await createBiffWriter(8)(book, [], context);
  const stream = readCfb(output, context).get("Workbook")!;
  const record = readBiffRecords(stream, context).find(record => record.opcode === 0x867)!;
  expect(record.data.bytes.length).toBe(23);
  expect(record.data.u16(19)).toBe(1 << bit);
  expect(Buffer.from(record.data.bytes).toString("hex").slice(0, 38)).toBe("670800000000000000000000020001ffffffff");
});

it("retains native defaults for unspecified permission fields", async () => {
  const output = await createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells: [], view: { protectedAllow: { formatCells: true } } }] }, [], context);
  const record = readBiffRecords(readCfb(output, context).get("Workbook")!, context).find(record => record.opcode === 0x867)!;
  expect(record.data.u16(19)).toBe(0x4404);
});

it("reports the BIFF7 permission loss and rejects invalid permission values", async () => {
  const diagnostics: string[] = [];
  const book = { sheets: [{ id: "s", name: "Data", cells: [], view: { protectedAllow: { formatCells: true } } }] };
  await createBiffWriter(7)(book, [], { ...context, diagnostic: async item => { diagnostics.push(item.message); } });
  expect(diagnostics).toContain("Excel BIFF7 cannot preserve sheet protection permissions");
  for (const protectedAllow of [{ formatCells: "true" }, { unknownPermission: true }]) {
    await expect(createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells: [], view: { protectedAllow } }] }, [], context))
      .rejects.toThrow("sheet protection permission");
  }
});


it("recognizes canonical permission edits while retaining unknown record warnings", async () => {
  const original = await readBiff(await createBiffWriter(8)({ sheets: [{ id: "s", name: "Data", cells: [],
    view: { protectedAllow: { formatCells: true } } }] }, [], context), context);
  const sheet = original.sheets[0]!;
  for (const mutation of ["edit", "reserved", "invalid", "unknown-bit"]) {
    const records = sheet.unsupportedRecords!.map(record => {
      if (record.kind !== "SHEETPROTECTION" || mutation === "edit") return record;
      const data = record.data as { opcode: number; bytes: string };
      const bytes = mutation === "reserved" ? data.bytes.slice(0, -2) + "01" : mutation === "invalid"
        ? data.bytes.slice(0, 38) + "zzzz" + data.bytes.slice(42) : data.bytes.slice(0, 40) + "80" + data.bytes.slice(42);
      return { ...record, data: { ...data, bytes } };
    });
    const diagnostics: string[] = [];
    await createBiffWriter(8)({ ...original, sheets: [{ ...sheet, unsupportedRecords: records,
      view: { ...sheet.view, protectedAllow: { formatCells: false } } }] }, [], {
      ...context, diagnostic: async item => { diagnostics.push(item.message); }
    });
    expect(diagnostics.includes("Unsupported Excel BIFF export metadata: SHEETPROTECTION"), mutation).toBe(mutation !== "edit");
  }
});
