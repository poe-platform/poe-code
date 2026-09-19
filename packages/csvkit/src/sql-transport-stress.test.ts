import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createSqlTransportProvider, type SqlTransportConnection, type SqlTransportCursor } from './sql-transport.js';
import { CsvkitDiagnostic } from './errors.js';

const signal = new AbortController().signal;

test('cursor metadata failure releases the acquired cursor before diagnostic delivery', async () => {
  const effects: string[] = [];
  const failure = new Error('driver column metadata failed');
  const provider = createSqlTransportProvider({
    profile: 'postgresql-positional-v1', authorize: async () => true,
    diagnostic: error => { assert.equal(error, failure); effects.push('diagnostic'); return new CsvkitDiagnostic('DriverError: metadata failed'); },
    connect: async () => ({
      execute: async () => ({
        get columns(): readonly string[] | null { throw failure; },
        read: async () => null,
        cancel: async () => { effects.push('cursor-cancel'); },
        close: async () => { effects.push('cursor-close'); }
      }),
      transaction: async () => {}, close: async () => { effects.push('connection-close'); }
    })
  });
  const session = await provider.connect('postgresql://allowed/db', {}, signal);
  await assert.rejects(session.query('select x', [], {}, signal), /DriverError: metadata failed/);
  assert.deepEqual(effects, ['cursor-cancel', 'cursor-close', 'diagnostic']);
  await session.close();
  assert.deepEqual(effects, ['cursor-cancel', 'cursor-close', 'diagnostic', 'connection-close']);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('session close drains a late cursor acquisition and releases it exactly once', async () => {
  const effects: string[] = [];
  const admitted = deferred<void>();
  const acquisition = deferred<SqlTransportCursor>();
  const provider = createSqlTransportProvider({ profile: 'mysql-positional-v1', authorize: async () => true,
    connect: async () => ({ execute: async () => { admitted.resolve(); return acquisition.promise; }, transaction: async () => {},
      close: async () => { effects.push('connection-close'); } }) });
  const session = await provider.connect('mysql://allowed/db', {}, signal);
  const querying = session.query('select x', [], {}, signal);
  await admitted.promise;
  let settled = false;
  const closing = session.close().then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  acquisition.resolve({ columns: ['x'], read: async () => { assert.fail('closing session cannot read late cursor'); },
    cancel: async () => { effects.push('cursor-cancel'); }, close: async () => { effects.push('cursor-close'); } });
  const result = await querying;
  await closing; await result.close(); await session.close();
  assert.deepEqual(effects, ['cursor-cancel', 'cursor-close', 'connection-close']);
});

test('cancelled pending cursor read drains return cleanup before cursor and connection close', async () => {
  const effects: string[] = [];
  const controller = new AbortController();
  const admitted = deferred<void>();
  const read = deferred<readonly string[] | null>();
  const cancelled = deferred<void>();
  const reason = new Error('caller cancelled cursor');
  const connection: SqlTransportConnection = {
    execute: async () => ({ columns: ['x'], read: async () => { effects.push('read'); admitted.resolve(); return read.promise; },
      cancel: async () => { effects.push('cancel-start'); read.resolve(null); await cancelled.promise; effects.push('cancel-end'); },
      close: async () => { effects.push('cursor-close'); } }),
    transaction: async () => {}, close: async () => { effects.push('connection-close'); }
  };
  const provider = createSqlTransportProvider({ profile: 'oracle-named-v1', authorize: async () => true, connect: async () => connection });
  const session = await provider.connect('oracle://allowed/db', {}, controller.signal);
  const result = await session.query('select x', [], {}, controller.signal);
  const iterator = result.rows[Symbol.asyncIterator]();
  const pending = assert.rejects(iterator.next(), error => error === reason);
  await admitted.promise; controller.abort(reason); await pending;
  let settled = false;
  const closing = session.close().then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(effects, ['read', 'cancel-start']);
  cancelled.resolve(); await closing; await result.close();
  assert.deepEqual(effects, ['read', 'cancel-start', 'cancel-end', 'cursor-close', 'connection-close']);
});

test('failed cursor metadata cleanup preserves both failures and still closes the connection', async () => {
  const metadata = new Error('metadata failed');
  const cancel = new Error('cursor cancellation failed');
  const close = new Error('cursor close failed');
  const effects: string[] = [];
  const provider = createSqlTransportProvider({ profile: 'mssql-named-v1', authorize: async () => true,
    diagnostic: () => { assert.fail('cooperative cleanup failure must not become a driver diagnostic'); },
    connect: async () => ({ execute: async () => ({ get columns(): readonly string[] | null { throw metadata; }, read: async () => null,
      cancel: async () => { effects.push('cancel'); throw cancel; }, close: async () => { effects.push('cursor-close'); throw close; } }),
      transaction: async () => {}, close: async () => { effects.push('connection-close'); } }) });
  const session = await provider.connect('mssql://allowed/db', {}, signal);
  await assert.rejects(session.query('select x', [], {}, signal), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [metadata, cancel, close]);
    return true;
  });
  await session.close();
  assert.deepEqual(effects, ['cancel', 'cursor-close', 'connection-close']);
});
