import { expect, it } from 'vitest';
import { recalculateWorkbook } from './evaluator.js';
import type { CapabilityContext } from '../contracts.js';
import type { CellValue } from '../workbook.js';
import { tukeyProbability } from './functions/statistics-advanced-distributions.js';
import type { FunctionHost } from './functions/types.js';

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 10000, sheets: 2, operations: 10000, workbookWork: 1000000 },
  own() {},
};
function calculate(formula: string, supplied = context): CellValue {
  return recalculateWorkbook({ sheets: [{ id: 's', name: 'Sheet', cells: [{ row: 0, column: 0, value: { kind: 'number', value: 0 }, formula, formulaDirty: true }] }] }, supplied).sheets[0]!.cells[0]!.value;
}
it.each([
  ['=INDEX(LINEST({3,5,7}),1,1)', 2],
  ['=INDEX(LINEST({3,5;7,9}),1,1)', 2],
  ['=INDEX(TREND({3,5,7}),2,1)', 5],
])('uses sequential default predictors independently of y shape: %s', (formula, expected) => {
  const value = calculate(formula as string);
  expect(value.kind).toBe('number');
  if (value.kind === 'number') expect(value.value).toBeCloseTo(expected as number, 12);
});
it.each([
  ['=R.PSNORM(2,1,1,-1)', .025171489600055108],
  ['=R.QSNORM(0.3,1,1,-1)', -7.394064564034049e184],
  ['=R.QTUKEY(0.3,-1,10)', 1], ['=R.QTUKEY(0.3,3,0)', 1],
])('preserves captured skew/inverter boundary behavior: %s', (formula, expected) => {
  const value=calculate(formula as string); expect(value.kind).toBe('number');
  if(value.kind==='number')expect(Math.abs((value.value-Number(expected))/Number(expected))).toBeLessThan(2e-14);
});
it.each([
  ['=R.QST(-1,5,1,TRUE,TRUE)', -7.394064564034049e184],
  ['=R.QST(-1000,5,1,FALSE,TRUE)', 7.394064564034049e184],
  ['=R.QSNORM(-1000,1,1,2,FALSE,TRUE)', 76.03859999999997],
  ['=R.QTUKEY(-1000,3,10,1,TRUE,TRUE)', 7.186959238596909e-108],
])('preserves measured advanced-distribution logarithmic inverter behavior: %s', (formula,expected) => {
  const value=calculate(formula as string);expect(value.kind).toBe('number');
  if(value.kind==='number')expect(Math.abs(value.value/Number(expected)-1)).toBeLessThan(2e-14);
});
it.each([
  ['=R.PTUKEY(1000000,3,10,1,FALSE,FALSE)',8.881784197001252e-16],
  ['=R.PTUKEY(1000000,3,10,1,TRUE,TRUE)',-8.881784197001256e-16],
  ['=R.PTUKEY(1000000,3,10,1,FALSE,TRUE)',-34.657359027997266],
])('preserves the measured released large-range integration residual: %s',(formula,expected)=>{
  expect(calculate(formula as string)).toEqual({kind:'number',value:expected});
});
it.each([
  ['=R.PBETA(0.3,-1,3)', .35662074822157436],
  ['=R.PBETA(0.3,0,3)', 1.515990388119534],
  ['=R.PBETA(0.3,2,-1)', .48176785714285725],
  ['=R.PBETA(0.3,2,0)', .5877777777777778],
])('preserves captured nonpositive beta parameter arithmetic: %s', (formula, expected) => {
  const value=calculate(formula as string);expect(value.kind).toBe('number');
  if(value.kind==='number')expect(Math.abs((value.value-Number(expected))/Number(expected))).toBeLessThan(2e-14);
});
it.each([
  ['=R.DBETA(0.3,0,3)',0], ['=R.DBETA(0.3,2,0)',0],
  ['=R.QBETA(0.3,0,3)',0], ['=R.QBETA(0.3,2,0)',0],
  ['=R.PBETA(0.1,0,3)',1], ['=R.PBETA(0.25,0.5,0.5)',1/3],
])('preserves the source beta limits and analytic small-shape CDF: %s', (formula,expected) => {
  const value=calculate(formula as string);expect(value.kind).toBe('number');
  if(value.kind==='number')expect(Math.abs(value.value-Number(expected))).toBeLessThan(2e-15);
});
it('keeps the Student-t logarithmic tail finite after the probability underflows', () => {
  const value = calculate('=R.PT(1e100,9,FALSE,TRUE)');
  expect(value.kind).toBe('number');
  if (value.kind === 'number') { expect(Number.isFinite(value.value)).toBe(true); expect(value.value).toBeLessThan(-2000); }
});
it.each([
  ['=RANDLAPLACE(0)', 0], ['=RANDLOGISTIC(0)', 0],
  ['=RANDRAYLEIGH(0)', 0], ['=RANDRAYLEIGHTAIL(3,0)', 3],
])('accepts the released zero-scale random limit: %s', (formula, expected) => {
  const value = calculate(formula as string, { ...context, random: { next: () => .25 } });
  expect(value.kind).toBe('number');
  if (value.kind === 'number') expect(value.value).toBe(expected);
});
it('replays Laplace rejection using the transformed uniform, including uniform zero', () => {
  const draws = [.5, 0]; let consumed = 0;
  const value = calculate('=RANDLAPLACE(2)', { ...context, random: { next: () => draws[consumed++]! } });
  expect(value.kind).toBe('number');
  if (value.kind === 'number') expect(value.value).toBe(0);
  expect(consumed).toBe(2);
});
it('retains the small F-test tail instead of subtracting a rounded CDF from one', () => {
  const value = calculate('=FTEST({0;1e-10;2e-10},{0;1;2})');
  expect(value.kind).toBe('number');
  if (value.kind === 'number') expect(value.value / 2e-20).toBeCloseTo(1, 12);
});
it('preserves the released skew-normal cancellation at shape one', () => {
  expect(calculate('=R.PSNORM(-10,1,0,1)')).toEqual({ kind: 'number', value: 0 });
  expect(calculate('=R.PSNORM(-10,1,0,1,TRUE,TRUE)')).toEqual({ kind: 'error', value: '#NUM!' });
});
it('preserves the released nonlog skew-normal location expression separately from log density', () => {
  const ordinary = calculate('=R.DSNORM(1,2,1,1)'), logarithmic = calculate('=R.DSNORM(1,2,1,1,TRUE)');
  expect(ordinary.kind).toBe('number'); expect(logarithmic.kind).toBe('number');
  if (ordinary.kind === 'number') expect(Math.abs(ordinary.value - 2 / Math.sqrt(2 * Math.PI) * .9331927987311419)).toBeLessThan(2e-16);
  if (logarithmic.kind === 'number') expect(Math.abs(logarithmic.value + .5 * Math.log(2 * Math.PI))).toBeLessThan(Number.EPSILON);
});
it('admits aggregate accumulation across argument boundaries before extending the array', () => {
  expect(() => calculate('=AVERAGE({1;2},{3;4})', { ...context, limits: { ...context.limits, cells: 2 } })).toThrow('ssconvert calculation array limit exceeded');
});
it('reduces the skew-t integer recurrence to its analytic zero-abscissa value', () => {
  const value = calculate('=R.PST(0,10,3)');
  expect(value.kind).toBe('number');
  if (value.kind === 'number') expect(Math.abs(value.value - Math.atan(1 / 3) / Math.PI)).toBeLessThan(Number.EPSILON);
});
it('matches the measured released skew-t recurrence tail', () => {
  const value = calculate('=R.PST(-20,10,3)');
  expect(value.kind).toBe('number');
  if (value.kind === 'number') expect(value.value).toBe(9.1723503792273675e-16);
});
it('retains the Student-t central displacement before rounding the beta coordinate', () => {
  const value = calculate('=(R.PT(1e-10,1)-0.5)/1e-10');
  expect(value.kind).toBe('number');
  if (value.kind === 'number') expect(Math.abs(value.value - 1 / Math.PI)).toBeLessThan(1e-6);
});
it('bounds random rejection work instead of looping on a deterministic midpoint source', () => {
  expect(() => calculate('=RANDLAPLACE(1)', { ...context, limits: { ...context.limits, workbookWork: 100 }, random: { next: () => .5 } })).toThrow('ssconvert workbook work limit exceeded');
});
it('observes cancellation during random rejection without another source draw', () => {
  const controller = new AbortController(), reason = new Error('cancel injected random'); let draws = 0;
  expect(() => calculate('=RANDLAPLACE(1)', { ...context, signal: controller.signal, random: { next() { draws++; controller.abort(reason); return .5; } } })).toThrow(reason);
  expect(draws).toBe(1);
});
it.each([NaN, Infinity, -1, 1])('rejects invalid random capability results: %s', next => {
  expect(() => calculate('=RAND()', { ...context, random: { next: () => next } })).toThrow('Invalid ssconvert random result');
});
it.each([[9,3],[109,1]])('excludes nested subtotal calls and applies hidden rows for code %s', (code, expected) => {
  const book = { sheets: [{ id: 's', name: 'Sheet', rows: [{ index: 1, hidden: true }], cells: [
    { row: 0, column: 0, value: { kind: 'number' as const, value: 1 } },
    { row: 1, column: 0, value: { kind: 'number' as const, value: 2 } },
    { row: 2, column: 0, value: { kind: 'number' as const, value: 0 }, formula: '=1+SUBTOTAL(9,A1:A2)', formulaDirty: true },
    { row: 3, column: 0, value: { kind: 'number' as const, value: 0 }, formula: `=SUBTOTAL(${code},A1:A3)`, formulaDirty: true },
  ] }] };
  expect(recalculateWorkbook(book,context).sheets[0]!.cells[3]!.value).toEqual({ kind: 'number', value: expected });
});
it.each([6,9])('bounds combined subtotal numeric accumulation for code %s', code => {
  expect(() => calculate(`=SUBTOTAL(${code},{1;2},{3;4})`, { ...context, limits: { ...context.limits, cells: 2 } })).toThrow('ssconvert calculation array limit exceeded');
});
it.each([
  ['=SUBTOTAL()', { kind: 'error', value: '#NUM!' }],
  ['=SUBTOTAL("9",1)', { kind: 'number', value: 1 }],
  ['=SUBTOTAL(TRUE,1)', { kind: 'number', value: 1 }],
])('preserves source subtotal code coercion: %s', (formula, expected) => {
  expect(calculate(formula as string)).toEqual(expected);
});

it.each(['work','cancellation'])('retains %s guards on warmed Tukey quadrature nodes',(guard)=>{
  const controller = new AbortController(); let ticks = 0, guarded = false;
  const host = { context, tick() {
    ticks++;
    if(guarded && ticks === 4 && guard === 'cancellation') controller.abort();
    if(controller.signal.aborted) throw new Error('cancelled');
    if(guarded && ticks > 3) throw new Error('work exhausted');
  } } as unknown as FunctionHost;
  const cache:NonNullable<Parameters<typeof tukeyProbability>[7]> = new Map();
  tukeyProbability(1000000,3,10,1,false,false,host,cache);
  expect(cache.size).toBeGreaterThan(0); const size = cache.size;
  ticks = 0; guarded = true;
  expect(()=>tukeyProbability(1000000,3,10,1,false,false,host,cache)).toThrow(guard === 'work' ? 'work exhausted' : 'cancelled');
  expect(ticks).toBe(4); expect(cache.size).toBe(size);
});
