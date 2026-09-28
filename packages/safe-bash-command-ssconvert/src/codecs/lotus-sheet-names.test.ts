import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readLotus } from "./lotus.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 1000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
const sheetName = (index: number, bytes: number[]) => record(0x23, [0xb0, 0x36, ...word(index), ...bytes]);
const file = (version: number, ...records: number[][]) => Uint8Array.from([
  ...record(0, [...word(version), 4, 0, ...Array<number>(22).fill(0)]), ...records.flat(), ...record(1)
]);

// LibreOffice bce0998a OP_SheetName123 reads the indexed, bounded C string.
// libwps 0.4.14 readSheetName uses the default Windows Western encoding.
it.each([0x1003, 0x1004, 0x1005])("imports indexed .123 sheet names for version %x", async version => {
  const book = await readLotus(file(version, sheetName(1, [67, 97, 102, 0xe9, 0]), sheetName(0, [0x80, 0])), context);
  expect(book.sheets.map(sheet => sheet.name)).toEqual(["€", "Café"]);
  expect(book.sheets.map(sheet => sheet.cells)).toEqual([[], []]);
});

it("uses the final sheet name in an earlier direct formula and named range", async () => {
  const name = record(9, [0, 0, 78, ...Array<number>(15).fill(0), 0, 0, 1, 0, 0, 0, 1, 0]);
  const formula = record(40, [0, 0, 0, 1, ...Array<number>(8).fill(0), 1, 0, 0, 0, 1, 0, 3]);
  const book = await readLotus(file(0x1003, name, formula, record(39, [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 38, 64]), sheetName(1, [79, 39, 66, 0])), context);
  expect(book.sheets[1]!.name).toBe("O'B");
  expect(book.names).toEqual([{ name: "N", expression: "='O\\'B'!$A$1" }]);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("='O\\'B'!$A$1");
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 11 });
});

it("keeps bounded unterminated names, stops at NUL and ignores empty replacements", async () => {
  const book = await readLotus(file(0x1003, sheetName(0, [65]), sheetName(1, [66, 0, 67]), sheetName(1, [0])), context);
  expect(book.sheets.map(sheet => sheet.name)).toEqual(["A", "B"]);
});

it("does not truncate the sheet index to its low byte", async () => {
  await expect(readLotus(file(0x1003, sheetName(256, [65, 0])), context)).rejects.toThrow("sheets limit exceeded");
});

it("charges duplicate sheet-name records before replacing the name", async () => {
  await expect(readLotus(file(0x1003, sheetName(0, [65]), sheetName(0, [66])),
    { ...context, limits: { ...context.limits, operations: 1 } })).rejects.toThrow("operations limit exceeded");
});

it("warns on truncated name headers without losing neighboring sheets", async () => {
  const warnings: string[] = [];
  const book = await readLotus(file(0x1003, record(0x23, [0xb0, 0x36, 0, 0]), sheetName(0, [65])),
    { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toEqual(["Record with type 0x23 has wrong length 4."]);
  expect(book.sheets[0]!.name).toBe("A");
});

it("preserves cancellation from a malformed sheet-name diagnostic", async () => {
  const controller = new AbortController();
  await expect(readLotus(file(0x1003, record(0x23)), { ...context, signal: controller.signal,
    async diagnostic() { controller.abort(false); } })).rejects.toBe(false);
});

it("keeps record 0x23 outside the qualified .123 versions unchanged", async () => {
  const book = await readLotus(file(0x1002, sheetName(0, [65]), record(24, [0, 0, 0, 0, 2, 0])), context);
  expect(book.sheets[0]!.name).toBe("Sheet1");
});
