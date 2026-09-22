import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodePdftotextOutput } from './encoding.js';

const signal = new AbortController().signal;
test('selected encodings encode text, spaces, EOL and final/blank page breaks together', () => {
  assert.deepEqual([...encodePdftotextOutput('A é\n\f\f', 'UTF-8', 'dos', signal).bytes], [65, 32, 195, 169, 13, 10, 12, 12]);
  assert.deepEqual([...encodePdftotextOutput('A é\n\f', 'Latin1', 'mac', signal).bytes], [65, 32, 233, 13, 12]);
  assert.deepEqual([...encodePdftotextOutput('A\n\f', 'UTF-16', 'dos', signal).bytes], [0, 65, 0, 13, 0, 10, 0, 12]);
  assert.deepEqual([...encodePdftotextOutput('😀', 'UTF-16', 'unix', signal).bytes], [0xd8, 0x3d, 0xde, 0]);
  assert.deepEqual([...encodePdftotextOutput('A\n\f', 'ASCII7', 'unix', signal).bytes], [65, 10, 12]);
});

test('strict unrepresentable Unicode is diagnosed without substitution or normalization', () => {
  for (const encoding of ['ASCII7', 'Latin1'] as const) assert.throws(() => encodePdftotextOutput('😀', encoding, 'unix', signal));
  assert.throws(() => encodePdftotextOutput('\ud800', 'UTF-8', 'unix', signal));
  assert.deepEqual([...encodePdftotextOutput('ﬁ', 'UTF-8', 'unix', signal).bytes], [0xef, 0xac, 0x81]);
});

test('encoding charges expansion before allocation, reports separate bytes and honors cancellation', () => {
  assert.throws(() => encodePdftotextOutput('\n', 'UTF-16', 'dos', signal, { outputBytes: 3 }));
  const result = encodePdftotextOutput('\n', 'UTF-16', 'dos', signal, { outputBytes: 4 });
  assert.equal(result.accounting.outputBytes, 4);
  assert.equal(result.accounting.decodedBytes, 2);
  assert.equal(result.accounting.inputBytes, 0);
  assert.throws(() => encodePdftotextOutput('a', 'UTF-8', 'unix', signal, { retainedBytes: 0 }));
  assert.throws(() => encodePdftotextOutput('', 'UTF-8', 'unix', signal, { retainedBytes: 0 }));
  assert.throws(() => encodePdftotextOutput('a', 'UTF-8', 'unix', signal, { work: 0 }));
  assert.throws(() => encodePdftotextOutput('a', 'UTF-8', 'unix', signal, { decodedBytes: 0 }));
  const controller = new AbortController();
  controller.abort('stop');
  assert.throws(() => encodePdftotextOutput('', 'UTF-8', 'unix', controller.signal), error => error === 'stop');
});

test('UTF-8 agrees with the independent platform encoder at scalar boundaries and with seed 0x0595ca8e', () => {
  let seed = 0x0595ca8e;
  const boundaries = [0, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff];
  for (let i = 0; i < 128; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const cp = seed % 0x110000;
    if (cp < 0xd800 || cp > 0xdfff) boundaries.push(cp);
  }
  const text = String.fromCodePoint(...boundaries);
  const expected = new TextEncoder().encode(text);
  assert.deepEqual(encodePdftotextOutput(text, 'UTF-8', 'unix', signal).bytes, expected);
});
