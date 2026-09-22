import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSofficeBudget, exportCsvTextRows, parseCsvExportOptions, SofficeError } from './index.js';

const limits = { argumentBytes: 4096, files: 20, inputBytes: 4096, retainedBytes: 4096, outputBytes: 4096, nodes: 100, pages: 10, work: 10000 };
const failure = (code: string) => (error: unknown) => error instanceof SofficeError && error.code === code;

test('UTF16 emits a mandatory BOM and exact surrogate-pair code units in each byte order', async () => {
  for (const endianness of ['little', 'big'] as const) {
    const budget = createSofficeBudget(limits, new AbortController().signal);
    try {
      const options = { ...parseCsvExportOptions(undefined, budget), encoding: 'UTF16', endianness, bom: false };
      const chunks: Uint8Array[] = [];
      for await (const chunk of exportCsvTextRows([['é🙂', '']], options, budget)) chunks.push(chunk);
      const little = [0xe9, 0, 0x3d, 0xd8, 0x42, 0xde, 0x2c, 0, 0x0a, 0];
      const big = [0, 0xe9, 0xd8, 0x3d, 0xde, 0x42, 0, 0x2c, 0, 0x0a];
      assert.deepEqual(chunks, [Uint8Array.from(endianness === 'little' ? [255, 254] : [254, 255]), Uint8Array.from(endianness === 'little' ? little : big)]);
      assert.equal(budget.used('outputBytes'), 12);
      assert.equal(budget.used('inputBytes'), 6);
      assert.equal(budget.used('retainedBytes'), 0);
    } finally { budget.close(); }
  }
});

test('UTF16 budget includes BOM and two-byte LF before yielding a row', async () => {
  const budget = createSofficeBudget({ ...limits, outputBytes: 5 }, new AbortController().signal);
  try {
    const stream = exportCsvTextRows([['a']], { ...parseCsvExportOptions(undefined, budget), encoding: 'UTF16' }, budget);
    assert.deepEqual((await stream.next()).value, Uint8Array.of(255, 254));
    await assert.rejects(stream.next(), failure('limit'));
    assert.equal(budget.used('outputBytes'), 2);
    assert.equal(budget.used('retainedBytes'), 0);
  } finally { budget.close(); }
});

test('unknown UTF16 byte order fails before any BOM or row output', async () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const options = { ...parseCsvExportOptions(undefined, budget), encoding: 'UTF16', endianness: 'invalid' as 'little' };
    await assert.rejects(exportCsvTextRows([], options, budget).next(), failure('unsupported'));
    assert.equal(budget.used('outputBytes'), 0);
  } finally { budget.close(); }
});

test('text rows escape separators, quotes and line endings with exact UTF-8 output', async () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const chunks: Uint8Array[] = [];
    for await (const chunk of exportCsvTextRows([['a,b', 'x"y', 'a\rb\nc', 'café🙂', ''], []], parseCsvExportOptions(undefined, budget), budget)) chunks.push(chunk);
    assert.deepEqual(chunks, [new TextEncoder().encode('"a,b","x""y","a\rb\nc",café🙂,\n'), new TextEncoder().encode('\n')]);
    assert.equal(budget.used('inputBytes'), new TextEncoder().encode('a,bx"ya\rb\nccafé🙂').length);
    assert.equal(budget.used('outputBytes'), chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    assert.equal(budget.used('retainedBytes'), 0);
  } finally { budget.close(); }
});
test('quote-all, custom separators and explicit BOM are applied to text cells', async () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const options = { ...parseCsvExportOptions(undefined, budget), fieldSeparator: ';', quoteAllText: true, bom: true };
    const chunks: Uint8Array[] = [];
    for await (const chunk of exportCsvTextRows([['', 'é']], options, budget)) chunks.push(chunk);
    assert.deepEqual(chunks, [Uint8Array.of(239, 187, 191), new TextEncoder().encode('"";"é"\n')]);
  } finally { budget.close(); }
});
test('unsupported output profiles and malformed text fail explicitly', async () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const defaults = parseCsvExportOptions(undefined, budget);
    for (const override of [{ encoding: 'unknown' }, { fixedWidth: true }, { complete: false }, { removeSpace: true }, { textSeparator: '' }]) {
      const stream = exportCsvTextRows([['text']], { ...defaults, ...override }, budget);
      await assert.rejects(stream.next(), failure('unsupported'));
    }
    await assert.rejects(exportCsvTextRows([['\ud800']], defaults, budget).next(), failure('invalid-argument'));
    assert.equal(budget.used('retainedBytes'), 0);
  } finally { budget.close(); }
});
test('input, output, work, node and retention boundaries fail without leaking reservations', async () => {
  for (const override of [{ inputBytes: 1 }, { outputBytes: 1 }, { work: 1 }, { nodes: 0 }, { retainedBytes: 1 }]) {
    const budget = createSofficeBudget({ ...limits, ...override }, new AbortController().signal);
    try {
      const options = parseCsvExportOptions(undefined, budget);
      await assert.rejects(exportCsvTextRows([['abc']], options, budget).next(), failure('limit'));
      assert.equal(budget.used('retainedBytes'), 0);
    } finally { budget.close(); }
  }
});
test('cancellation between rows and early consumer return release invocation-owned bytes', async () => {
  const controller = new AbortController();
  const budget = createSofficeBudget(limits, controller.signal);
  try {
    const options = parseCsvExportOptions(undefined, budget);
    const stream = exportCsvTextRows([['one'], ['two']], options, budget);
    assert.deepEqual((await stream.next()).value, new TextEncoder().encode('one\n'));
    assert.equal(budget.used('retainedBytes'), 0);
    controller.abort();
    await assert.rejects(stream.next(), failure('cancelled'));
    await assert.rejects(exportCsvTextRows([], options, budget).next(), failure('cancelled'));
  } finally { budget.close(); }
  const second = createSofficeBudget(limits, new AbortController().signal);
  try {
    const options = parseCsvExportOptions(undefined, second);
    const stream = exportCsvTextRows([['one'], ['two']], options, second);
    await stream.next();
    await stream.return(undefined);
    assert.equal(second.used('retainedBytes'), 0);
    second.close();
    await assert.rejects(exportCsvTextRows([], options, second).next(), failure('closed'));
  } finally { second.close(); }
});

test('Unicode delimiters count encoded bytes and formula-looking text remains inert', async () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const options = { ...parseCsvExportOptions(undefined, budget), fieldSeparator: 'é', textSeparator: '«' };
    const stream = exportCsvTextRows([['aéb', 'x«y', '=WEBSERVICE("https://example.invalid")']], options, budget);
    const expected = new TextEncoder().encode('«aéb«é«x««y«é=WEBSERVICE("https://example.invalid")\n');
    assert.deepEqual((await stream.next()).value, expected);
    assert.equal(budget.used('outputBytes'), expected.length);
    assert.equal((await stream.next()).done, true);
  } finally { budget.close(); }
});
test('failed row releases only its own memory reservations', async () => {
  const budget = createSofficeBudget({ ...limits, outputBytes: 1 }, new AbortController().signal);
  try {
    budget.charge('retainedBytes', 17);
    await assert.rejects(exportCsvTextRows([['abc']], parseCsvExportOptions(undefined, budget), budget).next(), failure('limit'));
    assert.equal(budget.used('retainedBytes'), 17);
  } finally { budget.close(); }
});

test('dollar text delimiters double literally rather than invoking replacement syntax', async () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const options = { ...parseCsvExportOptions(undefined, budget), textSeparator: '$' };
    assert.deepEqual((await exportCsvTextRows([['a$b']], options, budget).next()).value, new TextEncoder().encode('$a$$b$\n'));
  } finally { budget.close(); }
});

test('export settings are snapshotted before yielding to the consumer', async () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const options = { ...parseCsvExportOptions(undefined, budget), bom: true };
    const stream = exportCsvTextRows([['a,b']], options, budget);
    await stream.next();
    options.fieldSeparator = ';';
    options.textSeparator = 'long';
    assert.deepEqual((await stream.next()).value, new TextEncoder().encode('"a,b"\n'));
  } finally { budget.close(); }
});
