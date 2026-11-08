import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { readSqliteFile, writeSqliteFile } from './file-io.js';

const signal = () => new AbortController().signal;

test('SQLite file I/O retries short transfers in bounded owned buffers', async () => {
  const fs = new MemoryFileSystem();
  const file = await fs.open('/db', { access: 'readwrite', creation: 'exclusive' });
  const original = Uint8Array.from({ length: 40001 }, (_, index) => index % 251);
  const source = original.slice();
  let maxWrite = 0, maxRead = 0;
  const read = file.read.bind(file), write = file.write.bind(file);
  file.write = async (bytes, offset, options) => {
    maxWrite = Math.max(maxWrite, bytes.length);
    const count = await write(bytes.subarray(0, 127), offset, options);
    bytes.fill(255, 0, count);
    return count;
  };
  file.read = async (bytes, offset, options) => {
    maxRead = Math.max(maxRead, bytes.length);
    return read(bytes.subarray(0, 113), offset, options);
  };
  try {
    await writeSqliteFile(file, source, 17, signal());
    assert.deepEqual(source, original, 'descriptor writes cannot mutate the native source');
    const target = new Uint8Array(original.length);
    assert.equal(await readSqliteFile(file, target, 17, signal()), true);
    assert.deepEqual(target, original);
    assert.ok(maxRead <= 16384 && maxWrite <= 16384);
    const tail = new Uint8Array(10).fill(99);
    assert.equal(await readSqliteFile(file, tail, 17 + original.length - 3, signal()), false);
    assert.deepEqual(tail, Uint8Array.from([...original.subarray(-3), ...new Uint8Array(7)]));
  } finally { await file.close(); }
});

test('SQLite file I/O rejects invalid transfer results without retrying forever', async () => {
  const fs = new MemoryFileSystem();
  const file = await fs.open('/db', { access: 'readwrite', creation: 'exclusive' });
  try {
    for (const count of [-1, 0.5, 2, NaN]) {
      file.read = async () => count;
      await assert.rejects(readSqliteFile(file, new Uint8Array(1), 0, signal()), /SQLite file read/);
    }
    for (const count of [-1, 0, 0.5, 2, NaN]) {
      file.write = async () => count;
      await assert.rejects(writeSqliteFile(file, new Uint8Array(1), 0, signal()), /SQLite file write/);
    }
  } finally { await file.close(); }
});

test('SQLite file I/O honors cancellation between short transfers and retains caller ownership', async () => {
  const fs = new MemoryFileSystem();
  const file = await fs.open('/db', { access: 'readwrite', creation: 'exclusive' });
  try {
    const readAbort = new AbortController();
    let reads = 0;
    file.read = async () => { reads++; readAbort.abort(new Error('stop-read')); return 1; };
    await assert.rejects(readSqliteFile(file, new Uint8Array(3), 0, readAbort.signal), /stop-read/);
    assert.equal(reads, 1);
    const writeAbort = new AbortController();
    let writes = 0;
    file.write = async () => { writes++; writeAbort.abort(new Error('stop-write')); return 1; };
    await assert.rejects(writeSqliteFile(file, new Uint8Array(3), 0, writeAbort.signal), /stop-write/);
    assert.equal(writes, 1);
    assert.equal((await file.stat()).type, 'file', 'the transaction retains ownership of the descriptor');
  } finally { await file.close(); }
});

test('SQLite file I/O validates offset arithmetic before filesystem calls', async () => {
  const fs = new MemoryFileSystem();
  const file = await fs.open('/db', { access: 'readwrite', creation: 'exclusive' });
  try {
    file.read = async () => { throw new Error('unexpected read'); };
    file.write = async () => { throw new Error('unexpected write'); };
    for (const offset of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER]) {
      await assert.rejects(readSqliteFile(file, new Uint8Array(1), offset, signal()), RangeError);
      await assert.rejects(writeSqliteFile(file, new Uint8Array(1), offset, signal()), RangeError);
    }
    assert.equal(await readSqliteFile(file, new Uint8Array(), 0, signal()), true);
    await writeSqliteFile(file, new Uint8Array(), 0, signal());
    await assert.rejects(readSqliteFile(file, new Uint8Array(), 0, AbortSignal.abort(new Error('stop-empty'))), /stop-empty/);
  } finally { await file.close(); }
});
