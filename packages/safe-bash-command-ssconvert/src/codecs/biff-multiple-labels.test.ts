import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { parseExpression } from "../formulas/parser.js";
import { rewriteReferences, visitFormula } from "../formulas/rewriting.js";
import { renameWorkbookSheet } from "../formulas/workbook.js";
import { dirtyWorkbook } from "../workbook/updates/recalculation.js";
import { resizeWorkbookReferences } from "../workbook/resize.js";
import { readBiff, createBiffWriter } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
const words = (...values: number[]) => values.flatMap(value => [value & 255, value >> 8 & 255]);
const record = (opcode: number, data: readonly number[]) => [...words(opcode, data.length), ...data];
const extra = (relative: boolean, after: boolean) => [...words(2, relative ? 0x8000 : 0), ...words(9, 2, after ? 4 : 0, 0)];
const radical = (areaClass: number) => [24, 11, 0, 0, 0, 0, areaClass | 5, ...words(1, 3, 0, 0)];
function input(tokens: readonly number[], extras: readonly number[], after = false): Uint8Array {
  const bytes = [...record(0x809, [0, 6, 5, 0]), ...record(10, []), ...record(0x809, [0, 6, 16, 0])];
  for (const [row, column, text] of [[9, 2, "Year"], [after ? 4 : 0, 0, "Sales"]] as const)
    bytes.push(...record(0x204, [...words(row, column, 0, text.length), 0, ...Array.from(text, c => c.charCodeAt(0))]));
  for (const [row, value] of [[1, 2], [3, 3], [after ? 0 : 4, 100]]) {
    const data = new Uint8Array(14), view = new DataView(data.buffer);
    view.setUint16(0, row!, true); view.setFloat64(6, value!, true); bytes.push(...record(0x203, [...data]));
  }
  const data = new Uint8Array(22), view = new DataView(data.buffer);
  view.setUint16(0, 1, true); view.setUint16(2, 2, true); view.setFloat64(6, 999, true); view.setUint16(20, tokens.length, true);
  return Uint8Array.from([...bytes, ...record(6, [...data, ...tokens, ...extras]), ...record(10, [])]);
}
const formula = (bytes: Uint8Array) => readBiffRecords(readCfb(bytes, context).get("Workbook")!, context).find(record => record.opcode === 6)!.data;

for (const after of [false, true]) for (const relative of [false, true]) for (const areaClass of [0x20, 0x40, 0x60]) {
  it(`preserves multiple radical labels (after=${after}, relative=${relative}, class=${areaClass})`, async () => {
    const tokens = [...radical(areaClass), 0x22, 1, 4, 0], payload = extra(relative, after);
    const book = await readBiff(input(tokens, payload, after), context);
    const cell = book.sheets[0]!.cells.find(cell => cell.formula)!;
    const address = relative ? `C10;A${after ? 5 : 1}` : `$C$10;$A$${after ? 5 : 1}`;
    expect(cell.formula).toBe(`=SUM(@range${areaClass === 0x20 ? "" : areaClass === 0x40 ? ".value" : ".array"}.multi:{${address}}->$A$2:$A$4)`);
    const calculated = recalculateWorkbook(book, context, true);
    expect(calculated.sheets[0]!.cells.find(cell => cell.formula)!.value).toEqual({ kind: "number", value: 5 });
    const native = formula(await createBiffWriter(8)(calculated, [], context));
    expect([...native.bytes.subarray(22, 37)]).toEqual(tokens.slice(0, 15));
    expect([...native.bytes.subarray(22 + native.u16(20))]).toEqual(payload);
    expect(native.f64(6)).toBe(5);
  });
}

it("consumes ELF and array extras in token encounter order", async () => {
  const array = [0x20, ...Array<number>(7).fill(0)], value = new Uint8Array(12);
  value[3] = 1; new DataView(value.buffer).setFloat64(4, 10, true);
  for (const first of [false, true]) {
    const elf = radical(0x20), labels = extra(false, false);
    const tokens = [...(first ? [...array, ...elf] : [...elf, ...array]), 0x22, 2, 4, 0];
    const payload = first ? [...value, ...labels] : [...labels, ...value];
    const calculated = recalculateWorkbook(await readBiff(input(tokens, payload), context), context, true);
    expect(calculated.sheets[0]!.cells.find(cell => cell.formula)!.value).toEqual({ kind: "number", value: 15 });
    const native = formula(await createBiffWriter(8)(calculated, [], context));
    expect([...native.bytes.subarray(22 + native.u16(20))]).toEqual(payload);
  }
});

it("uses scalar intersection and preserves AreaErr plus a single-element multiple label", async () => {
  const scalar = recalculateWorkbook(await readBiff(input(radical(0x20), extra(false, false)), context), context, true);
  expect(scalar.sheets[0]!.cells.find(cell => cell.formula)!.value).toEqual({ kind: "number", value: 2 });
  const tokens = [24, 11, 1, 2, 3, 4, 0x6b, ...Array<number>(8).fill(255)], payload = [...words(1, 0), ...words(0, 0xc000)];
  const book = recalculateWorkbook(await readBiff(input(tokens, payload), context), context, true);
  expect(book.sheets[0]!.cells.find(cell => cell.formula)).toMatchObject({ formula: "=@range.array.multi:{$A$1}->#REF!", value: { kind: "error", value: "#REF!" } });
  const native = formula(await createBiffWriter(8)(book, [], context));
  expect([...native.bytes.subarray(22)]).toEqual([24, 11, 0, 0, 0, 0, 0x6b, ...Array<number>(8).fill(0), ...words(1, 0, 0, 0)]);
});

it("rewrites all ordered labels and includes them in visits and dependencies", async () => {
  const source = "=SUM(@range.multi:{'Sales'!C10;'sales'!A1}->'Sales'!$A$2:$A$4)";
  const parsed = parseExpression(source, { position: { sheet: "S", row: 1, column: 2 } });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { position: { sheet: "S", row: 2, column: 3 }, translation: "copy" }))
    .toBe("=SUM(@range.multi:{'Sales'!D11;'sales'!B2}->'Sales'!$A$2:$A$4)");
  expect(rewriteReferences(parsed.document, { position: { sheet: "S", row: 2, column: 3 }, translation: "move" })).toBe(source);
  const refs: number[] = [];
  visitFormula(parsed.document.root, node => { if (node.kind === "reference") refs.push(node.first.row!.value); });
  expect(refs).toEqual([-1, 8, 1]);
  const original = await readBiff(input([...radical(0x20), 0x22, 1, 4, 0], extra(false, false)), context);
  const book = recalculateWorkbook(original, context, true), sheet = book.sheets[0]!;
  const dirty = (row: number, column: number) => dirtyWorkbook(book, [{ sheet: sheet.id, startRow: row, endRow: row, startColumn: column, endColumn: column }], context).sheets[0]!.cells.find(cell => cell.formula)!.formulaDirty;
  expect(dirty(9, 2)).toBe(true); expect(dirty(9, 3)).toBe(false);
  const qualified = { sheets: [{ id: "S", name: "Sales", cells: [{ row: 1, column: 2, formula: source, value: { kind: "blank" as const } }] }] };
  expect(renameWorkbookSheet(qualified, "S", "New Sales", context).sheets[0]!.cells[0]!.formula)
    .toBe("=SUM(@range.multi:{'New Sales'!C10;'New Sales'!A1}->'New Sales'!$A$2:$A$4)");
});

it("rejects missing, truncated, empty, invalid-column and non-column multiple radical data", async () => {
  const tokens = radical(0x20), payload = extra(false, false);
  for (let end = 0; end < payload.length; end++) await expect(readBiff(input(tokens, payload.slice(0, end)), context)).rejects.toThrow();
  for (const invalid of [words(0, 0), [...words(1, 0), ...words(0, 256)], [...words(1, 0), ...words(0, 1)]])
    await expect(readBiff(input(tokens, invalid), context)).rejects.toThrow("Invalid Excel BIFF");
  await expect(readBiff(input([24, 11, 0, 0, 0, 0, 0x25, ...words(0, 0, 1, 3)], extra(false, false)), context)).rejects.toThrow("radical label");
  await expect(readBiff(input(tokens, [...words(0xffff, 0x3fff)]), { ...context, limits: { ...context.limits, workbookWork: 1000 } })).rejects.toThrow("work limit");
});

for (const areaClass of [0x20, 0x40, 0x60]) for (const after of [false, true]) {
  const suffix = areaClass === 0x20 ? "" : areaClass === 0x40 ? ".value" : ".array";
  const labelRow = after ? 2 : 0;
  const expected = `=@range${suffix}.multi:{$C$10;$B$${labelRow + 1}}->$B$2:$B$2`;
  it(`requires a column label when reading a single-cell multiple radical area (class=${areaClass}, after=${after})`, async () => {
    // MS-XLS 2.5.198.53 requires the terminal label's column to equal
    // area.columnFirst even when the explicit area has only one cell.
    const tokens = [24, 11, 0, 0, 0, 0, areaClass | 5, ...words(1, 1, 1, 1)];
    const wrongColumn = after ? 2 : 0;
    const payload = (row: number, column: number) => [...words(2, 0, 9, 2, row, column)];
    await expect(readBiff(input(tokens, payload(1, wrongColumn)), context)).rejects.toThrow("invalid radical label area");
    const valid = await readBiff(input(tokens, payload(labelRow, 1)), context);
    expect(valid.sheets[0]!.cells.find(cell => cell.formula)!.formula).toBe(expected);
  });
  it(`requires a column label when writing a single-cell multiple radical area (class=${areaClass}, after=${after})`, async () => {
    const book = (label: string) => ({ sheets: [{ id: "S", name: "S", cells: [{ row: 5, column: 4,
      formula: `=@range${suffix}.multi:{$C$10;${label}}->$B$2:$B$2`, value: { kind: "blank" as const } }] }] });
    await expect(createBiffWriter(8)(book(after ? "$C$2" : "$A$2"), [], context)).rejects.toThrow("radical label must adjoin");
    const roundtrip = await readBiff(await createBiffWriter(8)(book(`$B$${labelRow + 1}`), [], context), context);
    expect(roundtrip.sheets[0]!.cells.find(cell => cell.formula)!.formula).toBe(expected);
  });
}

it("orders two label lists with cached-area extras and ignores reserved bits", async () => {
  const memory = [0x26, 0, 0, 0, 0, 15, 0];
  const labels = extra(false, false), relative = extra(true, false);
  labels[3] = 0x40; // ignored reserved flag, not part of the 30-bit count
  const tokens = [...memory, ...radical(0x20), ...radical(0x60), 0x22, 2, 4, 0];
  const payload = [...words(1, 1, 3, 0, 0), ...labels, ...relative];
  const book = recalculateWorkbook(await readBiff(input(tokens, payload), context), context, true);
  expect(book.sheets[0]!.cells.find(cell => cell.formula)!.value).toEqual({ kind: "number", value: 10 });
  const native = formula(await createBiffWriter(8)(book, [], context));
  expect([...native.bytes.subarray(22 + native.u16(20))]).toEqual([...extra(false, false), ...relative]);
});

it("bounds list parsing and refuses unrepresentable multiple labels", async () => {
  const position = { sheet: "S", row: 1, column: 2 };
  for (const source of ["=@range.multi:{}->A2:A4", "=@range.multi:{A1;}->A2:A4", "=@range.multi:{A1:B1;A2}->A3:A4",
    "=@range.multi.quoted:{A1}->A2:A4", "=@range.multi:{[book]Sheet!A1;A2}->A3:A4"])
    expect(parseExpression(source, { position }).ok).toBe(false);
  expect(() => parseExpression("=@range.multi:{A1;A2;A3}->A4:A5", { position, maximumNodes: 2 })).toThrow("node limit");
  const book = (formula: string) => ({ sheets: [{ id: "S", name: "S", cells: [{ ...position, formula, value: { kind: "blank" as const } }] }] });
  for (const source of ["=@range.multi:{$C10;$A$1}->$A$2:$A$4", "=@range.multi:{Other!$C$10;$A$1}->$A$2:$A$4",
    "=@range.multi:{$C$10;$A$1}->$B$1:$D$1", "=@range.multi:{$IW$10;$A$1}->$A$2:$A$4"])
    await expect(createBiffWriter(8)(book(source), [], context)).rejects.toThrow();
  const valid = book("=SUM(@range.multi:{$C$10;$A$1}->$A$2:$A$4)");
  await expect(createBiffWriter(8)(valid, [], { ...context, limits: { ...context.limits, outputBytes: 20 } })).rejects.toThrow("limit");
  const controller = new AbortController(); controller.abort(new Error("cancelled label read"));
  await expect(readBiff(input(radical(0x20), extra(false, false)), { ...context, signal: controller.signal })).rejects.toThrow("cancelled label read");
});

it("clips data and rewrites a deleted earlier label on resize", () => {
  const book = { sheets: [{ id: "S", name: "S", size: { rows: 512, columns: 256 }, cells: [
    { row: 1, column: 2, formula: "=SUM(@range.multi:{$C$10;$A$1}->$A$2:$A$300)", value: { kind: "blank" as const } },
    { row: 2, column: 2, formula: "=SUM(@range.multi:{$C$300;$A$1}->$A$2:$A$4)", value: { kind: "blank" as const } }
  ] }] };
  expect(resizeWorkbookReferences(book, "S", { rows: 256, columns: 256 }, context).sheets[0]!.cells.map(cell => cell.formula))
    .toEqual(["=SUM(@range.multi:{$C$10;$A$1}->$A$2:$A$256)", "=SUM(#REF!)"]);
});
