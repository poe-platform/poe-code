import { expect, it } from 'vitest';
import { loadSolverParameters, validateSolverParameters, selectSolverAlgorithm } from './model.js';
import { solverRecord, constraintRecord } from '../codecs/mps.js';
import type { Workbook } from '../workbook.js';
import type { CapabilityContext } from '../contracts.js';
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { cells: 100, sheets: 4, operations: 20, inputBytes: 10000, outputBytes: 10000 } };
it('loads signed and zero-padded native integer model and objective enums', () => {
  for (const [source, modelType, objective] of [
    ['+0', 'linear', 'minimize'], ['01', 'quadratic', 'maximize'], ['+2', 'nonlinear', 'unknown'], ['-0', 'linear', 'minimize']
  ] as const) {
    const model = loadSolverParameters(fixture({ ModelType: source, ProblemType: source }), context);
    expect(model.modelType).toBe(modelType);
    expect(model.objective).toBe(objective);
  }
});
function fixture(attributes: Record<string, string> = {}, constraints: ReturnType<typeof constraintRecord>[] = []): Workbook {
  return { activeSheet: 's', sheets: [{ id: 's', name: 'Sheet', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 2 } },
    { row: 0, column: 1, formula: '=A1*2', value: { kind: 'number', value: 4 } }
  ], unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: '$B$1', Inputs: '$A$1', ...attributes }, constraints) }] }] };
}
it('loads native defaults, domains, classification and limits', () => {
  const model = loadSolverParameters(fixture({ ModelType: '2', MaxIter: '7', MaxTime: '3' }, [constraintRecord(16, 'A1')]), context);
  expect(model.modelType).toBe('nonlinear');
  expect(model.options.maximumIterations).toBe(7);
  expect(model.options.maximumTimeSeconds).toBe(3);
  expect(model.domains).toEqual(['binary']);
  expect(validateSolverParameters(fixture(), loadSolverParameters(fixture(), context), context)).toBeUndefined();
});
it('validates target before inputs and constraints', () => {
  const book = fixture({ Target: 'missing', Inputs: 'missing' }, [constraintRecord(1, 'A1:A2', 'B1')]);
  expect(validateSolverParameters(book, loadSolverParameters(book, context), context)).toBe('Invalid solver target');
});
it('rejects input formulas and shape mismatches in source order', () => {
  for (const [book, message] of [
    [fixture({ Inputs: 'B1' }), 'Input cell B1 contains a formula'],
    [fixture({}, [constraintRecord(1, 'A1:A2', 'B1')]), 'Solver constraint #1 is invalid'],
    [fixture({}, [constraintRecord(8, 'A2')]), 'Solver constraint #1 is invalid']
  ] as const) expect(validateSolverParameters(book, loadSolverParameters(book, context), context)).toBe(message);
});
it('uses deterministic functional model fallback without native algorithms', () => {
  const model = loadSolverParameters(fixture(), context);
  expect(selectSolverAlgorithm(model, [])).toBeUndefined();
  expect(selectSolverAlgorithm(model, [{ id: 'nonlinear', modelType: 'nonlinear', available: true }, { id: 'linear', modelType: 'linear', available: true }])?.id).toBe('linear');
});

it('reports native validation failures and continues the shared conversion pipeline', async () => {
  const { runConversionTransforms } = await import('../conversion/transforms.js');
  const messages: string[] = [];
  const result = await runConversionTransforms(fixture({ Target: 'missing' }), { input: { kind: 'stream', source: [] }, solve: true },
    { codecs: [], limits: context.limits, environment: context.environment }, { ...context, async diagnostic(d) { messages.push(d.message); } }, () => {});
  expect(messages).toEqual(['Solver: Invalid solver target']);
  expect(result.book.sheets[0]!.cells[0]!.value).toEqual({ kind: 'number', value: 2 });
});
it('solves validated linear models through the conversion transforms', async () => {
  const { runConversionTransforms } = await import('../conversion/transforms.js');
  const result = await runConversionTransforms(fixture({}, [constraintRecord(2, 'B1', '0')]), { input: { kind: 'stream', source: [] }, solve: true },
    { codecs: [], limits: context.limits, environment: context.environment }, context, () => {});
  expect(result.book.sheets[0]!.cells[0]!.value).toEqual({ kind: 'number', value: 0 });
  expect(result.book.sheets[0]!.cells[1]!.value).toEqual({ kind: 'number', value: 0 });
});

it('does not materialize an absent target from the input range before validation', () => {
  const book = fixture({ Target: 'C1', Inputs: 'C1' });
  expect(validateSolverParameters(book, loadSolverParameters(book, context), context)).toBe('Invalid solver target');
});
it('ignores invalid legacy target coordinates and retains the modern target', () => {
  for (const attributes of [{ TargetRow: '-1', TargetCol: '1' }, { TargetRow: '0', TargetCol: '999999' }, { TargetRow: '0' }]) {
    const book = fixture(attributes);
    expect(loadSolverParameters(book, context).target).toEqual({ sheet: 's', row: 0, column: 1 });
  }
});
it('does not resolve native XML names before delayed definitions', () => {
  for (const sheet of [undefined, 's']) {
    const names = [{ name: 'Goal', expression: '$B$1', ...(sheet ? { sheet } : {}) }];
    const targetBook: Workbook = { ...fixture({ Target: 'Goal' }), names };
    expect(loadSolverParameters(targetBook, context).target).toBeUndefined();
    const inputBook: Workbook = { ...fixture({ Inputs: 'Goal' }), names };
    expect(validateSolverParameters(inputBook, loadSolverParameters(inputBook, context), context)).toBe('Invalid solver input range');
    const constraintBook: Workbook = { ...fixture({}, [constraintRecord(1, 'Goal', '1')]), names };
    expect(validateSolverParameters(constraintBook, loadSolverParameters(constraintBook, context), context)).toBe('Solver constraint #1 is invalid');
  }
});
it('maps unknown native constraint types to less-than-or-equal', () => {
  const book = fixture({}, [constraintRecord(99, 'A1')]);
  const model = loadSolverParameters(book, context);
  expect(model.constraints[0]!.relation).toBe(1);
  expect(validateSolverParameters(book, model, context)).toBe('Solver constraint #1 is invalid');
});
it('loads legacy rectangular domain constraint coordinates', () => {
  const old = { name: 'Constr', namespace: 'http://www.gnumeric.org/v10.dtd', attributes: Object.entries({ Type: '16', Lcol: '0', Lrow: '0', Cols: '1', Rows: '1' }).map(([name, value]) => ({ name, value })) };
  const book = fixture({}, [old]);
  const model = loadSolverParameters(book, context);
  expect(model.domains).toEqual(['binary']);
  expect(validateSolverParameters(book, model, context)).toBeUndefined();
});
it('resolves parenthesized objective references', () => {
  const book = fixture({ Target: '(B1)' });
  expect(loadSolverParameters(book, context).target).toEqual({ sheet: 's', row: 0, column: 1 });
});
it('uses active sheet solver metadata and rejects domains on another sheet', () => {
  const first = fixture(), second = fixture({ Target: 'A1' });
  const book: Workbook = { activeSheet: 'other', sheets: [first.sheets[0]!, { ...second.sheets[0]!, id: 'other', name: 'Other' }] };
  const model = loadSolverParameters(book, context);
  expect(model.sheet).toBe('other');
  expect(validateSolverParameters(book, model, context)).toBe('Target cell, A1, must contain a formula that evaluates to a number');
  const constrained: Workbook = { ...first, sheets: [{ ...first.sheets[0]!, unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'A1' }, [constraintRecord(8, 'Other!A1')]) }] }, book.sheets[1]!] };
  expect(validateSolverParameters(constrained, loadSolverParameters(constrained, context), context)).toBe('Solver constraint #1 is invalid');
});
it('honors cancellation and bounds domain-membership work', () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  expect(() => loadSolverParameters(fixture(), { ...context, signal: controller.signal })).toThrow('cancelled');
  const book = fixture({ Inputs: 'A1:A10' }, Array.from({ length: 10 }, () => constraintRecord(16, 'A20')));
  expect(() => loadSolverParameters(book, { ...context, limits: { ...context.limits, workbookWork: 80 } })).toThrow('ssconvert workbook work limit exceeded');
});
it('quotes cross-sheet names in target and input validation diagnostics', () => {
  for (const [sheetName, quoted] of [['Other Sheet', "'Other Sheet'"], ["O'Brien", "'O\\'Brien'"]] as const) {
    const other = { id: 'other', name: sheetName, cells: [
      { row: 0, column: 0, value: { kind: 'number' as const, value: 2 } },
      { row: 0, column: 1, formula: '=A1*2', value: { kind: 'number' as const, value: 4 } }
    ] };
    const targetBook: Workbook = { ...fixture({ Target: `${quoted}!A1` }), sheets: [fixture({ Target: `${quoted}!A1` }).sheets[0]!, other] };
    expect(validateSolverParameters(targetBook, loadSolverParameters(targetBook, context), context)).toBe(`Target cell, ${quoted}!A1, must contain a formula that evaluates to a number`);
    const inputBook: Workbook = { ...fixture({ Inputs: `${quoted}!B1` }), sheets: [fixture({ Inputs: `${quoted}!B1` }).sheets[0]!, other] };
    expect(validateSolverParameters(inputBook, loadSolverParameters(inputBook, context), context)).toBe(`Input cell ${quoted}!B1 contains a formula`);
  }
});
it('rejects workbook record accessors before observing solver attributes', () => {
  let observed = false;
  const data = Object.defineProperty({}, 'attributes', { enumerable: true, get() { observed = true; return [{ name: 'Target', value: 'B1' }]; } });
  const book: Workbook = { ...fixture(), sheets: [{ ...fixture().sheets[0]!, unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data }] }] };
  expect(() => loadSolverParameters(book, context)).toThrow('Unsupported workbook accessor');
  expect(observed).toBe(false);
});
it('matches native numeric constraint text before parsing reference expressions', () => {
  for (const [source, expected] of [['50%', 0.5], ['$1,200', 1200], ['(50)', -50], ['-2.5', -2.5]] as const) {
    const book = fixture({}, [constraintRecord(1, 'A1', source)]);
    const model = loadSolverParameters(book, context);
    expect(model.constraints[0]!.rhs).toBe(expected);
    expect(validateSolverParameters(book, model, context)).toBeUndefined();
  }
  for (const source of ['=50', '=50%', '1+2']) {
    const book = fixture({}, [constraintRecord(1, 'A1', source)]);
    expect(validateSolverParameters(book, loadSolverParameters(book, context), context)).toBe('Solver constraint #1 is invalid');
  }
});
it('exposes nonserialized native constructor options without invented XML attributes', () => {
  const model = loadSolverParameters(fixture({ GradientOrder: '2', ScenarioName: 'custom', AddScenario: '1' }), context);
  expect(model.options).toMatchObject({ gradientOrder: 10, scenarioName: 'Optimal', addScenario: false });
});
it('retains a functional saved algorithm regardless of model type and orders functional fallbacks', () => {
  const model = loadSolverParameters(fixture(), context);
  const registry = [
    { id: 'saved', modelType: 'nonlinear' as const, available: true },
    { id: 'missing', modelType: 'linear' as const, available: false },
    { id: 'first', modelType: 'linear' as const, available: true },
    { id: 'second', modelType: 'linear' as const, available: true }
  ];
  expect(selectSolverAlgorithm(model, registry, 'saved')?.id).toBe('saved');
  expect(selectSolverAlgorithm(model, registry, 'missing')?.id).toBe('first');
});
it('loads native XML boolean options with false-or-zero semantics', () => {
  const disabled = loadSolverParameters(fixture({ NonNeg: 'FALSE', Discr: 'false', AutoScale: '0', ProgramR: 'FaLsE', SensitivityR: '0' }), context);
  expect(disabled.options).toMatchObject({ nonnegative: false, discrete: false, automaticScaling: false, programReport: false, sensitivityReport: false });
  const enabled = loadSolverParameters(fixture({ NonNeg: 'yes', Discr: 'true', AutoScale: 'TRUE', ProgramR: 'anything', SensitivityR: '' }), context);
  expect(enabled.options).toMatchObject({ nonnegative: true, discrete: true, automaticScaling: true, programReport: true, sensitivityReport: true });
  expect(enabled.domains).toEqual(['integer']);
});
it('loads signed native iteration bits as unsigned while retaining signed time limits', () => {
  const model = loadSolverParameters(fixture({ MaxIter: '-1', MaxTime: '-1' }), context);
  expect(model.options.maximumIterations).toBe(4294967295);
  expect(model.options.maximumTimeSeconds).toBe(-1);
});
it('matches numeric time-like constraint LHS text before whole-row references', () => {
  const book = fixture({}, [constraintRecord(1, '1:2', '5')]);
  const model = loadSolverParameters(book, context);
  expect(model.constraints[0]!.lhs).toBeUndefined();
  expect(validateSolverParameters(book, model, context)).toBe('Solver constraint #1 is invalid');
});
it('accepts numeric grouped objectives and rejects grouped variable expressions', () => {
  const base = fixture({ Target: 'C1' });
  const book: Workbook = { ...base, sheets: [{ ...base.sheets[0]!, cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 2 } },
    { row: 0, column: 1, formulaGroup: 'array', value: { kind: 'number', value: 4 } },
    { row: 0, column: 2, formulaGroup: 'array', value: { kind: 'number', value: 6 } }
  ], formulaGroups: [{ id: 'array', kind: 'array', expression: '=A1*{2,3}', range: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 2 } }] }] };
  expect(validateSolverParameters(book, loadSolverParameters(book, context), context)).toBeUndefined();
  const inputBook: Workbook = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: [{ source: 'gnumeric', kind: 'Solver', disposition: 'retained', data: solverRecord({ Target: 'B1', Inputs: 'C1' }) }] }] };
  expect(validateSolverParameters(inputBook, loadSolverParameters(inputBook, context), context)).toBe('Input cell C1 contains a formula');
});
it('bounds domain classification scans even for only ordinary constraints', () => {
  const book = fixture({ Inputs: 'A1:A40' }, Array.from({ length: 50 }, () => constraintRecord(1, 'A1', '0')));
  expect(() => loadSolverParameters(book, { ...context, limits: { ...context.limits, workbookWork: 2500 } })).toThrow('ssconvert workbook work limit exceeded');
});
