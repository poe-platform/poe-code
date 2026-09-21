import { expect, it } from 'vitest';
import { solverRecord } from '../codecs/mps.js';
import type { Workbook } from '../workbook.js';
import type { CapabilityContext } from '../contracts.js';
import { runSolverValidation } from './run.js';

it('preserves native compound-iterator limit warnings when the initial point is already stationary', async () => {
  const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 1000, sheets: 10, operations: 100, inputBytes: 100000, outputBytes: 100000, workbookWork: 1000000 } };
  for (const maximum of [1, 2, 3]) {
    const messages: string[] = [];
    const book: Workbook = { activeSheet: 's', sheets: [{ id: 's', name: 'Sheet', cells: [
      { row: 0, column: 0, value: { kind: 'number', value: 0 } },
      { row: 0, column: 1, formula: '=A1^2', value: { kind: 'number', value: 0 } }
    ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'A1', ModelType: '2', ProblemType: '0', MaxIter: String(maximum) }) }] }] };
    const result = await runSolverValidation(book, { ...context, diagnostic: async d => { messages.push(d.message); } });
    expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: 'number', value: 0 });
    expect(messages).toEqual(maximum < 3 ? ['Solver reached time or iteration limit'] : []);
  }
});

it('takes the native analytic Newton step for a coupled positive-definite quadratic before the first iteration limit', async () => {
  const messages: string[] = [];
  const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 1000, sheets: 10, operations: 100, inputBytes: 100000, outputBytes: 100000, workbookWork: 1000000 } };
  const book: Workbook = { activeSheet: 's', sheets: [{ id: 's', name: 'Sheet', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 0 } },
    { row: 1, column: 0, value: { kind: 'number', value: 0 } },
    { row: 0, column: 1, formula: '=(A1-3)^2+(A1-3)*(A2-2)+(A2-2)^2', value: { kind: 'number', value: 0 } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'A1:A2', ModelType: '2', ProblemType: '0', MaxIter: '1', ProgramR: '1' }) }] }] };
  const result = await runSolverValidation(book, { ...context, diagnostic: async d => { messages.push(d.message); } });
  const values = result.sheets[0]!.cells.filter(c => c.column === 0).map(c => c.value);
  for (const [i, expected] of [3, 2].entries()) { const value = values[i]!; expect(value.kind).toBe('number'); if (value.kind === 'number') expect(value.value).toBeCloseTo(expected, 12); }
  expect(messages).toEqual(['Solver reached time or iteration limit']);
  const objective = result.sheets[1]!.cells.find(c => c.row === 2 && c.column === 2)?.value;
  expect(objective?.kind).toBe('number'); if (objective?.kind === 'number') expect(objective.value).toBeLessThan(1e-24);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: 'number', value: 0 });
});
