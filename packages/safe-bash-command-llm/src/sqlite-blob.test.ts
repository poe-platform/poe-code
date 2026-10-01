import assert from 'node:assert/strict';
import test from 'node:test';
import { writeSqliteBlob } from './sqlite-blob.js';

function runtime(size: number) {
  const heap = new Uint8Array(65536), allocated = new Set<number>();
  const writes: Uint8Array[] = [], offsets: number[] = [];
  let next = 16, closed = 0, rowid: unknown[] = [];
  const module = {
    HEAPU8: heap,
    _malloc(length: number) { const pointer = next; next += length; allocated.add(pointer); return pointer; },
    _free(pointer: number) { assert.equal(allocated.delete(pointer), true); },
    cwrap(name: string) {
      if (name === 'sqlite3_blob_open') return async (...args: unknown[]) => { rowid = args.slice(4, 6); new DataView(heap.buffer).setInt32(args[7] as number, 42, true); return 0; };
      if (name === 'sqlite3_blob_bytes') return () => size;
      if (name === 'sqlite3_blob_write') return async (_handle: number, pointer: number, count: number, offset: number) => { writes.push(heap.slice(pointer, pointer + count)); offsets.push(offset); return 0; };
      if (name === 'sqlite3_blob_close') return async () => { closed++; return 0; };
      throw new Error(name);
    }
  };
  return { module, allocated, writes, offsets, get closed() { return closed; }, get rowid() { return rowid; } };
}

const options = (source: AsyncIterable<Uint8Array>, size: number, signal = new AbortController().signal) => ({ database: 1, table: 'schemas', column: 'content', rowid: -1n, source, size, signal, check: () => {} });

test('native blob writes split borrowed chunks into bounded transfers with exact signed rowids', async () => {
  const state = runtime(32771), input = new Uint8Array(32771).map((_, i) => i % 251);
  await writeSqliteBlob(state.module, options((async function* () { yield input; })(), input.length));
  assert.deepEqual(state.rowid, [-1, -1]);
  assert.deepEqual(state.offsets, [0, 16384, 32768]);
  assert.ok(state.writes.every(bytes => bytes.length <= 16384));
  assert.deepEqual(Buffer.concat(state.writes), Buffer.from(input));
  assert.equal(state.closed, 1); assert.equal(state.allocated.size, 0);
});

test('native blob size mismatches refuse or abort writes and always close native handles', async () => {
  for (const actual of [2, 4]) {
    const state = runtime(3);
    await assert.rejects(writeSqliteBlob(state.module, options((async function* () { yield new Uint8Array(actual); })(), 3)), /length/);
    assert.equal(state.closed, 1); assert.equal(state.allocated.size, 0);
  }
  const state = runtime(2); let consumed = false;
  await assert.rejects(writeSqliteBlob(state.module, options((async function* () { consumed = true; yield new Uint8Array(3); })(), 3)), /length/);
  assert.equal(consumed, false); assert.equal(state.closed, 1); assert.equal(state.allocated.size, 0);
});

test('cancellation of a pending source closes the blob and returns the source iterator', async () => {
  const state = runtime(3), controller = new AbortController(); let next!: () => void, returned = 0;
  const started = new Promise<void>(resolve => { next = resolve; });
  const source = { [Symbol.asyncIterator]() { return { next() { next(); return new Promise<IteratorResult<Uint8Array>>(() => {}); }, async return() { returned++; return { done: true as const, value: undefined }; } }; } };
  const writing = writeSqliteBlob(state.module, options(source, 3, controller.signal));
  await started; controller.abort(new Error('stop blob'));
  await assert.rejects(writing, /stop blob/);
  assert.equal(returned, 1); assert.equal(state.closed, 1); assert.equal(state.allocated.size, 0);
});

test('native open exceptions still release a returned handle and every allocation', async () => {
  const state = runtime(3), error = new Error('native open failed after acquisition');
  const module = { ...state.module, cwrap(name: string) {
    const method = state.module.cwrap(name);
    if (name !== 'sqlite3_blob_open') return method;
    return async (...args: unknown[]) => { await (method as (...args: unknown[]) => Promise<number>)(...args); throw error; };
  } };
  await assert.rejects(writeSqliteBlob(module, options((async function* () { yield new Uint8Array(3); })(), 3)), value => value === error);
  assert.equal(state.closed, 1); assert.equal(state.allocated.size, 0);
});
