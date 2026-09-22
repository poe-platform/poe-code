import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortRecords, type SortLimits, type SortRecord } from './sort.js';

const limits: SortLimits = { retainedBytes: 4096, work: 4096, records: 32, keyBytes: 128 };

test('every resource limit rejects invalid SDK values independently', () => {
  for (const field of ['retainedBytes', 'work', 'records', 'keyBytes'] as const) {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => sortRecords([], {}, { ...limits, [field]: value }), { code: 'OPTION' });
    }
  }
  assert.deepEqual(sortRecords([], {}, { retainedBytes: 0, work: 0, records: 0, keyBytes: 0 }), []);
});

test('singleton admission consumes work even without sorting comparisons', () => {
  const rows: SortRecord[] = [{ bytes: new Uint8Array([65]), keys: ['x'] }];
  // One row visit, one payload byte, one key visit, one UTF-16 unit.
  assert.equal(sortRecords(rows, {}, { ...limits, work: 4 }).length, 1);
  assert.throws(() => sortRecords(rows, {}, { ...limits, work: 3 }), { code: 'QUOTA' });
  assert.deepEqual(rows[0]?.bytes, new Uint8Array([65]));
});

test('failed admission has no retained state that poisons subsequent invocations', () => {
  const rows: SortRecord[] = [
    { bytes: new Uint8Array([255, 0]), keys: ['z'] },
    { bytes: new Uint8Array([128, 13]), keys: ['a'] }
  ];
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.throws(() => sortRecords(rows, {}, { ...limits, retainedBytes: 40 }), { code: 'QUOTA' });
    assert.deepEqual(sortRecords(rows, {}, limits).map(row => [...row.bytes]), [[128, 13], [255, 0]]);
  }
  assert.deepEqual(rows.map(row => [...row.bytes]), [[255, 0], [128, 13]]);
});

test('payload ownership copies only the supplied view and preserves arbitrary bytes', () => {
  const backing = new Uint8Array([1, 255, 0, 128, 2]);
  const key = { integer: '9007199254740993' };
  const rows: SortRecord[] = [{ bytes: backing.subarray(1, 4), keys: [key] }];
  const result = sortRecords(rows, {}, limits);
  backing.fill(0);
  key.integer = '0';
  assert.deepEqual(result[0]?.bytes, new Uint8Array([255, 0, 128]));
  assert.deepEqual(result[0]?.keys, [{ integer: '9007199254740993' }]);
  result[0]?.bytes.fill(9);
  assert.deepEqual(backing, new Uint8Array(5));
});

test('cancellation raised during key admission preserves the exact reason and caller bytes', () => {
  for (const reason of [false, 0, '', new Error('cancelled')]) {
    const controller = new AbortController();
    const payload = new Uint8Array([255]);
    const rows: SortRecord[] = [{ bytes: payload, keys: [{
      get integer() { controller.abort(reason); return '1'; }
    }] }];
    assert.throws(() => sortRecords(rows, {}, limits, controller.signal), error => error === reason);
    assert.deepEqual(payload, new Uint8Array([255]));
    assert.equal(sortRecords([{ bytes: payload, keys: ['x'] }], {}, limits).length, 1);
  }
});

test('long equal prefixes exhaust comparator work rather than escaping the budget', () => {
  const prefix = 'a'.repeat(40);
  const rows: SortRecord[] = [
    { bytes: new Uint8Array([1]), keys: [prefix + 'z'] },
    { bytes: new Uint8Array([2]), keys: [prefix + 'b'] }
  ];
  // Admission uses 88 units; 100 allows merge entry but not the full comparison.
  assert.throws(() => sortRecords(rows, {}, { ...limits, work: 100 }), { code: 'QUOTA' });
  assert.deepEqual(sortRecords(rows, {}, limits).map(row => [...row.bytes]), [[2], [1]]);
});
