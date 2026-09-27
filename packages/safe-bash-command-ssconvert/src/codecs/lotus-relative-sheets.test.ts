import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { parseExpression } from "../formulas/parser.js";
import { rewriteReferences } from "../formulas/rewriting.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 1000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
const reference = (flags: number, sheet: number) => [1, flags, 0, 0, sheet, 0];
function input(tokens: number[], owner = 0): Uint8Array {
  return Uint8Array.from([
    ...record(0, [...word(0x1002), 4, 0, ...Array<number>(22).fill(0)]),
    ...record(25, [1, 0, owner, 1, ...Array<number>(10).fill(0), ...tokens, 3]),
    ...[10, 11, 12].flatMap((value, sheet) => record(24, [0, 0, sheet, 0, ...word(value * 2)])),
    ...record(1)
  ]);
}

// LibreOffice LotusToSc::ReadSRD: bit 2 controls tab relativity, while
// the physical sheet coordinate equals the formula sheet for relative offset 0.
it.each([[0, 11], [4, 12]])("copies the physical target with Lotus sheet flag %i", async (flags, expected) => {
  const book = await readLotus(input(reference(flags, 1)), context);
  const cell = book.sheets[0]!.cells.find(cell => cell.formula)!;
  const parsed = parseExpression(cell.formula!, { position: { sheet: book.sheets[0]!.id, row: 1, column: 1 }, workbook: book });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  const copied = rewriteReferences(parsed.document, { translation: "copy", position: { sheet: book.sheets[1]!.id, row: 1, column: 1 } });
  const result = recalculateWorkbook({ ...book, sheets: book.sheets.map((sheet, index) => index !== 1 ? sheet :
    { ...sheet, cells: [...sheet.cells, { ...cell, formula: copied }] }) }, context, true);
  expect(result.sheets[1]!.cells.find(cell => cell.formula)!.value).toEqual({ kind: "number", value: expected });
});

it("retains different sheet flags for repeated physical targets", async () => {
  const book = await readLotus(input([...reference(4, 1), ...reference(0, 1), 15]), context);
  const cell = book.sheets[0]!.cells.find(cell => cell.formula)!;
  const parsed = parseExpression(cell.formula!, { position: { sheet: book.sheets[0]!.id, row: 1, column: 1 }, workbook: book });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { translation: "copy", position: { sheet: book.sheets[1]!.id, row: 1, column: 1 } }))
    .toBe("of:=(['Sheet3'.$A$1]+[$'Sheet2'.$A$1])");
});

it.each([[4, true, false], [32, false, true]])("keeps range endpoint flags independent: %i", async (flags, firstRelative, lastRelative) => {
  const book = await readLotus(input([2, Number(flags), 0, 0, 1, 0, 0, 0, 2, 0]), context);
  const parsed = parseExpression(book.sheets[0]!.cells.find(cell => cell.formula)!.formula!,
    { position: { sheet: book.sheets[0]!.id, row: 1, column: 1 }, workbook: book });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(parsed.document.root).toMatchObject({ kind: "reference", first: { sheetRelative: firstRelative }, last: { sheetRelative: lastRelative } });
});

it("keeps the owner-sheet endpoint relative even without bit 2", async () => {
  const book = await readLotus(input([2, 0, 0, 0, 0, 0, 0, 0, 2, 0]), context);
  const parsed = parseExpression(book.sheets[0]!.cells.find(cell => cell.formula)!.formula!,
    { position: { sheet: book.sheets[0]!.id, row: 1, column: 1 }, workbook: book });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(parsed.document.root).toMatchObject({ kind: "reference", first: { sheetRelative: true }, last: { sheetRelative: false } });
});

it.each([0, 4])("preserves literal quotes and backslashes beside sheet flag %i", async flags => {
  const text = '"quoted" \\ LOTUS_SHEET_REFERENCE_0';
  const book = await readLotus(input([...reference(flags, 1), 6, ...new TextEncoder().encode(text), 0, 30]), context);
  const result = recalculateWorkbook(book, context, true);
  expect(result.sheets[0]!.cells.find(cell => cell.formula)!.value).toEqual({ kind: "string", value: "11" + text });
});
