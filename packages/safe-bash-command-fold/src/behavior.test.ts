import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFoldEngine, parseFoldArguments, FoldError } from './index.js';

const limits = { inputBytes: 100000, outputBytes: 120000, retainedBytes: 8196, argumentBytes: 1024, work: 1000000 };
const profile = 'UTF-8/Unicode-17.0.0';
const encode = (text: string) => new TextEncoder().encode(text);

test('decoded byte admission includes LF and incomplete original bytes exactly once', () => {
  const engine = createFoldEngine(parseFoldArguments([], limits), profile, { ...limits, decodedBytes: 3 });
  engine.push(encode('é'));
  engine.push(Uint8Array.of(0xc3)); // Incomplete prefix has not been decoded yet.
  // Decoding briefly owns both the two prefix bytes and their retained copy.
  assert.deepEqual(engine.accounting(), { inputBytes: 3, decodedBytes: 2, retainedBytes: 3, peakRetainedBytes: 4, outputBytes: 0, work: engine.accounting().work });
  assert.throws(() => engine.push(Uint8Array.of(10)), (error: unknown) => error instanceof FoldError && error.code === 'LIMIT');
  assert.equal(engine.accounting().retainedBytes, 0);
  assert.throws(() => engine.endFile(), (error: unknown) => error instanceof FoldError && error.code === 'CLOSED');
});

test('space candidates reset at LF, file end and finite buffer flush without synthetic LF', () => {
  const fixtures = [
    ['a b\ncdef', '-sw3', 'a b\ncde\nf'],
    ['ab\rcdef', '-sw3', 'ab\rcde\nf'],
    ['ab\bcde', '-scw3', 'ab\bcd\ne'],
    ['a b\tcd', '-sw4', 'a \nb\n\t\ncd'],
    ['界a', '-sbw1', '界\na'],
    ['a \r' + '\0'.repeat(8188) + 'abcd', '-sw3', 'a \r' + '\0'.repeat(8188) + 'abc\nd'],
  ];
  for (const [input, flag, expected] of fixtures) {
    for (const chunkSize of [1, 3, 4096]) {
      const engine = createFoldEngine(parseFoldArguments([flag!], limits), profile, limits);
      const bytes = encode(input!), output: Uint8Array[] = [];
      for (let i = 0; i < bytes.length; i += chunkSize) output.push(...engine.push(bytes.subarray(i, i + chunkSize)));
      output.push(...engine.endFile());
      assert.deepEqual(Uint8Array.from(output.flatMap(chunk => [...chunk])), encode(expected!), flag);
      const usage = engine.accounting();
      assert.equal(usage.inputBytes, bytes.length);
      assert.equal(usage.decodedBytes, bytes.length);
      assert.equal(usage.outputBytes, encode(expected!).length);
      assert.equal(usage.retainedBytes, 0);
      assert.ok(usage.peakRetainedBytes <= 8196);
      engine.dispose();
    }
  }
});

test('output byte copies cannot escape the algorithm budget', () => {
  const engine = createFoldEngine(parseFoldArguments([], limits), 'C', { ...limits, work: 16000 });
  engine.push(new Uint8Array(3000));
  assert.throws(() => engine.endFile(), (error: unknown) => error instanceof FoldError && error.code === 'LIMIT');
  assert.equal(engine.accounting().retainedBytes, 0);
});

test('candidate state ends with its file while the previous glyph width survives', () => {
  const engine = createFoldEngine(parseFoldArguments(['-sw3'], limits), profile, limits);
  assert.deepEqual(engine.push(encode('a ')), []);
  assert.deepEqual(engine.endFile(), [encode('a ')]);
  assert.deepEqual([...engine.push(encode('bcde')), ...engine.endFile()], [encode('bcd\n'), encode('e')]);
  assert.equal(engine.accounting().decodedBytes, 6);
  engine.dispose();
});

test('long combining controls compare complete source-derived outputs in every counting mode', () => {
  const input = encode('\u0301'.repeat(12000) + 'abc\n');
  const fixtures = [
    ['-w7', '\u0301'.repeat(12000) + 'abc\n'],
    ['-sw7', '\u0301'.repeat(12000) + 'abc\n'],
    // Final three marks occupy six bytes: 'a' fits as byte seven before 'b' overflows.
    ['-bw7', ('\u0301'.repeat(3) + '\n').repeat(3999) + '\u0301'.repeat(3) + 'a\nbc\n'],
    ['-cw7', ('\u0301'.repeat(7) + '\n').repeat(1714) + '\u0301'.repeat(2) + 'abc\n'],
  ];
  for (const [flag, expected] of fixtures) {
    const engine = createFoldEngine(parseFoldArguments([flag!], limits), profile, limits);
    const output: Uint8Array[] = [];
    for (let i = 0; i < input.length; i += 4096) output.push(...engine.push(input.subarray(i, i + 4096)));
    output.push(...engine.endFile());
    assert.deepEqual(Uint8Array.from(output.flatMap(chunk => [...chunk])), encode(expected!));
    assert.equal(engine.accounting().decodedBytes, input.length);
    engine.dispose();
  }
});
