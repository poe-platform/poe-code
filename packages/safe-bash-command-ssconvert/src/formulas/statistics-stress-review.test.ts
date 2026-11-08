import { expect, it } from 'vitest';
import { recalculateWorkbook } from './evaluator.js';
import type { CapabilityContext } from '../contracts.js';

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 10000, sheets: 2, operations: 10000, workbookWork: 1000000 },
  own() {},
};
function calculate(formula: string, supplied = context) {
  return recalculateWorkbook({ sheets: [{ id: 's', name: 'Sheet', cells: [{ row: 0, column: 0, value: { kind: 'number', value: 0 }, formula, formulaDirty: true }] }] }, supplied).sheets[0]!.cells[0]!.value;
}

it.each([0, 1, 2, 3, 4, 5])('rejects duplicate interpolation knots before constructing a result array, method %s', method => {
  expect(calculate(`=ROWS(INTERPOLATION({2;1;2},{20;10;21},{1;2;3},${method}))`)).toEqual({ kind: 'error', value: '#VALUE!' });
});

it('keeps unsorted distinct interpolation knots valid', () => {
  expect(calculate('=INDEX(INTERPOLATION({3;1;2},{30;10;20},{1.5;2.5}),2,1)')).toEqual({ kind: 'number', value: 25 });
});

it('preserves single-knot staircase interpolation and averaging', () => {
  expect(calculate('=INDEX(INTERPOLATION({2},{7},{-1;2;5},2),3,1)')).toEqual({ kind: 'number', value: 7 });
  expect(calculate('=INDEX(INTERPOLATION({2},{7},{-1;2;5},3),2,1)')).toEqual({ kind: 'number', value: 7 });
});

it('preserves released negative-traffic DIMCIRC behavior separately from PROBBLOCK', () => {
  expect(calculate('=DIMCIRC(-1,0.1)')).toEqual({ kind: 'number', value: 1 });
  expect(calculate('=PROBBLOCK(-1,1)')).toEqual({ kind: 'error', value: '#VALUE!' });
});

it('uses the analytic one-circuit Erlang blocking limit', () => {
  expect(calculate('=PROBBLOCK(3,1)')).toEqual({ kind: 'number', value: .75 });
  const capacity = calculate('=OFFCAP(1,0.75)');
  expect(capacity.kind).toBe('number');
  if (capacity.kind === 'number') expect(Math.abs(capacity.value - 3)).toBeLessThan(2e-15);
});

it.each([
  ['=RANDCAUCHY(1)', 0],
  ['=RANDNORM(0,1)', 0],
  ['=RANDGAMMA(2,1)', .5],
  ['=RANDLOG(0.9999999)', .9999999999999999],
])('bounds independent random rejection/search paths: %s', (formula, draw) => {
  expect(() => calculate(String(formula), { ...context, limits: { ...context.limits, workbookWork: 50 }, random: { next: () => Number(draw) } })).toThrow('ssconvert workbook work limit exceeded');
});

it('rejects invalid random domains without consuming capability authority', () => {
  let draws = 0;
  const supplied = { ...context, random: { next() { draws++; throw new Error('must not draw'); } } };
  expect(calculate('=RANDGAMMA(-1,1)', supplied)).toEqual({ kind: 'error', value: '#NUM!' });
  expect(calculate('=RANDUNIFORM(2,1)', supplied)).toEqual({ kind: 'error', value: '#NUM!' });
  expect(calculate('=RANDDISCRETE({1;2},{0.3;0.3})', supplied)).toEqual({ kind: 'error', value: '#NUM!' });
  expect(draws).toBe(0);
});
