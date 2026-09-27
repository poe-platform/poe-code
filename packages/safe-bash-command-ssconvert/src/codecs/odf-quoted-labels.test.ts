import { expect, it } from "vitest";
import { readOdf } from "./odf.js";
import { context, content, fixture } from "./odf.test.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const declaration = '<table:label-ranges><table:label-range table:label-cell-range-address="$Data.$A$1" table:data-cell-range-address="$Data.$A$2:.$A$5" table:orientation="column"/></table:label-ranges>';
const data = '<table:table table:name="Data"><table:table-row><table:table-cell office:value-type="string"><text:p>Sales</text:p></table:table-cell></table:table-row>' +
  '<table:table-row><table:table-cell office:value="2"/></table:table-row><table:table-row table:number-rows-repeated="2"/>' +
  '<table:table-row><table:table-cell office:value="3"/></table:table-row></table:table>';
async function source(formula: string, attributes = 'office:value="999"', extra = '') {
  return fixture({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet', 'content.xml': content(
    '<table:calculation-settings table:automatic-find-labels="false"/>' +
    `<table:table table:name="Output"><table:table-row><table:table-cell table:formula="${formula}" ${attributes}/></table:table-row>${extra}</table:table>` + data + declaration) });
}

it.each(['office:value="999"', ''])("imports a forward declared label with attributes %s and computes across a blank gap", async attributes => {
  const diagnostics: string[] = [];
  const book = await readOdf(await source("of:=SUM('Sales')", attributes), { ...context, async diagnostic(d) { diagnostics.push(d.code); } });
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: "=SUM(@column.quoted:Data!A$1)", formulaDirty: true });
  expect(diagnostics).toEqual([]);
  expect(book.sheets[0]!.unsupportedRecords?.some(r => r.kind === "unparsed-formula")).toBe(false);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 5 });
  const changed = { ...book, sheets: book.sheets.map(sheet => sheet.name === "Data" ? { ...sheet,
    cells: sheet.cells.map(cell => cell.row === 0 ? { ...cell, value: { kind: "string" as const, value: "Changed" } } : cell)
  } : sheet) };
  expect(recalculateWorkbook(changed, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 5 });
});

it("binds sheet-local named expressions after declarations and cells load", async () => {
  const local = '<table:named-expressions><table:named-expression table:name="Total" table:expression="of:=SUM(\'Sales\')" table:base-cell-address="$Output.$A$1"/></table:named-expressions>';
  const book = await readOdf(await source('of:=Total', 'office:value="999"', local), context);
  expect(book.names).toContainEqual(expect.objectContaining({ name: "Total", sheet: "Output", expression: "=SUM(@column.quoted:Data!A$1)" }));
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 5 });
});

it("charges the enclosing operation for label lookup and aborts with the exact reason", async () => {
  const bytes = await source("of:=SUM('Sales')");
  await expect(readOdf(bytes, { ...context, limits: { ...context.limits, workbookWork: 1 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
  const controller = new AbortController(), reason = new Error("cancel native labels");
  controller.abort(reason);
  await expect(readOdf(bytes, { ...context, signal: controller.signal })).rejects.toBe(reason);
});

it("retains a bound array formula and its covered cells", async () => {
  const book = await readOdf(await source("of:=SUM('Sales')", 'office:value="999" table:number-matrix-columns-spanned="2" table:number-matrix-rows-spanned="1"'), context);
  expect(book.sheets[0]!.formulaGroups).toMatchObject([{ expression: "=SUM(@column.quoted:Data!A$1)", kind: "array" }]);
  expect(book.sheets[0]!.cells).toHaveLength(2);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 5 });
});

it("preserves OpenCalc repeats: one bound formula and cached scalar copies", async () => {
  const book = await readOdf(await source("of:=SUM('Sales')", 'office:value="999" table:number-columns-repeated="2"'), context);
  expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(["=SUM(@column.quoted:Data!A$1)", undefined]);
});

it.each(['office:value="999"', ''])("retains an unresolved source without a fabricated formula or array group (%s)", async attributes => {
  const diagnostics: string[] = [];
  const book = await readOdf(await source("of:=SUM('Missing')", attributes + ' table:number-matrix-columns-spanned="2" table:number-matrix-rows-spanned="1"'),
    { ...context, async diagnostic(d) { diagnostics.push(d.code); } });
  expect(diagnostics).toHaveLength(1);
  expect(book.sheets[0]!.cells).toHaveLength(attributes ? 1 : 0);
  expect(book.sheets[0]!.cells[0]?.formula).toBeUndefined();
  expect(book.sheets[0]!.formulaGroups).toEqual([]);
  expect(book.sheets[0]!.unsupportedRecords).toContainEqual(expect.objectContaining({ kind: "unparsed-formula", data: expect.objectContaining({ formula: "of:=SUM('Missing')" }) }));
});
