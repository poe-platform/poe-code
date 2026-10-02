import assert from 'node:assert/strict';
import test from 'node:test';
import { readSqliteBlob } from './sqlite-blob-read.js';

function runtime(size: number) {
  const heap = new Uint8Array(32768), allocated = new Set<number>();
  let closed = 0, reads = 0, next = 16;
  const module = {
    HEAPU8: heap,
    _malloc(size: number) { const pointer = next; next += size; allocated.add(pointer); return pointer; },
    _free(pointer: number) { assert.equal(allocated.delete(pointer), true); },
    cwrap(name: string) {
      if (name === 'sqlite3_blob_open') return async (...args: number[]) => { assert.equal(args[6], 0); new DataView(heap.buffer).setInt32(args[7]!, 42, true); return 0; };
      if (name === 'sqlite3_blob_bytes') return () => size;
      if (name === 'sqlite3_blob_read') return async (_handle: number, pointer: number, count: number, offset: number) => { assert.ok(count <= 16384); reads++; for (let i=0;i<count;i++) heap[pointer+i]=(offset+i)%251; return 0; };
      if (name === 'sqlite3_blob_close') return async () => { closed++; return 0; };
      throw new Error(name);
    }
  };
  return { module, allocated, get closed() { return closed; }, get reads() { return reads; } };
}
const options = { database: 1, table: 'schemas', column: 'content', rowid: 1n, signal: new AbortController().signal, check() {} };

test('native TEXT/blob reads own bounded windows and close on consumer return', async () => {
  const state = runtime(40000), parts: Uint8Array[] = [];
  for await (const bytes of readSqliteBlob(state.module, options)) parts.push(bytes);
  assert.deepEqual(Buffer.concat(parts), Buffer.from(Array.from({length:40000},(_,i)=>i%251)));
  assert.equal(state.closed,1); assert.equal(state.allocated.size,0);
  const partial = runtime(40000);
  for await (const bytes of readSqliteBlob(partial.module, options)) { assert.equal(bytes.length,16384); break; }
  assert.equal(partial.closed,1); assert.equal(partial.reads,1); assert.equal(partial.allocated.size,0);
});

test('native read limits and cancellation close the handle without further reads', async () => {
  const state = runtime(40000);
  await assert.rejects(async () => { for await (const ignoredChunk of readSqliteBlob(state.module, {...options,maxBytes:100})) { /* Consume through admission. */ } }, /limit/);
  assert.equal(state.closed,1); assert.equal(state.reads,0); assert.equal(state.allocated.size,0);
  const cancel = runtime(40000), controller = new AbortController();
  await assert.rejects(async () => { for await (const ignoredChunk of readSqliteBlob(cancel.module, {...options,signal:controller.signal})) controller.abort(new Error('stop')); }, /stop/);
  assert.equal(cancel.closed,1); assert.equal(cancel.reads,1); assert.equal(cancel.allocated.size,0);
});
