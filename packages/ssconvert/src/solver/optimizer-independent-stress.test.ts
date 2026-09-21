import { expect, it } from 'vitest';
import type { CapabilityContext } from '../contracts.js';
import { simplex, solveLinear, SolverBudget } from './linear.js';
import { SolverProgram } from './program.js';
import { solveNonlinear } from './nonlinear.js';
import { loadSolverParameters } from './model.js';
import { solverRecord } from '../codecs/mps.js';
import type { Workbook } from '../workbook.js';

function budget(iterations = 10000, signal = new AbortController().signal): SolverBudget {
  const context: CapabilityContext = { signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 1000, sheets: 10, operations: 100, inputBytes: 100000, outputBytes: 100000, workbookWork: 10000000 } };
  return new SolverBudget(context, iterations, 30);
}

it('does not classify an integer-infeasible unbounded relaxation as an unbounded integer model', () => {
  const result = solveLinear([
    { coefficients: [1, 0], upper: 0.5 },
    { coefficients: [-1, 0], upper: -0.5 }
  ], [0, 1], ['integer', 'continuous'], budget());
  expect(result.quality).toBe('infeasible');
});

it('solves the classical cycling tableau using deterministic Bland pivots', () => {
  const result = simplex([
    { coefficients: [0.5, -5.5, -2.5, 9], upper: 0 },
    { coefficients: [0.5, -1.5, -0.5, 1], upper: 0 },
    { coefficients: [1, 0, 0, 0], upper: 1 }
  ], [10, -57, -9, -24], budget(100));
  expect(result.quality).toBe('optimal');
  expect(result.value).toBeCloseTo(1, 10);
});

it('keeps negative free-variable optima and redundant equality rows feasible', () => {
  const result = solveLinear([
    { coefficients: [1], upper: -2 },
    { coefficients: [-1], upper: 2 },
    { coefficients: [2], upper: -4 },
    { coefficients: [-2], upper: 4 }
  ], [1], ['continuous'], budget());
  expect(result.quality).toBe('optimal');
  expect(result.solution).toEqual([-2]);
});

it('stops at the pivot limit without claiming an optimal result', () => {
  expect(simplex([{ coefficients: [1], upper: 1 }], [1], budget(0)).quality).toBe('limit');
});

it('matches independent exhaustive integer optima across bounded two-variable models', () => {
  for (let bound = 1; bound <= 9; bound++) {
    for (const objective of [[2, 3], [-2, 3], [0, 0]]) {
      const rows = [
        { coefficients: [1, 0], upper: 3 }, { coefficients: [-1, 0], upper: 2 },
        { coefficients: [0, 1], upper: 3 }, { coefficients: [0, -1], upper: 2 },
        { coefficients: [2, 3], upper: bound + 0.5 }
      ];
      let expected = -Infinity;
      for (let x = -2; x <= 3; x++) for (let y = -2; y <= 3; y++) {
        if (2 * x + 3 * y <= bound + 0.5) expected = Math.max(expected, objective[0]! * x + objective[1]! * y);
      }
      const result = solveLinear(rows, objective, ['integer', 'integer'], budget());
      expect(result.quality).toBe('optimal');
      expect(result.value).toBeCloseTo(expected, 10);
      expect(result.solution!.every(Number.isInteger)).toBe(true);
      for (const row of rows) expect(row.coefficients.reduce((sum, c, i) => sum + c * result.solution![i]!, 0)).toBeLessThanOrEqual(row.upper);
    }
  }
});

it('reports an integer-feasible unbounded model and an infeasible continuous model distinctly', () => {
  expect(solveLinear([], [1], ['integer'], budget()).quality).toBe('unbounded');
  expect(solveLinear([{ coefficients: [1], upper: -1 }, { coefficients: [-1], upper: -1 }], [1], ['continuous'], budget()).quality).toBe('infeasible');
});

it('honors an injected elapsed-time limit without relying on host clocks', () => {
  let calls = 0;
  const context: CapabilityContext = { signal: new AbortController().signal, own() {}, clock: { now: () => calls++ === 0 ? 0 : 1000 }, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 1000, sheets: 10, operations: 100, inputBytes: 100000, outputBytes: 100000, workbookWork: 10000000 } };
  expect(simplex([{ coefficients: [1], upper: 1 }], [1], new SolverBudget(context, 100, 1)).quality).toBe('limit');
});

it('propagates invocation cancellation before arithmetic', () => {
  const controller = new AbortController();
  const reason = new Error('independent cancellation');
  controller.abort(reason);
  expect(() => solveLinear([], [1], ['continuous'], budget(100, controller.signal))).toThrow(reason);
});

it('checks cancellation again between an iteration decision and tableau arithmetic', () => {
  const controller = new AbortController();
  const reason = new Error('cancel during optimization');
  let calls = 0;
  const context: CapabilityContext = { signal: controller.signal, own() {}, clock: { now: () => { if (++calls === 2) controller.abort(reason); return 0; } }, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 1000, sheets: 10, operations: 100, inputBytes: 100000, outputBytes: 100000, workbookWork: 10000000 } };
  expect(() => simplex([{ coefficients: [1], upper: 1 }], [1], new SolverBudget(context, 100, 30))).toThrow(reason);
});

it('minimizes the original curved Rosenbrock valley from a negative starting point', () => {
  const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 1000, sheets: 10, operations: 100, inputBytes: 100000, outputBytes: 100000, workbookWork: 20000000 } };
  const book: Workbook = { activeSheet: 's', sheets: [{ id: 's', name: 'Sheet', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: -1.2 } },
    { row: 1, column: 0, value: { kind: 'number', value: 1 } },
    { row: 0, column: 1, formula: '=100*(A2-A1^2)^2+(1-A1)^2', value: { kind: 'number', value: 24.2 } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'A1:A2', ProblemType: '0', ModelType: '2', NonNeg: '0' }, []) }] }] };
  const model = loadSolverParameters(book, context);
  const program = new SolverProgram(book, model, context, new SolverBudget(context, 10000, 30));
  const result = solveNonlinear(program);
  expect(typeof result).toBe('object');
  if (typeof result === 'string') throw new Error(result);
  expect(result.limited).toBe(false);
  const evaluated = program.apply(result.solution);
  expect(program.value(evaluated, model.target)).toBeLessThan(1e-6);
  expect(result.solution[0]).toBeCloseTo(1, 3);
  expect(result.solution[1]).toBeCloseTo(1, 3);
});
