import { expect, it } from "vitest";
import type { CapabilityContext, Diagnostic } from "../contracts.js";
import { readSpreadsheetML } from "./spreadsheetml.js";

const namespace = "urn:schemas-microsoft-com:office:spreadsheet";
const bytes = (body: string) => new TextEncoder().encode(`<Workbook xmlns="${namespace}" xmlns:ss="${namespace}"><Worksheet ss:Name="S"><Table>${body}</Table></Worksheet></Workbook>`);
function context() {
  const diagnostics: Diagnostic[] = [];
  const value: CapabilityContext = { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 100 }, own() {},
    async diagnostic(diagnostic) { diagnostics.push(diagnostic); } };
  return { value, diagnostics };
}

it("processes interleaved Table Row and Column warnings in source order", async () => {
  const c = context();
  const book = await readSpreadsheetML(bytes('<Row><Cell><Data ss:Type="Number">bad</Data></Cell></Row><Column ss:Width="bad"/>'), c.value);
  expect(book.sheets[0]!.columns?.map(column => column.index)).toEqual([1]);
  expect(c.diagnostics.map(diagnostic => diagnostic.message)).toEqual([
    "S!A1 : Invalid content of ss:data element, expected number, received 'bad'\n",
    "S : Invalid attribute 'Width', expected number, received 'bad'\n"
  ]);
});

it("uses the shared cell cursor for a late Column and resets it for the next Row", async () => {
  const book = await readSpreadsheetML(bytes('<Row><Cell ss:Index="3" ss:MergeAcross="1"><Data>x</Data></Cell></Row>' +
    '<Column ss:Width="17"/><Row><Cell><Data>y</Data></Cell></Row><Column ss:Width="23"/>'), context().value);
  expect(book.sheets[0]!.columns).toEqual([{ index: 1, sizePoints: 23 }, { index: 4, sizePoints: 17 }]);
  expect(book.sheets[0]!.cells.map(cell => [cell.row, cell.column, cell.value])).toEqual([
    [0, 2, { kind: "string", value: "x" }], [1, 0, { kind: "string", value: "y" }]
  ]);
});

it("preserves unknown-element diagnostics between interleaved axes", async () => {
  const c = context();
  await readSpreadsheetML(bytes('<Row><Cell><Data ss:Type="Number">bad</Data></Cell></Row><Mystery/><Column ss:Width="bad"/>'), c.value);
  expect(c.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
    "spreadsheetml-content", "spreadsheetml-unknown-element", "spreadsheetml-content"
  ]);
});

it("does not let foreign namespace Columns mutate recognized axis state", async () => {
  const c = context();
  const book = await readSpreadsheetML(bytes('<Row><Cell><Data>x</Data></Cell></Row><Column xmlns="urn:unrecognized" ss:Index="9" ss:Width="99"/>' +
    '<Column ss:Width="11"/>'), c.value);
  expect(book.sheets[0]!.columns).toEqual([{ index: 1, sizePoints: 11 }]);
  expect(c.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["spreadsheetml-unknown-element"]);
});
