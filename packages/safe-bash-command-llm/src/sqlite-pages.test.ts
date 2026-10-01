import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import fixture from './fixtures/sqlite-page-records.json' with { type: 'json' };
import { sqliteRecord } from './sqlite-record.js';
import { findSqliteRecord } from './sqlite-pages.js';

async function database() {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/logs.db', Buffer.from(fixture.database, 'base64'));
  const file = await fs.openReadFile('/logs.db');
  return { fs, file };
}
const signal = () => new AbortController().signal;
async function collect(source: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('bounded page lookup reads native interior, leaf and overflow records across signed rowids', async () => {
  const { file } = await database();
  let peak = 0;
  const read = file.read.bind(file);
  file.read = async (position, size, options) => { peak = Math.max(peak, size); return read(position, Math.min(size, 113), options); };
  try {
    for (const row of fixture.rows) {
      const record = await findSqliteRecord(file, fixture.root, BigInt(row.id), signal());
      assert.ok(record, row.id);
      const text = `row:${row.id}:${'x'.repeat(row.padding)}`;
      const expected = sqliteRecord([{ type: 'text', size: Buffer.byteLength(text), bytes: toByteSource(text) }]);
      assert.equal(record.size, expected.size);
      assert.deepEqual(await collect(record.bytes()), await collect(expected.bytes(signal())), row.id);
    }
    assert.equal(await findSqliteRecord(file, fixture.root, 100n, signal()), undefined);
    assert.ok(peak <= 512);
  } finally { await file.close(); }
});

test('page readers reject changed retained snapshots and malformed btrees', async () => {
  const { fs, file } = await database();
  try {
    const record = await findSqliteRecord(file, fixture.root, 3n, signal());
    assert.ok(record);
    await fs.appendFile('/logs.db', new Uint8Array([0]));
    await assert.rejects(collect(record.bytes()), /changed/);
  } finally { await file.close(); }
  const other = await database();
  try {
    const bytes = Buffer.from(fixture.database, 'base64');
    bytes[(fixture.root - 1) * 512] = 0;
    await other.fs.writeFile('/logs.db', bytes);
    await assert.rejects(findSqliteRecord(other.file, fixture.root, 1n, signal()), /SQLite/);
  } finally { await other.file.close(); }
});

test('page lookup observes cancellation and validates root and rowid bounds', async () => {
  const { file } = await database();
  try {
    await assert.rejects(findSqliteRecord(file, 0, 1n, signal()), /SQLite/);
    await assert.rejects(findSqliteRecord(file, fixture.root, 1n << 63n, signal()), /rowid/);
    await assert.rejects(findSqliteRecord(file, fixture.root, 1n, AbortSignal.abort(new Error('stop'))), /stop/);
  } finally { await file.close(); }
});

test('truncated and cyclic overflow chains fail instead of silently returning duplicate data', async () => {
  for (const cycle of [false, true]) {
    const { fs, file } = await database();
    try {
      const bytes = Buffer.from(fixture.database, 'base64');
      const firstOverflow = bytes.readUInt32BE(fixture.overflowPointer);
      if (cycle) bytes.writeUInt32BE(firstOverflow, (firstOverflow - 1) * 512);
      else bytes.writeUInt32BE(0, fixture.overflowPointer);
      await fs.writeFile('/logs.db', bytes);
      const record = await findSqliteRecord(file, fixture.root, 3n, signal());
      assert.ok(record);
      await assert.rejects(collect(record.bytes()), /SQLite/);
    } finally { await file.close(); }
  }
});

test('premature descriptor EOF is reported as corruption', async () => {
  const { file } = await database();
  try {
    file.read = async () => new Uint8Array();
    await assert.rejects(findSqliteRecord(file, fixture.root, 1n, signal()), /SQLite/);
  } finally { await file.close(); }
});

test('page one schema records account for the database header', async () => {
  const { file } = await database();
  try {
    const record = await findSqliteRecord(file, 1, 1n, signal());
    assert.ok(record);
    const values = ['table', 'records', 'records', 2n, 'CREATE TABLE records(value text)'];
    const expected = sqliteRecord(values.map(value => typeof value === 'bigint' ? value : ({ type: 'text' as const, size: Buffer.byteLength(value), bytes: toByteSource(value) })));
    assert.deepEqual(await collect(record.bytes()), await collect(expected.bytes(signal())));
  } finally { await file.close(); }
});

test('record byte ranges cross local and overflow boundaries without reading the tail', async () => {
  const { file } = await database();
  try {
    const record = await findSqliteRecord(file, fixture.root, 3n, signal());
    assert.ok(record);
    const whole = await collect(record.bytes());
    for (const [offset, length] of [[0, 1], [20, 700], [whole.length - 31, 31], [whole.length, 0]]) {
      assert.deepEqual(await collect(record.bytes(offset!, length!)), whole.subarray(offset!, offset! + length!));
    }
    let reads = 0;
    const read = file.read.bind(file);
    file.read = async (...args) => { reads++; return read(...args); };
    assert.deepEqual(await collect(record.bytes(0, 1)), whole.subarray(0, 1));
    assert.equal(reads, 0, 'local header reads must not traverse large payloads');
    const sizes: number[] = [];
    file.read = async (position, size, options) => { sizes.push(size); return read(position, size, options); };
    await collect(record.bytes(whole.length - 1, 1));
    assert.ok(sizes.includes(4), 'skipped overflow pages need only their next-page pointer');
    for (const [offset, length] of [[-1, 1], [0, -1], [0.1, 1], [0, Infinity], [whole.length, 1]]) {
      await assert.rejects(collect(record.bytes(offset!, length!)), RangeError);
    }
  } finally { await file.close(); }
});
