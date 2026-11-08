import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, sourceServices, type ImportedValue } from "../index.js";
import profile from '../../../../docs/ssconvert/mps-model-reference-profile.json' with { type: 'json' };

const mps = 'NAME          ORIGINAL\nROWS\n N COST\n L CAP\nCOLUMNS\n X COST 2 CAP 3\n Y COST -1 CAP 1\nRHS\n RHS CAP 9\nBOUNDS\n UP B X 4\nENDATA\n';
const glpk = '\\ Created by Gnumeric 1.12.61\n\nMinimize\n obj: 2 X_1 - X_2\n\nSubject to\n C_0: 3 X_1 + X_2 <= 9\n C_1: X_1 <= 4\n\nBounds\n X_1 >= 0\n X_2 >= 0\n\nEnd\n';
const lp = '/* Created by Gnumeric 1.12.61 */\n\n/* Object function */\nmin: 2 B10 - B11;\n\n/* Constraints */\nB10 >= 0;\nB11 >= 0;\nCONSTR_0: 3 B10 + B11 <= 9;\nCONSTR_0: B10 <= 4;\n\n/* Declarations */\n\n/* The End */\n';

it.each(['\r', '\r\n'])('imports native MPS line ending %j through the SDK', async ending => {
  const source = ['NAME CR', 'ROWS', ' N COST', 'COLUMNS', ' X COST 2', 'ENDATA', ''].join(ending);
  const engine = createEngine({ codecs: [], limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 }, environment: { env: {}, locale: 'C', timezone: 'UTC' } });
  const chunks: Uint8Array[] = [];
  try {
    const result = await engine.convert({ input: { kind: 'stream', source: [new TextEncoder().encode(source)] }, importType: 'Gnumeric_mps:mps', exportType: 'Gnumeric_glpk:glpk',
      destination: { kind: 'stream', sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(chunks.map(bytes => new TextDecoder().decode(bytes)).join('')).toBe('\\ Created by Gnumeric 1.12.61\n\nMinimize\n obj: 2 X_1\n\nSubject to\n\nBounds\n X_1 >= 0\n\nEnd\n');
  } finally { await engine.dispose(); }
});

it.each([['Gnumeric_glpk:glpk', glpk], ['Gnumeric_lpsolve:lpsolve', lp]])('imports an original MPS and exports exact %s bytes without a solver capability', async (exportType, expected) => {
  const volume = Volume.fromJSON({ '/original.mps': mps });
  const engine = createEngine({ codecs: sourceServices, limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 },
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
    } });
  try {
    const result = await engine.convert({ input: { kind: 'resource', uri: '/original.mps' }, importType: 'Gnumeric_mps:mps', exportType,
      destination: { kind: 'resource', uri: '/model' } }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    expect(volume.readFileSync('/model', 'utf8')).toBe(expected);
  } finally { await engine.dispose(); }
});

it('converts MPS to native cells, sheet names, formulas and solver metadata', async () => {
  const { readMps } = await import('./mps.js');
  const { readGnumeric } = await import('./gnumeric.js');
  const context = { signal: new AbortController().signal, environment: { env: {}, locale: 'C', timezone: 'UTC' },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 }, own() {} };
  const reference = await readGnumeric(new Uint8Array(Buffer.from(profile.cases[2]!.outputBase64, 'base64')), context);
  const imported = await readMps(new TextEncoder().encode(mps), context);
  const geometry = (book: typeof imported) => book.sheets[0]!.cells.map(c => ({ row: c.row, column: c.column,
    ...(c.formula ? { formula: c.formula } : { value: c.value }) })).sort((a, b) => a.row - b.row || a.column - b.column);
  expect(geometry(imported)).toEqual(geometry(reference));
  expect(imported.names).toEqual(reference.names);
  const metadata = (value: ImportedValue | undefined): ImportedValue => {
    if (value === undefined) return null;
    if (Array.isArray(value)) return value.map(v => metadata(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'text').map(([k, v]) => [k, metadata(v)]));
    return value;
  };
  expect(metadata(imported.sheets[0]!.unsupportedRecords?.find(r => r.kind === 'Solver')?.data)).toEqual(metadata(reference.sheets[0]!.unsupportedRecords?.find(r => r.kind === 'Solver')?.data));
});

it.each(profile.invalidImportCases)('preserves native invalid MPS diagnostics and namespace: $name', async capture => {
  const { runCommand } = await import('../cli.js');
  const volume = Volume.fromJSON({ '/invalid.mps': capture.source, '/keep': 'untouched' });
  const engine = createEngine({ codecs: sourceServices, limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 },
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
    } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  try {
    const result = await runCommand(['-I', 'Gnumeric_mps:mps', '-T', 'Gnumeric_glpk:glpk', '/invalid.mps', '/result'], engine,
      { signal: new AbortController().signal, stdout: { async write(b) { stdout.push(b); } }, stderr: { async write(b) { stderr.push(b); } } });
    expect(result.exitCode).toBe(capture.status);
    expect(stdout).toEqual([]); expect(stderr.map(b => new TextDecoder().decode(b)).join('')).toBe(capture.stderr);
    expect(volume.toJSON()).toEqual({ '/invalid.mps': capture.source, '/keep': 'untouched' });
  } finally { await engine.dispose(); }
});

it.each(profile.variantCases.flatMap(c => c.exports.map(e => ({ ...e, name: c.name, source: c.source }))))('matches native fixed/free MPS variant $name to $type', async capture => {
  const engine = createEngine({ codecs: [], limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 }, environment: { env: {}, locale: 'C', timezone: 'UTC' } });
  const chunks: Uint8Array[] = [];
  try {
    const result = await engine.convert({ input: { kind: 'stream', source: [new TextEncoder().encode(capture.source)], filename: `${capture.name}.MPS` }, exportType: capture.type,
      destination: { kind: 'stream', sink: { async write(b) { chunks.push(b); } } } }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(capture.status); expect(result.diagnostics).toEqual([]);
    expect(chunks.map(b => new TextDecoder().decode(b)).join('')).toBe(capture.output);
  } finally { await engine.dispose(); }
});

it('exports the active sheet model and an empty model without invoking solve', async () => {
  const source = '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>First</Name><Cells><Cell Row="0" Col="0" ValueType="40">99</Cell></Cells></Sheet><Sheet><Name>Active</Name><Solver Target="$B$1" Inputs="$A$1" ProblemType="1" NonNeg="0"/><Cells><Cell Row="0" Col="0" ValueType="40">0</Cell><Cell Row="0" Col="1">=3*A1+5</Cell></Cells></Sheet></Sheets><UIData SelectedTab="1"/></Workbook>';
  const engine = createEngine({ codecs: [], limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 }, environment: { env: {}, locale: 'C', timezone: 'UTC' } });
  const chunks: Uint8Array[] = [];
  try {
    await engine.convert({ input: { kind: 'stream', source: [new TextEncoder().encode(source)] }, exportType: 'Gnumeric_glpk:glpk', destination: { kind: 'stream', sink: { async write(b) { chunks.push(b); } } } }, { signal: new AbortController().signal });
    expect(new TextDecoder().decode(chunks[0])).toBe('\\ Created by Gnumeric 1.12.61\n\nMaximize\n obj: 3 X_1 +5\n\nSubject to\n\nBounds\n X_1 free\n\nEnd\n');
    chunks.length = 0;
    await engine.convert({ input: { kind: 'stream', source: [new TextEncoder().encode('1,2\n')], filename: 'empty.csv' }, exportType: 'Gnumeric_glpk:glpk', destination: { kind: 'stream', sink: { async write(b) { chunks.push(b); } } } }, { signal: new AbortController().signal });
    expect(new TextDecoder().decode(chunks[0])).toBe('\\ Created by Gnumeric 1.12.61\n\nMinimize\n obj: 0\n\nSubject to\n\nBounds\n\nEnd\n');
  } finally { await engine.dispose(); }
});

it('keeps native MPS header emphasis in workbook cells', async () => {
  const { readMps } = await import('./mps.js');
  const context = { signal: new AbortController().signal, environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 }, own() {} };
  const book = await readMps(new TextEncoder().encode(mps), context);
  for (const c of book.sheets[0]!.cells.filter(c => c.row === 8 || c.column === 0 && [0, 4].includes(c.row))) expect(c.style?.bold).toBe(true);
});

it('retains native NAME-only MPS empty-model conversion', async () => {
  const engine = createEngine({ codecs: [], limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 }, environment: { env: {}, locale: 'C', timezone: 'UTC' } });
  const chunks: Uint8Array[] = [];
  try {
    await engine.convert({ input: { kind: 'stream', source: [new TextEncoder().encode('NAME EMPTY\nENDATA\n')], filename: 'empty.mps' }, exportType: 'Gnumeric_glpk:glpk', destination: { kind: 'stream', sink: { async write(b) { chunks.push(b); } } } }, { signal: new AbortController().signal });
    expect(new TextDecoder().decode(chunks[0])).toBe('\\ Created by Gnumeric 1.12.61\n\nMinimize\n obj: 0\n\nSubject to\n\nBounds\n X_1 >= 0\n X_2 >= 0\n\nEnd\n');
  } finally { await engine.dispose(); }
});

it('skips native constraint ranges with equal cell count but unequal geometry', async () => {
  const engine = createEngine({ codecs: [], limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 }, environment: { env: {}, locale: 'C', timezone: 'UTC' } });
  const chunks: Uint8Array[] = [];
  try {
    const result = await engine.convert({ input: { kind: 'stream', source: [new TextEncoder().encode(profile.geometryCase.source)] }, exportType: 'Gnumeric_glpk:glpk', destination: { kind: 'stream', sink: { async write(b) { chunks.push(b); } } } }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(profile.geometryCase.status);
    expect(new TextDecoder().decode(chunks[0])).toBe(profile.geometryCase.output);
  } finally { await engine.dispose(); }
});

it.each(['Gnumeric_glpk:glpk', 'Gnumeric_lpsolve:lpsolve'])('preserves native non-LP %s status, error prefix and empty output file', async exportType => {
  const { runCommand } = await import('../cli.js');
  const source = '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>NonLP</Name><Solver ModelType="1"/><Cells/></Sheet></Sheets></Workbook>';
  const volume = Volume.fromJSON({ '/nonlp.gnumeric': source });
  const engine = createEngine({ codecs: [], limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000 }, environment: { env: {}, locale: 'C', timezone: 'UTC' }, filesystem: {
    async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; }, async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
  } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  try {
    const result = await runCommand(['-T', exportType, '/nonlp.gnumeric', '/result'], engine, { signal: new AbortController().signal,
      stdout: { async write(b) { stdout.push(b); } }, stderr: { async write(b) { stderr.push(b); } } });
    expect(result.exitCode).toBe(1); expect(stdout).toEqual([]);
    expect(stderr.map(b => new TextDecoder().decode(b)).join('')).toBe('E Only linear programs are handled.\n');
    expect(volume.readFileSync('/result', 'utf8')).toBe('');
  } finally { await engine.dispose(); }
});
