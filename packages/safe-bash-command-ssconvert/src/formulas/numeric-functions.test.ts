import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
export function calculateNumericFormula(formula: string, supplied = context): CellValue {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }
  ] }] }, supplied).sheets[0]!.cells[0]!.value;
}
it.each<[string, number]>([
  ['=BIN2DEC("1111111111")', -1], ['=HEX2DEC("FFFFFFFFFF")', -1], ['=OCT2DEC("7777777777")', -1],
  ['=DECIMAL("ZZ",36)', 1295], ['=DELTA(3,3)', 1], ['=GESTEP(3,4)', 0],
  ['=FLT.RADIX()', 2], ['=FLT.MIN()', 2 ** -1022], ['=FLT.MAX()', Number.MAX_VALUE],
  ['=FLT.NEXTAFTER(1,"+")', 1 + Number.EPSILON], ['=FLT.NEXTAFTER(0,"-")', -Number.MIN_VALUE],
  ['=BITOR(4294967296,1)', 4294967297], ['=BITAND(4294967297,4294967296)', 4294967296],
  ['=BITXOR(7,3,1)', 5], ['=BITLSHIFT(1,63)', 2 ** 63], ['=BITLSHIFT(1,64)', 0],
  ['=BITRSHIFT(9,-2)', 36], ['=NT_D(72)', 12], ['=NT_SIGMA(72)', 195], ['=NT_PHI(72)', 24],
  ['=NT_RADICAL(72)', 6], ['=NT_OMEGA(72)', 2], ['=NT_MU(72)', 0], ['=NT_MU(30)', -1],
  ['=ITHPRIME(12.8)', 37], ['=NT_PI(37)', 12], ['=PFACTOR(91)', 7]
])("evaluates released numeric contract %s", (formula, expected) => {
  expect(calculateNumericFormula(formula)).toEqual({ kind: "number", value: expected });
});
it.each(['=ISPRIME(2147483647)', '=ISPRIME(4503599627370449)'])("tests primality above the 32-bit range %s", formula => {
  expect(calculateNumericFormula(formula)).toEqual({ kind: "boolean", value: true });
});
it.each<[string, string]>([
  ['=BIN2DEC(" 1")', '#NUM!'], ['=DEC2BIN(TRUE)', '#VALUE!'], ['=DEC2BIN(512)', '#NUM!'],
  ['=DEC2BIN(8,3)', '#NUM!'], ['=DEC2BIN(-1,0)', '#NUM!'], ['=HEX2BIN("FFFFFFFFFF")', '#NUM!'],
  ['=FLT.NEXTAFTER(1,"1")', '#VALUE!'], ['=FLT.NEXTAFTER(FLT.MAX(),"+")', '#NUM!'],
  ['=BITXOR()', '#VALUE!'], ['=BITAND(-1,2)', '#VALUE!'], ['=BITLSHIFT(-1,2)', '#NUM!'],
  ['=PFACTOR(1)', '#VALUE!'], ['=NT_D(0)', '#NUM!'], ['=ISPRIME(4503599627370497)', '#LIMIT!'],
  ['=ITHPRIME(100000001)', '#LIMIT!'], ['=NT_SIGMA(1/0)', '#DIV/0!']
])("preserves numeric errors for %s", (formula, expected) => {
  expect(calculateNumericFormula(formula)).toEqual({ kind: "error", value: expected });
});
it.each<[string, string]>([
  ['=DEC2BIN(-1)', '1111111111'], ['=DEC2HEX(-1)', 'FFFFFFFFFF'], ['=BIN2HEX(101,4)', '0005'],
  ['=BASE(1295,36)', 'ZZ'], ['=BASE(-1,16)', 'FFFFFFFFFF'], ['=HEX2OCT("FF")', '377'],
  ['=BIN2HEX("",2)', '00']
])("preserves radix conversion text %s", (formula, expected) => {
  expect(calculateNumericFormula(formula)).toEqual({ kind: "string", value: expected });
});
