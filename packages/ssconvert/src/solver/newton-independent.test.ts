import { expect, it } from 'vitest';
import { analyticObjective, lineSearch, newtonImprove, polishObjective } from './newton.js';
import { SolverProgram } from './program.js';
import { SolverBudget } from './linear.js';
import { loadSolverParameters } from './model.js';
import { constraintRecord, solverRecord } from '../codecs/mps.js';
import type { CapabilityContext } from '../contracts.js';
import type { Workbook } from '../workbook.js';

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { cells: 100, sheets: 10, operations: 100, inputBytes: 10000, outputBytes: 10000, workbookWork: 100000 }
};

function program(formula: string, maximize = false, constraints: ReturnType<typeof constraintRecord>[] = []) {
  const book: Workbook = { activeSheet: 's', sheets: [{ id: 's', name: 'Sheet', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 0 } },
    { row: 1, column: 0, value: { kind: 'number', value: 0 } },
    { row: 0, column: 1, formula, value: { kind: 'number', value: 0 } },
    { row: 1, column: 1, formula: '=A1+A2', value: { kind: 'number', value: 0 } },
    { row: 1, column: 2, value: { kind: 'number', value: 2 } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'A1:A2', ModelType: '2', ProblemType: maximize ? '1' : '0' }, constraints) }] }] };
  return new SolverProgram(book, loadSolverParameters(book, context), context, new SolverBudget(context, 100, Infinity));
}

it('independently brackets a quartic Newton overshoot through multiple native phase-one expansions', () => {
  const result = newtonImprove(program('=A1^2-2*A1+100*A1^4+A2^2'), [0, 0], 0);
  // Stationary root of 400*x^3+2*x-2, independently bracketed on [0.15,0.18].
  expect(result?.solution[0]).toBeGreaterThan(0.15);
  expect(result?.solution[0]).toBeLessThan(0.18);
  expect(result?.value).toBeLessThan(-0.22);
});

it('differentiates division, product, percent and maximize signs with mixed Hessian terms', () => {
  const jet = analyticObjective(program('=A1*A2+A1^2/A2+10*A1%', true), [2, 4]);
  expect(jet?.value).toBeCloseTo(-9.2);
  expect(jet?.gradient).toEqual([-5.1, -1.75]);
  expect(jet?.hessian).toEqual([-0.5, -0.75, -0.75, -0.125]);
});

it('regularizes singular and indefinite Hessians using the released modified Cholesky path', () => {
  for (const formula of ['=A1^2', '=A1^2-A2^2']) {
    const p = program(formula);
    const before = p.book;
    const result = newtonImprove(p, [2, 2], formula === '=A1^2' ? 4 : 0);
    expect(result?.solution[0]).toBe(0);
    expect(result?.solution[1]).toBe(formula === '=A1^2' ? 2 : 4);
    expect(p.book).toBe(before);
  }
});

it('keeps a reduced Newton step feasible when the full step violates a bound', () => {
  const p = program('=(A1-3)^2+A2^2', false, [constraintRecord(1, 'A1', 'C2')]);
  const result = newtonImprove(p, [0, 0], 9);
  expect(result?.solution[0]).toBeGreaterThan(0);
  expect(result?.solution[0]).toBeLessThanOrEqual(2);
  expect(p.feasible(p.apply(result!.solution), result!.solution)).toBe(true);
});

it('solves a pivoted coupled Hessian exactly for both objective directions', () => {
  for (const maximize of [false, true]) {
    const formula = '=(A1-3)^2+3*(A2-2)^2+(A1-3)*(A2-2)';
    const result = newtonImprove(program(maximize ? `=-(${formula.slice(1)})` : formula, maximize), [0, 0], 27);
    expect(result?.solution).toEqual([3, 2]);
    expect(result?.value).toBe(maximize ? -0 : 0);
  }
});

it('disables analytic Newton for unsupported function graphs and nonfinite jets', () => {
  for (const formula of ['=SIN(A1)', '=A1/A2']) {
    expect(analyticObjective(program(formula), [0, 0])).toBeUndefined();
  }
});

it('follows reference chains and rejects a circular objective', () => {
  const p = program('=B2^2');
  expect(analyticObjective(p, [2, 3])?.gradient).toEqual([10, 10]);
  const cycle = program('=B1+1');
  expect(analyticObjective(cycle, [2, 3])).toBeUndefined();
});

it('observes cancellation and admits differentiation storage against the work budget', () => {
  const p = program('=A1^2+A2^2');
  const controller = new AbortController();
  const reason = new Error('independent cancellation');
  const cancelled = { ...context, signal: controller.signal };
  const cancelledProgram = new SolverProgram(p.book, p.model, context, new SolverBudget(cancelled, 100, Infinity));
  controller.abort(reason);
  expect(() => analyticObjective(cancelledProgram, [1, 1])).toThrow(reason);
  expect(() => polishObjective(cancelledProgram, [1, 1], 2)).toThrow(reason);
  const limited = { ...context, limits: { ...context.limits, workbookWork: 8 } };
  const limitedProgram = new SolverProgram(p.book, p.model, context, new SolverBudget(limited, 100, Infinity));
  expect(() => analyticObjective(limitedProgram, [1, 1])).toThrow('ssconvert workbook work limit exceeded');
  const limitedSearch = new SolverProgram(p.book, p.model, context, new SolverBudget(limited, 100, Infinity));
  expect(() => lineSearch(limitedSearch, [1, 1], [1, 0], 2, { tryReverse: true, initialStep: 0.5, maximumStep: 1, epsilon: 0 })).toThrow('ssconvert workbook work limit exceeded');
});

it('polishes both axis coordinates sequentially from zero with native half-unit steps', () => {
  const p = program('=(A1-0.3)^2+(A2-0.4)^2');
  const result = polishObjective(p, [0, 0], 0.25);
  expect(result?.solution).toEqual([0.5, 0.5]);
  expect(result?.value).toBeCloseTo(0.05);
});

it('polishes in reverse while preserving the released negative interval ordering', () => {
  const p = program('=(A1-1.7)^2+A2^2');
  const result = polishObjective(p, [2, 0], 0.09);
  // Negative native bracket exits before phase-two refinement; it retains the
  // last improving expansion rather than reaching the exact minimum 1.7.
  expect(result?.solution[0]).toBeGreaterThan(1.81);
  expect(result?.solution[0]).toBeLessThan(1.82);
  expect(result?.value).toBeLessThan(0.014);
});

it('keeps a flat line search unchanged and rejects invalid step bounds', () => {
  const p = program('=0*A1+0*A2');
  const x = [0, 0];
  expect(lineSearch(p, x, [1, 0], 0, { tryReverse: true, initialStep: 0.5, maximumStep: 1, epsilon: 0 })).toBeUndefined();
  expect(lineSearch(p, x, [1, 0], 0, { tryReverse: true, initialStep: 2, maximumStep: 1, epsilon: 0 })).toBeUndefined();
  expect(x).toEqual([0, 0]);
});

it('admits boundary polishing without evaluating known impossible box candidates', () => {
  const p = program('=2*A1');
  const limited = { ...context, limits: { ...context.limits, workbookWork: 5000 } };
  const bounded = new SolverProgram(p.book, p.model, limited, new SolverBudget(limited, 100, Infinity));
  expect(polishObjective(bounded, [0, 0], 0)).toBeUndefined();
});

it('uses formula work admission rather than command operation count for analytic parsing', () => {
  const p = program('=(A1-3)^2+(A1-3)*(A2-2)+(A2-2)^2');
  const singleOperation = { ...context, limits: { ...context.limits, operations: 1 } };
  const commandProgram = new SolverProgram(p.book, p.model, singleOperation, new SolverBudget(singleOperation, 100, Infinity));
  expect(newtonImprove(commandProgram, [0, 0], 19)?.solution).toEqual([3, 2]);
  const long = program(`=${'A1+'.repeat(100)}A2`);
  const limited = { ...context, limits: { ...context.limits, workbookWork: 300 } };
  const bounded = new SolverProgram(long.book, long.model, limited, new SolverBudget(limited, 100, Infinity));
  expect(() => analyticObjective(bounded, [0, 0])).toThrow('ssconvert workbook work limit exceeded');
});
