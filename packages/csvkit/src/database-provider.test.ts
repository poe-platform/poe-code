import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createDatabaseProvider } from './database-provider.js';
import type { DatabaseSession } from './contracts.js';

function session(effects: unknown[]): DatabaseSession {
  return { profile: 'test', begin: async () => {}, commit: async () => {}, rollback: async () => { effects.push('rollback'); }, close: async () => { effects.push('close'); },
    query: async (sql, values, options) => { effects.push({ sql, values, options }); return { columns: ['x'], rows: (async function* () { yield [1]; })(), close: async () => {} }; } };
}

test('declarative provider authorizes decoded explicit credentials and complete endpoint before driver acquisition', async () => {
  const effects: unknown[] = [];
  const provider = createDatabaseProvider({ schemes: ['owned+driver'], profile: 'test', transport: 'network',
    engineOptions: { timeout: { target: 'timeoutMs', convert: value => { assert.equal(typeof value, 'number'); return Number(value) * 1000; } } },
    executionOptions: { stream_results: { target: 'stream', convert: value => { assert.equal(typeof value, 'boolean'); return value; } } },
    authorize: async request => { effects.push(['authorize', request.url.host, request.url.query, request.credentials, request.options]); return request.url.host === 'allowed'; },
    connect: async request => { effects.push(['connect', request.cwd]); return session(effects); }
  });
  const db = await provider.connect('owned+driver://u%40x:p%2F@allowed:500/db?route=other', { timeout: 2 }, new AbortController().signal, { cwd: '/work' });
  const result = await db.query('select 1', [], { no_parameters: true, stream_results: true }, new AbortController().signal);
  await result.close(); await db.close();
  assert.deepEqual(JSON.parse(JSON.stringify(effects)), [['authorize', 'allowed', { route: 'other' }, { username: 'u@x', password: 'p/' }, { timeoutMs: 2000 }], ['connect', '/work'], { sql: 'select 1', values: [], options: { no_parameters: true, stream: true } }, 'close']);
});

test('provider never connects denied endpoints or accepts unreviewed options', async () => {
  let connects = 0;
  const provider = createDatabaseProvider({ schemes: ['owned'], profile: 'test', transport: 'network', authorize: async () => false, connect: async () => { connects++; return session([]); } });
  await assert.rejects(provider.connect('owned://host/db', {}, new AbortController().signal), /database endpoint authorization/);
  await assert.rejects(provider.connect('owned://host/db', { arbitrary_constructor: true }, new AbortController().signal), /unreviewed database engine option arbitrary_constructor/);
  assert.equal(connects, 0);
});

test('cancellation while authorization settles closes connection admission', async () => {
  const controller = new AbortController(); let connects = 0;
  const provider = createDatabaseProvider({ schemes: ['owned'], profile: 'test', transport: 'network', authorize: async () => { controller.abort('owned-abort'); return true; }, connect: async () => { connects++; return session([]); } });
  await assert.rejects(provider.connect('owned://host/db', {}, controller.signal), reason => reason === 'owned-abort');
  assert.equal(connects, 0);
});

test('ambient credentials are absent and late cancelled driver acquisition is disposed', async () => {
  const effects: unknown[] = [], controller = new AbortController();
  const provider = createDatabaseProvider({ schemes: ['owned'], profile: 'test', transport: 'network',
    authorize: async request => { assert.deepEqual(request.credentials, { username: null, password: null }); return true; },
    connect: async () => { controller.abort(false); return session(effects); }
  });
  await assert.rejects(provider.connect('owned://host/db', {}, controller.signal), reason => reason === false);
  assert.deepEqual(effects, ['rollback', 'close']);
});

test('URL credentials form one explicit identity and never borrow a different configured password', async () => {
  const provider = createDatabaseProvider({ schemes: ['owned'], profile: 'test', transport: 'network', credentials: { username: 'configured', password: 'private' },
    authorize: async request => { assert.deepEqual(request.credentials, { username: 'different', password: null }); return true; }, connect: async () => session([]) });
  const db = await provider.connect('owned://different@host/db', {}, new AbortController().signal);
  await db.close();
});

test('reviewed option mappings cannot overwrite the engine parameter-interpolation control', () => {
  assert.throws(() => createDatabaseProvider({ schemes: ['owned'], profile: 'test', transport: 'network',
    executionOptions: { injected: { target: 'no_parameters', convert: () => 'unsafe' } },
    authorize: async () => true, connect: async () => session([]) }), /reserved database execution option no_parameters/);
});
