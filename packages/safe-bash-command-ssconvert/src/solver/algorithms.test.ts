import { expect, it } from 'vitest';
import { runSolverValidation } from './run.js';
import { solverRecord, constraintRecord } from '../codecs/mps.js';
import type { Workbook } from '../workbook.js';
import type { CapabilityContext } from '../contracts.js';
export const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 1000, sheets: 10, operations: 100, inputBytes: 100000, outputBytes: 100000, workbookWork: 1000000 } };
export function problem(expression: string, attributes: Record<string, string> = {}, constraints: ReturnType<typeof constraintRecord>[] = []): Workbook {
  return { activeSheet: 's', sheets: [{ id: 's', name: 'Sheet', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 0 } },
    { row: 1, column: 0, value: { kind: 'number', value: 0 } },
    { row: 0, column: 1, formula: expression, value: { kind: 'number', value: 0 } },
    { row: 1, column: 1, formula: '=A1+A2', value: { kind: 'number', value: 0 } },
    ...[4, 2, 3].map((value, row) => ({ row, column: 2, value: { kind: 'number' as const, value } }))
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'A1:A2', ProblemType: '1', ...attributes }, constraints) }] }] };
}
const numeric = (book: Workbook, row: number, column = 0) => book.sheets[0]!.cells.find(c => c.row === row && c.column === column)!.value;
it('solves an original bounded LP and recalculates dependent formulas without changing the input', async () => {
  const book = problem('=3*A1+2*A2', {}, [constraintRecord(1, 'B2', 'C1'), constraintRecord(1, 'A1', 'C2'), constraintRecord(1, 'A2', 'C3')]);
  const result = await runSolverValidation(book, context);
  expect(numeric(result, 0)).toEqual({ kind: 'number', value: 2 });
  expect(numeric(result, 1)).toEqual({ kind: 'number', value: 2 });
  expect(numeric(result, 0, 1)).toEqual({ kind: 'number', value: 10 });
  expect(numeric(book, 0)).toEqual({ kind: 'number', value: 0 });
});
it('writes the released program-report layout, static values, header styles and sheet name', async () => {
  const result = await runSolverValidation(problem('=3*A1+2*A2', { ProgramR: '1' }, [constraintRecord(1, 'B2', 'C1'), constraintRecord(1, 'A1', 'C2'), constraintRecord(1, 'A2', 'C3')]), context);
  const report = result.sheets[1]!;
  expect(report.name).toBe('Solver (1)');
  expect(report.cells.find(c => c.row === 0 && c.column === 0)).toMatchObject({ value: { kind: 'string', value: 'Target' }, style: { bold: true } });
  expect(report.cells.find(c => c.row === 2 && c.column === 2)?.value).toEqual({ kind: 'number', value: 10 });
  expect(report.cells.find(c => c.row === 2 && c.column === 4)?.value).toEqual({ kind: 'string', value: 'Feasible' });
  expect(report.cells.find(c => c.row === 11 && c.column === 1)?.value).toEqual({ kind: 'string', value: 'B2 ≤ C1' });
  expect(report.cells.every(c => c.formula === undefined)).toBe(true);
});
it('matches released numeric RHS derived-bound quirk', async () => {
  const result = await runSolverValidation(problem('=A1', { Inputs: 'A1' }, [constraintRecord(1, 'A1', '2')]), context);
  expect(numeric(result, 0)).toEqual({ kind: 'number', value: 0 });
});
it('solves mixed integer and binary input domains', async () => {
  const result = await runSolverValidation(problem('=3*A1+2*A2', {}, [constraintRecord(1, 'B2', '2.5'), constraintRecord(8, 'A1:A2')]), context);
  expect(numeric(result, 0)).toEqual({ kind: 'number', value: 2 });
  expect(numeric(result, 1)).toEqual({ kind: 'number', value: 0 });
  const binary = await runSolverValidation(problem('=3*A1+2*A2', {}, [constraintRecord(16, 'A1:A2'), constraintRecord(1, 'B2', 'C1')]), context);
  expect(numeric(binary, 0)).toEqual({ kind: 'number', value: 1 });
  expect(numeric(binary, 1)).toEqual({ kind: 'number', value: 1 });
});
it('applies NA for infeasible and unbounded completed LPs', async () => {
  for (const book of [problem('=A1', {}, [constraintRecord(2, 'B2', '5'), constraintRecord(1, 'B2', '4')]), problem('=A2', {}, [constraintRecord(1, 'A1', 'C2')])]) {
    const result = await runSolverValidation(book, context);
    expect(numeric(result, 0)).toEqual({ kind: 'error', value: '#N/A' });
    expect(numeric(result, 1)).toEqual({ kind: 'error', value: '#N/A' });
  }
});
it('solves nonlinear quadratic objective with the nonlinear factory and feasible report status', async () => {
  const result = await runSolverValidation(problem('=(A1-3)^2+(A2-2)^2', { ModelType: '2', ProblemType: '0', ProgramR: '1' }), context);
  const a = numeric(result, 0), b = numeric(result, 1);
  expect(a.kind).toBe('number'); expect(b.kind).toBe('number');
  if (a.kind === 'number' && b.kind === 'number') { expect(a.value).toBeCloseTo(3, 5); expect(b.value).toBeCloseTo(2, 5); }
  expect(result.sheets[1]!.cells.find(c => c.row === 2 && c.column === 4)?.value).toEqual({ kind: 'string', value: 'Feasible' });
});
it('continues conversion on unavailable quadratic factories and nonlinear startup errors', async () => {
  for (const [book, message] of [
    [problem('=A1^2', { ModelType: '1' }), 'Solver: Failed to create solver'],
    [problem('=A1^2', { ModelType: '2' }, [constraintRecord(8, 'A1')]), 'Solver: This solver does not handle discrete variables.'],
    [problem('=A1^2', { ModelType: '2' }, [constraintRecord(4, 'B2', '0')]), 'Solver: This solver does not handle equality constraints.'],
    [problem('=A1^2', { ModelType: '2' }, [constraintRecord(2, 'B2', '1')]), 'Solver: The initial values do not satisfy the constraints.']
  ] as const) {
    const messages: string[] = [];
    const result = await runSolverValidation(book, { ...context, async diagnostic(d) { messages.push(d.message); } });
    expect(messages).toEqual([message]); expect(result).toBe(book);
  }
});
it('reports iteration limits and keeps a feasible nonlinear incumbent', async () => {
  const messages: string[] = [];
  const result = await runSolverValidation(problem('=(A1-3)^2', { ModelType: '2', ProblemType: '0', MaxIter: '1' }), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(messages).toEqual(['Solver reached time or iteration limit']);
  const a = numeric(result, 0); expect(a.kind).toBe('number');
  if (a.kind === 'number') expect(a.value).toBeGreaterThan(0);
});
it('generates the captured GLPK sensitivity report including released indexing and missing-value behavior', async () => {
  const result = await runSolverValidation(problem('=3*A1+2*A2', { SensitivityR: '1' }, [constraintRecord(1, 'B2', 'C1'), constraintRecord(1, 'A1', 'C2'), constraintRecord(1, 'A2', 'C3')]), context);
  const report = result.sheets[1]!;
  expect(report.name).toBe('Solver (1)');
  const value = (row: number, column: number) => report.cells.find(c => c.row === row && c.column === column)?.value;
  expect(value(2, 3)).toEqual({ kind: 'string', value: '-' });
  expect(value(2, 4)).toEqual({ kind: 'string', value: '-' });
  expect(value(3, 4)).toEqual({ kind: 'number', value: 0 });
  expect(value(3, 5)).toEqual({ kind: 'number', value: 3 });
  for (const row of [7, 8, 9]) { expect(value(row, 2)).toEqual({ kind: 'number', value: 2 }); expect(value(row, 5)).toEqual({ kind: 'number', value: 2 }); expect(value(row, 6)).toEqual({ kind: 'number', value: 5 }); }
});

it('continues conversion and preserves cells on GLPK grammar failures for an empty row set or constant row', async () => {
  for (const book of [problem('=A1'), problem('=A1', {}, [constraintRecord(1, 'A1', '2')])]) {
    const messages: string[] = [];
    expect(await runSolverValidation(book, { ...context, async diagnostic(d) { messages.push(d.message); } })).toBe(book);
    expect(messages).toEqual(['Solver: Solver ran, but failed']);
  }
});
it('selects the qualified LPSolve profile and generates its measured report differences', async () => {
  const registry = [{ id: 'lpsolve', modelType: 'linear' as const, available: true }];
  const result = await runSolverValidation(problem('=3*A1+2*A2', { ProgramR: '1', SensitivityR: '1' }, [constraintRecord(1, 'B2', 'C1'), constraintRecord(1, 'A1', 'C2'), constraintRecord(1, 'A2', 'C3')]), context, registry);
  expect(result.sheets[1]!.cells.find(c => c.row === 2 && c.column === 4)?.value).toEqual({ kind: 'string', value: 'Optimal' });
  const report = result.sheets[2]!;
  expect(report.cells.find(c => c.row === 2 && c.column === 3)?.value).toEqual({ kind: 'number', value: 0 });
  expect(report.cells.find(c => c.row === 2 && c.column === 4)?.value).toEqual({ kind: 'number', value: 2 });
  expect(report.cells.find(c => c.row === 2 && c.column === 5)?.value).toEqual({ kind: 'string', value: '-' });
});
it('does not impose Nlsolve iteration limits on the native linear plugin profile', async () => {
  const messages: string[] = [];
  const result = await runSolverValidation(problem('=3*A1+2*A2', { MaxIter: '0' }, [constraintRecord(1, 'B2', 'C1'), constraintRecord(1, 'A1', 'C2'), constraintRecord(1, 'A2', 'C3')]), { ...context, async diagnostic(d) { messages.push(d.message); } });
  expect(numeric(result, 0, 1)).toEqual({ kind: 'number', value: 10 });
  expect(messages).toEqual([]);
});
it('creates an infeasible program report from raw solver zeros after applying NA to input cells', async () => {
  const result = await runSolverValidation(problem('=A1+A2', { ProgramR: '1' }, [constraintRecord(2, 'B2', 'C3'), constraintRecord(1, 'B2', 'C2')]), context);
  expect(numeric(result, 0)).toEqual({ kind: 'error', value: '#N/A' });
  const report = result.sheets[1]!;
  expect(report.cells.find(c => c.row === 2 && c.column === 2)?.value).toEqual({ kind: 'number', value: 0 });
  expect(report.cells.find(c => c.row === 6 && c.column === 2)?.value).toEqual({ kind: 'number', value: 0 });
  expect(report.cells.find(c => c.row === 2 && c.column === 4)).toBeUndefined();
});
it('preserves input cells if an infeasible GLPK run requests unavailable sensitivity ranges', async () => {
  const book = problem('=A1+A2', { SensitivityR: '1' }, [constraintRecord(2, 'B2', 'C3'), constraintRecord(1, 'B2', 'C2')]);
  const messages: string[] = [];
  expect(await runSolverValidation(book, { ...context, async diagnostic(d) { messages.push(d.message); } })).toBe(book);
  expect(messages).toEqual(['Solver: Solver ran, but failed']);
});
it('does not apply GUI-only native time limits to command solving', async () => {
  const messages: string[] = [];
  const result = await runSolverValidation(problem('=3*A1+2*A2', { MaxTime: '0' }, [constraintRecord(1, 'B2', 'C1'), constraintRecord(1, 'A1', 'C2'), constraintRecord(1, 'A2', 'C3')]), { ...context, clock: { now: () => 0 }, async diagnostic(d) { messages.push(d.message); } });
  expect(numeric(result, 0, 1)).toEqual({ kind: 'number', value: 10 }); expect(messages).toEqual([]);
});

it('performs the first nonlinear iteration before checking a zero native iteration limit', async () => {
  const messages: string[] = [];
  const result = await runSolverValidation(problem('=(A1-3)^2', { ModelType: '2', ProblemType: '0', MaxIter: '0' }), { ...context, async diagnostic(d) { messages.push(d.message); } });
  const value = numeric(result, 0); expect(value.kind).toBe('number');
  if (value.kind === 'number') expect(value.value).toBeGreaterThan(0);
  expect(messages).toEqual(['Solver reached time or iteration limit']);
});
it('preserves the workbook on measured GLPK MIP sensitivity failure', async () => {
  const book = problem('=3*A1+2*A2', { SensitivityR: '1' }, [constraintRecord(8, 'A1:A2'), constraintRecord(1, 'B2', 'C1')]);
  const messages: string[] = [];
  expect(await runSolverValidation(book, { ...context, async diagnostic(d) { messages.push(d.message); } })).toBe(book);
  expect(messages).toEqual(['Solver: Solver ran, but failed']);
});
it('reaches a feasible nonnegative boundary within the original small command work budget', async () => {
  const book = problem('=A1*2', { Inputs: 'A1', ModelType: '2', ProblemType: '0' });
  const started: Workbook = { ...book, sheets: [{ ...book.sheets[0]!, cells: book.sheets[0]!.cells.map(c => c.row === 0 && c.column === 0 ? { ...c, value: { kind: 'number', value: 2 } } : c) }] };
  const result = await runSolverValidation(started, { ...context, limits: { ...context.limits, workbookWork: 10000 } });
  expect(numeric(result, 0)).toEqual({ kind: 'number', value: 0 });
});
