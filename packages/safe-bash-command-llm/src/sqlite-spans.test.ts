import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import fixture from './fixtures/sqlite-page-records.json' with { type: 'json' };
import { findSqliteRecord } from './sqlite-pages.js';

async function drain(source: AsyncIterable<unknown>) { for await (const item of source) void item; }

test('physical SQLite spans map native table and overflow ranges with bounded short reads', async () => {
  const fs = new MemoryFileSystem();
  const original = Buffer.from(fixture.database, 'base64');
  await fs.writeFile('/db', original);
  const file = await fs.openReadFile('/db');
  const signal = new AbortController().signal;
  let maxRead = 0;
  const read = file.read.bind(file);
  file.read = async (position, size, options) => {
    maxRead = Math.max(maxRead, size);
    return read(position, Math.min(size, 113), options);
  };
  try {
    const rows: [number, bigint][] = [[1, 1n], ...fixture.rows.map(row => [fixture.root, BigInt(row.id)] as [number, bigint])];
    for (const [root, id] of rows) {
      const record = await findSqliteRecord(file, root, id, signal);
      assert.ok(record);
      const all: Uint8Array[] = [];
      for await (const bytes of record.bytes()) all.push(bytes);
      const expected = Buffer.concat(all);
      for (const [offset, length] of [[0, record.size], [0, 1], [20, Math.min(700, Math.max(0, record.size - 20))], [Math.max(0, record.size - 31), Math.min(31, record.size)], [record.size, 0]]) {
        if (offset! > record.size) continue;
        const pieces: Uint8Array[] = [];
        let size = 0;
        for await (const span of record.spans(offset!, length!)) {
          assert.ok(span.length > 0 && span.length <= 512);
          assert.ok(span.offset >= 0 && span.offset + span.length <= original.length);
          pieces.push(original.subarray(span.offset, span.offset + span.length));
          size += span.length;
        }
        assert.equal(size, length);
        assert.deepEqual(Buffer.concat(pieces), expected.subarray(offset!, offset! + length!), `${root}:${id}:${offset}`);
      }
    }
    assert.ok(maxRead <= 512);
    const record = await findSqliteRecord(file, fixture.root, 3n, signal);
    assert.ok(record);
    maxRead = 0;
    await drain(record.spans(record.size - 1, 1));
    assert.equal(maxRead, 4, 'physical mapping reads overflow pointers without loading payload pages');
  } finally { await file.close(); }
});

test('physical spans reject invalid ranges, cancellation and changed snapshots', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/db', Buffer.from(fixture.database, 'base64'));
  const file = await fs.openReadFile('/db');
  try {
    const controller = new AbortController();
    const record = await findSqliteRecord(file, fixture.root, 3n, controller.signal);
    assert.ok(record);
    for (const [offset, length] of [[-1, 1], [0, -1], [0.1, 1], [0, Infinity], [record.size, 1]]) {
      await assert.rejects(drain(record.spans(offset!, length!)), RangeError);
    }
    const other = await findSqliteRecord(file, fixture.root, 3n, new AbortController().signal);
    assert.ok(other);
    const iterator = record.spans()[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).done, false);
    controller.abort(new Error('cancel-spans'));
    await assert.rejects(iterator.next(), /cancel-spans/);
    await fs.appendFile('/db', new Uint8Array([0]));
    await assert.rejects(drain(other.spans()), /changed/);
  } finally { await file.close(); }
});

test('physical spans reject truncated and cyclic overflow chains', async () => {
  for (const cyclic of [false, true]) {
    const fs = new MemoryFileSystem();
    const bytes = Buffer.from(fixture.database, 'base64');
    const overflow = bytes.readUInt32BE(fixture.overflowPointer);
    if (cyclic) bytes.writeUInt32BE(overflow, (overflow - 1) * 512);
    else bytes.writeUInt32BE(0, fixture.overflowPointer);
    await fs.writeFile('/db', bytes);
    const file = await fs.openReadFile('/db');
    try {
      const record = await findSqliteRecord(file, fixture.root, 3n, new AbortController().signal);
      assert.ok(record);
      await assert.rejects(drain(record.spans()), /SQLite/);
    } finally { await file.close(); }
  }
});
