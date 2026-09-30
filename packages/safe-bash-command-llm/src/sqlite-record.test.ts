import assert from 'node:assert/strict';
import test from 'node:test';
import { toByteSource } from 'safe-bash-contracts';
import integers from './fixtures/sqlite-integer-records.json' with { type: 'json' };
import { sqliteRecord } from './sqlite-record.js';

test('SQLite record encoding preserves native serial types and UTF-8 bytes', async () => {
  const record = sqliteRecord([null, 0n, 1n, -129n, 1.5, { type: 'text', size: 3, bytes: toByteSource('☃') }, { type: 'blob', size: 2, bytes: toByteSource(new Uint8Array([0, 255])) }]);
  const chunks: Uint8Array[] = [];
  for await (const chunk of record.bytes(new AbortController().signal)) chunks.push(chunk);
  // Native SQLite record: header size8;NULL,0,1,int16,float64,text3,blob2.
  assert.equal(Buffer.concat(chunks).toString('hex'), '0800080902071310ff7f3ff8000000000000e2988300ff');
  assert.equal(record.size, Buffer.concat(chunks).length);
});

test('large record values remain lazy and emit bounded owned chunks', async () => {
  let pulls = 0;
  const chunk = new Uint8Array(65536).fill(65);
  const record = sqliteRecord([{ type: 'text', size: chunk.length * 1024, bytes: { async *[Symbol.asyncIterator]() { for (let i = 0; i < 1024; i++) { pulls++; yield chunk; } } } }]);
  assert.equal(pulls, 0);
  let size = 0;
  for await (const bytes of record.bytes(new AbortController().signal)) {
    assert.ok(bytes.length <= 16384);
    assert.notEqual(bytes.buffer, chunk.buffer);
    size += bytes.length;
  }
  assert.equal(size, record.size);
  assert.equal(pulls, 1024);
});

test('record streams reject short and overlong fields and close on cancellation', async () => {
  for (const [size, text] of [[1, 'ab'], [3, 'ab']] as const) {
    const record = sqliteRecord([{ type: 'text', size, bytes: toByteSource(text) }]);
    await assert.rejects(async () => { for await (const chunk of record.bytes(new AbortController().signal)) void chunk; }, /size/);
  }
  let closed = false;
  const controller = new AbortController();
  const record = sqliteRecord([{ type: 'blob', size: 32768, bytes: { async *[Symbol.asyncIterator]() { try { yield new Uint8Array(32768); } finally { closed = true; } } } }]);
  await assert.rejects(async () => {
    for await (const chunk of record.bytes(controller.signal)) { if (chunk.length === 16384) controller.abort(new Error('stop')); }
  }, /stop/);
  assert.equal(closed, true);
});

test('integer serial widths match native SQLite at every signed boundary', async () => {
  for (const fixture of integers.cases) {
    const record = sqliteRecord([BigInt(fixture.integer)]);
    const chunks: Uint8Array[] = [];
    for await (const chunk of record.bytes(new AbortController().signal)) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString('hex'), fixture.hex, fixture.integer);
  }
  assert.throws(() => sqliteRecord([1n << 63n]), /out of range/);
  assert.throws(() => sqliteRecord([-(1n << 63n) - 1n]), /out of range/);
});

test('cancellation releases a pending source read without waiting for it', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let returned = false;
  const record = sqliteRecord([{ type: 'blob', size: 1, bytes: { [Symbol.asyncIterator]() { return {
    next() { started(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    async return() { returned = true; return { done: true, value: undefined }; },
  }; } } }]);
  const consuming = (async () => { for await (const chunk of record.bytes(controller.signal)) void chunk; })();
  await reading;
  controller.abort(new Error('cancel pending source'));
  await assert.rejects(consuming, /cancel pending source/);
  assert.equal(returned, true);
});
