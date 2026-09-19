import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { floatText } from './operations/json-table.js';
import { CsvkitDiagnostic } from './errors.js';
import { execute, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import type { CsvkitContext, DatabaseCell, DatabaseProvider } from './contracts.js';
import reference from '../../../docs/csvkit/csvsql-reference.json' with { type: 'json' };

/** Fast, explicitly injected in-memory driver; no host file, process or service. */
for (const [index, item] of reference.cases.entries()) {
  if (!item.argv.includes('--query')) continue;
  test(`csvsql SQLite differential stdout/stderr/status and database effects ${index}`, async () => {
    const db = new DatabaseSync(':memory:'); const effects: string[] = []; const cleanups: (() => Promise<void>)[] = [];
    let stdout = '', stderr = '';
    const provider: DatabaseProvider = { schemes: ['sqlite'], profile: 'test-only-node-sqlite', connect: async () => ({
      profile: 'test-only-node-sqlite', begin: async () => { db.exec('BEGIN'); effects.push('begin'); },
      commit: async () => { db.exec('COMMIT'); effects.push('commit'); },
      rollback: async () => { db.exec('ROLLBACK'); effects.push('rollback'); }, close: async () => { effects.push('close'); },
      query: async (sql, values) => {
        try {
        const stmt = db.prepare(sql); stmt.setReturnArrays(true); stmt.setReadBigInts(true);
        const columns = stmt.columns().map(column => column.name);
        let rows: DatabaseCell[][] = [];
        if (columns.length) rows = (stmt.all(...values as SQLInputValue[]) as unknown as (readonly (string | number | bigint | null)[])[]).map(row => row.map(value =>
          typeof value === 'number' ? { kind: 'float', value: floatText(value) } : value));
        else stmt.run(...values as SQLInputValue[]);
        return { columns: columns.length ? columns : null, rows: (async function* () { yield* rows; })(), close: async () => {} };
        } catch (error) {
          // The explicitly injected oracle adapter supplies the frozen SQLAlchemy
          // diagnostic profile; this formatter is not a product driver/fallback.
          if (!error || typeof error !== 'object' || !('errcode' in error)) throw error;
          const integrity = (Number(error.errcode) & 255) === 19;
          const kind = integrity ? 'IntegrityError' : 'OperationalError';
          const detail = error instanceof Error ? error.message : String(error);
          throw new CsvkitDiagnostic(`${kind}: (sqlite3.${kind}) ${detail}\n[SQL: ${sql}]\n(Background on this error at: https://sqlalche.me/e/20/${integrity ? 'gkpj' : 'e3q8'})`);
        }
      }
    }) };
    const context: CsvkitContext = {
      argv: new OwnedArguments(item.argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: '/',
      fs: { readFile: async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }, writeFile: async () => { assert.fail('file write'); } },
      stdin: (async function* () { yield new TextEncoder().encode(item.stdin); })(), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout += new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      env: {}, codecs: [utf8Codec], compression: [], databases: [provider], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
      clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
    };
    try {
      const status = await execute('csvsql', context);
      assert.deepEqual({ stdout, stderr, status }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
      if (status === 0) {
        assert.deepEqual(effects, ['begin', 'commit', 'close']);
        if (item.stdin) assert.deepEqual(db.prepare('SELECT a FROM stdin').all().map(row => row.a), 'sqliteRows' in item ? item.sqliteRows : ['x', 'y']);
      } else if (status === 2) {
        assert.deepEqual(effects, []);
      } else {
        assert.deepEqual(effects, ['begin', 'rollback', 'close']);
        assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='stdin'").get()!.n, 0);
      }
      await Promise.all(cleanups.map(cleanup => cleanup())); assert.equal(effects.filter(effect => effect === 'close').length, status === 2 ? 0 : 1);
    } finally { db.close(); }
  });
}
