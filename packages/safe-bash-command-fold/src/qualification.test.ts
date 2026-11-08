import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFoldEngine, parseFoldArguments } from './index.js';

const profile = 'UTF-8/Unicode-17.0.0';
const encode = (text: string) => new TextEncoder().encode(text);
const limits = { inputBytes: 2000000, outputBytes: 3000000, retainedBytes: 8196, work: 20000000, argumentBytes: 1024 };

test('explicit invalid-byte preservation differs from the signed-char native EOF collision', () => {
  // Minimized GNU 9.10/macOS control: FF terminates UTF8 input silently.
  // Our explicit profile preserves original invalid bytes, including suffixes.
  for (const locale of ['C', profile]) for (const args of [[], ['-b'], ['-c']]) {
    const engine = createFoldEngine(parseFoldArguments(args, limits), locale, limits);
    try {
      const chunks = [...engine.push(Uint8Array.of(255)), ...engine.push(Uint8Array.of(97)), ...engine.endFile()];
      assert.deepEqual(Uint8Array.from(chunks.flatMap(chunk => [...chunk])), Uint8Array.of(255, 97));
      assert.equal(engine.accounting().decodedBytes, 2);
    } finally { engine.dispose(); }
  }
});

test('released fold-characters fullwidth and decoder-buffer edge variants', () => {
  // Fixed expected byte layouts from the released upstream test, including
  // the entire buffer-edge output rather than only its last four lines.
  const fixtures = [
    { input: '：'.repeat(50) + '\n', args: ['-w10'], output: ('：'.repeat(5) + '\n').repeat(10) },
    { input: '：'.repeat(50) + '\n', args: ['-cw10'], output: ('：'.repeat(10) + '\n').repeat(5) },
    { input: 'a'.repeat(8191) + '뉐' + 'a'.repeat(100) + '\n', args: ['-c'], output: ('a'.repeat(80) + '\n').repeat(102) + 'a'.repeat(31) + '뉐' + 'a'.repeat(48) + '\n' + 'a'.repeat(52) + '\n' },
  ];
  for (const fixture of fixtures) for (const size of [1, 3, 4096]) {
    const engine = createFoldEngine(parseFoldArguments(fixture.args, limits), profile, limits);
    const input = encode(fixture.input), output: number[] = [];
    try {
      for (let offset = 0; offset < input.length; offset += size) {
        for (const chunk of engine.push(input.subarray(offset, offset + size))) output.push(...chunk);
      }
      for (const chunk of engine.endFile()) output.push(...chunk);
      assert.deepEqual(Uint8Array.from(output), encode(fixture.output));
    } finally { engine.dispose(); }
  }
});

test('released fold-zero-width NUL and U+200B variants count scalars without column breaks', () => {
  for (const [glyph, locale] of [['\0', 'C'], ['\u200b', profile]] as const) {
    const input = encode(glyph.repeat(16384));
    for (const args of [[], ['-c']]) {
      const engine = createFoldEngine(parseFoldArguments(args, limits), locale, limits);
      const output: number[] = [];
      try {
        for (let offset = 0; offset < input.length; offset += 4096) {
          for (const chunk of engine.push(input.subarray(offset, offset + 4096))) output.push(...chunk);
        }
        for (const chunk of engine.endFile()) output.push(...chunk);
        const expected = args.length ? (glyph.repeat(80) + '\n').repeat(204) + glyph.repeat(64) : glyph.repeat(16384);
        assert.deepEqual(Uint8Array.from(output), encode(expected));
      } finally { engine.dispose(); }
    }
  }
});

test('streaming zero-width input retains a fixed buffer and delivers owned bytes without breaks', () => {
  const engine = createFoldEngine(parseFoldArguments(['-sw1'], limits), profile, limits);
  const input = encode('\u0301'.repeat(2048));
  let delivered = 0;
  try {
    for (let batch = 0; batch < 256; batch++) {
      for (const chunk of engine.push(input)) {
        assert.equal(chunk.length % 2, 0);
        for (let i = 0; i < chunk.length; i += 2) {
          assert.equal(chunk[i], 0xcc); assert.equal(chunk[i + 1], 0x81);
        }
        delivered += chunk.length;
        chunk.fill(0); // Delivered storage must not alias retained state.
      }
      assert.ok(engine.accounting().retainedBytes <= 8196);
    }
    for (const chunk of engine.endFile()) {
      for (let i = 0; i < chunk.length; i += 2) {
        assert.equal(chunk[i], 0xcc); assert.equal(chunk[i + 1], 0x81);
      }
      delivered += chunk.length;
    }
    assert.equal(delivered, 1048576);
    assert.equal(engine.accounting().outputBytes, delivered);
    assert.ok(engine.accounting().peakRetainedBytes <= 8196);
    assert.equal(engine.accounting().retainedBytes, 0);
  } finally { engine.dispose(); }
});
