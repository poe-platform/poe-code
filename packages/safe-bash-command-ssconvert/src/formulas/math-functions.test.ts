import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
function evaluate(formula: string) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula,
    formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context).sheets[0]!.cells[0]!.value;
}
it.each<[string, number]>([
  ['=ABS(-9)', 9], ['=SIGN(-9)', -1], ['=PI()', Math.PI], ['=SQRT(81)', 9], ['=INT(-2.1)', -3],
  ['=CEIL(-2.1)', -2], ['=CEILING(-2.1)', -3], ['=FLOOR(-2.1)', -2], ['=MOD(-7,3)', 2],
  ['=QUOTIENT(-7,3)', -2], ['=POWER(-8,1,3)', -2], ['=ROUND(-2.5)', -3], ['=ROUND(1.005,2)', 1.01],
  ['=ROUNDUP(-1.21,1)', -1.3], ['=ROUNDDOWN(-1.29,1)', -1.2], ['=TRUNC(-1.29,1)', -1.2],
  ['=EVEN(-2.1)', -4], ['=ODD(0)', 1], ['=MROUND(8,3)', 9], ['=FACT(6)', 720],
  ['=FACTDOUBLE(7)', 105], ['=COMBIN(8,3)', 56], ['=COMBINA(3,2)', 6], ['=FIB(12)', 144],
  ['=GCD(24,36,18)', 6], ['=LCM(4,6)', 12], ['=MULTINOMIAL(2,3,1)', 60],
  ['=SUMSQ(3,4)', 25], ['=SUMA(2,TRUE,"ignored")', 3], ['=SUMPRODUCT({2,3},{4,5})', 23],
  ['=SUMX2MY2({3,4},{1,2})', 20], ['=SUMX2PY2({3,4},{1,2})', 30], ['=SUMXMY2({3,4},{1,2})', 8],
  ['=SERIESSUM(2,0,1,{1,2,3})', 17], ['=HYPOT(3,4)', 5], ['=AGM(4,4)', 4],
  ['=LOG(100)', 2], ['=LOG2(8)', 3], ['=LOG10(1000)', 3], ['=ILOG(99,10)', 1],
  ['=LN(1)', 0], ['=LN1P(0)', 0], ['=EXP(0)', 1], ['=EXPM1(0)', 0],
  ['=SINPI(2)', 0], ['=COSPI(3)', -1], ['=TANPI(1)', 0], ['=COTPI(.5)', 0],
  ['=SIN(0)', 0], ['=COS(0)', 1], ['=TAN(0)', 0], ['=ASIN(0)', 0], ['=ACOS(1)', 0],
  ['=ATAN(0)', 0], ['=ASINH(0)', 0], ['=ACOSH(1)', 0], ['=ATANH(0)', 0],
  ['=SINH(0)', 0], ['=COSH(0)', 1], ['=TANH(0)', 0], ['=SECH(0)', 1],
  ['=DEGREES(PI())', 180], ['=RADIANS(180)', Math.PI], ['=GD(0)', 0]
])("evaluates original mathematical fixture %s", (formula, expected) => {
  expect(evaluate(formula)).toEqual({ kind: "number", value: expected });
});
it.each<[string, string]>([
  ['=POWER(0,0)', '#NUM!'], ['=POWER(0,-1)', '#DIV/0!'], ['=SQRT(-1)', '#NUM!'],
  ['=MOD(3,0)', '#DIV/0!'], ['=QUOTIENT(3,0)', '#DIV/0!'], ['=LN(0)', '#NUM!'],
  ['=LN1P(-1)', '#NUM!'], ['=FACT(-1)', '#NUM!'], ['=COMBIN(2,3)', '#NUM!'],
  ['=MROUND(-3,2)', '#NUM!'], ['=FLOOR(2,0)', '#DIV/0!'], ['=CEILING(2,-1)', '#NUM!'],
  ['=ROUNDUP(1,-309)', '#NUM!'], ['=ROUND(1,-309)', 'zero'], ['=EXP(1000)', '#NUM!']
])("preserves mathematical domain/overflow %s", (formula, expected) => {
  expect(evaluate(formula)).toEqual(expected === 'zero' ? { kind: "number", value: 0 } : { kind: "error", value: expected });
});
