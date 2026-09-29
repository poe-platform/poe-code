import { expect, it } from "vitest";
import { createBiffWriter, readBiff } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { BiffOutput } from "./biff-write-binary.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10000, sheets: 256, operations: 10000 } };

it("continues a 256-sheet BIFF7 INDEX without oversized physical records", async () => {
  const book: Workbook = { sheets: Array.from({ length: 256 }, (_, index) => ({ id: `s${index}`, name: `S${index + 1}`,
    cells: index === 128 ? [{ row: 0, column: 0, formula: "=INDEX(S1:S256!A1:B2,2,2,256)",
      value: { kind: "number", value: 999 } }] : index === 255 ? [{ row: 1, column: 1, value: { kind: "number", value: 20 } }] : [] })) };
  const bytes = await createBiffWriter(7)(book, [], context);
  const records = readBiffRecords(readCfb(bytes, context).get("Book")!, context);
  const formula = records.findIndex(record => record.opcode === 6);
  expect(records[formula]!.data.u16(20)).toBeGreaterThan(2080);
  expect(records[formula + 1]!.opcode).toBe(0x3c);
  expect(records.every(record => record.data.bytes.length <= 2080)).toBe(true);
  const reopened = await readBiff(bytes, context);
  expect(recalculateWorkbook(reopened, context, true).sheets[128]!.cells[0]!.value).toEqual({ kind: "number", value: 20 });
});

it.each([
  ['=LEN("é€")', { kind: "number", value: 999 }, { kind: "number", value: 2 }],
  ['="é€"', { kind: "string", value: "old" }, { kind: "string", value: "é€" }]
] as const)("reads formula tokens split inside a UTF-16 literal: %s", async (formula, cached, expected) => {
  const bytes = await createBiffWriter(8)({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula, value: cached }
  ] }] }, [], context);
  const records = readBiffRecords(readCfb(bytes, context).get("Workbook")!, context);
  const raw: number[] = [];
  const append = (opcode: number, data: Uint8Array) => raw.push(opcode & 255, opcode >>> 8, data.length & 255, data.length >>> 8, ...data);
  for (const record of records) {
    if (record.opcode === 6) {
      // 22-byte FORMULA header, tStr + length + Unicode flag, one byte of é.
      append(6, record.data.bytes.subarray(0, 26));
      append(0x3c, record.data.bytes.subarray(26));
    } else append(record.opcode, record.data.bytes);
  }
  const book = await readBiff(Uint8Array.from(raw), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe(formula);
  expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual(cached);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual(expected);
});

it.each([{ outputBytes: 20 }, { workbookNodes: 2 }])("charges every continuation record against quotas: %j", limits => {
  const output = new BiffOutput({ ...context, limits: { ...context.limits, ...limits } }, 4);
  expect(() => output.continuedRecord(6, new Uint8Array(9))).toThrowError(expect.objectContaining({ code: "resource-limit" }));
});

it.each([7, 8] as const)("keeps inline string tokens inside BIFF%i physical records", async revision => {
  const bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: `=LEN("${"é€".repeat(3000)}")`, value: { kind: "number", value: 999 } }
  ] }] }, [], context);
  const records = readBiffRecords(readCfb(bytes, context).get(revision === 7 ? "Book" : "Workbook")!, context);
  let index = records.findIndex(record => record.opcode === 6), first = true;
  do {
    const data = records[index++]!.data;
    let offset = first ? 22 : 0; first = false;
    while (offset < data.bytes.length) {
      const opcode = data.u8(offset++);
      if (opcode === 23) {
        const count = data.u8(offset++), width = revision === 8 ? data.u8(offset++) & 1 ? 2 : 1 : 1;
        offset += count * width;
      } else if (opcode === 0x41) offset += 2;
      else expect([8, 21]).toContain(opcode);
      expect(offset).toBeLessThanOrEqual(data.bytes.length);
    }
  } while (records[index]?.opcode === 0x3c);
  const reopened = await readBiff(bytes, context);
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 6000 });
});

it.each([7, 8] as const)("rejects BIFF%i token lengths that cannot fit the 16-bit formula header", async revision => {
  await expect(createBiffWriter(revision)({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula: `=LEN("${"a".repeat(70000)}")`, value: { kind: "number", value: 999 } }
  ] }] }, [], context)).rejects.toThrow("formula token length");
});

for (const revision of [7, 8] as const) {
  it.each([
    [`=SUM({${Array.from({ length: 32 }, () => Array<number>(32).fill(1).join(",")).join(";")}})`, 1024],
    [`=COUNTA({${Array.from({ length: 16 }, () => Array<string>(16).fill(`"${"é€".repeat(20)}"`).join(",")).join(";")}})`, 256],
    [`=SUM({${Array.from({ length: 4 }, () => Array<number>(256).fill(2).join(",")).join(";")}})+SUM({${Array.from({ length: 4 }, () => Array<number>(256).fill(3).join(",")).join(";")}})`, 5120]
  ])(`continues BIFF${revision} auxiliary arrays with native element boundaries (%#)`, async (formula, expected) => {
    const bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "S", cells: [
      { row: 0, column: 0, formula, value: { kind: "number", value: 999 } }
    ] }] }, [], context);
    const records = readBiffRecords(readCfb(bytes, context).get(revision === 7 ? "Book" : "Workbook")!, context);
    expect(records.some(record => record.opcode === 0x3c)).toBe(true);
    expect(records.every(record => record.data.bytes.length <= (revision === 7 ? 2080 : 8224))).toBe(true);
    const reopened = await readBiff(bytes, context);
    expect(reopened.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 999 });
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
  });
}

for (const revision of [7, 8] as const) for (const scope of [undefined, "s"]) {
  it.each([
    [`=LEN("${"é€".repeat(3000)}")`, 6000],
    [`=SUM({${Array.from({ length: 32 }, () => Array<number>(32).fill(1).join(",")).join(";")}})`, 1024]
  ])(`continues BIFF${revision} named expressions (${scope ?? "global"}, %#)`, async (expression, expected) => {
    const bytes = await createBiffWriter(revision)({
      names: [{ name: "Alias", expression: "=Wide", ...(scope ? { sheet: scope } : {}) },
        { name: "Wide", expression, ...(scope ? { sheet: scope } : {}) }],
      sheets: [{ id: "s", name: "S", cells: [
        { row: 0, column: 0, formula: "=Alias", value: { kind: "number", value: 999 } }
      ] }]
    }, [], context);
    const reopened = await readBiff(bytes, context);
    expect(reopened.sheets[0]!.cells[0]!.formula).toContain("Alias");
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: expected });
    const edited = { ...reopened, names: reopened.names!.map(name => name.name === "Wide" ? { ...name, expression: "=7" } : name) };
    expect(recalculateWorkbook(edited, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  });
}

for (const revision of [7, 8] as const) {
  it.each([
    [`=LEN("${"é€".repeat(3000)}")`, 6000],
    [`=SUM({${Array.from({ length: 32 }, () => Array<number>(32).fill(1).join(",")).join(";")}})`, 1024]
  ])(`continues BIFF${revision} ARRAY-group tokens and auxiliary values (%#)`, async (expression, expected) => {
    const bytes = await createBiffWriter(revision)({ sheets: [{ id: "s", name: "S",
      formulaGroups: [{ id: "a", kind: "array", expression,
        range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 } }],
      cells: [0, 1].map(row => ({ row, column: 0, formula: expression, formulaGroup: "a", value: { kind: "number", value: 999 } }))
    }] }, [], context);
    const reopened = await readBiff(bytes, context);
    expect(reopened.sheets[0]!.formulaGroups).toHaveLength(1);
    expect(reopened.sheets[0]!.formulaGroups![0]).toMatchObject({ kind: "array",
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 } });
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(cell => cell.value))
      .toEqual([0, 1].map(() => ({ kind: "number", value: expected })));
  });
}
