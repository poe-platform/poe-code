import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createSqlTransportProvider, type SqlTransportConnection, type SqlTransportCursor } from './sql-transport.js';
import { sqlTransportProfiles } from './sql-transports.js';
import { CsvkitDiagnostic } from './errors.js';

const signal = new AbortController().signal;
function cursor(effects: unknown[], rows: readonly (readonly string[])[] = []): SqlTransportCursor {
  let index = 0;
  return { columns: ['x'], read: async () => rows[index++] ?? null,
    cancel: async () => { effects.push('cancel'); }, close: async () => { effects.push('cursor.close'); } };
}
function connection(effects: unknown[]): SqlTransportConnection {
  return { execute: async statement => { effects.push(statement); return cursor(effects, [['present']]); },
    transaction: async operation => { effects.push(operation); }, close: async () => { effects.push('connection.close'); } };
}
for (const profile of ['postgresql-positional-v1', 'mysql-positional-v1', 'mariadb-positional-v1', 'mssql-named-v1', 'oracle-named-v1']) test(`${profile}: explicit authorization, reflected schema and transaction port`, async () => {
  const effects: unknown[] = [];
  const descriptor = sqlTransportProfiles.find(item => item.name === profile)!;
  const provider = createSqlTransportProvider({ profile, authorize: async request => { effects.push(request.credentials); return true; }, connect: async () => connection(effects) });
  const session = await provider.connect(descriptor.schemes[0]! + '://u:p@allowed/db', {}, signal);
  await session.begin(signal);
  assert.equal(await session.hasTable!('items', 'owned', signal), true);
  assert.deepEqual(effects[2], { ...descriptor.reflection('items', 'owned'), options: {}, signal });
  assert.equal(session.sqlDialect!.doublePercent, false);
  await session.commit(signal); await session.close();
  assert.deepEqual(effects.slice(-4), ['cancel', 'cursor.close', 'commit', 'connection.close']);
});

test('transport cursor preserves duplicate labels, row order and producer byte ownership', async () => {
  const effects: unknown[] = [], reused = new Uint8Array([65]); let reads = 0;
  const provider = createSqlTransportProvider({ profile: 'postgresql-positional-v1', authorize: async () => true,
    connect: async () => ({ ...connection(effects), execute: async () => ({ columns: ['x', 'x'], read: async () => { reused[0] = ++reads === 1 ? 65 : 66; return reads <= 2 ? [reused, 1] : null; }, cancel: async () => {}, close: async () => {} }) }) });
  const session = await provider.connect('postgresql://allowed/db', {}, signal);
  const result = await session.query('select x', [], {}, signal), rows = [];
  for await (const row of result.rows) rows.push(row);
  assert.deepEqual(result.columns, ['x', 'x']);
  assert.deepEqual(rows, [[new Uint8Array([65]), 1], [new Uint8Array([66]), 1]]);
  await result.close(); await session.rollback(); await session.close();
});

test('late cancelled transport acquisition is rolled back and closed without changing falsey reason', async () => {
  const effects: unknown[] = [], controller = new AbortController();
  const provider = createSqlTransportProvider({ profile: 'mysql-positional-v1', authorize: async () => true,
    connect: async () => { controller.abort(0); return connection(effects); } });
  await assert.rejects(provider.connect('mysql://allowed/db', {}, controller.signal), reason => reason === 0);
  assert.deepEqual(effects, ['rollback', 'connection.close']);
});

test('network transport refuses unknown profiles, unreviewed options and absent endpoint authority', async () => {
  let acquisitions = 0;
  assert.throws(() => createSqlTransportProvider({ profile: 'unknown', authorize: async () => true, connect: async () => connection([]) }), /SQL transport profile unknown/);
  const provider = createSqlTransportProvider({ profile: 'oracle-named-v1', authorize: async () => false, connect: async () => { acquisitions++; return connection([]); } });
  await assert.rejects(provider.connect('oracle://allowed/db', {}, signal), /endpoint authorization/);
  await assert.rejects(provider.connect('oracle://allowed/db', { implicit: true }, signal), /unreviewed database engine option/);
  assert.equal(acquisitions, 0);
});

for (const profile of ['mysql-positional-v1', 'mariadb-positional-v1']) test(`${profile}: reflection sees temporary tables and handles only absent-table errno`, async () => {
  const descriptor = sqlTransportProfiles.find(item => item.name === profile)!;
  const provider = createSqlTransportProvider({ profile, authorize: async () => true,
    connect: async () => ({ ...connection([]), execute: async statement => {
      if (!statement.sql.startsWith('DESCRIBE ')) return cursor([], []);
      if (statement.sql.includes('`missing`')) throw Object.assign(new Error('missing table'), { errno: 1146 });
      if (statement.sql.includes('`denied`')) throw Object.assign(new Error('permission denied'), { errno: 1142 });
      assert.ok(statement.sql.includes('`own``ed`.`temporary`'));
      return cursor([], [['column']]);
    } }) });
  const session = await provider.connect(descriptor.schemes[0]! + '://allowed/db', {}, signal);
  assert.equal(await session.hasTable!('temporary', 'own`ed', signal), true);
  assert.equal(await session.hasTable!('missing', null, signal), false);
  await assert.rejects(session.hasTable!('denied', null, signal), /driver diagnostic profile/);
  await session.close();
});

test('Oracle reflection preserves quoted reserved identifiers while normalizing ordinary names', () => {
  const profile = sqlTransportProfiles.find(item => item.name === 'oracle-named-v1')!;
  assert.deepEqual(profile.reflection('select', 'where').values, ['select', 'where']);
  assert.deepEqual(profile.reflection('ordinary', 'owner').values, ['ORDINARY', 'OWNER']);
});

test('an additional named transport/compiler profile is explicitly configured without a builtin dialect branch', async () => {
  const transport = sqlTransportProfiles.find(item => item.name === 'postgresql-positional-v1')!;
  const { databases } = await import('./databases.js');
  const compiler = { ...databases.find(item => item.name === 'postgresql')!, name: 'extra' };
  const provider = createSqlTransportProvider({ profile: 'extra-reviewed-v1', compiler, transportProfile: { ...transport, name: 'extra-reviewed-v1', dialect: 'extra', schemes: ['extra+reviewed'] }, authorize: async () => true, connect: async () => connection([]) });
  const session = await provider.connect('extra+reviewed://allowed/db', {}, signal);
  assert.equal(session.sqlDialect!.name, 'extra');
  await session.rollback(); await session.close();
});

test('MSSQL reflection selects explicit bracketed database/owner and session temporary tables', () => {
  const profile = sqlTransportProfiles.find(item => item.name === 'mssql-named-v1')!;
  assert.deepEqual(profile.reflection('items', '[db.with.dot].[owner.with.dot]'), { sql: 'SELECT TABLE_NAME FROM [db.with.dot].INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @p1 AND TABLE_SCHEMA = @p2', values: ['items', 'owner.with.dot'] });
  assert.deepEqual(profile.reflection('#temporary', null), { sql: "SELECT name FROM tempdb.sys.tables WHERE object_id = OBJECT_ID('tempdb..' + @p1, 'U')", values: ['#temporary'] });
});

test('admitted query owns typed parameters before the native acquisition microtask', async () => {
  let captured: unknown;
  const provider = createSqlTransportProvider({ profile: 'oracle-named-v1', authorize: async () => true,
    connect: async () => ({ ...connection([]), execute: async statement => { captured = statement.values.map(value => value && typeof value === 'object' ? { ...value } : value); return cursor([], []); } }) });
  const session = await provider.connect('oracle://owned/db', {}, signal);
  const value = { kind: 'datetime' as const, value: '2026-09-18T00:00:00.000001' };
  const querying = session.query('select :p1', [value], {}, signal);
  value.value = 'changed-by-caller';
  const result = await querying;
  assert.deepEqual(captured, [{ kind: 'datetime', value: '2026-09-18T00:00:00.000001' }]);
  await result.close(); await session.rollback(); await session.close();
});

test('reflection metadata failure follows the qualified error codec after cursor cleanup', async () => {
  const effects: string[] = [], failure = new Error('reflection metadata failed');
  const provider = createSqlTransportProvider({ profile: 'postgresql-positional-v1', authorize: async () => true,
    diagnostic: error => { assert.equal(error, failure); effects.push('diagnostic'); return new CsvkitDiagnostic('DriverError: reflected metadata failed'); },
    connect: async () => ({ ...connection([]), execute: async () => ({ get columns(): readonly string[] | null { throw failure; }, read: async () => null, cancel: async () => { effects.push('cancel'); }, close: async () => { effects.push('close'); } }) }) });
  const session = await provider.connect('postgresql://owned/db', {}, signal);
  await assert.rejects(session.hasTable!('items', null, signal), /DriverError: reflected metadata failed/);
  assert.deepEqual(effects, ['cancel', 'close', 'diagnostic']);
  await session.rollback(); await session.close();
});
