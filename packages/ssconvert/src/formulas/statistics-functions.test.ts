import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 10000, sheets: 3, operations: 10000, workbookWork: 1000000 }, own() {} };
export function evaluateStatistic(formula: string, supplied = context): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, value: { kind: "number", value: 0 }, formula, formulaDirty: true }] }] };
  return recalculateWorkbook(book, supplied).sheets[0]!.cells[0]!.value;
}
it.each([
  ['=AVERAGE(1,2,9)', 4], ['=VAR(1,2,3)', 1], ['=VARP(1,2,3)', 2 / 3],
  ['=MEDIAN(1,9,2,3)', 2.5], ['=PERCENTILE({1;2;3;4},0.25)', 1.75],
  ['=CORREL({1;2;3},{2;4;6})', 1], ['=COVAR({1;2;3},{2;4;6})', 4 / 3],
  ['=SLOPE({3;5;7},{1;2;3})', 2], ['=INTERCEPT({3;5;7},{1;2;3})', 1],
  ['=NORMSDIST(0)', .5], ['=NORMSINV(0.5)', 0], ['=R.PNORM(0,0,1,FALSE)', .5],
  ['=R.PNORM(10,0,1,FALSE)', Number("7.619853024160526e-24")],
  ['=R.PNORM(-40,0,1,TRUE,TRUE)', -Number("804.6084420137538")],
  ['=R.DEXP(2,2,TRUE)', -1 - Math.log(2)],
  ['=PROBBLOCK(2,2)', .4], ['=OFFTRAF(1,2)', Math.sqrt(2)],
  ['=DIMCIRC(2,0.4)', 2], ['=OFFCAP(2,0.4)', 2],
  ['=BINOMDIST(2,4,0.5,FALSE)', .375], ['=BETADIST(0.5,2,2)', .5],
  ['=GAMMADIST(2,1,2,TRUE)', 1 - Math.exp(-1)], ['=POISSON(0,2,FALSE)', Math.exp(-2)],
  ['=TDIST(1,1,2)', .5], ['=FINV(0.5,1,1)', 1],
] as [string, number][])("calculates %s using the shared workbook engine", (formula, expected) => {
  const actual = evaluateStatistic(formula);
  expect(actual.kind).toBe("number");
  if (actual.kind === "number") expect(Math.abs(actual.value - expected)).toBeLessThanOrEqual(Math.max(Number.MIN_VALUE, Math.abs(expected) * 2e-13));
});
it.each([
  ['=VAR(1)', '#DIV/0!'], ['=NORMDIST(0,0,-1,TRUE)', '#NUM!'],
  ['=PROBBLOCK(-1,2)', '#VALUE!'], ['=AVERAGE()', '#DIV/0!'],
  ['=PERCENTILE.EXC({1;2;3},0)', '#NUM!'], ['=R.PNORM(0,0,1,TRUE,FALSE,1)', '#N/A'],
])("preserves domain/arity error for %s", (formula, value) => expect(evaluateStatistic(formula)).toEqual({ kind: "error", value }));
it("uses injected randomness reproducibly and validates domains before drawing", () => {
  let draws = 0;
  const supplied = { ...context, random: { next() { draws++; return .25; } } };
  expect(evaluateStatistic('=RANDUNIFORM(2,6)', supplied)).toEqual({ kind: 'number', value: 3 });
  expect(evaluateStatistic('=RANDBERNOULLI(1.1)', supplied)).toEqual({ kind: 'error', value: '#NUM!' });
  expect(draws).toBe(1);
});
it("returns the normalized Fourier transform in separate columns", () => {
  const book: Workbook = { sheets: [{ id: 's', name: 'Sheet', cells: [], formulaGroups: [{ id: 'a', kind: 'array', expression: '=FOURIER({1;0;0;0},FALSE,TRUE)', range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 } }] }] };
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(Array.from({ length: 4 }, () => [{ kind: 'number', value: .25 }, { kind: 'number', value: 0 }]).flat());
});
