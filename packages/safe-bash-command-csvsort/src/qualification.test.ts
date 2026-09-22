import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortRecords, type SortKey, type SortRecord } from './sort.js';

const limits = { retainedBytes: 100_000, work: 100_000, records: 100, keyBytes: 1000 };
const row = (id: number, ...keys: SortKey[]): SortRecord => ({ bytes: new Uint8Array([id]), keys });
const integer = (value: string): SortKey => ({ integer: value });
const ids = (rows: readonly SortRecord[]): number[] => rows.map(record => record.bytes[0]!);

test('independent numeric/text controls distinguish 2 versus 10 without inferring keys', () => {
  assert.deepEqual(ids(sortRecords([row(10, integer('10')), row(2, integer('2'))], {}, limits)), [2, 10]);
  assert.deepEqual(ids(sortRecords([row(10, '10'), row(2, '2')], {}, limits)), [10, 2]);
  // This stage is exact integer ordering, NOT the native precision-28 cast.
  const rows = [row(1, integer('1234567890123456789012345678901')), row(0, integer('1234567890123456789012345678900'))];
  assert.deepEqual(ids(sortRecords(rows, {}, limits)), [0, 1]);
  assert.deepEqual(ids(sortRecords(rows, { reverse: true }, limits)), [1, 0]);
});

test('independent reverse composite control includes secondary keys and null ties', () => {
  const rows = [row(1, null, 'b'), row(2, integer('2'), 'b'), row(3, null, 'a'), row(4, integer('2'), 'a'), row(5, integer('2'), 'a')];
  assert.deepEqual(ids(sortRecords(rows, {}, limits)), [4, 5, 2, 3, 1]);
  assert.deepEqual(ids(sortRecords(rows, { reverse: true }, limits)), [1, 3, 2, 4, 5]);
});

test('CSV-looking bytes stay opaque including BOM, CRLF, quotes and multiline records', () => {
  const first = new Uint8Array([239, 187, 191, 118, 44, 118, 13, 10]);
  const second = new Uint8Array([34, 97, 13, 10, 98, 34, 44, 50, 10]);
  const result = sortRecords([{ bytes: first, keys: ['z'] }, { bytes: second, keys: ['a'] }], {}, limits);
  assert.deepEqual(result.map(record => [...record.bytes]), [[34, 97, 13, 10, 98, 34, 44, 50, 10], [239, 187, 191, 118, 44, 118, 13, 10]]);
  assert.notEqual(result[0]?.bytes, second);
  assert.notEqual(result[1]?.bytes, first);
});

test('temporal-looking text has no ambient date inference', () => {
  assert.deepEqual(ids(sortRecords([row(1, '02/01/2026'), row(2, '01/02/2026'), row(3, 'today')], {}, limits)), [2, 1, 3]);
});

test('negative type authority controls reject mixed keys rather than coercing them', () => {
  assert.throws(() => sortRecords([row(1, integer('2')), row(2, '10')], {}, limits), { code: 'KEY' });
  for (const value of ['NaN', 'Infinity', '2.0', '2e0']) {
    assert.throws(() => sortRecords([row(1, integer(value))], {}, limits), { code: 'KEY' });
  }
});
