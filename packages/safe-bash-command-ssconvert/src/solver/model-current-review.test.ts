import { expect, it } from 'vitest';
import { loadSolverParameters, selectSolverAlgorithm, validateSolverParameters } from './model.js';
import { solverRecord } from '../codecs/mps.js';
import type { CapabilityContext } from '../contracts.js';
import type { Workbook } from '../workbook.js';

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { cells: 20, sheets: 2, operations: 20, inputBytes: 10000, outputBytes: 10000 }
};
function fixture(attributes: Record<string, string>): Workbook {
  return { activeSheet: 's', sheets: [{ id: 's', name: 'Review', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 3 } },
    { row: 0, column: 1, formula: '=A1+1', value: { kind: 'number', value: 4 } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained',
    data: solverRecord({ Target: 'B1', Inputs: 'A1', ...attributes }) }] }] };
}

it('retains native constructor defaults when XML integer attributes fail parsing', () => {
  for (const invalid of ['no', '1.5', '1 ', '+', '-', ' ', '0x1', '1e2']) {
    const model = loadSolverParameters(fixture({ ModelType: invalid, ProblemType: invalid, MaxIter: invalid, MaxTime: invalid }), context);
    expect(model.modelType, invalid).toBe('linear');
    expect(model.objective, invalid).toBe('minimize');
    expect(model.options.maximumIterations, invalid).toBe(1000);
    expect(model.options.maximumTimeSeconds, invalid).toBe(60);
  }
});

it('distinguishes valid unknown native enums from invalid lexical spellings', () => {
  const model = loadSolverParameters(fixture({ ModelType: '3', ProblemType: '-1' }), context);
  expect(model.modelType).toBe('unknown');
  expect(model.objective).toBe('unknown');
  expect(selectSolverAlgorithm(model, [{ id: 'linear', modelType: 'linear', available: true }])).toBeUndefined();
});

it('accepts native empty-string zero and leading whitespace without accepting trailing whitespace', () => {
  for (const [source, expected] of [['', 0], ['\t+0001', 1], ['\n-0', 0]] as const) {
    const model = loadSolverParameters(fixture({ MaxTime: source }), context);
    expect(model.options.maximumTimeSeconds).toBe(expected);
  }
});

it('matches captured 64-bit strtol bounds and native signed-int assignments', () => {
  for (const [source, time, iterations] of [
    ['4294967297', 1, 1], ['2147483648', -2147483648, 2147483648],
    ['9223372036854775807', -1, 4294967295], ['-9223372036854775808', 0, 0],
    ['9223372036854775808', 60, 1000], ['-9223372036854775809', 60, 1000]
  ] as const) {
    const model = loadSolverParameters(fixture({ MaxTime: source, MaxIter: source }), context);
    expect(model.options.maximumTimeSeconds, source).toBe(time);
    expect(model.options.maximumIterations, source).toBe(iterations);
  }
  const model = loadSolverParameters(fixture({ ModelType: '4294967297', ProblemType: '4294967297', TargetCol: '4294967297', TargetRow: '0' }), context);
  expect(model.modelType).toBe('quadratic');
  expect(model.objective).toBe('maximize');
  expect(model.target).toEqual({ sheet: 's', row: 0, column: 1 });
});

it('checks negative authority controls and leaves the original workbook unchanged', () => {
  const book = fixture({ Target: 'B1', Inputs: 'A1' });
  const before = structuredClone(book);
  const model = loadSolverParameters(book, context);
  expect(validateSolverParameters(book, model, context)).toBeUndefined();
  expect(book).toEqual(before);
  expect(() => loadSolverParameters(book, { ...context, limits: { ...context.limits, workbookWork: 1 } })).toThrow('limit exceeded');
  const controller = new AbortController();
  controller.abort(new Error('review cancellation'));
  expect(() => validateSolverParameters(book, model, { ...context, signal: controller.signal })).toThrow('review cancellation');
});
