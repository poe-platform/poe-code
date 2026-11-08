import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 10000 } };

it.each([7, 8, "dsf"] as const)("writes independently readable NAME scope fields for BIFF %s", async profile => {
  const bytes = await createBiffWriter(profile)({ names: [
    { name: "Rate", expression: "11" },
    { name: "Rate", sheet: "first", expression: "22" },
    { name: "Rate", sheet: "last", expression: "33" }
  ], sheets: [{ id: "first", name: "First", cells: [] }, { id: "last", name: "Last", cells: [] }] }, [], context);
  for (const [stream, input] of readCfb(bytes, context)) {
    const fields = [...readBiffRecords(input, context)].filter(record => record.opcode === 0x18)
      .map(record => [record.data.u16(6), record.data.u16(8)]);
    expect(fields, stream).toEqual(stream === "Book" ? [[0, 0], [0, 1], [1, 2]] : [[0, 0], [0, 1], [0, 2]]);
  }
});

// Literal BIFF5/7 vectors, independent of the writer. Offset 6 indexes the
// EXTERNSHEET table for legacy exports; a populated offset 8 is the
// authoritative worksheet scope, including Calc's zero-based offset 6.
function record(opcode: number, payload: number[]): number[] {
  return [opcode & 255, opcode >> 8, payload.length & 255, payload.length >> 8, ...payload];
}
it.each([
  { external: 0, tab: 1, expected: "First" },
  { external: 2, tab: 1, expected: "First" },
  { external: 1, tab: 1, expected: "First" },
  { external: 1, tab: 2, expected: "Last" },
  { external: 2, tab: 0, expected: "First" },
  { external: 0, tab: 0, expected: undefined },
  { external: 1, tab: 3, expected: null }
])("resolves independent legacy link and worksheet scope fields ($external/$tab)", async ({ external, tab, expected }) => {
  const bytes = new Uint8Array([
    ...record(0x809, [0, 5, 5, 0]),
    ...record(0x85, [0, 0, 0, 0, 0, 0, 5, 70, 105, 114, 115, 116]),
    ...record(0x85, [0, 0, 0, 0, 0, 0, 4, 76, 97, 115, 116]),
    ...record(0x17, [4, 3, 76, 97, 115, 116]),
    ...record(0x17, [5, 3, 70, 105, 114, 115, 116]),
    ...record(0x18, [0, 0, 0, 4, 3, 0, external, 0, tab, 0, 0, 0, 0, 0, 82, 97, 116, 101, 0x1e, 7, 0]),
    ...record(10, []), ...record(0x809, [0, 5, 16, 0]), ...record(10, []),
    ...record(0x809, [0, 5, 16, 0]), ...record(10, [])
  ]);
  const records = [...readBiffRecords(bytes, context)];
  const sheets = records.filter(record => record.opcode === 0x809).slice(1);
  records.filter(record => record.opcode === 0x85).forEach((record, index) =>
    new DataView(bytes.buffer).setUint32(record.offset + 4, sheets[index]!.offset, true));
  if (expected === null) {
    await expect(readBiff(bytes, context)).rejects.toThrow("invalid name sheet scope");
    return;
  }
  const book = await readBiff(bytes, context);
  expect(book.names?.find(name => name.name === "Rate")?.sheet).toBe(expected);
});

it("uses indexed internal names for qualified BIFF7 references", async () => {
  const bytes = await createBiffWriter(7)({ names: [
    { name: "Rate", expression: "11" }, { name: "Rate", sheet: "last", expression: "33" }
  ], sheets: [{ id: "first", name: "First", cells: [
    { row: 0, column: 0, formula: "=Last!Rate", value: { kind: "number", value: 999 } }
  ] }, { id: "last", name: "Last", cells: [] }] }, [], context);
  const input = readCfb(bytes, context).get("Book")!;
  const formula = [...readBiffRecords(input, context)].find(record => record.opcode === 6)!;
  expect(formula.data.u16(20)).toBe(15);
  expect(Array.from(formula.data.slice(22, 15))).toEqual([0x43, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const reopened = await readBiff(bytes, context);
  expect(reopened.sheets[0]!.cells[0]!.formula).toBe("='Last'!Rate");
});


it.each([7, 8, "dsf"] as const)("retains local array aliases and duplicate identity in BIFF %s", async profile => {
  const bytes = await createBiffWriter(profile)({ names: [
    { name: "ArrayName", expression: "{1,2;3,4}" },
    { name: "ArrayName", sheet: "first", expression: "{2,3;4,5}" },
    { name: "AliasArray", sheet: "first", expression: "ArrayName" },
    { name: "ArrayName", sheet: "last", expression: "{5,6;7,8}" },
    { name: "AliasArray", sheet: "last", expression: "ArrayName" }
  ], sheets: [{ id: "first", name: "First", cells: [
    "=SUM(AliasArray)", "=SUM(Last!AliasArray)", "=SUM([]ArrayName)"
  ].map((formula, row) => ({ row, column: 0, formula, value: { kind: "number", value: 999 } })) },
  { id: "last", name: "Last", cells: [] }] }, [], context);
  for (const [stream, input] of readCfb(bytes, context)) {
    const book = await readBiff(input, context);
    expect(book.names?.filter(name => name.name === "AliasArray").map(name => name.sheet), stream).toEqual(["First", "Last"]);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value), stream)
      .toEqual([14, 26, 10].map(value => ({ kind: "number", value })));
  }
});
