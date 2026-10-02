import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import reference from './fixtures/history-migrations-0.27.1.json' with { type: 'json' };
import { migrateLlmHistorySchema } from './history-migrations.js';
import { transactSqlite } from './sqlite-transaction.js';
import { withSqliteStatement, type SqliteBinding, type SqliteColumn } from './sqlite-statement.js';

test('all pinned historical migrations preserve data and match final table contracts', async () => {
  assert.equal(reference.version, '0.27.1');
  for (const fixture of reference.cases) {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/logs.db', inflateSync(Buffer.from(fixture.databaseZlib, 'base64')));
    const signal = new AbortController().signal;
    await transactSqlite({ fs, path: '/logs.db', signal, maxFileBytes: 2097152, maxIndexBytes: 2097152, maxOpenFiles: 8 }, async session => {
      const query = (sql: string, types: SqliteColumn[], bindings: SqliteBinding[] = []) => withSqliteStatement(session.module, { ...session, signal, sql }, async statement => {
        const rows: SqliteBinding[][] = []; for await (const row of statement.rows(bindings, types)) rows.push(row); return rows;
      });
      await migrateLlmHistorySchema(session, signal, '2026-10-02');
      await migrateLlmHistorySchema(session, signal, '2026-10-03');
      assert.deepEqual(await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'responses_fts%' ORDER BY name", ['text']), Object.keys(reference.catalogs[fixture.catalog]!).map(name => [name]), `stage ${fixture.stage}`);
      for (const [table, expected] of Object.entries(reference.catalogs[fixture.catalog]!)) {
        const columns = await query('SELECT cid,name,type,"notnull",coalesce(dflt_value,\'\'),pk FROM pragma_table_info(?)', ['integer','text','text','integer','text','integer'], [table]);
        const normalized = expected.columns.map(row => row.map((value, index) => [0,3,5].includes(index) ? BigInt(value as number) : value ?? ''));
        assert.deepEqual(columns, normalized, `${fixture.stage}: ${table}`);
        const foreign = await query('SELECT "table","from",coalesce("to",\'\'),on_update,on_delete,match FROM pragma_foreign_key_list(?)', ['text','text','text','text','text','text'], [table]);
        foreign.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const expectedForeign = [...expected.foreignKeys].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        assert.deepEqual(foreign, expectedForeign, `${fixture.stage}: ${table} foreign keys`);
      }
      assert.deepEqual(await query('SELECT name FROM _llm_migrations ORDER BY rowid', ['text']), reference.migrationNames.map(name => [name]));
      assert.deepEqual(await query('SELECT applied_at FROM _llm_migrations ORDER BY rowid', ['text']), reference.migrationNames.map((_name,index) => [index < fixture.stage ? '2020-01-01' : '2026-10-02']));
      assert.deepEqual(await query('SELECT value FROM unrelated', ['text']), [['untouched']]);
      if (fixture.stage >= 12) assert.deepEqual(await query('SELECT prompt,response FROM responses', ['text','text']), [['apples','oranges']]);
      else if (fixture.stage > 0 && fixture.stage < 11) assert.deepEqual(await query('SELECT prompt,response FROM logs', ['text','text']), [['legacy','retained']]);
      if (fixture.stage >= 12) assert.deepEqual(await query("SELECT rowid FROM responses_fts WHERE responses_fts MATCH 'oranges'", ['integer']), [[1n]]);
      assert.deepEqual(await query('PRAGMA integrity_check', ['text']), [['ok']]);
    });
  }
});

test('legacy rewrites retain custom columns, indexed values and large blobs', async () => {
  const fs = new MemoryFileSystem();
  const fixture = reference.cases[2]!;
  await fs.writeFile('/logs.db', inflateSync(Buffer.from(fixture.databaseZlib, 'base64')));
  const signal = new AbortController().signal;
  await transactSqlite({ fs, path: '/logs.db', signal, maxFileBytes: 2097152, maxIndexBytes: 2097152, maxOpenFiles: 8 }, async session => {
    await session.execute('ALTER TABLE log ADD COLUMN constructor TEXT DEFAULT \'extra\'; ALTER TABLE log ADD COLUMN payload BLOB; UPDATE log SET payload=zeroblob(131072); CREATE INDEX custom_index ON log(constructor);');
    await migrateLlmHistorySchema(session, signal, '2026-10-02');
    await withSqliteStatement(session.module, { ...session, signal, sql: 'SELECT constructor,length(payload) FROM logs' }, async statement => {
      const rows = []; for await (const row of statement.rows([], ['text','integer'])) rows.push(row);
      assert.deepEqual(rows, [['extra', 131072n]]);
    });
    await withSqliteStatement(session.module, { ...session, signal, sql: "SELECT tbl_name FROM sqlite_master WHERE name='custom_index'" }, async statement => {
      const rows = []; for await (const row of statement.rows([], ['text'])) rows.push(row);
      assert.deepEqual(rows, [['logs']]);
    });
  });
});

for (const cancel of [false, true]) test(`migration ${cancel ? 'cancellation' : 'failure'} preserves canonical bytes and cleanup`, async () => {
  const fs = new MemoryFileSystem();
  const original = new Uint8Array(inflateSync(Buffer.from(reference.cases[0]!.databaseZlib, 'base64')));
  await fs.writeFile('/logs.db', original);
  const controller = new AbortController();
  const signal = controller.signal;
  await assert.rejects(transactSqlite({ fs, path: '/logs.db', signal, maxFileBytes: 2097152, maxIndexBytes: 2097152, maxOpenFiles: 8 }, async session => {
    let executed = 0;
    await migrateLlmHistorySchema({ ...session, async execute(sql) {
      if (++executed === 8) {
        if (cancel) controller.abort(new Error('cancel migration'));
        else throw new Error('migration IO failed');
      }
      await session.execute(sql);
    } }, signal, '2026-10-02');
  }));
  assert.deepEqual(await fs.readFile('/logs.db'), original);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['logs.db']);
});
