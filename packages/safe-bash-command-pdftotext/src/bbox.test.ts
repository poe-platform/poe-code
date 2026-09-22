import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeBboxWord } from './bbox.js';

const signal = new AbortController().signal;
test('bbox escapes every XML metacharacter once and formats admitted coordinates to six decimals', () => {
  const result = serializeBboxWord("&amp;'\"<>😀", [40, 30.77, 50.1234567, 42], signal);
  assert.equal(new TextDecoder().decode(result.bytes), '<word xMin="40.000000" yMin="30.770000" xMax="50.123457" yMax="42.000000">&amp;amp;&apos;&quot;&lt;&gt;😀</word>\n');
  assert.equal(result.accounting.inputBytes, 0);
  assert.equal(result.accounting.outputBytes, result.bytes.length);
});

test('bbox never invents text for an empty word; negative geometry is legal and negative zero is stable', () => {
  assert.equal(new TextDecoder().decode(serializeBboxWord('', [-0, -2, 1, 3], signal).bytes), '<word xMin="0.000000" yMin="-2.000000" xMax="1.000000" yMax="3.000000"></word>\n');
});

test('bbox rejects invalid XML scalars, nonfinite/reversed geometry and exponent-format coordinates', () => {
  for (const text of ['a\0b', '\u0001', '\ud800', '\ufffe']) assert.throws(() => serializeBboxWord(text, [0, 0, 1, 1], signal));
  for (const box of [[NaN, 0, 1, 1], [0, 0, Infinity, 1], [2, 0, 1, 1], [0, 2, 1, 1], [0, 0, 1e21, 1]] as const) {
    assert.throws(() => serializeBboxWord('a', box, signal));
  }
});

test('bbox bounds escaped expansion, total output, retention and work before emission', () => {
  const baseline = serializeBboxWord('&', [0, 0, 1, 1], signal);
  assert.throws(() => serializeBboxWord('&', [0, 0, 1, 1], signal, { outputBytes: baseline.bytes.length - 1 }));
  assert.throws(() => serializeBboxWord('&', [0, 0, 1, 1], signal, { retainedBytes: 1 }));
  assert.throws(() => serializeBboxWord('&', [0, 0, 1, 1], signal, { work: 1 }));
  const controller = new AbortController(); controller.abort('stop');
  assert.throws(() => serializeBboxWord('', [0, 0, 1, 1], controller.signal), error => error === 'stop');
});

test('bbox does not call producer-supplied array methods for geometry admission or formatting', () => {
  const box: [number, number, number, number] = [0, 0, 1, 1];
  Object.defineProperties(box, {
    every: { value: () => { throw new Error('producer callback'); } },
    map: { value: () => { throw new Error('producer callback'); } },
  });
  assert.match(new TextDecoder().decode(serializeBboxWord('A', box, signal).bytes), /xMax="1.000000"/);
});
