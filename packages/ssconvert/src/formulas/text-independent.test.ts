import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
  own() {}
};
const n = (value: number): CellValue => ({ kind: "number", value });
const s = (value: string): CellValue => ({ kind: "string", value });
const e = (value: string): CellValue => ({ kind: "error", value });
function calculate(formula: string): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: n(999), formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value;
}

// Audited directly against released fn-string source, including helper collection order.
it.each<[string, CellValue]>([
  ['=SUBSTITUTE("a-a-a","a","x",0.5)', s("x-x-x")],
  ['=SUBSTITUTE("a-a-a","a","x",1.5)', s("x-a-a")],
  ['=SUBSTITUTE("a","a","x",0)', e("#VALUE!")],
  ['=TEXTAFTER("a--b",{"-","--"})', s("b")],
  ['=TEXTAFTER("a--b",{"--","-"})', s("-b")],
  ['=TEXTAFTER("aXb","x",1,1.5)', s("b")],
  ['=TEXTBEFORE("abc","-",2,0,1.5)', s("abc")],
  ['=CONCAT(TEXTSPLIT("aXb","x",,FALSE,1.5))', s("ab")]
])("matches released text argument behavior for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

// Numeric formatting must remain decimal at the binary64 exponent boundaries.
it.each<[string, CellValue]>([
  ['=FIXED(1E21,2,TRUE)', s("1000000000000000000000.00")],
  ['=DOLLAR(-0.001,2)', s("$0.00")],
  ['=FIXED(1E308,2,TRUE)', s("100000000000000001097906362944045541740492309677311846336810682903157585404911491537163328978494688899061249669721172515611590283743140088328307009198146046031271664502933027185697489699588559043338384466165001178426897626212945177628091195786707458122783970171784415105291802893207873272974885715430223118336.00")]
])("formats numeric boundary %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each<[string, CellValue]>([
  ['=LEN("a😀é")', n(3)], ['=LENB("a😀é")', n(7)],
  ['=LEFTB("a😀é",4)', s("a")], ['=LEFTB("a😀é",5)', s("a😀")],
  ['=RIGHTB("a😀é",5)', s("é")], ['=RIGHTB("a😀é",6)', s("😀é")],
  ['=MIDB("a😀é",2,3)', s("")], ['=MIDB("a😀é",3,4)', e("#VALUE!")],
  ['=MIDB("",1,0)', e("#VALUE!")], ['=MID("",1,0)', s("")],
  ['=REPLACEB("a😀é",2,4,"b")', s("abé")],
  ['=REPLACEB("a😀é",3,3,"b")', e("#VALUE!")],
  ['=FIND("","abc",3)', n(3)], ['=FIND("","",1)', e("#VALUE!")],
  ['=FINDB("v","Lévy",3)', n(4)], ['=SEARCH("~*","a*b")', n(2)],
  ['=SEARCH("?b","😀B")', n(1)], ['=SEARCHB("é","aé",2)', n(2)],
  ['=ASC("ガパＡ￥’")', s("ｶﾞﾊﾟA\\'")], ['=JIS("ｶﾞﾊﾟ")', s("ガ゛パ゜")],
  ['=CODE(CHAR(128))', n(128)], ['=CHAR(129)', e("#VALUE!")],
  ['=UNICHAR(65534)', e("#VALUE!")], ['=UNICODE("😀a")', n(128512)],
  ['=UPPER("straße")', s("STRASSE")], ['=LOWER("ÉA")', s("éa")],
  ['=TRIM(" a  b ")', s("a  b")], ['=PROPER("a2BC")', s("A2Bc")],
  ['=ENCODEURL("é/?")', s("%C3%A9%2F%3F")], ['=CLEAN("a"&CHAR(7))', s("a")],
  ['=FIXED(1234.5,1,TRUE)', s("1234.5")], ['=FIXED(1234,-2)', s("1,200")],
  ['=DOLLAR(-1234.5,1)', s("($1,234.5)")], ['=DOLLAR(1,128)', e("#VALUE!")],
  ['=TEXT(-12.5,"0.0;(0.0)")', s("(12.5)")], ['=TEXT(0.125,"0.0%")', s("12.5%")],
  ['=VALUE("(1,234.5)")', n(-1234.5)], ['=NUMBERVALUE("1.234,5",",")', n(1234.5)],
  ['=T(42)', n(0)], ['=T("abc")', s("abc")],
  ['=TEXTJOIN("-",FALSE,{"a","","b"})', s("a--b")],
  ['=TEXTAFTER("abc","")', e("#N/A")], ['=TEXTBEFORE("abc","")', e("#N/A")],
  ['=CONCAT(TEXTSPLIT("a,b;c",",",";",FALSE,0,7))', s("abc7")],
  ['=CONCATENATE({"a","b"},3)', s("ab3")],
  ['=LEFT()', e("#N/A")], ['=MID("a",1)', e("#N/A")],
  ['=LEN("a","b")', e("#N/A")], ['=TEXTJOIN("-",TRUE)', e("#VALUE!")]
])("independently stresses text and UTF-8 behavior for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it("applies Unicode slicing separately to supported array elements", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [
    { id: "bytes", kind: "array", expression: '=LEFTB({"é","😀"},2)',
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } }
  ] }] };
  const cells = recalculateWorkbook(book, context, true).sheets[0]!.cells;
  expect(cells.map(cell => cell.value)).toEqual([s("é"), s("")]);
});

it("preserves a text formula/cache until explicit recalculation", () => {
  const formula = '=TEXTJOIN("-",TRUE,{"a","","b"})';
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: s("old"), cachedResult: s("old"), formulaDirty: false }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual(s("old"));
  const cell = recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!;
  expect(cell.formula).toBe(formula);
  expect(cell.value).toEqual(s("a-b"));
  expect(cell.cachedResult).toEqual(s("a-b"));
  expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual(s("old"));
});

it("reports uncaptured format locales as unsupported rather than a successful result", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: '=TEXT(1.5,"0.0")', value: n(0), formulaDirty: true }
  ] }] };
  expect(() => recalculateWorkbook(book, {
    ...context, environment: { ...context.environment, locale: "fr_FR.UTF-8" }
  })).toThrow("uncaptured format locale");
});

it.each<[string, CellValue]>([
  ['=TEXT(12,"0000")', s("0012")],
  ['=TEXT(-12,"0000.00")', s("-0012.00")],
  ['=TEXT(1.25,"000.00")', s("001.25")]
])("pads mandatory numeric format positions for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each<[string, CellValue]>([
  ['=PROPER("ßA")', s("ßa")], ['=PROPER("中a")', s("中a")],
  ['=PROPER("aİ")', s("Ai")], ['=PROPER("ﬁA")', s("ﬁa")],
  ['=CLEAN("a​b")', s("ab")], ['=CLEAN("a"&UNICHAR(888)&"b")', s("ab")],
  ['=CLEAN("a"&UNICHAR(8232)&UNICHAR(160)&"b")', s("a\u2028 b")],
  ['=CLEAN("a"&UNICHAR(57344)&"b")', s("a\ue000b")]
])("matches captured GLib Unicode properties for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each<[string, CellValue]>([
  ['=TEXT(1234567,"0.0,,")', s("1.2")],
  ['=TEXT(1234567,"#,##0,")', s("1,235")],
  ['=TEXT(0,"#")', s("0")], ['=TEXT(0.5,"#.##")', s(".5")],
  ['=TEXT(0,"#.00")', s(".00")], ['=TEXT(0,"0")', s("0")]
])("handles numeric scaling and optional positions for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each<[string, CellValue]>([
  ['=VALUE("2000-01-01")', n(36526)], ['=VALUE("1900-02-29")', e("#VALUE!")],
  ['=VALUE("12:30")', n(12.5 / 24)], ['=VALUE("30:00.0")', n(30 / 1440)],
  ['=VALUE("25:00:00")', n(25 / 24)], ['=VALUE("12:60")', e("#VALUE!")],
  ['=VALUE("12:30 pm")', n(12.5 / 24)],
  ['=TEXT(12345,"0.00E+00")', s("1.23E+04")],
  ['=TEXT(0.0123,"0.0E-00")', s("1.2E-02")],
  ['=TEXT(36526.5,"yyyy-mm-dd hh:mm:ss")', s("2000-01-01 12:00:00")],
  ['=TEXT(0.5,"hh:mm:ss")', s("12:00:00")],
  ['=TEXT(60,"yyyy-mm-dd")', e("#VALUE!")]
])("implements source-backed temporal/scientific formats for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each<[string, CellValue]>([
  ['=VALUE("1899-12-31")', n(0)],
  ['=TEXT(-1,"yyyy-mm-dd")', s("1899-12-30")],
  ['=TEXT(-0.5,"hh:mm:ss")', s("12:00:00")]
])("preserves GOffice negative-date support for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it("formats a time-only serial 60 without applying the invalid-date rejection", () => {
  expect(calculate('=TEXT(60,"hh:mm:ss")')).toEqual(s("00:00:00"));
});

it.each<[string, CellValue]>([
  ['=TEXT(36526,"dddd, mmmm d, yyyy")', s("Saturday, January 1, 2000")],
  ['=TEXT(36526,"ddd mmm mmmmm")', s("Sat Jan J")],
  ['=TEXT(0,"h:mm AM/PM")', s("12:00 AM")],
  ['=TEXT(0.5,"h:mm am/pm")', s("12:00 PM")],
  ['=TEXT(0.75,"hh:mm A/P")', s("06:00 P")],
  ['=TEXT(0.25,"h:mm a/p")', s("6:00 a")],
  ['=TEXT(1.5,"[h]:mm:ss")', s("36:00:00")],
  ['=TEXT(-1.5,"[hh]:mm:ss")', s("-36:00:00")],
  ['=TEXT(1.5,"[m]:ss")', s("2160:00")],
  ['=TEXT(0.5,"[s]")', s("43200")],
  ['=TEXT(1.25/86400,"ss.000")', s("01.250")],
  ['=TEXT(59.9996/86400,"mm:ss.000")', s("01:00.000")],
  ['=TEXT(1/86400,"ss.0000")', e("#VALUE!")],
  ['=TEXT(0.5,"[h]:mm AM/PM")', e("#VALUE!")]
])("formats standard C locale dates and elapsed times for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each<[string, CellValue]>([
  ['=TEXT(1.25,"# ?/?")', s("1 1/4")],
  ['=TEXT(1.25,"?/ ?")', s("5/ 4")],
  ['=TEXT(-1.25,"??/??")', s("- 5/ 4")],
  ['=TEXT(0.5,"# ?/?")', s("1/2")],
  ['=TEXT(0.3,"?/ ?")', s("1/ 3")],
  ['=TEXT(0.3,"??/??")', s(" 3/10")],
  ['=TEXT(1.25,"# ?/16")', s("1 4/16")],
  ['=TEXT(1.25,"?/16")', s("20/16")],
  ['=TEXT(1.99,"# ?/8")', s("2    ")],
  ['=TEXT(2,"# 00/16")', s("2 00/16")],
  ['=TEXT(0,"?/ ?")', s("0/ 1")],
  ['=TEXT(2,"# ?/?")', s("2    ")]
])("formats standard mixed and improper fractions for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each<[string, CellValue]>([
  ['=TEXT(1.25,"00/00")', s("05/04")],
  ['=TEXT(0.3,"##/##")', s("3/10")],
  ['=TEXT(0.5,"# ?/1?")', e("#VALUE!")],
  ['=TEXT(0.5,"0 ?/?")', s("0 1/2")]
])("preserves fraction placeholder and denominator contracts for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});
