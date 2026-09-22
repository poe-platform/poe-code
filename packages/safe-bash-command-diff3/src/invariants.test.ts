import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { analyzeDiff3, createDiff3Engine, Diff3Error } from './index.js';

const limits = { inputBytes: 100000, retainedBytes: 200000, tokens: 10000, graphCells: 100000, work: 2000000 };
const b = (text: string) => new TextEncoder().encode(text);

test('byte equivalence never merges distinct invalid UTF8 presentations', () => {
  const result = analyzeDiff3({ base: Uint8Array.of(97, 10), left: Uint8Array.of(255, 10), right: Uint8Array.of(254, 10) }, limits);
  assert.equal(result.regions[0]!.kind, 'conflict');
});

test('borrowed limits/options, byte realms and separate invocations preserve replay', () => {
  const mutableLimits = { ...limits }, options = { text: true, stripTrailingCR: true };
  const engine = createDiff3Engine(mutableLimits, options);
  mutableLimits.inputBytes = 0; options.text = options.stripTrailingCR = false;
  const foreign = runInNewContext('Uint8Array.of(0, 13, 10)') as Uint8Array;
  engine.push('base', foreign); engine.push('left', Uint8Array.of(0, 10)); engine.push('right', foreign);
  for (const file of ['base', 'left', 'right'] as const) engine.end(file);
  const first = engine.finish();
  assert.deepEqual(first.regions, []);
  foreign.fill(255);
  const second = analyzeDiff3({ base: Uint8Array.of(0, 13, 10), left: Uint8Array.of(0, 10), right: Uint8Array.of(0, 13, 10) }, limits, { text: true, stripTrailingCR: true });
  assert.deepEqual(first, second);
  assert.equal(engine.accounting().retainedBytes, 0);
  assert.equal(engine.accounting().graphCells, 0);
});

test('every chunk boundary gives the same original bytes and edits', () => {
  const files = { base: Uint8Array.of(255, 13, 10, 10, 97), left: Uint8Array.of(255, 13, 10, 98, 10, 97), right: Uint8Array.of(255, 13, 10, 10, 99) };
  const expected = analyzeDiff3(files, limits);
  for (let width = 1; width < 6; width++) {
    const engine = createDiff3Engine(limits);
    for (const file of ['base', 'left', 'right'] as const) {
      for (let offset = 0; offset < files[file].length; offset += width) engine.push(file, files[file].subarray(offset, offset + width));
      engine.end(file);
    }
    assert.deepEqual(engine.finish(), expected);
  }
});

test('chunk admission uses actual byte storage rather than shadowed producer length', () => {
  const bytes = Uint8Array.of(97, 98, 99, 10);
  Object.defineProperty(bytes, 'length', { value: 1 });
  const engine = createDiff3Engine({ ...limits, inputBytes: 3 });
  assert.throws(() => engine.push('base', bytes), error => error instanceof Diff3Error && error.code === 'LIMIT' && error.resource === 'inputBytes');
  assert.equal(engine.accounting().retainedBytes, 0);
  assert.equal(engine.accounting().graphCells, 0);
});

test('post-spool work exhaustion releases all state rather than returning partial edits', () => {
  const files = { base: b('a\nb\na\nb\n'), left: b('b\na\nb\na\n'), right: b('c\nb\nc\na\n') };
  const probe = createDiff3Engine(limits);
  for (const file of ['base', 'left', 'right'] as const) { probe.push(file, files[file]); probe.end(file); }
  const work = probe.accounting().work; probe.dispose();
  const engine = createDiff3Engine({ ...limits, work: work + 10 });
  for (const file of ['base', 'left', 'right'] as const) { engine.push(file, files[file]); engine.end(file); }
  assert.throws(() => engine.finish(), error => error instanceof Diff3Error && error.code === 'LIMIT' && error.resource === 'work');
  assert.equal(engine.accounting().retainedBytes, 0);
  assert.equal(engine.accounting().tokens, 0);
  assert.equal(engine.accounting().graphCells, 0);
});

test('cooperative cancellation is checked inside comparison work', () => {
  const controller = new AbortController();
  let checks = 0;
  Object.defineProperty(controller.signal, 'aborted', { get: () => ++checks > 100 });
  const engine = createDiff3Engine(limits, {}, controller.signal);
  for (const file of ['base', 'left', 'right'] as const) { engine.push(file, b('a\nb\nc\nd\n')); engine.end(file); }
  assert.throws(() => engine.finish(), error => error instanceof Diff3Error && error.code === 'CANCELLED');
  assert.equal(engine.accounting().retainedBytes, 0);
});

test('edit ranges reconstruct the variant for a deterministic repeated-line corpus', () => {
  let seed = 1;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let sample = 0; sample < 100; sample++) {
    const base = Array.from({ length: random() % 10 }, () => String(random() % 4) + '\n').join('');
    const left = Array.from({ length: random() % 10 }, () => String(random() % 4) + '\n').join('');
    const result = analyzeDiff3({ base: b(base), left: b(left), right: b(base) }, limits);
    const text = (file: 'base' | 'left', start: number, end: number) => result.files[file].slice(start, end).map(line => new TextDecoder().decode(line.bytes)).join('');
    let actual = '', cursor = 0;
    for (const edit of result.leftEdits) {
      assert.ok(edit.base.start >= cursor);
      actual += text('base', cursor, edit.base.start) + text('left', edit.variant.start, edit.variant.end);
      cursor = edit.base.end;
    }
    actual += text('base', cursor, result.files.base.length);
    assert.equal(actual, left);
  }
});
