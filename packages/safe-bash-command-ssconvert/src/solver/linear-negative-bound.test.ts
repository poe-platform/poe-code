import { expect, it } from 'vitest';
import { constraintRecord, solverRecord } from '../codecs/mps.js';
import type { CapabilityContext } from '../contracts.js';
import type { Workbook } from '../workbook.js';
import { SolverBudget } from './linear.js';
import { loadSolverParameters } from './model.js';
import { SolverProgram } from './program.js';
import { runSolverValidation } from './run.js';

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { cells: 100, sheets: 10, operations: 100, inputBytes: 10000, outputBytes: 10000, workbookWork: 100000 } };
function problem(upper: number, integer = false): Workbook {
  return { activeSheet: 's', sheets: [{ id: 's', name: 'S', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: -2 } },
    { row: 0, column: 1, formula: '=3*A1+2', value: { kind: 'blank' } },
    { row: 0, column: 2, value: { kind: 'number', value: upper } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained',
    data: solverRecord({ Target: 'B1', Inputs: 'A1', ProblemType: '1', NonNeg: '0' }, [
      constraintRecord(1, 'A1', 'C1'), ...(integer ? [constraintRecord(8, 'A1')] : [])
    ]) }] }] };
}
it.each([-1, -0.25])('retains affine slopes when probing backwards from upper bound %s', upper => {
  const book = problem(upper);
  const program = new SolverProgram(book, loadSolverParameters(book, context), context, new SolverBudget(context, 1000, 30));
  expect(program.linearize()).toEqual({ objective: [3], rows: [{ coefficients: [1], upper }] });
});
it.each(['glpk', 'lpsolve'])('solves negative upper bounds through %s', async id => {
  for (const [upper, integer, optimum] of [[-1, false, -1], [-0.25, false, -0.25], [-0.25, true, -1]] as const) {
    const diagnostics: string[] = [];
    const result = await runSolverValidation(problem(upper, integer), { ...context,
      async diagnostic(d) { diagnostics.push(d.message); }
    }, [{ id, modelType: 'linear', available: true }]);
    expect(diagnostics).toEqual([]);
    expect(result.sheets[0]!.cells.find(c => c.column === 0)?.value).toEqual({ kind: 'number', value: optimum });
    expect(result.sheets[0]!.cells.find(c => c.column === 1)?.value).toEqual({ kind: 'number', value: 3 * optimum + 2 });
  }
});
