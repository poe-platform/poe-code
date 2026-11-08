import { expect, it } from 'vitest';
import { constraintRecord, solverRecord } from '../codecs/mps.js';
import type { CapabilityContext } from '../contracts.js';
import type { Workbook } from '../workbook.js';
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
      constraintRecord(4, 'A1', 'C1'), ...(integer ? [constraintRecord(8, 'A1')] : [])
    ]) }] }] };
}
it.each([3, -3, 0.25])('restores fixed variable %s after solving the substituted model', async fixed => {
  const diagnostics: string[] = [];
  const result = await runSolverValidation(problem(fixed), { ...context,
    async diagnostic(d) { diagnostics.push(d.message); }
  }, [{ id: 'lpsolve', modelType: 'linear', available: true }]);
  expect(diagnostics).toEqual([]);
  expect(result.sheets[0]!.cells.find(c => c.column === 0)?.value).toEqual({ kind: 'number', value: fixed });
  expect(result.sheets[0]!.cells.find(c => c.column === 1)?.value).toEqual({ kind: 'number', value: 3 * fixed + 2 });
});
it('retains the native GLPK constant-row diagnostic for a fully fixed model', async () => {
  const book = problem(3), diagnostics: string[] = [];
  const result = await runSolverValidation(book, { ...context,
    async diagnostic(d) { diagnostics.push(d.message); }
  }, [{ id: 'glpk', modelType: 'linear', available: true }]);
  expect(result).toBe(book);
  expect(diagnostics).toEqual(['Solver: Solver ran, but failed']);
});

it.each([false, true])('reconstructs fixed reference aliases beside a free integer=%s input', async integer => {
  const book: Workbook = { activeSheet: 's', sheets: [{ id: 's', name: 'S', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 3 } },
    { row: 1, column: 0, value: { kind: 'number', value: 0 } },
    { row: 0, column: 1, formula: '=IF(A1=3,2*A2+7,NA())', value: { kind: 'blank' } },
    { row: 1, column: 1, formula: '=A1+A2', value: { kind: 'blank' } },
    { row: 0, column: 2, value: { kind: 'number', value: 3 } },
    { row: 1, column: 2, value: { kind: 'number', value: 5.5 } },
    { row: 0, column: 3, formula: '=A1', value: { kind: 'blank' } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained',
    data: solverRecord({ Target: 'B1', Inputs: 'A1:A2', ProblemType: '1', NonNeg: '0', ProgramR: '1' }, [
      constraintRecord(4, 'D1', 'C1'), constraintRecord(1, 'B2', 'C2'),
      ...(integer ? [constraintRecord(8, 'A1:A2')] : [])
    ]) }] }] };
  const result = await runSolverValidation(book, context, [{ id: 'lpsolve', modelType: 'linear', available: true }]);
  const at = (row: number, column: number) => result.sheets[0]!.cells.find(c => c.row === row && c.column === column)?.value;
  expect(at(0, 0)).toEqual({ kind: 'number', value: 3 });
  expect(at(1, 0)).toEqual({ kind: 'number', value: integer ? 2 : 2.5 });
  expect(at(0, 1)).toEqual({ kind: 'number', value: integer ? 11 : 12 });
  expect(at(0, 3)).toEqual({ kind: 'number', value: 3 });
  expect(result.sheets[1]!.cells.find(c => c.row === 2 && c.column === 2)?.value).toEqual({ kind: 'number', value: integer ? 11 : 12 });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: 'number', value: 3 });
});
