import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { snapshotWorkbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

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
  await expect(readLotus(modern(newName("One"), newName("Two")), { ...context, limits: { ...context.limits, workbookTextBytes: 30 } })).rejects.toThrow("named-expression text limit");
});

it("recalculates imported names after an apostrophe-containing sheet rename", async () => {
  const book = await readLotus(modern(newName("Value"), record(24, [0, 0, 0, 0, 22, 0]), record(0x204, [...Array<number>(10).fill(0), 79, 39, 66, 0])), context);
  const result = recalculateWorkbook({ ...book, sheets: book.sheets.map(s => ({ ...s, cells: [...s.cells, { row: 0, column: 1, formula: "=Value+1", formulaDirty: true, value: { kind: "blank" as const } }] })) }, context);
  expect(result.sheets[0]?.cells.find(c => c.column === 1)?.value).toEqual({ kind: "number", value: 12 });
});
