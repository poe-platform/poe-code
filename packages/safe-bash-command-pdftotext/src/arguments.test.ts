import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultOutputName, normalizePageRange } from './arguments.js';
const signal = new AbortController().signal;

test('page range clamps native sentinels and rejects reversed or out-of-document first page', () => {
  assert.deepEqual(normalizePageRange(0, 0, 3), [1, 3]);
  assert.deepEqual(normalizePageRange(-12, 100, 3), [1, 3]);
  assert.deepEqual(normalizePageRange(2, -1, 3), [2, 3]);
  assert.deepEqual(normalizePageRange(3, 3, 3), [3, 3]);
  assert.throws(() => normalizePageRange(4, 0, 3));
  assert.throws(() => normalizePageRange(2, 1, 3));
});

test('page arithmetic never admits fractional, nonfinite or unchecked integers', () => {
  for (const bad of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizePageRange(bad, 0, 3));
    assert.throws(() => normalizePageRange(1, bad, 3));
    assert.throws(() => normalizePageRange(1, 0, bad));
  }
  assert.throws(() => normalizePageRange(1, 0, 0));
});

test('output suffix matching is exact and safe for short names; stdin requires an explicit destination', () => {
  for (const [input, output] of [['a.pdf', 'a.txt'], ['a.PDF', 'a.txt'], ['a.Pdf', 'a.Pdf.txt'], ['a', 'a.txt'], ['.pdf', '.txt'], ['pdf', 'pdf.txt']]) {
    assert.equal(defaultOutputName(input!, false, signal).name, output);
  }
  assert.equal(defaultOutputName('dir/a.PDF', true, signal).name, 'dir/a.html');
  assert.throws(() => defaultOutputName('-', false, signal));
  assert.throws(() => defaultOutputName('', false, signal));
  assert.throws(() => defaultOutputName('a\0.pdf', false, signal));
});

test('output naming accounts scans and string copies, respects limits and explicit cancellation', () => {
  const result = defaultOutputName('é.pdf', false, signal);
  assert.equal(result.name, 'é.txt');
  assert.equal(result.accounting.inputBytes, 6);
  assert.equal(result.accounting.outputBytes, 0);
  assert.equal(result.accounting.decodedBytes, 10);
  assert.throws(() => defaultOutputName('abc', false, signal, { work: 0 }));
  assert.throws(() => defaultOutputName('abc', false, signal, { retainedBytes: 0 }));
  assert.throws(() => defaultOutputName('\ud800.pdf', false, signal));
  const controller = new AbortController(); controller.abort('stop');
  assert.throws(() => defaultOutputName('abc', false, controller.signal), error => error === 'stop');
});
