import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Volume } from 'memfs';
import { test } from 'vitest';
import init from '@sqlite.org/sqlite-wasm';
import { createSqliteDatabaseProvider } from './sqlite.js';
import { createMemorySqliteFileSystem } from './sqlite-memory.js';
import { defaultLimits, execute } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import type { CsvkitContext, DatabaseSession } from './contracts.js';

const wasmBinary = await readFile(createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
const sqlite = await init({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof init>[0]);
const signal = new AbortController().signal;
async function query(session: DatabaseSession, sql: string) {
  const result = await session.query(sql, [], {}, signal);
  try { const rows = []; for await (const row of result.rows) rows.push(row); return rows; }
  finally { await result.close(); }
}

for (const duplicate of [false, true]) test(`pysqlite legacy logical begin preserves independent DDL effects: duplicate=${duplicate}`, async () => {
  const volume = Volume.fromJSON({ '/db/.keep': '' });
  const provider = createSqliteDatabaseProvider({ sqlite, cwd: '/db', clock: { now: () => 0 }, random: bytes => bytes.fill(7),
    vfs: createMemorySqliteFileSystem(volume, { authorize: path => path.startsWith('/db/'), maxBytes: 1_000_000 }) });
  let stdout = '', stderr = '';
  const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(['-y', '0', '--db', 'sqlite:///ddl.db', '--insert', '--tables', 'newrecords', '--unique-constraint', 'x'].map(value => new TextEncoder().encode(value)), defaultLimits),
    cwd: '/db', fs: { readFile: async () => assert.fail('unexpected read'), writeFile: async () => assert.fail('unexpected write') },
    stdin: (async function* () { yield new TextEncoder().encode(`x,v\n3,first\n${duplicate ? '3,duplicate' : '4,second'}\n`); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [provider],
    locale: { profile: 'C', timezone: 'UTC', formatNumber: String }, clock: { now: () => 0 },
    limits: defaultLimits, signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  try {
    const status = await execute('csvsql', context);
    await Promise.all(cleanups.map(cleanup => cleanup()));
    assert.deepEqual({ stdout, stderr, status }, { stdout: '', status: duplicate ? 1 : 0,
      stderr: duplicate ? "IntegrityError: (sqlite3.IntegrityError) UNIQUE constraint failed: newrecords.x\n[SQL: INSERT INTO newrecords (x, v) VALUES (?, ?)]\n[parameters: [(3.0, 'first'), (3.0, 'duplicate')]]\n(Background on this error at: https://sqlalche.me/e/20/gkpj)\n" : '' });
    const session = await provider.connect('sqlite:///ddl.db', {}, signal);
    try {
      assert.deepEqual(await query(session, 'SELECT name,sql FROM sqlite_master ORDER BY name'), [
        ['newrecords', 'CREATE TABLE newrecords (\n\tx FLOAT NOT NULL, \n\tv VARCHAR NOT NULL, \n\tUNIQUE (x)\n)'],
        ['sqlite_autoindex_newrecords_1', null]
      ]);
      assert.deepEqual(await query(session, 'SELECT x,v FROM newrecords ORDER BY x'), duplicate ? [] : [
        [{ kind: 'float', value: '3.0' }, 'first'], [{ kind: 'float', value: '4.0' }, 'second']
      ]);
    } finally { await session.close(); }
    const bytes = volume.readFileSync('/db/ddl.db') as Buffer;
    assert.equal(bytes.readUInt32BE(24), duplicate ? 1 : 2, 'physical DDL and DML commits retain native SQLite change-counter effects');
    assert.equal(volume.existsSync('/db/ddl.db-journal'), false);
  } finally { await provider.dispose(); }
});

test('explicit SQL BEGIN remains physical and rolls back DDL', async () => {
  const provider = createSqliteDatabaseProvider({ sqlite, cwd: '/', clock: { now: () => 0 }, random: bytes => bytes.fill(7) });
  const session = await provider.connect('sqlite://', {}, signal);
  try {
    await query(session, 'BEGIN');
    await query(session, 'CREATE TABLE explicitly_owned(x)');
    await session.rollback();
    assert.deepEqual(await query(session, "SELECT name FROM sqlite_master WHERE name='explicitly_owned'"), []);
  } finally { await session.close(); await provider.dispose(); }
});
