import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Cell, CellValue, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: { SS_INFO_OWNED: "injected" }, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};
const n = (value: number): CellValue => ({ kind: "number", value });
const b = (value: boolean): CellValue => ({ kind: "boolean", value });
const e = (value: string): CellValue => ({ kind: "error", value });
const s = (value: string): CellValue => ({ kind: "string", value });
function calculate(formula: string, cells: readonly Cell[] = []): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    ...cells, { row: 4, column: 4, formula, value: n(999), formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells.at(-1)!.value;
}

it.each<[string, CellValue]>([
  ['=ISODD("3suffix")', b(true)], ['=ISODD("  -3.9suffix")', b(true)],
  ['=ISODD("2suffix")', b(false)], ['=ISODD("word")', b(false)],
  // value_get_as_float delegates to C-locale go_strtod, not ECMAScript whitespace parsing.
  ['=ISODD(" 3")', b(false)], ['=ISODD(" 3")', b(false)],
  ['=ISODD("\t3suffix")', b(true)], ['=ISODD("3 suffix")', b(true)],
  ['=ISODD("+ 3")', b(false)], ['=ISODD("0x3")', b(false)],
  ["=ISODD(-3.9)", b(true)], ["=ISEVEN(-2.9)", b(true)],
  ["=N(A1)", e("#NUM!")], ["=N(TRUE)", n(1)], ["=N(FALSE)", n(0)],
  ['=N("word")', n(0)], ['=N("25%")', n(.25)], ["=N(1/0)", e("#DIV/0!")],
  ["=TYPE(A1)", n(1)], ["=TYPE({1,2})", n(64)], ["=TYPE(1/0)", n(16)],
  ["=TYPE(TRUE)", n(4)], ["=TYPE()", e("#N/A")], ["=TYPE(1,2)", e("#N/A")],
  ["=ISREF(A1:B2)", b(true)], ["=ISREF({1,2})", b(false)], ["=ISREF(1/0)", b(false)],
  ["=ISREF()", e("Invalid number of arguments")], ["=ISREF(A1,A2)", e("Invalid number of arguments")],
  ['=GETENV("SS_INFO_OWNED")', s("injected")], ['=GETENV("HOME")', e("#N/A")],
  ['=CELL("CoLuMn",B3)', n(2)], ['=CELL("row",B3)', n(3)],
  ['=CELL("address",B3)', s("$B$3")], ['=CELL("coord",B3)', s("$B$3")],
  ['=CELL("type",B3)', s("b")], ['=CELL("sheetname",B3)', s("Sheet1")],
  ['=CELL("filename",B3)', s("")], ['=CELL("parentheses",B3)', n(0)],
  ['=CELL("color",B3)', n(0)], ['=CELL("prefix",B3)', s("")],
  ['=CELL("format",B3)', s("G")], ['=CELL("invalid",B3)', e("#VALUE!")],
  ['=CELL("locKed",B3)', e("#VALUE!")],
  ['=CELL("row",2)', e("#VALUE!")], ['=CELL("row")', e("#N/A")],
  ["=EXPRESSION(A1:A2)", e("#REF!")], ["=GET.FORMULA(A1:A2)", e("#REF!")],
  ["=ISFORMULA(A1:A2)", e("#REF!")], ["=ISFORMULA(A1)", b(false)],
  ['=INFO("release")', s("1.12.61")], ['=INFO("directory")', e("Unimplemented")],
  ['=INFO("nonsense")', e("Unknown info_type")], ["=COUNTBLANK(A1:B2)", n(4)]
])("independently stresses %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each<[string, string]>([
  ["m/d/yy", "D4"], ["dd-mmm-yy", "D1"], ["d-mmm", "D2"], ["mmm-yy", "D3"],
  ["mm/dd", "D5"], ["h:mm am/pm", "D7"], ["h:mm:ss am/pm", "D6"], ["h:mm", "D9"], ["h:mm:ss", "D8"]
])("classifies CELL format %s", (format, expected) => {
  expect(calculate('=CELL("format",A1)', [{ row: 0, column: 0, value: n(2), format }])).toEqual(s(expected));
});

it("counts blank values and empty strings without counting errors or zeros", () => {
  expect(calculate("=COUNTBLANK(A1:A4)", [
    { row: 0, column: 0, value: s("") }, { row: 1, column: 0, value: n(0) },
    { row: 2, column: 0, value: e("#N/A") }
  ])).toEqual(n(2));
});

it("CELL address and coord omit the sheet name even for remote references", () => {
  const book: Workbook = { sheets: [
    { id: "s", name: "Sheet1", cells: [
      { row: 0, column: 0, formula: '=CELL("address",\'Remote Sheet\'!B3)', value: n(999), formulaDirty: true },
      { row: 1, column: 0, formula: '=CELL("coord",\'Remote Sheet\'!B3)', value: n(999), formulaDirty: true }
    ] },
    { id: "remote", name: "Remote Sheet", cells: [] }
  ] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells.map(cell => cell.value)).toEqual([s("$B$3"), s("$B$3")]);
});
