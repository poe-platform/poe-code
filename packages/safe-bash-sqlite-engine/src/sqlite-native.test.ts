import assert from 'node:assert/strict';
import test from 'node:test';
import { withSqliteDatabase } from './sqlite-native.js';

function native(openCode = 0) {
  const heap = new Uint8Array(1024), calls: string[] = [], freed: number[] = [];
  const module = {
    HEAPU8: heap,
    _malloc() { return 16; },
    _free(pointer: number) { freed.push(pointer); },
    cwrap(name: string) {
      if (name === 'sqlite3_open_v2') return async (_path: string, out: number) => { new DataView(heap.buffer).setInt32(out, 123, true); return openCode; };
      if (name === 'sqlite3_exec') return async (_db: number, sql: string) => { calls.push(sql); return 0; };
      if (name === 'sqlite3_close') return async () => { calls.push('close'); return 0; };
      throw new Error(name);
    }
  };
  return { module, calls, freed };
}
const options = () => ({ path: '/private/db', vfs: 'private', signal: new AbortController().signal, check() {} });

test('native connection applies bounded cache settings and closes after work', async () => {
  const { module, calls, freed } = native();
  const value = await withSqliteDatabase(module, options(), async connection => {
    assert.equal(connection.database, 123);
    await connection.execute('CREATE TABLE example(value)'); return 42;
  });
  assert.equal(value, 42);
  assert.ok(calls[0]!.includes('cache_size=-512'));
  assert.ok(calls[0]!.includes('temp_store=FILE'));
  assert.equal(calls.at(-1), 'close'); assert.deepEqual(freed, [16]);
});

test('native connection closes even when open reports an error with a live handle', async () => {
  const { module, calls, freed } = native(14);
  await assert.rejects(withSqliteDatabase(module, options(), async () => { assert.fail('operation called'); }), /14/);
  assert.deepEqual(calls, ['close']); assert.deepEqual(freed, [16]);
});

test('native connection preserves caller errors and closes after cancellation', async () => {
  const { module, calls } = native(); const controller = new AbortController(), error = new Error('cancel');
  await assert.rejects(withSqliteDatabase(module, { ...options(), signal: controller.signal }, async () => { controller.abort(error); throw error; }), value => value === error);
  assert.equal(calls.at(-1), 'close');
});

test('native statements reject oversized control text before entering SQLite', async () => {
  const { module, calls } = native();
  await assert.rejects(withSqliteDatabase(module, options(), async connection => { await connection.execute('x'.repeat(65537)); }), /control/);
  assert.equal(calls.length, 2);
});

test('native cleanup waits for unawaited work and rejects overlapping calls', async () => {
  const { module, calls } = native();
  const wrap = module.cwrap.bind(module);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  module.cwrap = name => name === 'sqlite3_exec' ? async (_db: number, sql: string) => {
    calls.push(sql);
    if (sql === 'slow') { started(); await gate; }
    return 0;
  } : wrap(name);
  const run = withSqliteDatabase(module, options(), async connection => {
    void connection.execute('slow');
    await entered;
    await assert.rejects(connection.execute('overlap'), { code: 'EBUSY' });
  });
  await entered;
  await Promise.resolve();
  assert.equal(calls.includes('close'), false);
  release();
  await assert.rejects(run, { code: 'EBUSY' });
  assert.equal(calls.includes('overlap'), false);
  assert.equal(calls.at(-1), 'close');
});

test('native cleanup recovers a handle when the open bridge throws', async () => {
  const { module, calls, freed } = native();
  const wrap = module.cwrap.bind(module), error = new Error('bridge failure');
  module.cwrap = name => name === 'sqlite3_open_v2' ? async (_path: string, out: number) => {
    new DataView(module.HEAPU8.buffer).setInt32(out, 123, true); throw error;
  } : wrap(name);
  await assert.rejects(withSqliteDatabase(module, options(), async () => {}), value => value === error);
  assert.deepEqual(calls, ['close']); assert.deepEqual(freed, [16]);
});
