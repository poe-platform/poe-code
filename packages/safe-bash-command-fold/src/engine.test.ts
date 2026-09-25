import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createFoldEngine, parseFoldArguments, FoldError, portableWidth, adjustFoldColumn } from './index.js';
const utf8 = 'UTF-8/Unicode-17.0.0';
const limits = { inputBytes: 200000, outputBytes: 300000, work: 1000000, retainedBytes: 8196, argumentBytes: 4096 };
function fold(input: string | Uint8Array, args: string[] = [], locale = utf8, chunks = 1): Uint8Array {
  const engine = createFoldEngine(parseFoldArguments(args, limits), locale, limits);
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const output: number[] = [];
  for (let i = 0; i < bytes.length; i += chunks) for (const b of engine.push(bytes.subarray(i, i + chunks))) output.push(...b);
  for (const b of engine.endFile()) output.push(...b);
  engine.dispose();
  return Uint8Array.from(output);
}
const expected = (s: string) => new TextEncoder().encode(s);
test('byte admission rejects non-byte containers with structured failure and cleanup', () => {
  const detached = Uint8Array.of(97);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const input of [new Uint16Array([256]), new DataView(new ArrayBuffer(1)), [256], null,
    detached, new Proxy(Uint8Array.of(97), {}),
    { length: 1, 0: 256, [Symbol.toStringTag]: 'Uint8Array', *[Symbol.iterator]() { yield 256; } }]) {
    const engine = createFoldEngine(parseFoldArguments([], limits), 'C', limits);
    engine.push(Uint8Array.of(97));
    assert.throws(() => engine.push(input as unknown as Uint8Array), (e: unknown) => e instanceof FoldError && e.code === 'INPUT');
    assert.throws(() => engine.endFile(), (e: unknown) => e instanceof FoldError && e.code === 'CLOSED');
  }
});
test('released upstream variants preserve fixed expected bytes at every input split', () => {
  // Independently transcribed outputs from released tests/fold, with explicit
  // portable widths/blank membership rather than an implicit French locale.
  const fixtures = [
    ['a\t', ['-sw2'], 'a\n\t'],
    ['abcdef d\n', ['-sw4'], 'abcd\nef d\n'],
    ['a cd fgh\n', ['-sw4'], 'a \ncd \nfgh\n'],
    ['abc ef\n', ['-sw4'], 'abc \nef\n'],
    ['abcdef\nghijkl', ['-bw4'], 'abcd\nef\nghij\nkl'],
    ['1234567890\nabcdefghij\n1234567890', ['-bw6'], '123456\n7890\nabcdef\nghij\n123456\n7890'],
    ['ééé', ['-w2'], 'éé\né'],
    ['e\u0301e\u0301e\u0301', ['-w2'], 'e\u0301e\u0301\ne\u0301'],
    ['ｅｅ', ['-w2'], 'ｅ\nｅ'],
    ['뉐뉐뉐\n', ['-w5'], '뉐뉐\n뉐\n'],
    ['뉐뉐뉐\n', ['-cw5'], '뉐뉐뉐\n'],
    ['abcdefghijklmnop\u2007qrstuvwxyz\n', ['-sw10'], 'abcdefghij\nklmnop\u2007qrs\ntuvwxyz\n'],
    ['abcdefghijklmnop\u00a0\u00a0qrstuvwxyz\n', ['-sw10'], 'abcdefghij\nklmnop\u00a0\u00a0qr\nstuvwxyz\n'],
    ['abcdefghijklmnop\u2002qrstuvwxyz\n', ['-sw10'], 'abcdefghij\nklmnop\u2002\nqrstuvwxyz\n'],
    ['abcdefghijklmnop\u2003\u2003qrstuvwxyz\n', ['-sw10'], 'abcdefghij\nklmnop\u2003\u2003\nqrstuvwxyz\n'],
  ] as const;
  for (const [input, args, output] of fixtures) {
    const bytes = expected(input);
    for (let split = 0; split <= bytes.length; split++) {
      const engine = createFoldEngine(parseFoldArguments(args, limits), utf8, limits);
      try {
        const chunks = [...engine.push(bytes.subarray(0, split)), ...engine.push(bytes.subarray(split)), ...engine.endFile()];
        assert.deepEqual(Uint8Array.from(chunks.flatMap(chunk => [...chunk])), expected(output), `${args.join(' ')} split ${split}`);
      } finally { engine.dispose(); }
    }
  }
  assert.deepEqual(fold(Buffer.from([255, 0, 97]), ['-w1'], 'C'), Uint8Array.of(255, 0, 10, 97));
});
test('cross-realm bytes are admitted using storage length and values, not overridable iteration', () => {
  const input = runInNewContext('Uint8Array.of(255, 0, 97)') as Uint8Array;
  Object.defineProperty(input, 'length', { value: 0 });
  Object.defineProperty(input, Symbol.iterator, { value: function* () { yield 256; } });
  const engine = createFoldEngine(parseFoldArguments([], limits), 'C', limits);
  assert.deepEqual([...engine.push(input), ...engine.endFile()], [Uint8Array.of(255, 0, 97)]);
  engine.dispose();
  const constrained = createFoldEngine(parseFoldArguments([], limits), 'C', { ...limits, inputBytes: 2 });
  assert.throws(() => constrained.push(input), (e: unknown) => e instanceof FoldError && e.code === 'LIMIT');
});
test('ordered counting options, legacy width and exact numeric admission', () => {
  assert.equal(parseFoldArguments(['-bc', '-12', '--wid=+5'], limits).mode, 'characters');
  assert.equal(parseFoldArguments(['-cb', '-w', ' 05'], limits).width, 5);
  assert.deepEqual(parseFoldArguments(['--', '-c'], limits).files, ['-c']);
  for (const width of ['0', '-5', '1.5', '5x', '', '18446744073709551616']) assert.throws(() => parseFoldArguments(['-w', width], limits), FoldError);
  assert.throws(() => parseFoldArguments(['-w9007199254740992'], limits), (e: unknown) => e instanceof FoldError && e.code === 'LIMIT');
});
test('UTF8 byte mode admits whole characters, C preserves individual byte identity', () => {
  assert.deepEqual(fold('界界界\n', ['-b', '-w5']), expected('界\n界\n界\n'));
  assert.deepEqual(fold('界界界\n', ['-w5']), expected('界界\n界\n'));
  assert.deepEqual(fold('界界界\n', ['-c', '-w5']), expected('界界界\n'));
  assert.deepEqual(fold(Uint8Array.of(0xe7, 0x95, 0x8c), ['-b', '-w2'], 'C'), Uint8Array.of(0xe7, 0x95, 10, 0x8c));
});
test('stateful control adjustment and overflow replay match release controls', () => {
  assert.deepEqual(fold('界\t\bABCDE\n', ['-w7']), expected('界\n\t\bA\nBCDE\n'));
  assert.deepEqual(fold('界\t\bABCDE\n', ['-c', '-w7']), expected('界\n\t\b\nABCDE\n'));
  assert.deepEqual(fold('界\t\bABCDE\n', ['-s', '-w7']), expected('界\n\t\n\bABCDE\n'));
  assert.deepEqual(fold('a\tb\tc\n', ['-c', '-w5']), expected('a\n\t\nb\n\t\nc\n'));
  assert.deepEqual(fold('a\tb\tc\n', ['-b', '-w5']), expected('a\tb\tc\n'));
});
test('spaces include separator, excluding release nonbreaking spaces', () => {
  assert.deepEqual(fold('a  bcd', ['-s', '-w3']), expected('a  \nbcd'));
  assert.deepEqual(fold('ab\u00a0cd', ['-s', '-w4']), expected('ab\u00a0c\nd'));
  assert.deepEqual(fold('ab\u2007cd', ['-s', '-w4']), expected('ab\u2007c\nd'));
});
test('invalid sequences, incomplete EOF and BOM preserve exact bytes across chunks', () => {
  for (const bytes of [Uint8Array.of(0xc3), Uint8Array.of(0xed, 0xa0, 0x80, 0xff, 0), expected('\ufeff界')]) {
    assert.deepEqual(fold(bytes, ['-w80']), bytes);
    assert.deepEqual(fold(bytes, ['-w80'], utf8, 7), bytes);
  }
});
test('zero width runs flush without newlines; no grapheme substitution', () => {
  const input = '\u0301'.repeat(12000) + 'abc\n';
  assert.deepEqual(fold(input, ['-w7']), expected(input));
  assert.deepEqual(fold(input, ['-s', '-w7']), expected(input));
  for (const [mode, lines] of [['-b', 4001], ['-c', 1715]] as const) {
    const bytes = fold(input, [mode, '-w7']);
    assert.equal(bytes.filter(byte => byte === 10).length, lines);
    assert.deepEqual(bytes.filter(byte => byte !== 10), expected(input.slice(0, -1)));
  }
  assert.deepEqual(fold('\0'.repeat(20000), ['-w1'], 'C'), expected('\0'.repeat(20000)));
  assert.deepEqual(fold('a\u0301b', ['-c', '-w1']), expected('a\n\u0301\nb'));
});
test('previous counted width survives LF and file boundaries; byte owners are copied', () => {
  const engine = createFoldEngine(parseFoldArguments(['-w7'], limits), utf8, limits);
  const input = expected('界'); engine.push(input); input.fill(0);
  assert.deepEqual(engine.endFile(), [expected('界')]);
  const out = [...engine.push(expected('\t\bABCDE\n')), ...engine.endFile()];
  assert.deepEqual(Uint8Array.from(out.flatMap(b => [...b])), expected('\t\bA\nBCDE\n'));
  engine.dispose(); assert.throws(() => engine.push(expected('x')), FoldError);
});
test('unknown locale, resource limits, cancellation and arithmetic errors are explicit', () => {
  const options = parseFoldArguments([], limits);
  assert.throws(() => createFoldEngine(options, 'en_US.UTF-8', limits), (e: unknown) => e instanceof FoldError && e.code === 'LOCALE');
  assert.throws(() => adjustFoldColumn({ column: 1, lastWidth: 2 }, { codePoint: 8, byteLength: 1 }, 'columns', 'C'), (e: unknown) => e instanceof FoldError && e.code === 'ARITHMETIC');
  const engine = createFoldEngine(options, 'C', { ...limits, inputBytes: 1 });
  assert.throws(() => engine.push(expected('ab')), (e: unknown) => e instanceof FoldError && e.code === 'LIMIT');
  const controller = new AbortController(); controller.abort();
  assert.throws(() => createFoldEngine(options, 'C', limits, controller.signal).push(expected('x')), (e: unknown) => e instanceof FoldError && e.code === 'CANCELLED');
});
test('checked underflow and oversized calls retire the invocation without synthetic output', () => {
  const options = parseFoldArguments([], limits);
  const underflow = createFoldEngine(options, utf8, limits);
  underflow.push(expected('a界\b'));
  // Proposed checked-JS boundary, not an observed native unsigned-wrap result.
  assert.throws(() => underflow.push(Uint8Array.of(8)), (e: unknown) => e instanceof FoldError && e.code === 'ARITHMETIC');
  assert.throws(() => underflow.endFile(), (e: unknown) => e instanceof FoldError && e.code === 'CLOSED');
  const oversized = createFoldEngine(options, 'C', limits);
  assert.throws(() => oversized.push(new Uint8Array(4097)), (e: unknown) => e instanceof FoldError && e.code === 'LIMIT');
  assert.throws(() => oversized.endFile(), (e: unknown) => e instanceof FoldError && e.code === 'CLOSED');
});
test('pinned width primitive covers controls, combining, Jamo, wide and ambiguous', () => {
  for (const [cp, width] of [[0, 0], [1, -1], [0x301, 0], [0x1160, 0], [0x754c, 2], [0x1f600, 2], [0xa1, 1]]) assert.equal(portableWidth(cp!), width);
});
test('every resource gate fails explicitly and borrowed limits cannot change admission', () => {
  const options = parseFoldArguments([], limits);
  const unlimited = createFoldEngine(options, 'C'); unlimited.dispose();
  for (const constrained of [{ ...limits, outputBytes: 0 }, { ...limits, work: 1 }]) {
    const engine = createFoldEngine(options, 'C', constrained);
    assert.throws(() => { engine.push(expected('x')); engine.endFile(); }, (e: unknown) => e instanceof FoldError && e.code === 'LIMIT');
  }
  assert.throws(() => parseFoldArguments(['x'.repeat(4097)], limits), (e: unknown) => e instanceof FoldError && e.code === 'LIMIT');
  const borrowed = { ...limits, inputBytes: 1 }, engine = createFoldEngine(options, 'C', borrowed);
  borrowed.inputBytes = 100;
  assert.throws(() => engine.push(expected('ab')), FoldError);
  assert.throws(() => adjustFoldColumn({ column: Number.MAX_SAFE_INTEGER, lastWidth: 1 }, { codePoint: 97, byteLength: 1 }, 'columns', 'C'), FoldError);
});
test('strict decoding rejects all malformed classes one original byte at a time', () => {
  for (const sequence of [[0xc0, 0xaf], [0xe0, 0x80, 0x80], [0xf0, 0x80, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80], [0xe7, 0x95]]) {
    const bytes = Uint8Array.from(sequence), out = Uint8Array.from(sequence.flatMap((byte, i) => i ? [10, byte] : [byte]));
    for (const chunks of [1, 2, 4]) assert.deepEqual(fold(bytes, ['-b', '-w1'], utf8, chunks), out);
  }
});
test('native buffer boundary flushing preserves last width and column', () => {
  for (const chunks of [1, 2, 3, 4096]) {
    const input = '\u0301'.repeat(4096) + '界\babc\n';
    assert.deepEqual(fold(input, ['-w3'], utf8, chunks), expected(input));
  }
});
test('release invalid-byte reading versus separator rescan preserves bytes and counting', () => {
  const bytes = Uint8Array.of(97, 32, 0x85, 98, 99, 100, 101);
  assert.deepEqual(fold(bytes, ['-s', '-w4']), Uint8Array.of(97, 32, 10, 0x85, 98, 99, 100, 101));
  assert.deepEqual(fold('界\n\t\bABCDE\n', ['-w7']), expected('界\n\t\bA\nBCDE\n'));
});
test('malformed continuation bytes count one on input, zero during blank remainder rescanning', () => {
  const malformed = Uint8Array.of(0xad, 97);
  for (const chunks of [1, 2]) {
    assert.deepEqual(fold(malformed, ['-w1'], utf8, chunks), Uint8Array.of(0xad, 10, 97));
    assert.deepEqual(fold(expected('\u00ad' + 'a'), ['-w1'], utf8, chunks), expected('\u00ada'));
  }
  const remainder = Uint8Array.of(97, 32, 0x85, 98, 99, 100, 101);
  assert.deepEqual(fold(remainder, ['-s', '-w4'], 'C'), Uint8Array.of(97, 32, 10, 0x85, 98, 99, 100, 101));
});
test('cancellation and output-budget failure close pending state without mutating delivered output', () => {
  const controller = new AbortController();
  const engine = createFoldEngine(parseFoldArguments(['-w1'], limits), utf8, limits, controller.signal);
  const delivered = engine.push(expected('ab'));
  assert.deepEqual(delivered, [expected('a\n')]);
  engine.push(Uint8Array.of(0xe7));
  controller.abort();
  assert.throws(() => engine.endFile(), (e: unknown) => e instanceof FoldError && e.code === 'CANCELLED');
  assert.throws(() => engine.push(Uint8Array.of(0x95, 0x8c)), (e: unknown) => e instanceof FoldError && e.code === 'CLOSED');
  engine.dispose(); engine.dispose();
  assert.deepEqual(delivered, [expected('a\n')]);
  const constrained = createFoldEngine(parseFoldArguments(['-w1'], limits), 'C', { ...limits, outputBytes: 1 });
  assert.throws(() => constrained.push(expected('ab')), (e: unknown) => e instanceof FoldError && e.code === 'LIMIT');
  assert.throws(() => constrained.endFile(), (e: unknown) => e instanceof FoldError && e.code === 'CLOSED');
});
test('legacy numeric option owns its entire attached suffix, unlike ordinary grouped flags', () => {
  assert.equal(parseFoldArguments(['-b12'], limits).width, 12);
  for (const arg of ['-12b', '-1w5', '-1s2']) assert.throws(() => parseFoldArguments([arg], limits), (e: unknown) => e instanceof FoldError && e.code === 'WIDTH');
  assert.equal(parseFoldArguments(['-1', '-2'], limits).width, 2);
});
test('width boundaries, indivisible too-wide glyph, LF and missing final LF are exact', () => {
  for (const width of [1, 2, 8, 80]) {
    assert.deepEqual(fold('a'.repeat(width) + 'b', ['-w' + width], 'C'), expected('a'.repeat(width) + '\nb'));
    assert.deepEqual(fold('a'.repeat(width) + '\n\n', ['-w' + width], 'C'), expected('a'.repeat(width) + '\n\n'));
  }
  assert.deepEqual(fold('界界', ['-w1']), expected('界\n界'));
  assert.deepEqual(fold('  abc', ['-s', '-w1']), expected(' \n \na\nb\nc'));
  assert.deepEqual(fold('ab\rcdef', ['-w3'], 'C'), expected('ab\rcde\nf'));
  assert.deepEqual(fold('ab\bcde', ['-w3'], 'C'), expected('ab\bcd\ne'));
  assert.deepEqual(fold('ab\rcdef', ['-b', '-w3'], 'C'), expected('ab\r\ncde\nf'));
});
