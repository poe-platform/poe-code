import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

const setup = `CREATE TABLE a(dep TEXT,leftpos INTEGER);
  INSERT INTO a VALUES ('@poe-code/safe-fs',1),('safe-bash-contracts',2),
    ('safe-bash-query-engine',3),('safe-bash-byte-engine',4),('safe-bash-io-engine',5);
  CREATE TABLE b(dep TEXT,rightpos INTEGER);
  INSERT INTO b VALUES ('safe-bash-contracts',1),('safe-bash-regex-engine',2),('@poe-code/safe-fs',3);`;

for (const [query, expected] of [
  ['SELECT * FROM a LEFT JOIN (SELECT dep,dep FROM b) q USING(dep) ORDER BY dep',
    'dep|leftpos|dep:1\n@poe-code/safe-fs|1|@poe-code/safe-fs\nsafe-bash-byte-engine|4|NULL\nsafe-bash-contracts|2|safe-bash-contracts\nsafe-bash-io-engine|5|NULL\nsafe-bash-query-engine|3|NULL\n'],
  ['SELECT q."dep:1" FROM (SELECT a.dep,b.dep FROM a JOIN b USING(dep)) q ORDER BY 1',
    'dep:1\n@poe-code/safe-fs\nsafe-bash-contracts\n']
] as const) {
  test(`derived duplicate columns through async and sync commands: ${query}`, async () => {
    const args = ['-header', '-nullvalue', 'NULL', ':memory:', setup, query];
    let stdout = '', stderr = '';
    const result = await createSqlite3Command().execute({
      command: 'sqlite3', ...createCommandArguments(args),
      fs: createMemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout, expected);
    assert.equal(evalSyncSqlite3(undefined, args), expected);
  });
}

for (const [projection, columns] of [
  ['1 AS dep, 2 AS dep, 3 AS dep', ['dep', 'dep:1', 'dep:2']],
  ['1 AS dep, 2 AS DEP, 3 AS dep', ['dep', 'DEP:1', 'dep:2']],
  ['1 AS dep, 2 AS "dep:1", 3 AS dep', ['dep', 'dep:1', 'dep:2']],
  ['1 AS dep, 2 AS dep, 3 AS "dep:1"', ['dep', 'dep:1', 'dep:2']],
  ['1 AS "dep:9", 2 AS "dep:9", 3 AS "dep:1"', ['dep:9', 'dep:1', 'dep:2']]
] as const) {
  test(`derived column names preserve separate values: ${projection}`, () => {
    const db = new SqliteDatabase();
    for (const suffix of ['', ' WHERE 0']) {
      const result = db.exec(`SELECT * FROM (SELECT ${projection}${suffix}) q`)[0]!;
      assert.deepEqual(result.columns, columns);
      assert.deepEqual(result.rows, suffix ? [] : [[1, 2, 3]]);
    }
  });
}

test('direct projections keep duplicate column headers', () => {
  assert.deepEqual(new SqliteDatabase().exec('SELECT 1 AS dep, 2 AS dep')[0], {
    columns: ['dep', 'dep'], rows: [[1, 2]]
  });
});
