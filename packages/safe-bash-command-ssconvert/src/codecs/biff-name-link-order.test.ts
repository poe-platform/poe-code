import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 8, operations: 10000 } };

it.each([8, "dsf"] as const)("declares BIFF %s links before names need them during sequential native import", async profile => {
  const book: Workbook = { names: [
    { name: "Inner", expression: "5" },
    { name: "Inner", expression: "3", sheet: "data" },
    { name: "Outer", expression: "Inner", sheet: "data" },
    { name: "Location", expression: "Data!$A$1" }
  ], sheets: [
    { id: "here", name: "Here", cells: [
      { row: 0, column: 0, formula: "=Data!Outer", value: { kind: "number", value: 99 } },
      { row: 1, column: 0, formula: "=Location", value: { kind: "number", value: 99 } },
      { row: 2, column: 0, formula: "=ACOT(1)", value: { kind: "number", value: 99 } }
    ] }, { id: "data", name: "Data", cells: [{ row: 0, column: 0, value: { kind: "number", value: 17 } }] }
  ] };
  const bytes = await createBiffWriter(profile)(book, [], context);
  const records = readBiffRecords(readCfb(bytes, context).get("Workbook")!, context);
  const firstName = records.findIndex(record => record.opcode === 0x18);
  const externSheet = records.findIndex(record => record.opcode === 0x17);
  const supbooks = records.flatMap((record, index) => record.opcode === 0x1ae ? [index] : []);
  expect(firstName).toBeGreaterThan(0);
  expect(externSheet).toBeGreaterThan(Math.max(...supbooks));
  expect(externSheet).toBeLessThan(firstName);
  expect(supbooks).toHaveLength(2);
  const links = records[externSheet]!.data;
  expect(links.u16(0)).toBe(2);
  expect([links.u16(2), links.u16(4), links.u16(6)]).toEqual([0, 0xfffe, 0xfffe]);
  expect([links.u16(8), links.u16(10), links.u16(12)]).toEqual([1, 1, 1]);
  for (const input of readCfb(bytes, context).values()) {
    const calculated = recalculateWorkbook(await readBiff(input, context), context, true);
    expect(calculated.sheets[0]!.cells.slice(0, 2).map(cell => cell.value)).toEqual([3, 17].map(value => ({ kind: "number", value })));
    expect(calculated.sheets[0]!.cells[2]!.value).toEqual({ kind: "number", value: Math.PI / 4 });
  }
});
