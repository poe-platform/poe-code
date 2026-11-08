import { expect, it } from "vitest";
import { renameWorkbookSheet, moveWorkbookSheet, resizeWorkbookReferences, translateFormulaGroup, remapWorkbookSheets } from "./workbook.js";
import { mergeWorkbookSheets } from "../workbook/merge.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

const limits = { sheets: 8, cells: 100, inputBytes: 10000, outputBytes: 10000, operations: 20 };
const context = (): CapabilityContext => ({ limits, signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
const cache = { kind: "number" as const, value: 47 };
const book: Workbook = { activeSheet: "s", sheets: [
  { id: "s", name: "First", size: { rows: 256, columns: 256 }, cells: [{ row: 0, column: 0, value: cache, cachedResult: cache, formula: '=Future(fIRST!A200,"First!A200",[other]First!A200)' }] },
  { id: "t", name: "Second", size: { rows: 256, columns: 256 }, cells: [] }
] };

it("rejects noninteger array formula targets before returning the expression", () => {
  const group = { id: "array", kind: "array" as const, expression: "=A1", range: { startRow: 0, startColumn: 0, endRow: 2, endColumn: 2 } };
  expect(() => translateFormulaGroup(group, { sheet: "s", row: NaN, column: 1 }, context())).toThrow("Invalid formula group member");
  expect(() => translateFormulaGroup(group, { sheet: "s", row: 0.5, column: 1 }, context())).toThrow("Invalid formula group member");
});

it("honors cancellation for merging and remapping sheets without formulas", () => {
  const abort = new AbortController(), reason = new Error("cancelled stress"); abort.abort(reason);
  const ctx = { ...context(), signal: abort.signal };
  const empty: Workbook = { sheets: [{ id: "s", name: "First", cells: [] }] };
  expect(() => mergeWorkbookSheets(empty, empty, limits, ctx)).toThrow(reason);
  expect(() => remapWorkbookSheets(empty, new Map(), ctx)).toThrow(reason);
});

it("preserves caches, unknown spelling, external namespaces and borrowed input through sequential edits", () => {
  const copy = structuredClone(book);
  const renamed = renameWorkbookSheet(book, "s", "Renamed", context());
  expect(renamed.sheets[0]!.cells[0]).toMatchObject({ formula: '=Future(\'Renamed\'!A200,"First!A200",[other]First!A200)', value: cache, cachedResult: cache });
  const moved = moveWorkbookSheet(renamed, "s", 1, context());
  const resized = resizeWorkbookReferences(moved, "s", { rows: 128, columns: 128 }, context());
  expect(resized.sheets[1]!.cells[0]).toMatchObject({ formula: '=Future(#REF!,"First!A200",[other]First!A200)', value: cache, cachedResult: cache });
  expect(book).toEqual(copy);
  expect(renameWorkbookSheet(book, "s", "Renamed", context())).toEqual(renamed);
});

it("preserves case-distinct globals, rejects exact collisions and preserves scoped merge names", () => {
  const target: Workbook = { sheets: [{ id: "s", name: "First", cells: [] }], names: [{ name: "Input", expression: "=1" }] };
  const incoming: Workbook = { sheets: [{ id: "s", name: "First", cells: [] }], names: [{ name: "iNPUT", expression: "=2" }] };
  expect(mergeWorkbookSheets(target, incoming, limits, context()).names?.map(name => name.name)).toEqual(["Input", "iNPUT"]);
  expect(() => mergeWorkbookSheets(target, { ...incoming, names: target.names! }, limits, context())).toThrow("Name conflict");
  const scoped = mergeWorkbookSheets(target, { ...incoming, names: [{ name: "Input", sheet: "s", expression: "=First!A1", position: { sheet: "s", row: 0, column: 0 } }] }, limits, context());
  expect(scoped.names![1]).toMatchObject({ sheet: "s(1)", position: { sheet: "s(1)" }, expression: "='First(2)'!A1" });
});

it("rejects detached incoming sheet ownership rather than silently dropping it", () => {
  expect(() => mergeWorkbookSheets(book, { sheets: [], detachedSheets: [book.sheets[0]!] }, limits, context())).toThrow("merge reference records");
});

it("applies workbook work budgets to rename formulas", () => {
  expect(() => renameWorkbookSheet(book, "s", "Renamed", { ...context(), limits: { ...limits, workbookWork: 2 } })).toThrow("work limit");
});
