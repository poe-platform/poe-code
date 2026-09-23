import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Cell, CellValue, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
  own() {}
};
const number = (value: number): CellValue => ({ kind: "number", value });
const text = (value: string): CellValue => ({ kind: "string", value });
const boolean = (value: boolean): CellValue => ({ kind: "boolean", value });
const error = (value: string): CellValue => ({ kind: "error", value });
function calculate(formula: string, cells: readonly Cell[] = [], supplied = context): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    ...cells, { row: 9, column: 9, formula, value: number(0), formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, supplied).sheets[0]!.cells.at(-1)!.value;
}

// Expected values follow released source, including Gnumeric's UTF-8 byte semantics.
it.each<[string, CellValue]>([
  ["=AND(TRUE,2)", boolean(true)], ["=AND(FALSE,1/0)", error("#DIV/0!")],
  ["=IFS(FALSE,1/0,TRUE,7)", number(7)], ["=IFS(1,7)", error("#VALUE!")],
  ['=LEN("a😀é")', number(3)], ['=LENB("a😀é")', number(7)],
  ['=LEFTB("Lévy",2)', text("L")], ['=MIDB("Lévy",3,2)', error("#VALUE!")],
  ["=ISERROR(1/0)", boolean(true)], ["=ISERROR(7)", boolean(false)], ['=N("12")', number(12)],
  ['=ADDRESS(2,3)', text("$C$2")], ['=MATCH(3,{1;3;5},0)', number(2)],
  ['=INDEX({1,2;3,4},2,2)', number(4)], ['=INDEX({1,2},0)', error("#REF!")]
  ,['=ASC("ＡＢＣ")', text("ABC")], ['=ASC("")', text("")],
  ['=JIS("ABC")', text("ＡＢＣ")], ['=JIS("")', text("")],
  ['=CHAR(65)', text("A")], ['=CHAR(0)', error("#VALUE!")],
  ['=UNICHAR(128512)', text("😀")], ['=UNICHAR(55296)', error("#VALUE!")],
  ['=CODE("A")', number(65)], ['=CODE("")', error("#VALUE!")],
  ['=UNICODE("😀")', number(128512)], ['=UNICODE("")', error("#VALUE!")],
  ['=CLEAN("a"&CHAR(7))', text("a")], ['=CLEAN("")', text("")],
  ['=CONCAT({"a","b"},"c")', text("abc")], ['=CONCAT(1/0)', error("#DIV/0!")],
  ['=CONCATENATE("a",2)', text("a2")], ['=CONCATENATE(1/0)', error("#DIV/0!")],
  ['=DOLLAR(12.34)', text("$12.34")], ['=DOLLAR(1,128)', error("#VALUE!")],
  ['=FIXED(1234.5,1)', text("1,234.5")], ['=FIXED(1,128)', error("#VALUE!")],
  ['=ENCODEURL("a b/é")', text("a%20b%2F%C3%A9")], ['=ENCODEURL("")', text("")],
  ['=EXACT("é","é")', boolean(true)], ['=EXACT("A","a")', boolean(false)],
  ['=FIND("é","Lévy")', number(2)], ['=FIND("x","abc")', error("#VALUE!")],
  ['=FINDB("v","Lévy")', number(4)], ['=FINDB("x","abc")', error("#VALUE!")],
  ['=LEFT("😀ab",2)', text("😀a")], ['=LEFT("abc",-1)', error("#VALUE!")],
  ['=LOWER("ÉABC")', text("éabc")], ['=LOWER("")', text("")],
  ['=MID("😀ab",2,1)', text("a")], ['=MID("abc",0,1)', error("#VALUE!")],
  ['=NUMBERVALUE("1.234,5",",")', number(1234.5)], ['=NUMBERVALUE("1",";")', error("#VALUE!")],
  ['=PROPER("a2BC")', text("A2Bc")], ['=PROPER("")', text("")],
  ['=REPLACE("abcd",2,2,"x")', text("axd")], ['=REPLACE("a",0,1,"x")', error("#VALUE!")],
  ['=REPLACEB("Lévy",2,2,"x")', text("Lxvy")], ['=REPLACEB("Lévy",2,1,"x")', error("#VALUE!")],
  ['=REPT("ab",3)', text("ababab")], ['=REPT("a",-1)', error("#VALUE!")],
  ['=RIGHT("😀ab",2)', text("ab")], ['=RIGHT("a",-1)', error("#VALUE!")],
  ['=RIGHTB("aé",2)', text("é")], ['=RIGHTB("aé",1)', text("")],
  ['=SEARCH("c*c","Cancún")', number(1)], ['=SEARCH("x","abc")', error("#VALUE!")],
  ['=SEARCHB("v","Lévy")', number(4)], ['=SEARCHB("x","abc")', error("#VALUE!")],
  ['=SUBSTITUTE("a-a-a","a","x",2)', text("a-x-a")], ['=SUBSTITUTE("a","a","x",0)', error("#VALUE!")],
  ['=T("abc")', text("abc")], ['=T(42)', { kind: "blank" }],
  ['=TEXT(12.345,"0.00")', text("12.35")], ['=TEXT("abc","0.00")', text("abc")],
  ['=TEXTAFTER("a-b-c","-",-1)', text("c")], ['=TEXTAFTER("a","-",0)', error("#VALUE!")],
  ['=TEXTBEFORE("a-b-c","-",2)', text("a-b")], ['=TEXTBEFORE("a","-")', error("#N/A")],
  ['=TEXTJOIN("-",TRUE,{"a","","b"})', text("a-b")], ['=TEXTJOIN("-",TRUE)', error("#VALUE!")],
  ['=INDEX(TEXTSPLIT("a,b;c",",",";"),2,1)', text("c")], ['=INDEX(TEXTSPLIT("a,b;c",",",";"),2,2)', error("#N/A")],
  ['=TRIM("  a   b  ")', text("a b")], ['=TRIM("")', text("")],
  ['=UPPER("éabc")', text("ÉABC")], ['=UPPER("")', text("")],
  ['=VALUE("$1,234.5")', number(1234.5)], ['=VALUE("abc")', error("#VALUE!")]
  ,['=ERROR.TYPE(#REF!)', number(4)], ['=ERROR.TYPE(7)', error("#N/A")],
  ['=INFO("release")', text("1.12.61")], ['=INFO("unknown")', error("Unknown info_type")],
  ['=ISBLANK(A1)', boolean(true)], ['=ISBLANK("")', boolean(false)],
  ['=ISERR(1/0)', boolean(true)], ['=ISERR(#N/A)', boolean(false)],
  ['=ISEVEN(-2.9)', boolean(true)], ['=ISEVEN("x")', error("#VALUE!")],
  ['=ISLOGICAL(TRUE)', boolean(true)], ['=ISLOGICAL(1)', boolean(false)],
  ['=ISNA(#N/A)', boolean(true)], ['=ISNA(1/0)', boolean(false)],
  ['=ISNONTEXT(1)', boolean(true)], ['=ISNONTEXT("")', boolean(false)],
  ['=ISNUMBER(1)', boolean(true)], ['=ISNUMBER(TRUE)', boolean(false)],
  ['=ISODD(-3.9)', boolean(true)], ['=ISODD("x")', boolean(false)],
  ['=ISREF(A1)', boolean(true)], ['=ISREF(1)', boolean(false)],
  ['=ISTEXT("")', boolean(true)], ['=ISTEXT(#VALUE!)', boolean(false)],
  ['=N("text")', number(0)], ['=N(#VALUE!)', error("#VALUE!")],
  ['=NA()', error("#N/A")], ['=NA(1)', error("#N/A")],
  ['=TYPE({1,2})', number(64)], ['=TYPE(A1:A2)', number(16)],
  ['=COUNTBLANK(A1:A3)', number(3)], ['=COUNTBLANK(1)', error("#VALUE!")],
  ['=ERROR("custom")', error("custom")], ['=ERROR(1/0)', error("#DIV/0!")],
  ['=EXPRESSION(A1)', { kind: "blank" }], ['=EXPRESSION(A1:A2)', error("#REF!")],
  ['=GET.FORMULA(A1)', { kind: "blank" }], ['=GET.FORMULA(A1:A2)', error("#REF!")],
  ['=GET.LINK(A1)', { kind: "blank" }], ['=GET.LINK(A1:A2)', error("#REF!")],
  ['=ISFORMULA(A1)', boolean(false)], ['=ISFORMULA(A1:A2)', error("#REF!")],
  ['=GETENV("missing")', error("#N/A")], ['=GETENV(1/0)', error("#DIV/0!")],
  ['=CELL("row",A3)', number(3)], ['=CELL("unknown",A3)', error("#VALUE!")]
  ,['=AREAS((A1,B2))', number(2)], ['=AREAS(7)', error("#VALUE!")],
  ['=CHOOSE(2,1/0,7)', number(7)], ['=CHOOSE(TRUE,7)', error("#VALUE!")],
  ['=COLUMN(C1)', number(3)], ['=COLUMN({1,2})', error("#VALUE!")],
  ['=COLUMNNUMBER("IV")', number(256)], ['=COLUMNNUMBER("IW")', error("#VALUE!")],
  ['=COLUMNS({1,2;3,4})', number(2)], ['=COLUMNS(7)', number(1)],
  ['=HLOOKUP(3,{1,3;7,9},2,FALSE)', number(9)], ['=HLOOKUP(1,{1},2)', error("#REF!")],
  ['=HYPERLINK("url","label")', text("label")], ['=HYPERLINK(1/0,"label")', error("#DIV/0!")],
  ['=ISREF(INDIRECT("A1"))', boolean(true)], ['=INDIRECT("1+2")', error("#REF!")],
  ['=LOOKUP(3,{1,2;3,4;5,6})', number(4)], ['=LOOKUP(0,{1;3})', error("#N/A")],
  ['=ISREF(OFFSET(A1,1,1))', boolean(true)], ['=OFFSET(A1,-1,0)', error("#REF!")],
  ['=ROW(A3)', number(3)], ['=ROW({1,2})', error("#VALUE!")],
  ['=ROWS({1;2;3})', number(3)], ['=ROWS(7)', number(1)],
  ['=SHEETS()', number(1)], ['=SHEETS(7)', number(1)],
  ['=SHEET("Sheet1")', number(1)], ['=SHEET("missing")', error("#NUM!")],
  ['=INDEX(SORT({3,1,2}),2)', number(2)], ['=SORT({1},2)', error("#VALUE!")],
  ['=INDEX(TRANSPOSE({1,2;3,4}),1,2)', number(3)], ['=TRANSPOSE(1/0)', error("#DIV/0!")],
  ['=ROWS(UNIQUE({1;1;2}))', number(2)], ['=UNIQUE({1;1},FALSE,TRUE)', error("#VALUE!")],
  ['=VLOOKUP(3,{1,7;3,9},2,FALSE)', number(9)], ['=VLOOKUP(1,{1},0)', error("#VALUE!")],
  ['=XLOOKUP(3,{1;3},{7;9})', number(9)], ['=XLOOKUP(2,{1;3},{7;9})', error("#N/A")],
  ['=XMATCH(3,{1;3})', number(2)], ['=XMATCH(2,{1;3})', error("#N/A")],
  ['=INDEX(ARRAY({1,2},3),3)', number(3)], ['=ARRAY()', error("#VALUE!")],
  ['=INDEX(FLIP({1,2;3,4}),1,1)', number(3)], ['=FLIP(1/0)', error("#DIV/0!")]
])("calculates %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it("selects database rows by OR criteria and AND fields", () => {
  const cells: Cell[] = [
    { row: 0, column: 0, value: text("Name") }, { row: 0, column: 1, value: text("Amount") },
    { row: 1, column: 0, value: text("apple") }, { row: 1, column: 1, value: number(3) },
    { row: 2, column: 0, value: text("pear") }, { row: 2, column: 1, value: number(7) },
    { row: 0, column: 3, value: text("Name") }, { row: 1, column: 3, value: text("a*") }
  ];
  expect(calculate('=DSUM(A1:B3,"Amount",D1:D2)', cells)).toEqual(number(3));
  expect(calculate('=DAVERAGE(A1:B3,"missing",D1:D2)', cells)).toEqual(error("#NUM!"));
});

it.each<[string, number]>([
  ["DAVERAGE", 3], ["DCOUNT", 2], ["DCOUNTA", 2], ["DGET", 2],
  ["DMAX", 4], ["DMIN", 2], ["DPRODUCT", 8], ["DSTDEV", Math.sqrt(2)],
  ["DSTDEVP", 1], ["DSUM", 6], ["DVAR", 2], ["DVARP", 1]
])("calculates %s with header criteria and invalid field errors", (name, expected) => {
  const cells: Cell[] = [
    { row: 0, column: 0, value: text("Amount") },
    { row: 1, column: 0, value: number(2) }, { row: 2, column: 0, value: number(4) },
    { row: 0, column: 3, value: text("Amount") }, { row: 1, column: 3, value: text(">0") }
  ];
  expect(calculate(`=${name}(A1:A3,"Amount",D1:D2)`, cells)).toEqual(number(expected));
  expect(calculate(`=${name}(A1:A3,"missing",D1:D2)`, cells)).toEqual(error("#NUM!"));
});
it("implements released GETPIVOTDATA subset and missing-field error", () => {
  const cells: Cell[] = [{ row: 0, column: 0, value: text("Amount") }, { row: 1, column: 0, value: number(8) }];
  expect(calculate('=GETPIVOTDATA(A1:A2,"Amount")', cells)).toEqual(number(8));
  expect(calculate('=GETPIVOTDATA(A1:A2,"missing")', cells)).toEqual(error("#REF!"));
});
