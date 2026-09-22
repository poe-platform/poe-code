import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDiff3, createDiff3Engine, Diff3Error, type Diff3Limits } from './index.js';

const limits: Diff3Limits = { inputBytes: 100_000, retainedBytes: 200_000, tokens: 10_000, graphCells: 100_000, work: 2_000_000 };
const bytes = (text: string) => new TextEncoder().encode(text);
const analyze = (base: string, left: string, right: string) => analyzeDiff3({ base: bytes(base), left: bytes(left), right: bytes(right) }, limits);
const failure = (code: string, resource?: string) => (error: unknown) => error instanceof Diff3Error && error.code === code && (resource === undefined || error.resource === resource);

test('owned byte tokens preserve invalid UTF8, CRLF, empty lines and final LF metadata', () => {
  const source = Uint8Array.of(255, 13, 10, 10, 254);
  const result = analyzeDiff3({ base: source, left: source, right: source }, limits);
  source.fill(0);
  assert.deepEqual(result.files.base.map(line => [Array.from(line.bytes), line.terminated]), [[[255, 13, 10], true], [[10], true], [[254], false]]);
  assert.deepEqual(result.regions, []);
  assert.deepEqual(analyze('', '', '').files.base, []);
});

test('single-sided, identical and conflicting changes have distinct classifications', () => {
  assert.deepEqual(analyze('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n').regions.map(r => r.kind), ['left', 'right']);
  const same = analyze('a\nb\nc\n', 'a\nnew\nc\n', 'a\nnew\nc\n');
  assert.equal(same.regions[0]!.kind, 'identical'); // GNU A renderer must retain DIFF_2ND.
  assert.equal(analyze('a\nb\n', 'a\nx\n', 'a\ny\n').regions[0]!.kind, 'conflict');
  assert.deepEqual(same.leftEdits, [{ base: { start: 1, end: 2 }, variant: { start: 1, end: 2 } }]);
});

test('adjacent replacements form a GNU DIFF_ALL region but retain their distinct kind', () => {
  assert.deepEqual(analyze('a\nb\n', 'A\nb\n', 'a\nB\n').regions, [{ kind: 'adjacent', base: { start: 0, end: 2 }, left: { start: 0, end: 2 }, right: { start: 0, end: 2 } }]);
  assert.equal(analyze('a\n', 'x\na\n', 'y\na\n').regions[0]!.kind, 'conflict');
  assert.equal(analyze('a\nb\nc\n', 'a\nc\n', 'a\nB\nc\n').regions[0]!.kind, 'conflict');
});

test('transitively overlapping edits expand all three corresponding ranges', () => {
  const result = analyze('a\nb\nc\nd\ne\n', 'a\nX\ne\n', 'a\nb\nY\ne\n');
  assert.deepEqual(result.regions, [{ kind: 'conflict', base: { start: 1, end: 4 }, left: { start: 1, end: 2 }, right: { start: 1, end: 3 } }]);
});

test('terminator differences are edits and CR stripping is comparison-only', () => {
  assert.equal(analyze('x\n', 'x', 'x\n').regions[0]!.kind, 'left');
  const result = analyzeDiff3({ base: bytes('x\r\n'), left: bytes('x\n'), right: bytes('x\r\n') }, limits, { stripTrailingCR: true });
  assert.deepEqual(result.regions, []);
  assert.deepEqual(Array.from(result.files.base[0]!.bytes), [120, 13, 10]);
  assert.throws(() => analyzeDiff3({ base: Uint8Array.of(0), left: bytes('x'), right: bytes('y') }, limits), failure('BINARY'));
  assert.equal(analyzeDiff3({ base: Uint8Array.of(0), left: bytes('x'), right: bytes('y') }, limits, { text: true }).regions[0]!.kind, 'conflict');
});

test('stream chunks are copied before producer reuse and cleanup is idempotent', () => {
  const engine = createDiff3Engine(limits);
  const chunk = bytes('a\r');
  engine.push('base', chunk); chunk.fill(0); engine.push('base', bytes('\nb'));
  engine.push('left', bytes('a\r\nb')); engine.push('right', bytes('a\r\nb'));
  for (const file of ['base', 'left', 'right'] as const) engine.end(file);
  const result = engine.finish();
  assert.deepEqual(result.files.base.map(l => Array.from(l.bytes)), [[97, 13, 10], [98]]);
  engine.dispose(); engine.dispose();
  assert.equal(engine.accounting().retainedBytes, 0);
  assert.equal(engine.accounting().tokens, 0);
  assert.throws(() => engine.push('base', bytes('x')), failure('CLOSED'));
});

test('limits fail explicitly, release state, and never fall back to another alignment', () => {
  for (const [resource, cap] of [['inputBytes', 1], ['retainedBytes', 1], ['tokens', 1], ['graphCells', 1], ['work', 1]] as const) {
    assert.throws(() => analyzeDiff3({ base: bytes('a\nb\n'), left: bytes('b\na\n'), right: bytes('c\na\n') }, { ...limits, [resource]: cap }), failure('LIMIT', resource));
  }
  assert.throws(() => createDiff3Engine({ ...limits, tokens: NaN }), failure('LIMIT', 'tokens'));
  const engine = createDiff3Engine({ ...limits, tokens: 0 });
  engine.push('base', bytes('a\n'));
  assert.throws(() => engine.end('base'), failure('LIMIT', 'tokens'));
  assert.equal(engine.accounting().retainedBytes, 0);
});

test('explicit cancellation and lifecycle admission do not masquerade as conflicts', () => {
  const controller = new AbortController();
  const engine = createDiff3Engine(limits, {}, controller.signal);
  engine.push('base', bytes('a')); controller.abort('stop');
  assert.throws(() => engine.end('base'), failure('CANCELLED'));
  assert.equal(engine.accounting().retainedBytes, 0);
  assert.throws(() => createDiff3Engine(limits).finish(), failure('STATE'));
});

for (const horizon of [99, 100, 101]) for (const finalLF of [true, false]) {
  test(`GNU-qualified insert/delete around ${horizon} lines, final LF=${finalLF}`, () => {
    const prefix = 'r\n'.repeat(horizon), suffix = 's\n'.repeat(horizon - 1) + (finalLF ? 's\n' : 's');
    assert.deepEqual(analyze(prefix + 'x\nr\n' + suffix, prefix + 'r\nx\n' + suffix, prefix + 'r\ny\n' + suffix).regions, [
      { kind: 'adjacent', base: { start: horizon, end: horizon + 2 }, left: { start: horizon, end: horizon + 2 }, right: { start: horizon, end: horizon + 2 } }
    ]);
  });
  test(`GNU-qualified nested repeats around ${horizon} lines, final LF=${finalLF}`, () => {
    const prefix = 'r\n'.repeat(horizon), suffix = 's\n'.repeat(horizon - 1) + (finalLF ? 's\n' : 's');
    assert.deepEqual(analyze(prefix + 'r\nx\nr\nr\n' + suffix, prefix + 'r\nr\nx\nr\n' + suffix, prefix + 'r\nr\ny\nr\n' + suffix).regions, [
      { kind: 'adjacent', base: { start: horizon + 1, end: horizon + 2 }, left: { start: horizon + 1, end: horizon + 3 }, right: { start: horizon + 1, end: horizon + 1 } },
      { kind: 'adjacent', base: { start: horizon + 3, end: horizon + 4 }, left: { start: horizon + 4, end: horizon + 4 }, right: { start: horizon + 2, end: horizon + 4 } }
    ]);
  });
  test(`GNU-qualified swap around ${horizon} common lines, final LF=${finalLF}`, () => {
    const prefix = 'r\n'.repeat(horizon), suffix = 's\n'.repeat(horizon - 1) + (finalLF ? 's\n' : 's');
    const result = analyze(prefix + 'y\nx\n' + suffix, prefix + 'x\ny\n' + suffix, prefix + 'y\nz\n' + suffix);
    assert.deepEqual(result.leftEdits, [
      { base: { start: horizon, end: horizon }, variant: { start: horizon, end: horizon + 1 } },
      { base: { start: horizon + 1, end: horizon + 2 }, variant: { start: horizon + 2, end: horizon + 2 } }
    ]);
    assert.deepEqual(result.regions.map(r => [r.kind, r.base.start, r.base.end]), [['left', horizon, horizon], ['conflict', horizon + 1, horizon + 2]]);
  });
}
