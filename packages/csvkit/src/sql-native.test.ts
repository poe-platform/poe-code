import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createSqlTransportProvider } from './sql-transport.js';

const signal = new AbortController().signal;
test('native PostgreSQL binding uses injected client/cursor and array labels without loading a module', async () => {
  const effects: unknown[] = [];
  const provider = createSqlTransportProvider({ profile: 'postgresql-pg-cursor-v1', authorize: async () => true,
    driver: {
      acquire: async () => ({ query: async (query: unknown) => { effects.push(query); return { fields: [], rows: [] }; } }),
      release: async () => { effects.push('release'); },
      cursor: async (_client: unknown, text: string, values: unknown[]) => {
        effects.push([text, values]); let read = false;
        return { columns: ['a', 'a'], read: async () => { if (read) return null; read = true; return ['1.23', '2026-09-18']; }, cancel: async () => { effects.push('cancel'); }, close: async () => { effects.push('close'); } };
      }
    }
  });
  const session = await provider.connect('postgresql://authorized/db', {}, signal);
  await session.begin(signal);
  const result = await session.query('select $1', ['1.23'], {}, signal);
  const rows = []; for await (const row of result.rows) rows.push(row);
  assert.deepEqual(result.columns, ['a', 'a']); assert.deepEqual(rows, [['1.23', '2026-09-18']]);
  await result.close(); await session.commit(signal); await session.close();
  assert.deepEqual(effects, ['BEGIN', ['select $1', ['1.23']], 'cancel', 'close', 'COMMIT', 'release']);
});

test('native mysql2 binds rowsAsArray and owns non-row statements', async () => {
  const effects: unknown[] = [];
  const provider = createSqlTransportProvider({ profile: 'mysql-mysql2-v1', authorize: async () => true,
    driver: { acquire: async () => ({ execute: async (options: unknown, values: unknown) => { effects.push([options, values]); return [[], [{ name: 'x' }, { name: 'x' }]]; }, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {} }), release: async () => { effects.push('release'); } }
  });
  const session = await provider.connect('mysql://authorized/db', {}, signal);
  const result = await session.query('select ?, ?', ['1.25', null], {}, signal);
  assert.deepEqual(result.columns, ['x', 'x']);
  await result.close(); await session.rollback(); await session.close();
  assert.deepEqual(effects, [[{ sql: 'select ?, ?', rowsAsArray: true }, ['1.25', null]], 'release']);
});

test('native Oracle requests array rows/resultSet and rolls back implicit transaction', async () => {
  const effects: unknown[] = [];
  const provider = createSqlTransportProvider({ profile: 'oracle-oracledb-v1', authorize: async () => true,
    driver: { acquire: async () => ({ execute: async (sql: string, values: unknown, options: unknown) => { effects.push([sql, values, options]); return { metaData: [{ name: 'X' }], resultSet: { getRow: async () => undefined, close: async () => { effects.push('result.close'); } } }; }, commit: async () => { effects.push('commit'); }, rollback: async () => { effects.push('rollback'); } }), release: async () => { effects.push('release'); }, cancel: async () => { effects.push('cancel'); } }
  });
  const session = await provider.connect('oracle+oracledb://authorized/db', {}, signal);
  await session.begin(signal);
  const result = await session.query('select :p1 from dual', ['text'], {}, signal);
  assert.deepEqual(result.columns, ['X']);
  await result.close(); await session.rollback(); await session.close();
  assert.deepEqual(effects, [['select :p1 from dual', ['text'], { outFormat: 4001, resultSet: true, autoCommit: false }], 'cancel', 'result.close', 'rollback', 'release']);
});

test('native MariaDB requests paired metadata in array mode', async () => {
  const effects: unknown[] = [];
  const provider = createSqlTransportProvider({ profile: 'mariadb-node-v1', authorize: async () => true,
    driver: { acquire: async () => ({ query: async (options: unknown, values: unknown) => { effects.push([options, values]); return [[['a', 'b']], [{ name: 'x' }, { name: 'x' }]]; }, beginTransaction: async () => { effects.push('begin'); }, commit: async () => { effects.push('commit'); }, rollback: async () => { effects.push('rollback'); } }), release: async () => { effects.push('release'); } }
  });
  const session = await provider.connect('mariadb://authorized/db', {}, signal);
  await session.begin(signal);
  const result = await session.query('select ?, ?', ['a', 'b'], {}, signal);
  const rows = []; for await (const row of result.rows) rows.push(row);
  assert.deepEqual(result.columns, ['x', 'x']); assert.deepEqual(rows, [['a', 'b']]);
  await result.close(); await session.commit(signal); await session.close();
  assert.deepEqual(effects, ['begin', [{ sql: 'select ?, ?', rowsAsArray: true, metaAsArray: true }, ['a', 'b']], 'commit', 'release']);
});

test('native MSSQL uses transaction-bound named inputs and duplicate label array mode', async () => {
  const effects: unknown[] = [], transaction = { begin: async () => { effects.push('begin'); }, commit: async () => { effects.push('commit'); }, rollback: async () => { effects.push('rollback'); } };
  const provider = createSqlTransportProvider({ profile: 'mssql-node-v1', authorize: async () => true,
    driver: { acquire: async () => ({}), release: async () => { effects.push('release'); }, transaction: () => transaction,
      request: owner => {
        assert.equal(owner, transaction);
        const request = { arrayRowMode: false, input(name: string, value: unknown) { effects.push([name, value]); return request; },
          query: async (sql: string) => { effects.push([sql, request.arrayRowMode]); return { recordset: Object.assign([['a', 'b']], { columns: [{ name: 'x' }, { name: 'x' }] }) }; }, cancel: () => {} };
        return request;
      }
    }
  });
  const session = await provider.connect('mssql://authorized/db', {}, signal);
  await session.begin(signal);
  const result = await session.query('select @p1, @p2', ['a', 'b'], {}, signal);
  const rows = []; for await (const row of result.rows) rows.push(row);
  assert.deepEqual(result.columns, ['x', 'x']); assert.deepEqual(rows, [['a', 'b']]);
  await result.close(); await session.rollback(); await session.close();
  assert.deepEqual(effects, ['begin', ['p1', 'a'], ['p2', 'b'], ['select @p1, @p2', true], 'rollback', 'release']);
});

test('native Oracle invalid acquired metadata must dispose its result set before driver diagnostic', async () => {
  const effects: unknown[] = [];
  const provider = createSqlTransportProvider({ profile: 'oracle-oracledb-v1', authorize: async () => true,
    driver: { acquire: async () => ({ execute: async () => ({ metaData: [null], resultSet: { getRow: async () => undefined, close: async () => { effects.push('result.close'); } } }), rollback: async () => {}, commit: async () => {} }), release: async () => { effects.push('release'); }, cancel: async () => { effects.push('cancel'); } }
  });
  const session = await provider.connect('oracle://authorized/db', {}, signal);
  await assert.rejects(session.query('select 1', [], {}, signal), /driver diagnostic profile/);
  await session.rollback(); await session.close();
  assert.deepEqual(effects, ['cancel', 'result.close', 'release']);
});

test('native PostgreSQL does not silently treat requested DBAPI interpolation as raw JavaScript SQL', async () => {
  let queries = 0;
  const provider = createSqlTransportProvider({ profile: 'postgresql-pg-cursor-v1', authorize: async () => true,
    driver: { acquire: async () => ({ query: async () => ({ fields: [], rows: [] }) }), release: async () => {}, cursor: async () => { queries++; return { columns: null, read: async () => null, cancel: async () => {}, close: async () => {} }; } }
  });
  const session = await provider.connect('postgresql://owned/db', {}, signal);
  await assert.rejects(session.query("select '50%'", [], { no_parameters: false }, signal), /DBAPI parameter interpolation profile/);
  assert.equal(queries, 0);
  await session.rollback(); await session.close();
});

test('native buffered Oracle does not silently ignore reviewed options absent from its native API binding', async () => {
  let queries = 0;
  const provider = createSqlTransportProvider({ profile: 'oracle-oracledb-v1', authorize: async () => true,
    executionOptions: { custom: { target: 'custom', convert: value => value } },
    driver: { acquire: async () => ({ execute: async () => { queries++; return {}; }, commit: async () => {}, rollback: async () => {} }), release: async () => {} }
  });
  const session = await provider.connect('oracle://owned/db', {}, signal);
  await assert.rejects(session.query('select 1', [], { custom: true }, signal), /native SQL execution option custom/);
  assert.equal(queries, 0);
  await session.rollback(); await session.close();
});

test('native numeric outputs require an explicit scalar codec rather than guessing float/int/decimal identity', async () => {
  const provider = createSqlTransportProvider({ profile: 'oracle-oracledb-v1', authorize: async () => true,
    driver: { acquire: async () => ({ execute: async () => ({ metaData: [{ name: 'N', precision: 38, scale: 6 }], resultSet: { getRow: async () => [1], close: async () => {} } }), commit: async () => {}, rollback: async () => {} }), release: async () => {} }
  });
  const session = await provider.connect('oracle://owned/db', {}, signal);
  const result = await session.query('select 1 from dual', [], {}, signal);
  await assert.rejects(result.rows[Symbol.asyncIterator]().next(), /numeric result scalar codec/);
  await result.close(); await session.rollback(); await session.close();
});

test('native numeric codec receives source metadata and preserves an integral float', async () => {
  const field = { name: 'N', precision: 38, scale: 6 }, seen: unknown[] = [];
  const provider = createSqlTransportProvider({ profile: 'oracle-oracledb-v1', authorize: async () => true,
    driver: { acquire: async () => ({ execute: async () => ({ metaData: [field], resultSet: { getRow: async () => [1], close: async () => {} } }), commit: async () => {}, rollback: async () => {} }), release: async () => {}, decode: (value, column, metadata) => { seen.push([value, column, metadata]); return { kind: 'float', value: '1.0' }; } }
  });
  const session = await provider.connect('oracle://owned/db', {}, signal);
  const result = await session.query('select 1 from dual', [], {}, signal);
  const next = await result.rows[Symbol.asyncIterator]().next();
  assert.deepEqual(next.value, [{ kind: 'float', value: '1.0' }]);
  assert.deepEqual(seen, [[1, 0, field]]);
  await result.close(); await session.rollback(); await session.close();
});
