import { expect, it, vi } from 'vitest';
import type { CapabilityContext } from '../contracts.js';
import type { Workbook } from '../workbook.js';
import { constraintRecord, solverRecord } from '../codecs/mps.js';
import { runSolverValidation } from './run.js';
import { SolverBudget } from './linear.js';
import { linearSensitivity } from './sensitivity.js';
import { SolverProgram } from './program.js';
import { loadSolverParameters } from './model.js';
import { solveNonlinear } from './nonlinear.js';

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 1000, sheets: 10, operations: 100, inputBytes: 100000, outputBytes: 100000, workbookWork: 1000000 } };
function book(): Workbook {
  return { activeSheet: 's', sheets: [{ id: 's', name: 'Sheet', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 0 } },
    { row: 1, column: 0, value: { kind: 'number', value: 0 } },
    { row: 0, column: 1, formula: '=3*A1+2*A2', value: { kind: 'number', value: 0 } },
    { row: 1, column: 1, formula: '=A1+A2', value: { kind: 'number', value: 0 } },
    { row: 0, column: 2, value: { kind: 'number', value: 4 } },
    { row: 1, column: 2, value: { kind: 'number', value: 2 } },
    { row: 2, column: 2, value: { kind: 'number', value: 3 } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'A1:A2', ProblemType: '1', ProgramR: '1', SensitivityR: '1' }, [constraintRecord(1, 'B2', 'C1'), constraintRecord(1, 'A1', 'C2'), constraintRecord(1, 'A2', 'C3')]) }] }] };
}

it('allocates both report names without replacing case-insensitive names or existing sheet identifiers', async () => {
  const input = book();
  const existing: Workbook = { ...input, sheets: [...input.sheets, { id: 'old', name: 'sOlVeR (1)', cells: [] }, { id: 'solver-report-2', name: 'Other', cells: [] }] };
  const result = await runSolverValidation(existing, context);
  expect(result.sheets.map(s => s.name)).toEqual(['Sheet', 'sOlVeR (1)', 'Other', 'Solver (3)', 'Solver (4)']);
  expect(result.activeSheet).toBe('solver-report-4');
  expect(existing.sheets).toHaveLength(3);
  expect(existing.activeSheet).toBe('s');
  expect(result.sheets.slice(3).every(s => s.cells.every(c => c.formula === undefined))).toBe(true);
  expect(new Set(result.sheets.map(s => s.id)).size).toBe(result.sheets.length);
});

it('preserves native missing-value alignment and sensitivity heading styles', async () => {
  const result = await runSolverValidation(book(), context);
  const report = result.sheets.at(-1)!;
  expect(report.cells.find(c => c.row === 1 && c.column === 3)).toMatchObject({ value: { kind: 'string', value: 'Reduced\nCost' }, style: { horizontalAlignment: 'center', verticalAlignment: 'bottom' } });
  expect(report.cells.find(c => c.row === 2 && c.column === 3)).toMatchObject({ value: { kind: 'string', value: '-' }, style: { horizontalAlignment: 'center', verticalAlignment: 'top' } });
});

it('computes feasible RHS and objective perturbation intervals for a nondegenerate active basis', () => {
  const rows = [{ coefficients: [1, 1], upper: 4 }, { coefficients: [1, 0], upper: 2 }, { coefficients: [0, 1], upper: 3 }, { coefficients: [-1, 0], upper: 0 }, { coefficients: [0, -1], upper: 0 }];
  const result = linearSensitivity(rows, [3, 2], [2, 2], new SolverBudget(context, 10000, 30));
  expect(result.variables[0]).toEqual({ low: 2, high: Infinity, shadow: 0 });
  expect(result.variables[1]).toEqual({ low: 0, high: 3, shadow: 0 });
  expect(result.constraints[0]).toEqual({ low: 2, high: 5, shadow: 2 });
  for (const upper of [2, 3, 4, 5]) {
    const solution = [2, upper - 2];
    const altered = [{ ...rows[0]!, upper }, ...rows.slice(1)];
    expect(altered.every(r => r.coefficients.reduce((sum, c, i) => sum + c * solution[i]!, 0) <= r.upper)).toBe(true);
  }
});

it('bounds sensitivity matrix allocation before creating a large basis', () => {
  const limited = { ...context, limits: { ...context.limits, workbookWork: 20 } };
  expect(() => linearSensitivity([], Array<number>(10).fill(1), Array<number>(10).fill(0), new SolverBudget(limited, 100, 30))).toThrow('ssconvert workbook work limit exceeded');
});

it('matches native minimization shadow signs and finite constraint limits', async () => {
  const original = book();
  const sheet = original.sheets[0]!;
  const input: Workbook = { ...original, sheets: [{ ...sheet, unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'A1:A2', ProblemType: '0', SensitivityR: '1' }, [constraintRecord(1, 'A2', 'C3'), constraintRecord(2, 'B2', 'C1'), constraintRecord(1, 'A1', 'C2')]) }] }] };
  const result = await runSolverValidation(input, context);
  const report = result.sheets.at(-1)!;
  for (const row of [7, 8, 9]) {
    expect(report.cells.find(c => c.row === row && c.column === 2)?.value).toEqual({ kind: 'number', value: -1 });
    expect(report.cells.find(c => c.row === row && c.column === 5)?.value).toEqual({ kind: 'number', value: 2 });
    expect(report.cells.find(c => c.row === row && c.column === 6)?.value).toEqual({ kind: 'number', value: 4 });
  }
});

it('charges variable-domain allocation before constructing an otherwise unconstrained program', () => {
  const input = book();
  const parsed = loadSolverParameters(input, context);
  const model = { ...parsed, constraints: [], variables: Array.from({ length: 10 }, (_, row) => ({ sheet: 's', row, column: 0 })), domains: Array<'continuous'>(10).fill('continuous') };
  const limited = { ...context, limits: { ...context.limits, workbookWork: 20 } };
  expect(() => new SolverProgram(input, model, limited, new SolverBudget(limited, 100, 30))).toThrow('ssconvert workbook work limit exceeded');
});

it('admits the complete linear coefficient matrices before evaluating their first workbook', () => {
  const input = book();
  const parsed = loadSolverParameters(input, context);
  const model = { ...parsed, constraints: Array.from({ length: 20 }, () => parsed.constraints[0]!), variables: Array.from({ length: 10 }, (_, row) => ({ sheet: 's', row, column: 0 })), domains: Array<'continuous'>(10).fill('continuous') };
  const limited = { ...context, limits: { ...context.limits, workbookWork: 500 } };
  const program = new SolverProgram(input, model, limited, new SolverBudget(limited, 100, 30));
  const evaluate = vi.spyOn(program, 'apply');
  expect(() => program.linearize()).toThrow('ssconvert workbook work limit exceeded');
  expect(evaluate).not.toHaveBeenCalled();
});

it('admits the nonlinear direction matrix before evaluating any candidate', () => {
  const input = book();
  const parsed = loadSolverParameters(input, context);
  const model = { ...parsed, constraints: [], modelType: 'nonlinear' as const, variables: Array.from({ length: 100 }, (_, row) => ({ sheet: 's', row, column: 0 })), domains: Array<'continuous'>(100).fill('continuous') };
  const limited = { ...context, limits: { ...context.limits, workbookWork: 2000 } };
  const program = new SolverProgram(input, model, limited, new SolverBudget(limited, 100, 30));
  const evaluate = vi.spyOn(program, 'apply');
  expect(() => solveNonlinear(program)).toThrow('ssconvert workbook work limit exceeded');
  expect(evaluate).toHaveBeenCalledTimes(1);
});
