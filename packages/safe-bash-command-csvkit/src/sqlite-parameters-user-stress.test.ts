import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'vitest';
import init from '@sqlite.org/sqlite-wasm';
import { createSqliteDatabaseProvider } from './sqlite.js';
import { defaultLimits, execute } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import type { CsvkitContext } from './contracts.js';

const wasmBinary = await readFile(createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
const sqlite = await init({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof init>[0]);
const sql = 'INSERT INTO records (x, v) VALUES (?, ?)';
// Original SQLAlchemy 2.0.54 / SQLite 3.50.4 oracle specimens, independently
// captured in the isolated optional-profile campaign before this fix.
const cases = [
  { input: "x,v\n1,single'quote\\end\n", parameters: '(1, "single\'quote\\\\end")' },
  { input: 'x,v\n3,third\n1,duplicate\n', parameters: "[(3.0, 'third'), (1.0, 'duplicate')]" },
  { input: "x,v\n10,value0\n11,value1\n12,value2\n13,value3\n14,value4\n15,value5\n16,value6\n17,value7\n18,value8\n19,value9\n20,value10\n1,single'quote\\end\n",
    parameters: "[(10.0, 'value0'), (11.0, 'value1'), (12.0, 'value2'), (13.0, 'value3'), (14.0, 'value4'), (15.0, 'value5'), (16.0, 'value6'), (17.0, 'value7')  ... displaying 10 of 12 total bound parameter sets ...  (20.0, 'value10'), (1.0, \"single'quote\\\\end\")]" }
];

for (const specimen of cases) test(`SQLite original failed insert includes bound profile effects: ${specimen.parameters}`, async () => {
  const provider = createSqliteDatabaseProvider({ sqlite, cwd: '/', clock: { now: () => 0 }, random: bytes => bytes.fill(7) });
  const signal = new AbortController().signal;
  const session = await provider.connect('sqlite://', {}, signal);
  const cleanups: (() => Promise<void>)[] = [];
  let stdout = '', stderr = '';
  try {
    for (const setup of ['CREATE TABLE records (x FLOAT NOT NULL UNIQUE, v VARCHAR NOT NULL)', "INSERT INTO records VALUES (1.0, 'alpha'), (2.0, 'é')"])
      await (await session.query(setup, [], {}, signal)).close();
    await session.commit(signal);
    const context: CsvkitContext = {
      argv: new OwnedArguments(['-y', '0', '--db', 'sqlite://', '--insert', '--no-create', '--tables', 'records'].map(value => new TextEncoder().encode(value)), defaultLimits),
      cwd: '/', fs: { readFile: async () => assert.fail('unexpected read'), writeFile: async () => assert.fail('unexpected write') },
      stdin: (async function* () { yield new TextEncoder().encode(specimen.input); })(), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      env: {}, codecs: [utf8Codec], compression: [], databases: [{ ...provider, connect: async () => ({ ...session, close: async () => {} }) }],
      locale: { profile: 'C', timezone: 'UTC', formatNumber: String }, clock: { now: () => 0 },
      limits: defaultLimits, signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
    };
    const status = await execute('csvsql', context);
    await Promise.all(cleanups.map(cleanup => cleanup()));
    assert.deepEqual({ stdout, stderr, status }, { stdout: '', status: 1,
      stderr: `IntegrityError: (sqlite3.IntegrityError) UNIQUE constraint failed: records.x\n[SQL: ${sql}]\n[parameters: ${specimen.parameters}]\n(Background on this error at: https://sqlalche.me/e/20/gkpj)\n` });
    const result = await session.query('SELECT x,v FROM records ORDER BY x', [], {}, signal);
    const rows = []; for await (const row of result.rows) rows.push(row);
    await result.close();
    assert.deepEqual(rows, [[{ kind: 'float', value: '1.0' }, 'alpha'], [{ kind: 'float', value: '2.0' }, 'é']]);
  } finally { await session.close(); await provider.dispose(); }
});
