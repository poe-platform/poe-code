import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {withPrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement, type SqliteColumn} from './sqlite-statement.js';
import {createLlmHistorySchema} from './history-schema.js';

test('matches the complete llm 0.27.1 history catalog and migration ledger', async () => {
  const reference = JSON.parse(await readFile(new URL('./fixtures/history-schema-0.27.1.json', import.meta.url), 'utf8')) as {version: string; catalog: unknown[][]; migrations: string[]};
  assert.equal(reference.version, '0.27.1');
  const fs = new MemoryFileSystem(); await fs.mkdir('/private');
  const signal = new AbortController().signal;
  await withPrivateSqliteSession({fs, directory: '/private', path: '/private/logs.db', signal, maxOpenFiles: 8, maxFileBytes: 1048576}, async session => {
    const appliedAt = '2026-10-01 00:00:00+00:00';
    await createLlmHistorySchema(session, signal, appliedAt);
    const query = async (sql: string, columns: SqliteColumn[]) => withSqliteStatement(session.module, {...session, signal, sql}, async statement => {
      const rows = []; for await (const row of statement.rows([], columns)) rows.push(row); return rows;
    });
    assert.deepEqual(await query('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name', ['text','text','text','text']), reference.catalog);
    assert.deepEqual(await query('SELECT name,applied_at FROM _llm_migrations ORDER BY rowid', ['text','text']), reference.migrations.map(name => [name, appliedAt]));
    assert.deepEqual(await query('PRAGMA integrity_check', ['text']), [['ok']]);
    assert.deepEqual(await query('PRAGMA foreign_key_check', ['text','integer','text','integer']), []);
    await session.execute("INSERT INTO conversations(id,name,model) VALUES ('c','demo','test'); INSERT INTO responses(id,prompt,response,conversation_id) VALUES ('r','apples','oranges','c');");
    assert.deepEqual(await query("SELECT responses.id FROM responses JOIN responses_fts ON responses.rowid=responses_fts.rowid WHERE responses_fts MATCH 'oranges'", ['text']), [['r']]);
    await session.execute("UPDATE responses SET response='pears' WHERE id='r';");
    assert.deepEqual(await query("SELECT rowid FROM responses_fts WHERE responses_fts MATCH 'oranges'", ['integer']), []);
    await session.execute("DELETE FROM responses WHERE id='r';");
    assert.deepEqual(await query("SELECT rowid FROM responses_fts WHERE responses_fts MATCH 'pears'", ['integer']), []);
  });
});

test('failed initialization preserves an existing private database', async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir('/private');
  const signal = new AbortController().signal;
  const options = {fs, directory: '/private', path: '/private/logs.db', signal, maxOpenFiles: 8, maxFileBytes: 1048576};
  await assert.rejects(withPrivateSqliteSession(options, async session => {
    await session.execute("CREATE TABLE sentinel(value); INSERT INTO sentinel VALUES (42); CREATE TABLE responses(custom);");
    await createLlmHistorySchema(session, signal, '2026-10-01 00:00:00+00:00');
  }), {code: 'EIO'});
  await withPrivateSqliteSession(options, async session => {
    await withSqliteStatement(session.module, {...session, signal, sql: 'SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name'}, async statement => {
      const names = []; for await (const row of statement.rows([], ['text'])) names.push(row[0]);
      assert.deepEqual(names, ['responses', 'sentinel']);
    });
    await withSqliteStatement(session.module, {...session, signal, sql: 'SELECT value FROM sentinel'}, async statement => {
      const values = []; for await (const row of statement.rows([], ['integer'])) values.push(row[0]);
      assert.deepEqual(values, [42n]);
    });
  });
});
