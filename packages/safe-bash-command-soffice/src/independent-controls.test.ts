import assert from 'node:assert/strict';
import test from 'node:test';
import { createSofficeBudget, exportCsvTextRows, parseCsvExportOptions, SofficeError } from './index.js';

// Fixed byte oracles, not candidate-generated expectations. These qualify only
// the inert text primitive: no Office import, layout or native parity is implied.
const limits = { argumentBytes: 4096, files: 20, inputBytes: 4096,
  retainedBytes: 16384, outputBytes: 4096, nodes: 100, pages: 10, work: 10000 };

test('C1 quoting and CR/LF cells match independently specified bytes', async () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const chunks: number[] = [];
    for await (const bytes of exportCsvTextRows([
      ['name', 'value'], ['a,b', 'x"y'], ['A\rB', 'C\nD'], ['=1+2', '']
    ], parseCsvExportOptions(undefined, budget), budget)) chunks.push(...bytes);
    assert.deepEqual(Uint8Array.from(chunks), new TextEncoder().encode(
      'name,value\n"a,b","x""y"\n"A\rB","C\nD"\n=1+2,\n'
    ));
    assert.equal(budget.used('outputBytes'), chunks.length);
    assert.equal(budget.used('retainedBytes'), 0);
  } finally { budget.close(); }
});

test('UTF-16 negative controls distinguish byte order and preserve a surrogate pair', async () => {
  for (const [token, expected] of [
    ['0', [254, 255, 216, 61, 222, 0, 0, 44, 0, 233, 0, 10]],
    ['1', [255, 254, 61, 216, 0, 222, 44, 0, 233, 0, 10, 0]]
  ] as const) {
    const budget = createSofficeBudget(limits, new AbortController().signal);
    try {
      const options = parseCsvExportOptions('44,34,UTF16,1,,0,false,true,false,false,false,0,true,false,' + token, budget);
      const chunks: number[] = [];
      for await (const bytes of exportCsvTextRows([['😀', 'é']], options, budget)) chunks.push(...bytes);
      assert.deepEqual(chunks, expected);
      assert.equal(budget.used('outputBytes'), 12);
    } finally { budget.close(); }
  }
});

test('CSV export selector is token twelve, independently of token eleven', () => {
  for (const [text, sheet, removeSpace, evaluateFormulas] of [
    ['44,34,76,1,,0,false,true,false,false,true,2', 2, true, true],
    ['44,34,76,1,,0,false,true,false,false,false,-1,', -1, false, false],
    ['44,34,76,1,,0,false,true,false,false,true,1x,TRUE', -23, true, false]
  ] as const) {
    const budget = createSofficeBudget(limits, new AbortController().signal);
    try {
      const actual = parseCsvExportOptions(text, budget);
      assert.deepEqual([actual.sheet, actual.removeSpace, actual.evaluateFormulas], [sheet, removeSpace, evaluateFormulas]);
    } finally { budget.close(); }
  }
});

test('late invalid text releases row storage without pretending earlier bytes were unpublished', async () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const stream = exportCsvTextRows([['ok'], ['\ud800']], parseCsvExportOptions(undefined, budget), budget);
    assert.deepEqual((await stream.next()).value, Uint8Array.of(111, 107, 10));
    await assert.rejects(stream.next(), error => error instanceof SofficeError && error.code === 'invalid-argument');
    assert.equal(budget.used('retainedBytes'), 0);
    assert.equal(budget.used('outputBytes'), 3);
    assert.equal((await stream.next()).done, true);
  } finally { budget.close(); }
});
