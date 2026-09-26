import { expect, it } from 'vitest';
import { readMps, solverRecord, constraintRecord } from './mps.js';
import { writeModelProgram } from './model-program.js';
import { readGnumeric } from './gnumeric.js';
import type { CapabilityContext } from '../contracts.js';
import type { Workbook, ImportedValue } from '../workbook.js';

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 }, own() {} };
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
function model(constraints: ImportedValue[], formula = '=A1+A2+3'): Workbook {
  return { activeSheet: 's1', sheets: [{ id: 's1', name: 'Sheet1', cells: [
    { row: 0, column: 0, value: { kind: 'number', value: 0 } },
    { row: 1, column: 0, value: { kind: 'number', value: 0 } },
    { row: 0, column: 1, formula, value: { kind: 'number', value: 3 } }
  ], unsupportedRecords: [{ source: 'Gnumeric_XmlIO:sax', kind: 'Solver', disposition: 'retained',
    data: solverRecord({ Target: '$B$1', Inputs: '$A$1:$A$2', ModelType: '0', ProblemType: '1', NonNeg: '1', Discr: '0' }, constraints) }] }] };
}

it('matches native numeric RHS coordinate quirk and per-constraint expanded LP labels', async () => {
  expect(text(await writeModelProgram(model([constraintRecord(1, '$A$1:$A$2', '2')]), context, 'lpsolve')))
    .toBe('/* Created by Gnumeric 1.12.61 */\n\n/* Object function */\nmax: 3;\n\n/* Constraints */\nA1 >= 0;\nA2 >= 0;\nCONSTR_0: 0 <= 2;\nCONSTR_1: 0 <= 2;\n\n/* Declarations */\n\n/* The End */\n');
});

it('extracts MPS fixed bounds through one cell-reference indirection', async () => {
  const book = await readMps(new TextEncoder().encode('NAME          FIXED\nROWS\n N OBJ\nCOLUMNS\n X OBJ 2\nBOUNDS\n FX B X 3\nENDATA\n'), context);
  expect(text(await writeModelProgram(book, context, 'glpk'))).toContain(' obj: 0 X_1 +6\n');
});

it('rounds native integer cell bounds before extracting coefficients and preserves declaration duplicates', async () => {
  const book = await readMps(new TextEncoder().encode('NAME          INTEGER\nROWS\n N OBJ\nCOLUMNS\n X OBJ 2\nBOUNDS\n LI B X 1.2\n UI B X 2.8\nENDATA\n'), context);
  expect(text(await writeModelProgram(book, context, 'glpk')))
    .toBe('\\ Created by Gnumeric 1.12.61\n\nMinimize\n obj: 0 X_1 +4\n\nSubject to\n C_0: 2 >= 1.2\n C_2: 2 <= 2.8\n\nBounds\n X_1 >= 0\n\nGeneral\n X_1\n X_1\n\nEnd\n');
});

it('enforces output bytes without mutating input workbook or swallowing budgets', async () => {
  const book = model([]), before = structuredClone(book);
  await expect(writeModelProgram(book, { ...context, limits: { ...context.limits, outputBytes: 1 } }, 'glpk'))
    .rejects.toMatchObject({ code: 'resource-limit' });
  expect(book).toEqual(before);
});

it('preserves shortest native numbers and scientific exponent spelling', async () => {
  const book = await readMps(new TextEncoder().encode('NAME NUMBERS\nROWS\n N OBJ\nCOLUMNS\n X OBJ 1e-7\n Y OBJ 1e20\n Z OBJ 1.2345678901234567\nENDATA\n'), context);
  expect(text(await writeModelProgram(book, context, 'glpk')))
    .toContain(' obj: 1e-07 X_1 + 1e+20 X_2 + 1.2345678901234567 X_3\n');
});

it.each(['glpk', 'lpsolve'] as const)('preserves non-LP errors in %s outside native affine error handling', async dialect => {
  const book = model([]);
  const changed = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: [{ source: 'Gnumeric_XmlIO:sax', kind: 'Solver', disposition: 'retained' as const,
    data: solverRecord({ Target: '$B$1', Inputs: '$A$1:$A$2', ModelType: '1' }) }] }] };
  await expect(writeModelProgram(changed, context, dialect)).rejects.toMatchObject({ code: 'io', exitCode: 1, message: 'E Only linear programs are handled.' });
});

it.each(['UNKNOWN', '#REF!', '2'])('matches native empty programs for invalid variable set %s', async inputs => {
  const book = model([]);
  const changed = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: [{ source: 'Gnumeric_XmlIO:sax', kind: 'Solver', disposition: 'retained' as const,
    data: solverRecord({ Target: '$B$1', Inputs: inputs, ModelType: '0', ProblemType: '1', NonNeg: '1' }) }] }] };
  expect(text(await writeModelProgram(changed, context, 'glpk')))
    .toBe('\\ Created by Gnumeric 1.12.61\n\nMaximize\n obj: \n\nSubject to\n\nBounds\n\nEnd\n');
});

it.each([[1, 'UNKNOWN'], [1, '2'], [8, '$B$1']] as const)('skips native invalid constraint type %s lhs %s', async (type, lhs) => {
  expect(text(await writeModelProgram(model([constraintRecord(type, lhs, '2')]), context, 'glpk')))
    .toBe('\\ Created by Gnumeric 1.12.61\n\nMaximize\n obj: X_1 + X_2 +3\n\nSubject to\n\nBounds\n X_1 >= 0\n X_2 >= 0\n\nEnd\n');
});

it.each(['$A$1', 'UNKNOWN'])('skips native mismatched or invalid constraint RHS %s', async rhs => {
  expect(text(await writeModelProgram(model([constraintRecord(1, '$A$1:$A$2', rhs)]), context, 'glpk')))
    .toBe('\\ Created by Gnumeric 1.12.61\n\nMaximize\n obj: X_1 + X_2 +3\n\nSubject to\n\nBounds\n X_1 >= 0\n X_2 >= 0\n\nEnd\n');
});

it.each(['glpk', 'lpsolve'] as const)('retains native empty %s expressions when affine detection fails', async dialect => {
  for (const formula of ['=A1*(1-A1)+A2', '=1/0']) {
    const output = text(await writeModelProgram(model([], formula), context, dialect));
    expect(output).toContain(dialect === 'glpk' ? ' obj: \n' : 'max: ;\n');
    expect(output).toContain(dialect === 'glpk' ? '\nEnd\n' : '/* The End */\n');
  }
});

it.each(['glpk', 'lpsolve'] as const)('retains native permissive quadratic secant coefficients in %s', async dialect => {
  expect(text(await writeModelProgram(model([], '=A1^2+A2'), context, dialect)))
    .toContain(dialect === 'glpk' ? ' obj: X_1 + X_2\n' : 'max: A1 + A2;\n');
});

it('honors cancellation before parsing or model evaluation', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(readMps(new Uint8Array(), { ...context, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  await expect(writeModelProgram(model([]), { ...context, signal: controller.signal }, 'glpk')).rejects.toMatchObject({ name: 'AbortError' });
});

it('enforces independent importer and exporter workbook-work limits', async () => {
  const limited = { ...context, limits: { ...context.limits, workbookWork: 1 } };
  await expect(readMps(new TextEncoder().encode('NAME A\nROWS\n N OBJ\nENDATA\n'), limited)).rejects.toMatchObject({ code: 'resource-limit' });
  await expect(writeModelProgram(model([]), limited, 'glpk')).rejects.toMatchObject({ code: 'resource-limit' });
});


it.each(['2', 'UNKNOWN', '$A$1:$A$2', '$Z$99'])('matches native absent target cell for %s', async target => {
  const book = model([]);
  const changed = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: [{ source: 'Gnumeric_XmlIO:sax', kind: 'Solver', disposition: 'retained' as const,
    data: solverRecord({ Target: target, Inputs: '$A$1:$A$2', ModelType: '0', ProblemType: '0', NonNeg: '1' }) }] }] };
  for (const dialect of ['glpk', 'lpsolve'] as const) {
    expect(text(await writeModelProgram(changed, context, dialect)))
      .toContain(dialect === 'glpk' ? ' obj: 0\n' : 'min: 0;\n');
  }
});


it.each([false, true])('discards native named XML targets with global shadow=%s', async shadow => {
  const local = '<Names><Name><name>Goal</name><value>$B$1</value><position>A1</position></Name></Names>';
  const global = shadow ? '<Names><Name><name>Goal</name><value>Sheet1!$A$1</value><position>A1</position></Name></Names>' : '';
  const source = `<Workbook xmlns="http://www.gnumeric.org/v10.dtd">${global}<Sheets><Sheet><Name>Sheet1</Name>${local}<Solver Target="Goal" Inputs="$A$1:$A$2" ProblemType="0"/><Cells><Cell Row="0" Col="0" ValueType="40">0</Cell><Cell Row="1" Col="0" ValueType="40">0</Cell><Cell Row="0" Col="1">=2*A1+3</Cell></Cells></Sheet></Sheets></Workbook>`;
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  for (const dialect of ['glpk', 'lpsolve'] as const) expect(text(await writeModelProgram(book, context, dialect)))
    .toContain(dialect === 'glpk' ? ' obj: 0\n' : 'min: 0;\n');
});

it('retains native allocated target inputs and singleton target ranges', async () => {
  const book = model([]);
  for (const [target, inputs, expected] of [['$A$3', '$A$3', 'X_1'], ['$A$1:$A$1', '$A$1:$A$2', 'X_1 + 0 X_2']]) {
    const changed = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: [{ ...book.sheets[0]!.unsupportedRecords![0]!,
      data: solverRecord({ Target: target!, Inputs: inputs!, NonNeg: '1' }) }] }] };
    expect(text(await writeModelProgram(changed, context, 'glpk'))).toContain(` obj: ${expected}\n`);
  }
});
