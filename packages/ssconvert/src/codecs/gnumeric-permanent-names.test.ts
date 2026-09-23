import { expect, it, vi } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { resolveName } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 10000 } };
function names(entries: readonly (readonly [string, string])[]) {
  return `<gnm:Names>${entries.map(([name, value]) => `<gnm:Name><gnm:name>${name}</gnm:name><gnm:value>${value}</gnm:value><gnm:position>A1</gnm:position></gnm:Name>`).join("")}</gnm:Names>`;
}
function input(formulas: readonly string[], globals = "", locals = "", dataName = "Data") {
  return new TextEncoder().encode(`<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Version Epoch="1" Major="12" Minor="61"/>
    <gnm:SheetNameIndex><gnm:SheetName>Here</gnm:SheetName><gnm:SheetName>${dataName}</gnm:SheetName></gnm:SheetNameIndex>${globals}<gnm:Sheets>
    <gnm:Sheet><gnm:Name>Here</gnm:Name>${locals}<gnm:Cells>${formulas.map((formula, row) => `<gnm:Cell Row="${row}" Col="0">${formula}</gnm:Cell>`).join("")}
    <gnm:Cell Row="0" Col="1" ValueType="40">9</gnm:Cell></gnm:Cells></gnm:Sheet>
    <gnm:Sheet><gnm:Name>${dataName}</gnm:Name></gnm:Sheet></gnm:Sheets></gnm:Workbook>`);
}

it("materializes each XML sheet's permanent names for public lookup and formula evaluation", async () => {
  const book = await readGnumeric(input(["=Sheet_Title", "='dAtA'!Sheet_Title", "=Print_Area", "=Data!Print_Area"]), context);
  for (const sheet of book.sheets) {
    expect(resolveName(book, "Sheet_Title", sheet.id)).toMatchObject({ sheet: sheet.id, expression: `"${sheet.name}"` });
    expect(resolveName(book, "Print_Area", sheet.id)).toMatchObject({ sheet: sheet.id, expression: "#REF!" });
  }
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.slice(0, 4).map(cell => cell.value)).toEqual([
    { kind: "string", value: "Here" }, { kind: "string", value: "Data" },
    { kind: "error", value: "#REF!" }, { kind: "error", value: "#REF!" }
  ]);
});

it("shadows globals with permanent locals while preserving explicitly global and exact-case names", async () => {
  const book = await readGnumeric(input(["=Sheet_Title", "=Print_Area", "=[]Sheet_Title", "=[]Print_Area", "=sheet_title", '=INDIRECT("Print_Area")'],
    names([["Sheet_Title", '"Global"'], ["Print_Area", "$B$1"], ["sheet_title", "13"]])), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.slice(0, 6).map(cell => cell.value)).toEqual([
    { kind: "string", value: "Here" }, { kind: "error", value: "#REF!" },
    { kind: "string", value: "Global" }, { kind: "number", value: 9 },
    { kind: "number", value: 13 }, { kind: "error", value: "#REF!" }
  ]);
});

it("fills permanent names with explicit local definitions without duplicate model records", async () => {
  const book = await readGnumeric(input(["=Sheet_Title", "=Print_Area", '=INDIRECT("Print_Area")'], "",
    names([["Sheet_Title", '"Custom"'], ["Print_Area", "$B$1"]])), context);
  expect(book.names?.filter(name => name.sheet === "s1" && name.name === "Sheet_Title")).toHaveLength(1);
  expect(book.names?.filter(name => name.sheet === "s1" && name.name === "Print_Area")).toHaveLength(1);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.slice(0, 3).map(cell => cell.value)).toEqual([
    { kind: "string", value: "Custom" }, { kind: "number", value: 9 }, { kind: "number", value: 9 }
  ]);
});

it("retains permanent names through XML export and formula-string escaping", async () => {
  const book = await readGnumeric(input([`='A"B\\\\C'!Sheet_Title`], "", "", 'A"B\\C'), context);
  const replay = await readGnumeric(await writeGnumeric(book, [], context), context);
  expect(replay.names).toEqual(book.names);
  expect(recalculateWorkbook(replay, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: 'A"B\\C' });
});

it("links an explicitly defined permanent print area when its precedent becomes dirty", async () => {
  const book = await readGnumeric(input(["=SUM(Print_Area)", '=SUM(INDIRECT("Print_Area"))'], "", names([["Print_Area", "$B$1"]])), context);
  const calculated = recalculateWorkbook(book, context, true);
  const updated = { ...calculated, sheets: calculated.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => cell.column === 1
    ? { ...cell, formula: "=17", formulaDirty: true } : cell) })) };
  expect(recalculateWorkbook(updated, context).sheets[0]!.cells.slice(0, 2).map(cell => cell.value)).toEqual([
    { kind: "number", value: 17 }, { kind: "number", value: 17 }
  ]);
});

it("keeps external permanent-name requests under the supplied capability", async () => {
  const book = await readGnumeric(input(["=[book]Sheet_Title", "=[book]Data!Print_Area"]), context);
  const resolve = vi.fn(() => ({ kind: "number" as const, value: 23 }));
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.slice(0, 2).map(cell => cell.value)).toEqual([
    { kind: "error", value: "#REF!" }, { kind: "error", value: "#REF!" }
  ]);
  expect(recalculateWorkbook(book, { ...context, externalReferences: { resolve } }, true).sheets[0]!.cells.slice(0, 2).map(cell => cell.value)).toEqual([
    { kind: "number", value: 23 }, { kind: "number", value: 23 }
  ]);
  expect(resolve).toHaveBeenCalledTimes(2);
});
