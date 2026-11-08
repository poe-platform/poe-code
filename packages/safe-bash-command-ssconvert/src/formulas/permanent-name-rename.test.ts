import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { resolveName, type Workbook } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";
import { renameWorkbookSheet, remapWorkbookSheets } from "./workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 10000 } };
function input(): Workbook {
  return { sheets: [
    { id: "here", name: "Here", cells: [
      { row: 0, column: 0, formula: "=Data!Sheet_Title", value: { kind: "blank" } },
      { row: 1, column: 0, formula: "=[]Sheet_Title", value: { kind: "blank" } }
    ] },
    { id: "data", name: "Data", cells: [{ row: 0, column: 0, formula: "=Sheet_Title", value: { kind: "blank" } }] }
  ], names: [
    { name: "Sheet_Title", expression: '"Global"' },
    { name: "Sheet_Title", expression: '"Custom"', sheet: "data", position: { sheet: "data", row: 2, column: 3 } },
    { name: "Print_Area", expression: "$B$1", sheet: "data" },
    { name: "Sheet_Title", expression: '"Here custom"', sheet: "here" },
    { name: "sheet_title", expression: '"lowercase"', sheet: "data" }
  ] };
}

it.each(["Renamed", "DATA", 'New "title"\\path'])("resets the renamed sheet's explicit Sheet_Title to %s", name => {
  // sheet.c: sheet_set_name replaces Sheet_Title even if its definition was edited.
  const book = input(), before = structuredClone(book);
  const renamed = renameWorkbookSheet(book, "data", name, context);
  const calculated = recalculateWorkbook(renamed, context, true);
  expect(calculated.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "string", value: name }, { kind: "string", value: "Global" }
  ]);
  expect(calculated.sheets[1]!.cells[0]!.value).toEqual({ kind: "string", value: name });
  expect(resolveName(renamed, "Sheet_Title", "data")?.position).toEqual({ sheet: "data", row: 2, column: 3 });
  expect(resolveName(renamed, "Print_Area", "data")?.expression).toBe("$B$1");
  expect(resolveName(renamed, "Sheet_Title", "here")?.expression).toBe('"Here custom"');
  expect(resolveName(renamed, "sheet_title", "data")?.expression).toBe('"lowercase"');
  expect(book).toEqual(before);
});

it("keeps an edited Sheet_Title when the sheet name is unchanged", () => {
  const renamed = renameWorkbookSheet(input(), "data", "Data", context);
  expect(resolveName(renamed, "Sheet_Title", "data")?.expression).toBe('"Custom"');
  expect(recalculateWorkbook(renamed, context, true).sheets[1]!.cells[0]!.value).toEqual({ kind: "string", value: "Custom" });
});

it("resets Sheet_Title when remapping both the sheet identity and its display name", () => {
  const book = input(), before = structuredClone(book);
  const mapped = remapWorkbookSheets(book, new Map([["data", { id: "imported", name: "Imported" }]]), context);
  expect(resolveName(mapped, "Sheet_Title", "imported")).toMatchObject({ sheet: "imported", expression: '"Imported"', position: { sheet: "imported", row: 2, column: 3 } });
  expect(recalculateWorkbook(mapped, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "Imported" });
  expect(resolveName(mapped, "Sheet_Title", "here")?.expression).toBe('"Here custom"');
  expect(book).toEqual(before);
});

it("preserves edited title definitions when remapping only sheet identity", () => {
  const mapped = remapWorkbookSheets(input(), new Map([["data", { id: "imported", name: "Data" }]]), context);
  expect(resolveName(mapped, "Sheet_Title", "imported")?.expression).toBe('"Custom"');
  expect(resolveName(mapped, "Sheet_Title")?.expression).toBe('"Global"');
});
