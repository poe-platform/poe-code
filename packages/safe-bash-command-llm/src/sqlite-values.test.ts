import assert from 'node:assert/strict';
import test from 'node:test';
import { toByteSource } from 'safe-bash-contracts';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import integers from './fixtures/sqlite-integer-records.json' with { type: 'json' };
import fixture from './fixtures/sqlite-page-records.json' with { type: 'json' };
import { findSqliteRecord, type SqliteRecordSource } from './sqlite-pages.js';
import { readSqliteValues } from './sqlite-values.js';

const signal = () => new AbortController().signal;
function record(hex: string): SqliteRecordSource {
  const bytes = Buffer.from(hex, 'hex');
  return { size: bytes.length, bytes(offset = 0, length = bytes.length - offset) { return toByteSource(bytes.subarray(offset, offset + length)); } };
}
async function collect(bytes: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of bytes) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('record decoding preserves all native SQLite integer widths and scalar types', async () => {
  for (const row of integers.cases) assert.deepEqual(await readSqliteValues(record(row.hex), 1, signal()), [BigInt(row.integer)]);
  const values = await readSqliteValues(record('0800080902071310ff7f3ff8000000000000e2988300ff'), 7, signal());
  assert.deepEqual(values.slice(0, 5), [null, 0n, 1n, -129n, 1.5]);
  const text = values[5], blob = values[6];
  assert.ok(text && typeof text === 'object' && text.type === 'text');
  assert.ok(blob && typeof blob === 'object' && blob.type === 'blob');
  assert.equal((await collect(text.bytes)).toString(), '☃');
  assert.deepEqual(await collect(blob.bytes), Buffer.from([0, 255]));
});

test('stored native SQLite TEXT stays a retained source through overflow pages', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/logs.db', Buffer.from(fixture.database, 'base64'));
  const file = await fs.openReadFile('/logs.db');
  try {
    const source = await findSqliteRecord(file, fixture.root, 3n, signal());
    assert.ok(source);
    let reads = 0;
    const read = file.read.bind(file);
    file.read = async (...args) => { reads++; return read(...args); };
    const [value] = await readSqliteValues(source, 1, signal());
    assert.equal(reads, 0, 'metadata decoding does not pull overflow TEXT');
    assert.ok(value && typeof value === 'object' && value.type === 'text');
    const row = fixture.rows.find(row => row.id === '3')!;
    assert.equal((await collect(value.bytes)).toString(), `row:3:${'x'.repeat(row.padding)}`);
    assert.ok(reads > 0);
    const [changed] = await readSqliteValues(source, 1, signal());
    assert.ok(changed && typeof changed === 'object');
    await fs.appendFile('/logs.db', new Uint8Array([0]));
    await assert.rejects(collect(changed.bytes), /changed/);
  } finally { await file.close(); }
});

test('record decoding rejects malformed headers, reserved types and payload sizes', async () => {
  for (const hex of ['', '00', '03', '0280', '020a', '020b', '0211', '02010000', '030000']) {
    await assert.rejects(readSqliteValues(record(hex), 1, signal()), /SQLite/);
  }
  await assert.rejects(readSqliteValues(record('0100'), 0, signal()), /SQLite/);
  assert.deepEqual(await readSqliteValues(record('01'), 0, signal()), []);
  await assert.rejects(readSqliteValues(record('0200'), -1, signal()), RangeError);
});

test('cancellation interrupts pending metadata reads and closes the source iterator', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  let returned = 0;
  const source: SqliteRecordSource = { size: 2, bytes() { return { [Symbol.asyncIterator]() { return {
    next() { started(); return new Promise<IteratorResult<Uint8Array>>(() => undefined); },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } }; } };
  const decoding = readSqliteValues(source, 1, controller.signal);
  await pending; controller.abort(new Error('cancel metadata'));
  await assert.rejects(decoding, { message: 'cancel metadata' });
  assert.equal(returned, 1);
});
