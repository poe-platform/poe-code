import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { snapshotWorkbook } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { rewriteReferences } from "../formulas/rewriting.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { moveWorkbookSheet, renameWorkbookSheet } from "../formulas/workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 1000, sheets: 4, operations: 1000, workbookWork: 100000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
const name = (text: string) => [...Array.from(text, c => c.charCodeAt(0)), ...Array<number>(16 - text.length).fill(0)];
const oldName = (text: string, first = [0, 0], last = first) => record(11, [...name(text), ...word(first[0]!), ...word(first[1]!), ...word(last[0]!), ...word(last[1]!)]);
const newName = (text: string, first = [0, 0, 0], last = first, type = 0) => record(9, [...word(type), ...name(text), ...word(first[0]!), first[1]!, first[2]!, ...word(last[0]!), last[1]!, last[2]!]);
const old = (...records: number[][]) => Uint8Array.from([...record(0, [5, 4]), ...records.flat(), ...record(1)]);
const modern = (...records: number[][]) => Uint8Array.from([...record(0, [2, 16, ...Array<number>(14).fill(0), 1, 0, 0]), ...records.flat(), ...record(1)]);

it("imports WK1 names as absolute workbook expressions with their physical owner", async () => {
  const book = await readLotus(old(oldName("Total", [0, 1], [2, 3])), context);
  expect(book.names).toEqual([{ name: "Total", expression: "='A'!$A$2:$C$4" }]);
  expect(snapshotWorkbook(book, context.limits).names).toEqual(book.names);
});
it.each([0, 1])("imports WK3 user-range type %i and single-cell coordinates", async type => {
  const book = await readLotus(modern(newName("Value", [4, 1, 2], undefined, type)), context);
  expect(book.names).toEqual([{ name: "Value", expression: "='Sheet2'!$C$5" }]);
  expect(book.sheets.map(s => s.id)).toEqual(["lotus-0", "lotus-1"]);
});
it("uses final sheet names, including apostrophes, after all records are read", async () => {
  const book = await readLotus(modern(newName("Value"), record(0x204, [...Array<number>(10).fill(0), 79, 39, 66, 0])), context);
  expect(book.names).toEqual([{ name: "Value", expression: "='O\\'B'!$A$1" }]);
});
it("preserves both worksheet endpoints of three-dimensional named ranges", async () => {
  const book = await readLotus(modern(newName("Across", [2, 0, 1], [4, 2, 3])), context);
  expect(book.names).toEqual([{ name: "Across", expression: "='Sheet1'!$B$3:'Sheet3'!$D$5" }]);
  expect(book.sheets).toHaveLength(3);
});
it("preserves a reversed physical sheet span without sorting source endpoints", async () => {
  const book = await readLotus(modern(newName("Back", [0, 2, 0], [0, 0, 0])), context);
  expect(book.names).toEqual([{ name: "Back", expression: "='Sheet3'!$A$1:'Sheet1'!$A$1" }]);
});
it("retains exact-case names and keeps the first exact duplicate", async () => {
  const warnings: string[] = [];
  const book = await readLotus(old(oldName("N"), oldName("n", [1, 0]), oldName("N", [2, 0])), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(book.names).toEqual([{ name: "N", expression: "='A'!$A$1" }, { name: "n", expression: "='A'!$B$1" }]);
  expect(warnings).toEqual(["Ignoring duplicate Lotus name 'N'."]);
});
it("decodes bounded LMBCS names and sixteen-byte names without a terminator", async () => {
  const book = await readLotus(old(oldName("abcdefghijklmnop"), oldName(String.fromCharCode(0x82))), context);
  expect(book.names?.map(n => n.name)).toEqual(["abcdefghijklmnop", "é"]);
});
it.each([false, true])("warns for truncated and empty name records while preserving neighboring cells (modern=%s)", async isModern => {
  const warnings: string[] = [];
  const input = isModern ? modern(record(9, [0]), newName(""), record(24, [0, 0, 0, 0, 14, 0])) : old(record(11, [0]), oldName(""), record(13, [113, 0, 0, 0, 0, 7, 0]));
  const book = await readLotus(input, { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(book.names ?? []).toEqual([]);
  expect(book.sheets[0]?.cells[0]?.value).toEqual({ kind: "number", value: 7 });
  expect(warnings).toEqual([`Record with type 0x${isModern ? "9" : "b"} has wrong length 1.`, "Ignoring empty Lotus name."]);
});
it("does not promote an unqualified WK3 range type to a workbook name", async () => {
  const input = modern(newName("Private", undefined, undefined, 2), record(24, [0, 0, 0, 0, 14, 0]));
  const book = await readLotus(input, context);
  expect(book.names ?? []).toEqual([]);
  expect(book.sheets[0]?.unsupportedRecords).toEqual([{ source: "lotus", kind: "NamedRange", disposition: "retained", data: { type: 2, payload: "0200507269766174650000000000000000000000000000000000" } }]);
});
it("rejects invalid WK1 column coordinates without manufacturing a name", async () => {
  const warnings: string[] = [];
  const book = await readLotus(old(oldName("Bad", [256, 0]), oldName("Good")), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(book.names).toEqual([{ name: "Good", expression: "='A'!$A$1" }]);
  expect(warnings).toEqual(["Ignoring invalid Lotus named range 'Bad'."]);
});
it("charges every duplicate name record and enforces explicit worksheet bounds", async () => {
  await expect(readLotus(old(oldName("N"), oldName("N")), { ...context, limits: { ...context.limits, operations: 1 } })).rejects.toThrow("operations limit exceeded");
  await expect(readLotus(modern(newName("Bad", [0, 4, 0])), context)).rejects.toThrow("sheets limit exceeded");
});
it("preserves cancellation raised by name diagnostics", async () => {
  const controller = new AbortController(), reason = new Error("name cancellation");
  await expect(readLotus(old(oldName("N"), oldName("N")), { ...context, signal: controller.signal, async diagnostic() { controller.abort(reason); } })).rejects.toBe(reason);
});
it("exposes imported names through actual arithmetic and range recalculation", async () => {
  const book = await readLotus(old(oldName("Total", [0, 0], [0, 1]), record(13, [113, 0, 0, 0, 0, 11, 0]), record(13, [113, 0, 0, 1, 0, 13, 0])), context);
  const result = recalculateWorkbook({ ...book, sheets: book.sheets.map(s => ({ ...s, cells: [...s.cells, { row: 0, column: 1, formula: "=SUM(Total)+1", formulaDirty: true, value: { kind: "blank" as const } }] })) }, context);
  expect(result.sheets[0]?.cells.find(c => c.column === 1)?.value).toEqual({ kind: "number", value: 25 });
});

it("admits aggregate named-expression text before retaining expanded sheet qualifiers", async () => {
  await expect(readLotus(modern(newName("One"), newName("Two")), { ...context, limits: { ...context.limits, workbookTextBytes: 30 } })).rejects.toThrow("expression text limit");
});

it("recalculates imported names after an apostrophe-containing sheet rename", async () => {
  const book = await readLotus(modern(newName("Value"), record(24, [0, 0, 0, 0, 22, 0]), record(0x204, [...Array<number>(10).fill(0), 79, 39, 66, 0])), context);
  const result = recalculateWorkbook({ ...book, sheets: book.sheets.map(s => ({ ...s, cells: [...s.cells, { row: 0, column: 1, formula: "=Value+1", formulaDirty: true, value: { kind: "blank" as const } }] })) }, context);
  expect(result.sheets[0]?.cells.find(c => c.column === 1)?.value).toEqual({ kind: "number", value: 12 });
});

const namedToken = (text: string, opcode = 7) => [opcode, ...Array.from(text, c => c.charCodeAt(0)), 0];
const formulaRecord = (tokens: number[], row = 0, column = 1, sheet = 0) => record(25, [...word(row), sheet, column, ...Array<number>(10).fill(0), ...tokens, 3]);
it.each([7, 8])("resolves a forward WK3 name token %i and continues subsequent arithmetic", async opcode => {
  const warnings: string[] = [];
  const book = await readLotus(modern(formulaRecord([...namedToken(opcode === 8 ? "$Value" : "Value", opcode), 5, 2, 0, 15]), newName("Value"), record(24, [0, 0, 0, 0, 22, 0])), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(book.sheets[0]?.cells.find(c => c.column === 1)?.formula).toBe(opcode === 7 ? "=(A1+1)" : "=($A$1+1)");
  const result = recalculateWorkbook(book, context, true);
  expect(result.sheets[0]?.cells.find(c => c.column === 1)?.value).toEqual({ kind: "number", value: 12 });
  expect(warnings).toEqual([]);
});
it.each([7, 8])("retains token %i copy semantics at the formula position", async opcode => {
  const book = await readLotus(modern(newName("Value"), formulaRecord(namedToken("Value", opcode), 2, 2)), context);
  const parsed = parseExpression(book.sheets[0]!.cells[0]!.formula!, { position: { sheet: "lotus-0", row: 2, column: 2 } });
  expect(parsed.ok).toBe(true); if (!parsed.ok) return;
  expect(rewriteReferences(parsed.document, { translation: "copy", position: { sheet: "lotus-0", row: 3, column: 3 } })).toBe(opcode === 7 ? "=B2" : "=$A$1");
});
it("uses final escaped sheets and both endpoints for named formula ranges", async () => {
  const book = await readLotus(modern(formulaRecord(namedToken("Across", 8)), newName("Across", [0, 0, 0], [1, 1, 2]), record(0x204, [...Array<number>(10).fill(0), 79, 39, 66, 0]), record(0x204, [...Array<number>(10).fill(0), 76, 97, 115, 116, 0])), context);
  expect(book.sheets[0]?.cells[0]?.formula).toBe("='O\\'B'!$A$1:'Last'!$C$2");
});
it("retains deferred named formulas through their cached string record", async () => {
  const book = await readLotus(modern(formulaRecord(namedToken("Value", 8)), record(26, [0, 0, 0, 1, 120, 0]), newName("Value")), context);
  expect(book.sheets[0]?.cells[0]).toMatchObject({ formula: "=$A$1", cachedResult: { kind: "string", value: "x" }, formulaDirty: false });
});
it("does not resurrect an overwritten deferred formula", async () => {
  const book = await readLotus(modern(formulaRecord(namedToken("Value", 8)), record(24, [0, 0, 0, 1, 14, 0]), newName("Value")), context);
  expect(book.sheets[0]?.cells[0]).toMatchObject({ value: { kind: "number", value: 7 } });
  expect(book.sheets[0]?.cells[0]?.formula).toBeUndefined();
});
it("consumes a complete missing name without interpreting its bytes as opcodes", async () => {
  const warnings: string[] = [];
  const book = await readLotus(modern(formulaRecord([...namedToken("Missing"), 5, 2, 0, 15])), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(book.sheets[0]?.cells[0]?.formula).toBe("=(#NAME?+1)");
  expect(warnings).toEqual(["Unknown Lotus named reference 'Missing'."]);
});
it("rejects an unterminated named token without inventing a terminator", async () => {
  const warnings: string[] = [];
  const book = await readLotus(modern(record(40, [0, 0, 0, 1, ...Array<number>(8).fill(0), 7, 88])), { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(book.sheets[0]?.cells[0]?.formula).toBe("=#REF!");
  expect(warnings).toEqual(["Unterminated Lotus named reference."]);
});

it("preserves cancellation raised by the final unterminated-name diagnostic", async () => {
  const controller = new AbortController(), reason = new Error("token cancellation");
  await expect(readLotus(modern(record(40, [0, 0, 0, 1, ...Array<number>(8).fill(0), 7, 88])), { ...context, signal: controller.signal, async diagnostic() { controller.abort(reason); } })).rejects.toBe(reason);
});
it("decodes exact-case and LMBCS token names without selecting a duplicate", async () => {
  const book = await readLotus(modern(newName("N"), newName("n", [0, 0, 2]), newName(String.fromCharCode(0x82), [1, 0, 0]), newName("N", [0, 0, 3]), formulaRecord([...namedToken("N", 8), ...namedToken("n", 8), 15, ...namedToken(String.fromCharCode(0x82), 8), 15])), context);
  expect(book.sheets[0]?.cells[0]?.formula).toBe("=(($A$1+$C$1)+$A$2)");
});
it("qualifies a final apostrophe-containing named endpoint from another sheet", async () => {
  const book = await readLotus(modern(formulaRecord(namedToken("Value", 8), 0, 1, 1), newName("Value"), record(0x204, [...Array<number>(10).fill(0), 79, 39, 66, 0])), context);
  expect(book.sheets[1]?.cells[0]?.formula).toBe("='O\\'B'!$A$1");
});
it("charges deferred named tokens against the formula operation budget", async () => {
  await expect(readLotus(modern(newName("N"), formulaRecord([...namedToken("N"), ...namedToken("N"), 15])), { ...context, limits: { ...context.limits, operations: 2 } })).rejects.toThrow("operations limit exceeded");
});

it.each([false, true])("recalculates a named sheet span with an owner endpoint (reverse=%s)", async reverse => {
  const first = reverse ? [0, 2, 0] : [0, 0, 0], last = reverse ? [0, 0, 0] : [0, 2, 0];
  const book = await readLotus(modern(formulaRecord([...namedToken("Across", 8), 80, 1]), newName("Across", first, last), record(24, [0, 0, 0, 0, 22, 0]), record(24, [0, 0, 1, 0, 26, 0]), record(24, [0, 0, 2, 0, 34, 0])), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]?.cells.find(c => c.column === 1)?.value).toEqual({ kind: "number", value: 41 });
});

it("admits named definitions and expanded formula text under one aggregate budget", async () => {
  const input = modern(newName("N"), formulaRecord(namedToken("N", 8), 0, 1, 1), formulaRecord(namedToken("N", 8), 0, 1, 2));
  const book = await readLotus(input, context);
  const total = (book.names ?? []).reduce((sum, n) => sum + n.name.length + n.expression.length, 0) +
    book.sheets.reduce((sum, s) => sum + s.cells.reduce((n, c) => n + (c.formula?.length ?? 0), 0), 0);
  expect(total).toBe(43);
  await expect(readLotus(input, { ...context, limits: { ...context.limits, workbookTextBytes: total - 1 } })).rejects.toThrow("expression text limit");
  expect((await readLotus(input, { ...context, limits: { ...context.limits, workbookTextBytes: total } })).names).toEqual(book.names);
});

it.each([
  { opcode: 7, owner: 0, span: false, expected: 29 },
  { opcode: 8, owner: 0, span: false, expected: 23 },
  { opcode: 7, owner: 1, span: false, expected: 13 },
  { opcode: 8, owner: 1, span: false, expected: 11 },
  { opcode: 7, owner: 0, span: true, expected: 32 },
  { opcode: 8, owner: 0, span: true, expected: 28 }
])("copies WK3 token $opcode from sheet $owner across sheets (span=$span)", async ({ opcode, owner, span, expected }) => {
  const input = modern(newName("Value", [0, 0, 0], [0, span ? 1 : 0, 0]),
    formulaRecord([...namedToken("Value", opcode), ...(span ? [80, 1] : [])], 2, 2, owner),
    ...[11, 17, 23].map((value, sheet) => record(24, [0, 0, sheet, 0, ...word(value * 2)])),
    ...[13, 19, 29].map((value, sheet) => record(24, [1, 0, sheet, 1, ...word(value * 2)])));
  const inputBefore = new Uint8Array(input);
  const book = await readLotus(input, context), before = snapshotWorkbook(book, context.limits);
  const original = book.sheets[owner]!.cells.find(cell => cell.row === 2 && cell.column === 2)!;
  const parsed = parseExpression(original.formula!, { workbook: book, position: { sheet: `lotus-${owner}`, row: 2, column: 2 } });
  expect(parsed.ok).toBe(true); if (!parsed.ok) return;
  const formula = rewriteReferences(parsed.document, { translation: "copy", position: { sheet: "lotus-2", row: 3, column: 3 } });
  const copied = { ...book, sheets: book.sheets.map(sheet => sheet.id !== "lotus-2" ? sheet : { ...sheet,
    cells: [...sheet.cells, { row: 3, column: 3, formula, formulaDirty: true, value: { kind: "blank" as const } }] }) };
  const result = recalculateWorkbook(copied, context, true);
  expect(result.sheets[2]!.cells.find(cell => cell.row === 3 && cell.column === 3)?.value).toEqual({ kind: "number", value: expected });
  expect(book).toEqual(before);
  expect(input).toEqual(inputBefore);
});

it.each([7, 8])("keeps imported token %i coordinates independent of later name replacement or deletion", async opcode => {
  const book = await readLotus(modern(newName("Value"), formulaRecord(namedToken("Value", opcode), 0, 2),
    record(24, [0, 0, 0, 0, 22, 0]), record(24, [0, 0, 0, 1, 26, 0])), context);
  const before = snapshotWorkbook(book, context.limits);
  const withNameFormula = { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: [...sheet.cells,
    { row: 0, column: 3, formula: "=Value", formulaDirty: true, value: { kind: "blank" as const } }] })) };
  for (const names of [[{ name: "Value", expression: "='Sheet1'!$B$1" }], []]) {
    const result = recalculateWorkbook(snapshotWorkbook({ ...withNameFormula, names }, context.limits), context, true);
    expect(result.sheets[0]!.cells.find(cell => cell.column === 2)?.value).toEqual({ kind: "number", value: 11 });
    expect(result.sheets[0]!.cells.find(cell => cell.column === 3)?.value).toEqual(names.length
      ? { kind: "number", value: 13 } : { kind: "error", value: "#NAME?" });
  }
  expect(book).toEqual(before);
});

it.each([7, 8])("preserves token %i and workbook name targets across sheet rename and movement", async opcode => {
  const book = await readLotus(modern(newName("Value"), formulaRecord(namedToken("Value", opcode), 0, 1, 1),
    record(24, [0, 0, 0, 0, 22, 0]), record(24, [0, 0, 1, 0, 34, 0])), context);
  const before = snapshotWorkbook(book, context.limits);
  const renamed = renameWorkbookSheet(book, "lotus-0", "O'Brian", context);
  const moved = moveWorkbookSheet(renamed, "lotus-0", 1, context);
  const result = recalculateWorkbook(moved, context, true);
  expect(result.sheets.map(sheet => sheet.id)).toEqual(["lotus-1", "lotus-0"]);
  expect(result.sheets[0]!.cells.find(cell => cell.column === 1)?.value).toEqual({ kind: "number", value: 11 });
  expect(result.names).toEqual([{ name: "Value", expression: "='O\\'Brian'!$A$1" }]);
  expect(book).toEqual(before);
});
