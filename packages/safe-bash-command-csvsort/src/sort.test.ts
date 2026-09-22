import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortRecords, CsvSortError, type SortRecord, type SortLimits } from './sort.js';

const limits: SortLimits = { retainedBytes: 100_000, work: 100_000, records: 100, keyBytes: 1000 };
const record = (id: string, ...keys: (string | bigint | null)[]): SortRecord => ({ bytes: new TextEncoder().encode(id), keys: keys.map(key => typeof key === 'bigint' ? { integer: String(key) } : key) });
const ids = (rows: readonly SortRecord[]): string[] => rows.map(row => new TextDecoder().decode(row.bytes));

test('composite ordering reverses keys while preserving ties', () => {
  const rows = [record('p', 2n, 2n), record('q', 2n, 1n), record('r', 2n, 1n), record('s', 1n, 9n)];
  assert.deepEqual(ids(sortRecords(rows, { reverse: false }, limits)), ['s', 'q', 'r', 'p']);
  assert.deepEqual(ids(sortRecords(rows, { reverse: true }, limits)), ['p', 'q', 'r', 's']);
  assert.deepEqual(ids(rows), ['p', 'q', 'r', 's']);
});

test('nulls last ascending, first descending, with stable null ties', () => {
  const rows = [record('a', null), record('b', 2n), record('c', null), record('d', 1n)];
  assert.deepEqual(ids(sortRecords(rows, {}, limits)), ['d', 'b', 'a', 'c']);
  assert.deepEqual(ids(sortRecords(rows, { reverse: true }, limits)), ['a', 'c', 'b', 'd']);
});

test('integer keys remain exact and text compares Unicode code points', () => {
  assert.deepEqual(ids(sortRecords([record('a', 9007199254740993n), record('b', 9007199254740992n)], {}, limits)), ['b', 'a']);
  assert.deepEqual(ids(sortRecords([record('a', '😀'), record('b', '\uE000')], {}, limits)), ['b', 'a']);
});

test('empty and single record inputs still validate and own output bytes', () => {
  assert.deepEqual(sortRecords([], {}, limits), []);
  const row = record('a', 'v');
  const result = sortRecords([row], {}, limits);
  row.bytes.fill(0);
  assert.deepEqual(ids(result), ['a']);
  assert.throws(() => sortRecords([record('a', 'v')], {}, { ...limits, records: 0 }), CsvSortError);
});

test('retained accounting admits exact boundary and rejects one less', () => {
  // Two index buffers, type/key slots, payload, and UTF-16 key storage.
  const rows = [record('a', 'v')];
  assert.deepEqual(ids(sortRecords(rows, {}, { ...limits, retainedBytes: 35 })), ['a']);
  assert.throws(() => sortRecords(rows, {}, { ...limits, retainedBytes: 34 }), { code: 'QUOTA' });
});

test('independent permutation control covers non-power-of-two runs and negative integers', () => {
  // Deterministic exhaustive permutations; expected order is a hand-ranked list.
  const ranked = [record('a', -100n), record('b', -2n), record('c', 0n), record('d', 2n), record('e', 100n)];
  const visit = (prefix: SortRecord[], rest: SortRecord[]): void => {
    if (!rest.length) {
      assert.deepEqual(ids(sortRecords(prefix, {}, limits)), ['a', 'b', 'c', 'd', 'e']);
      assert.deepEqual(ids(sortRecords(prefix, { reverse: true }, limits)), ['e', 'd', 'c', 'b', 'a']);
      return;
    }
    for (let i = 0; i < rest.length; i++) visit([...prefix, rest[i]!], rest.filter((_, j) => i !== j));
  };
  visit([], ranked);
});

test('null key slots consume retained budget and noncanonical integers are rejected', () => {
  assert.throws(() => sortRecords([record('a', null, null)], {}, { ...limits, retainedBytes: 47 }), { code: 'QUOTA' });
  for (const integer of ['', '-', '+1', '01', '-0', '1.0', '１２']) {
    assert.throws(() => sortRecords([{ bytes: new Uint8Array(), keys: [{ integer }] }], {}, limits), { code: 'KEY' });
  }
});

test('key, comparator work and record quotas fail before returning output', () => {
  assert.throws(() => sortRecords([record('a', 'long')], {}, { ...limits, keyBytes: 7 }), { code: 'QUOTA' });
  assert.throws(() => sortRecords([record('a', 'abc'), record('b', 'abd')], {}, { ...limits, work: 1 }), { code: 'QUOTA' });
  assert.throws(() => sortRecords([record('a', 1n), record('b', 2n)], {}, { ...limits, records: 1 }), { code: 'QUOTA' });
});

test('mismatched key types or arity fail even when no comparison is necessary', () => {
  assert.throws(() => sortRecords([record('a', 1n), record('b', '2')], {}, limits), { code: 'KEY' });
  assert.throws(() => sortRecords([record('a', 1n), record('b', 2n, 3n)], {}, limits), { code: 'KEY' });
});

test('cancellation preserves falsey reasons and limits reject unsafe values', () => {
  const abort = new AbortController(); abort.abort(false);
  assert.throws(() => sortRecords([], {}, limits, abort.signal), error => error === false);
  for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => sortRecords([], {}, { ...limits, work: value }), { code: 'OPTION' });
  }
});
