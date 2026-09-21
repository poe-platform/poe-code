import { expect, it, vi } from 'vitest';
import { constraintRecord, solverRecord } from '../codecs/mps.js';
import type { CapabilityContext } from '../contracts.js';
import type { Workbook } from '../workbook.js';
import { SolverBudget } from './linear.js';
import { loadSolverParameters } from './model.js';
import { solveNonlinear } from './nonlinear.js';
import { SolverProgram } from './program.js';

function program(expression: string, initial: number, options: { maximize?: boolean; constraints?: ReturnType<typeof constraintRecord>[]; iterations?: number; controller?: AbortController } = {}): SolverProgram {
  const context: CapabilityContext = { signal: (options.controller ?? new AbortController()).signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 1000, sheets: 10, operations: 100, inputBytes: 100000, outputBytes: 100000, workbookWork: 200000 } };
  const book: Workbook = { activeSheet: 's', sheets: [{ id: 's', name: 'Sheet', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: initial } },
    { row: 0, column: 1, formula: expression, value: { kind: 'number', value: 0 } },
    { row: 0, column: 2, formula: '=A1', value: { kind: 'number', value: initial } },
    { row: 0, column: 3, value: { kind: 'number', value: 1 } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'A1', ProblemType: options.maximize ? '1' : '0', ModelType: '2' }, options.constraints ?? []) }] }] };
  const model = loadSolverParameters(book, context);
  return new SolverProgram(book, model, context, new SolverBudget(context, options.iterations ?? 1000, Infinity));
}

it('accepts a nearby upper boundary only with a feasible improved maximizing objective', () => {
  const model = program('=A1', 1 - 1e-6, { maximize: true, constraints: [constraintRecord(1, 'A1', 'D1')] });
  const result = solveNonlinear(model);
  if (typeof result === 'string') throw new Error(result);
  expect(result.limited).toBe(false);
  expect(result.solution).toEqual([1]);
  expect(model.feasible(model.apply(result.solution), result.solution)).toBe(true);
});

it('does not snap an interior minimum to a nearby worse box boundary', () => {
  const model = program('=(A1-0.000001)^2', 1e-6);
  const result = solveNonlinear(model);
  if (typeof result === 'string') throw new Error(result);
  expect(result.limited).toBe(false);
  expect(result.solution).toEqual([1e-6]);
  expect(model.value(model.apply(result.solution), model.model.target)).toBe(0);
});

it('rejects objective-improving box snaps that violate an ordinary constraint', () => {
  const model = program('=A1', 1e-6, { constraints: [constraintRecord(2, 'C1', '0.000001')] });
  const result = solveNonlinear(model);
  if (typeof result === 'string') throw new Error(result);
  expect(result.limited).toBe(false);
  expect(result.solution).toEqual([1e-6]);
  expect(model.feasible(model.apply(result.solution), result.solution)).toBe(true);
});

it('honors a zero routine iteration budget before any boundary polish', () => {
  const model = program('=A1', 1e-6, { iterations: 0 });
  expect(solveNonlinear(model)).toEqual({ solution: [1e-6], limited: true });
});

it('propagates cancellation when evaluating a zero-boundary candidate', () => {
  const controller = new AbortController();
  const reason = new Error('cancel boundary candidate');
  const model = program('=A1', 1e-6, { controller });
  const apply = model.apply.bind(model);
  vi.spyOn(model, 'apply').mockImplementation(solution => {
    const evaluated = apply(solution);
    if (solution?.[0] === 0) controller.abort(reason);
    return evaluated;
  });
  expect(() => solveNonlinear(model)).toThrow(reason);
});
