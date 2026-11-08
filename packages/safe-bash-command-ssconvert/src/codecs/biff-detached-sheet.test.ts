import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { readBiff } from "./biff.js";
import { writeBiffStream } from "./biff-write.js";
import { readBiffRecords } from "./biff-binary.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
for (const revision of [7, 8] as const) for (const formula of [
  "=Missing!A1+1", "=SUM(Missing!A1:B2)", "=SUM(Here:Missing!A1:B2)", "=SUM(Missing:Here!A1:B2)",
  "=IFERROR(Missing!A1,41)", "=Here!A2+1"
]) it(`exports BIFF${revision} missing-sheet references with their error semantics: ${formula}`, async () => {
  const book: Workbook = { sheets: [{ id: "Here", name: "Here", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 42 }, cachedResult: { kind: "number", value: 42 }, formula },
    { row: 1, column: 0, value: { kind: "number", value: 41 } }
  ] }] };
  const expected = formula.startsWith("=IFERROR") ? { kind: "number", value: 41 } : formula === "=Here!A2+1" ?
    { kind: "number", value: 42 } : { kind: "error", value: "#REF!" };
  let calls = 0;
  const host = { ...context, externalReferences: { resolve() { calls++; throw new Error("implicit host access"); } } };
  const before = recalculateWorkbook(book, host, true);
  expect(before.sheets[0]!.cells[0]!.value).toEqual(expected);
  const imported = await readBiff(await writeBiffStream(book, revision, false, host), host);
  expect(imported.sheets).toHaveLength(1);
  expect(imported.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 42 });
  expect(recalculateWorkbook(imported, host, true).sheets[0]!.cells[0]!.value).toEqual(expected);
  expect(calls).toBe(0);
});
it.each([7, 8] as const)("encodes BIFF%i deleted-sheet markers without inventing a worksheet", async revision => {
  const book: Workbook = { sheets: [{ id: "Here", name: "Here", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 42 }, formula: "=Missing!A1" }
  ] }] };
  const records = readBiffRecords(await writeBiffStream(book, revision, false, context), context);
  expect(records.filter(r => r.opcode === 0x85)).toHaveLength(1);
  if (revision === 8) {
    const xti = records.find(r => r.opcode === 0x17)!.data;
    expect([xti.u16(4), xti.u16(6)]).toEqual([0xffff, 0xffff]);
  } else {
    const cell = records.find(r => r.opcode === 6)!.data;
    expect(cell.u8(22)).toBe(0x5a);
    expect(cell.u16(23)).toBe(0xfffd); // negative link to the own-document placeholder
    expect([cell.u16(33), cell.u16(35)]).toEqual([0xffff, 0xffff]);
  }
});
it.each([7, 8] as const)("keeps BIFF%i missing references in definitions, array and shared formulas", async revision => {
  const book: Workbook = { names: [{ name: "Alias", expression: "=Missing!A1" }], sheets: [{ id: "Here", name: "Here", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 42 }, formula: "=Alias" },
    { row: 0, column: 1, value: { kind: "number", value: 42 }, formula: "=Missing!A1", formulaGroup: "a" },
    { row: 1, column: 1, value: { kind: "number", value: 42 }, formula: "=Missing!A1", formulaGroup: "s" },
    { row: 2, column: 1, value: { kind: "number", value: 42 }, formula: "=Missing!A2", formulaGroup: "s" }
  ], formulaGroups: [
    { id: "a", kind: "array", expression: "=Missing!A1", range: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 } },
    { id: "s", kind: "shared", expression: "=Missing!A1", range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 1 } }
  ] }] };
  const imported = await readBiff(await writeBiffStream(book, revision, false, context), context);
  expect(imported.sheets[0]!.formulaGroups?.[0]?.kind).toBe("array");
  expect(recalculateWorkbook(imported, context, true).sheets[0]!.cells.map(c => c.value)).toEqual([
    { kind: "error", value: "#REF!" }, { kind: "error", value: "#REF!" },
    { kind: "error", value: "#REF!" }, { kind: "error", value: "#REF!" }
  ]);
});
