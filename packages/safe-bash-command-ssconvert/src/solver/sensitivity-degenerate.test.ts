import { expect, it } from 'vitest';
import type { CapabilityContext } from '../contracts.js';
import { SolverBudget, solveLinear } from './linear.js';
import { linearSensitivity, linearSensitivitySteps } from './sensitivity.js';
import { runSolverValidation } from './run.js';
import { solverRecord, constraintRecord } from '../codecs/mps.js';

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { cells: 100, sheets: 2, operations: 100, inputBytes: 10000, outputBytes: 10000, workbookWork: 100000 } };
const budget = () => new SolverBudget(context, 1000, 30);
const rows = [
  { coefficients: [0, -1], upper: 0 },
  { coefficients: [1, 0], upper: 1 },
  { coefficients: [1, 1], upper: 1 },
  { coefficients: [-1, 0], upper: 0 }
];

it('uses a dual-feasible basis at a degenerate optimum', () => {
  // Independent lp_solve: x=1,y=0, objective=1; coefficient ranges
  // x:[1,+inf], y:[-inf,1]. The first active pair has dual [-1,1].
  const result = linearSensitivity(rows, [1, 1], [1, 0], budget());
  expect(result.constraints.every(entry => entry.shadow >= -1e-10)).toBe(true);
  expect(result.variables[0]).toMatchObject({ low: 1, high: Infinity });
  expect(result.variables[1]).toMatchObject({ low: -Infinity, high: 1 });
  expect(result.constraints[2]!.shadow).toBeCloseTo(1);
  for (const coefficients of [[1, 1], [2, 1], [1, 0], [1, -3]]) {
    const solved = solveLinear(rows, coefficients, ['continuous', 'continuous'], budget());
    expect(solved.quality).toBe('optimal');
    expect(solved.value).toBeCloseTo(coefficients[0]!);
  }
});

it.each([0, 1, 2, 3])('keeps valid sensitivity under active-row rotation %s', offset => {
  const reordered = [...rows.slice(offset), ...rows.slice(0, offset)];
  const result = linearSensitivity(reordered, [1, 1], [1, 0], budget());
  expect(result.constraints.every(entry => entry.shadow >= -1e-10)).toBe(true);
  for (const entry of result.variables) {
    expect(entry.low).toBeLessThanOrEqual(1);
    expect(entry.high).toBeGreaterThanOrEqual(1);
  }
  for (let column = 0; column < 2; column++) {
    const dual = reordered.reduce((sum, row, i) => sum + row.coefficients[column]! * result.constraints[i]!.shadow, 0);
    expect(dual).toBeCloseTo(1);
  }
});

it('returns unavailable sensitivity if the dual feasibility solve exhausts its iteration limit', () => {
  const result = linearSensitivity(rows, [1, 1], [1, 0], new SolverBudget(context, 0, 30));
  expect(result.variables.every(entry => Number.isNaN(entry.low) && Number.isNaN(entry.high))).toBe(true);
  expect(result.constraints.every(entry => Number.isNaN(entry.shadow))).toBe(true);
});

it('shares work admission and cancellation with degenerate basis recovery', () => {
  expect(() => linearSensitivity(rows, [1, 1], [1, 0], new SolverBudget({ ...context,
    limits: { ...context.limits, workbookWork: 100 } }, 1000, 30))).toThrow('work limit exceeded');
  const controller = new AbortController(), reason = new Error('cancel sensitivity recovery');
  const repeated = Array.from({ length: 2048 }, () => rows).flat();
  const steps = linearSensitivitySteps(repeated, [1, 1], [1, 0], new SolverBudget({ ...context,
    signal: controller.signal, limits: { ...context.limits, workbookWork: 1000000 } }, 1000, 30));
  expect(steps.next().done).toBe(false);
  controller.abort(reason);
  expect(() => steps.next()).toThrow(reason);
});

it.each([false, true])('exports valid degenerate coefficient limits in a minimization=%s report', async minimize => {
  const book = await runSolverValidation({ sheets: [{ id: 's', name: 'S', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 0 } },
    { row: 1, column: 0, value: { kind: 'number', value: 0 } },
    { row: 0, column: 1, formula: minimize ? '=-A1-A2' : '=A1+A2', value: { kind: 'blank' } },
    { row: 1, column: 1, formula: '=A1+A2', value: { kind: 'blank' } },
    { row: 0, column: 2, value: { kind: 'number', value: 0 } },
    { row: 1, column: 2, value: { kind: 'number', value: 1 } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained',
    data: solverRecord({ Target: 'B1', Inputs: 'A1:A2', ProblemType: minimize ? '0' : '1', SensitivityR: '1' },
      [constraintRecord(2, 'A2', 'C1'), constraintRecord(1, 'A1', 'C2'), constraintRecord(1, 'B2', 'C2')]) }] }] },
  context, [{ id: 'lpsolve', modelType: 'linear', available: true }]);
  const report = book.sheets[1]!;
  const value = (row: number, column: number) => report.cells.find(c => c.row === row && c.column === column)?.value;
  expect(value(2, 4)).toEqual(minimize ? { kind: 'string', value: '-' } : { kind: 'number', value: 1 });
  expect(value(3, 5)).toEqual(minimize ? { kind: 'string', value: '-' } : { kind: 'number', value: 1 });
  expect(value(2, 5)).toEqual(minimize ? { kind: 'number', value: -1 } : { kind: 'string', value: '-' });
  expect(value(3, 4)).toEqual(minimize ? { kind: 'number', value: -1 } : { kind: 'string', value: '-' });
});
