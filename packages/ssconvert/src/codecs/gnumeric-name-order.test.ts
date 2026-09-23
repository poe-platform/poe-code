import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 10000 } };
function names(entries: readonly (readonly [string, string])[]) {
  return `<gnm:Names>${entries.map(([name, value]) => `<gnm:Name><gnm:name>${name}</gnm:name><gnm:value>${value}</gnm:value><gnm:position>A1</gnm:position></gnm:Name>`).join("")}</gnm:Names>`;
}
function cells(formulas: readonly string[]) {
  return `<gnm:Cells>${formulas.map((formula, row) => `<gnm:Cell Row="${row}" Col="0">${formula}</gnm:Cell>`).join("")}</gnm:Cells>`;
}
function input(sheets: readonly (readonly [string, string])[], globals = names([["Rate", "11"], ["rate", "13"]]), globalsAfter = false) {
  return new TextEncoder().encode(`<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Version Epoch="1" Major="12" Minor="61"/>
    <gnm:SheetNameIndex><gnm:SheetName>Here</gnm:SheetName><gnm:SheetName>Data</gnm:SheetName></gnm:SheetNameIndex>
    ${globalsAfter ? "" : globals}<gnm:Sheets>${sheets.map(([name, body]) => `<gnm:Sheet><gnm:Name>${name}</gnm:Name>${body}</gnm:Sheet>`).join("")}</gnm:Sheets>${globalsAfter ? globals : ""}</gnm:Workbook>`);
}

it("retains native global bindings when the referenced local names are declared later", async () => {
  // Same declaration/cell ordering as native35925225030's three BIFF XML exports.
  const book = await readGnumeric(input([
    ["Here", cells(["=Data!Rate", "=Data!rate", "=Rate", "=rate", "=Data!Bridge", "=#NAME?"])],
    ["Data", names([["Bridge", "Rate+rate+[]Rate+[]rate"], ["Rate", "2"], ["rate", "3"]])]
  ]), context);
  const expected: CellValue[] = [11, 13, 11, 13, 29].map(value => ({ kind: "number", value }));
  expected.push({ kind: "error", value: "#NAME?" });
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(expected);
  expect(book.sheets[0]!.cells.slice(0, 2).map(cell => cell.formula)).toEqual(["=[]Rate", "=[]rate"]);
  expect(recalculateWorkbook(await readGnumeric(await writeGnumeric(book, [], context), context), context, true)
    .sheets[0]!.cells.map(cell => cell.value)).toEqual(expected);
});

it("uses XML declaration order independently of the sheet index order", async () => {
  const book = await readGnumeric(input([
    ["Data", names([["Rate", "2"]])], ["Here", cells(["='dAtA'!Rate"])]
  ]), context);
  expect(book.sheets.map(sheet => sheet.name)).toEqual(["Here", "Data"]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 2 });
});

it("does not let a later local declaration retarget an earlier unqualified global name", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Rate"]) + names([["Rate", "2"]])], ["Data", ""]]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=[]Rate");
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 11 });
});

it("reserves a forward local placeholder when no global definition is visible yet", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Data!Rate"])], ["Data", names([["Rate", "2"]])]], names([["Rate", "11"]]), true), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 2 });
});

it("does not bind a local placeholder to a global declaration that appears later", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Data!Rate"])], ["Data", ""]], names([["Rate", "11"]]), true), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#NAME?" });
  expect(book.names).toContainEqual({ name: "Rate", expression: "#NAME?", sheet: "s2", position: { sheet: "s2", row: 0, column: 0 } });
});

it("resolves later unqualified uses on the placeholder's own sheet to that placeholder", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Data!Rate"])], ["Data", cells(["=Rate"])]], names([["Rate", "11"]]), true), context);
  expect(recalculateWorkbook(book, context, true).sheets.map(sheet => sheet.cells[0]!.value)).toEqual([
    { kind: "error", value: "#NAME?" }, { kind: "error", value: "#NAME?" }
  ]);
});

it("retains exact placeholder names and their first parse position under folded sheet spelling", async () => {
  const source = cells(["=Data!Rate", "='dAtA'!Rate", "=Data!rate", "=Rate", "=rate"]);
  const book = await readGnumeric(input([["Here", source], ["Data", ""]], names([["Rate", "11"], ["rate", "13"]]), true), context);
  expect(book.names?.filter(name => name.sheet === "s2")).toEqual([
    { name: "Rate", expression: "#NAME?", sheet: "s2", position: { sheet: "s2", row: 0, column: 0 } },
    { name: "rate", expression: "#NAME?", sheet: "s2", position: { sheet: "s2", row: 2, column: 0 } }
  ]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "error", value: "#NAME?" }, { kind: "error", value: "#NAME?" }, { kind: "error", value: "#NAME?" },
    { kind: "number", value: 11 }, { kind: "number", value: 13 }
  ]);
});

it("keeps a placeholder available for a later explicit model definition", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Data!Rate"])], ["Data", ""]], names([["Rate", "11"]]), true), context);
  const edited = { ...book, names: (book.names ?? []).map(name => name.sheet === "s2" && name.name === "Rate" ? { ...name, expression: "7" } : name) };
  expect(recalculateWorkbook(edited, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("does not add a duplicate placeholder when a later local declaration fills it", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Data!Rate"])], ["Data", names([["Rate", "2"]])]], names([["Rate", "11"]]), true), context);
  expect(book.names?.filter(name => name.sheet === "s2" && name.name === "Rate")).toHaveLength(1);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 2 });
});

it("retains an unresolved local placeholder in XML when no later global definition exists", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Data!Rate"])], ["Data", ""]], ""), context);
  const replay = await readGnumeric(await writeGnumeric(book, [], context), context);
  expect(replay.names?.find(name => name.name === "Rate" && name.sheet === "s2")?.expression).toBe("#NAME?");
  expect(recalculateWorkbook(replay, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#NAME?" });
});

it("retains global placeholders created by unqualified and explicitly global names", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Unknown", "=[]Explicit", "=Unknown"])], ["Data", ""]], ""), context);
  expect(book.names).toEqual([
    { name: "Unknown", expression: "#NAME?", position: { sheet: "s1", row: 0, column: 0 } },
    { name: "Explicit", expression: "#NAME?", position: { sheet: "s1", row: 1, column: 0 } }
  ]);
  const replay = await readGnumeric(await writeGnumeric(book, [], context), context);
  expect(replay.names).toEqual(book.names);
});

it("retains an earlier global placeholder beside a later same-spelled local declaration", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Rate", "=Data!Rate"])], ["Data", names([["Rate", "2"]])]], ""), context);
  expect(book.names?.find(name => name.sheet === undefined && name.name === "Rate")?.expression).toBe("#NAME?");
  const edited = { ...book, names: (book.names ?? []).map(name => name.sheet === undefined ? { ...name, expression: "7" } : name) };
  expect(recalculateWorkbook(edited, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "number", value: 7 }, { kind: "number", value: 7 }
  ]);
});

it("includes earlier global placeholders in later qualified-name lookup", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Rate", "=Data!Rate"])], ["Data", names([["Rate", "2"]])]], ""), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "error", value: "#NAME?" }, { kind: "error", value: "#NAME?" }
  ]);
});

it("keeps case-distinct names and literal formula text independent of sheet folding", async () => {
  const book = await readGnumeric(input([["Here", cells(["=Data!RATE", '="Data!Rate"'])], ["Data", names([["RATE", "2"]])]]), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "number", value: 2 }, { kind: "string", value: "Data!Rate" }
  ]);
});

it("replays a shared formula's original global binding", async () => {
  const shared = '<gnm:Cells><gnm:Cell Row="0" Col="0" ExprID="1">=Data!Rate</gnm:Cell><gnm:Cell Row="1" Col="0" ExprID="1"/></gnm:Cells>';
  const book = await readGnumeric(input([["Here", shared], ["Data", names([["Rate", "2"]])]]), context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "number", value: 11 }, { kind: "number", value: 11 }
  ]);
});
