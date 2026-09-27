import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, CommandRegistry, commandRuntimeIdentity, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, createSqlite3Commands } from "./index.js";

test("sqlite3 factories cannot cross runtime registries", async () => {
  const foreign = await import(new URL("../../safe-bash-contracts/src/command.ts?sqlite3-foreign-runtime", import.meta.url).href) as typeof import("safe-bash-contracts");
  assert.notEqual(foreign.commandRuntimeIdentity, commandRuntimeIdentity);
  for (const command of [createSqlite3Command(), ...createSqlite3Commands()]) {
    assert.equal(new CommandRegistry([command]).has("sqlite3"), true);
    assert.throws(() => new foreign.CommandRegistry([command]), /matching shell runtime/);
  }
});

async function runSqlite3(
  fs: FileSystem,
  args: string[],
  stdinText = ""
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdin = createBytePipe();
  if (stdinText) {
    await writeText(stdin.writable, stdinText);
  }
  await stdin.close();

  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const cmd = createSqlite3Command();
  const res = await cmd.execute({
    command: "sqlite3",
    args: createCommandArguments(args).args,
    stdin: stdin.readable,
    stdout: stdout.writable,
    stderr: stderr.writable,
    fs,
    cwd: "/",
    env: {},
    signal: new AbortController().signal
  });
  await stdout.close();
  await stderr.close();

  const outChunks: Uint8Array[] = [];
  for await (const c of stdout.readable) outChunks.push(c);
  const errChunks: Uint8Array[] = [];
  for await (const c of stderr.readable) errChunks.push(c);

  return {
    code: res.exitCode,
    stdout: Buffer.concat(outChunks).toString("utf8"),
    stderr: Buffer.concat(errChunks).toString("utf8")
  };
}

test("sqlite3 persists genuine SQLite format 3 binary B-tree database files across invocations", async () => {
  const fs = createMemoryFileSystem();
  const res1 = await runSqlite3(fs, [
    "/app.db",
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, score INTEGER DEFAULT 10); INSERT INTO users (name, score) VALUES ('Alice', 95), ('Bob', 82);"
  ]);
  assert.equal(res1.code, 0, res1.stderr);

  const dbBytes = await fs.readFile("/app.db");
  const magic = new TextDecoder().decode(dbBytes.subarray(0, 16));
  assert.equal(magic, "SQLite format 3\0");
  assert.equal(dbBytes.byteLength % 4096, 0);

  const res2 = await runSqlite3(fs, ["-json", "/app.db", "SELECT id, name, score FROM users ORDER BY id;"]);
  assert.equal(res2.code, 0, res2.stderr);
  assert.deepEqual(JSON.parse(res2.stdout), [
    { id: 1, name: "Alice", score: 95 },
    { id: 2, name: "Bob", score: 82 }
  ]);
});

test("sqlite3 supports recursive CTEs, window functions, JSON functions, json_each, UPSERT, RETURNING, and triggers", async () => {
  const fs = createMemoryFileSystem();

  // Recursive CTE + Window functions
  const cteRes = await runSqlite3(fs, [
    ":memory:",
    `WITH RECURSIVE seq(n) AS (
       SELECT 1
       UNION ALL
       SELECT n + 1 FROM seq WHERE n < 5
     )
     SELECT n, SUM(n) OVER (ORDER BY n) AS running_sum, LAG(n, 1, 0) OVER (ORDER BY n) AS prev_n FROM seq;`
  ]);
  assert.equal(cteRes.code, 0, cteRes.stderr);
  assert.equal(cteRes.stdout, "1|1|0\n2|3|1\n3|6|2\n4|10|3\n5|15|4\n");

  // JSON functions & json_each
  const jsonRes = await runSqlite3(fs, [
    ":memory:",
    `SELECT key, value, json_extract('{"a":[10,20,30]}', '$.a[1]') AS second
     FROM json_each('{"x":100,"y":200}')
     ORDER BY key;`
  ]);
  assert.equal(jsonRes.code, 0, jsonRes.stderr);
  assert.equal(jsonRes.stdout, "x|100|20\ny|200|20\n");

  // UPSERT + RETURNING + Triggers
  const upsertRes = await runSqlite3(fs, [
    ":memory:",
    `CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER);
     CREATE TABLE audit (msg TEXT);
     CREATE TRIGGER tr_kv AFTER INSERT ON kv BEGIN INSERT INTO audit VALUES ('inserted:' || NEW.k); END;
     INSERT INTO kv VALUES ('a', 1), ('b', 2);
     INSERT INTO kv VALUES ('a', 10) ON CONFLICT(k) DO UPDATE SET v = kv.v + excluded.v RETURNING k, v;
     SELECT msg FROM audit ORDER BY rowid;`
  ]);
  assert.equal(upsertRes.code, 0, upsertRes.stderr);
  assert.equal(upsertRes.stdout, "a|11\ninserted:a\ninserted:b\n");
});

test("sqlite3 supports dot-commands (.mode, .headers, .tables, .schema, .dump, .import) and CSV/line/column formatting", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/items.csv", new TextEncoder().encode("code,qty\nA1,5\nB2,12\n"));

  const script = [
    ".mode csv",
    ".import /items.csv items",
    ".headers on",
    ".mode list",
    ".separator |",
    "SELECT code, CAST(qty AS INTEGER) * 2 AS doubled FROM items ORDER BY code;",
    ".tables"
  ].join("\n");

  const res = await runSqlite3(fs, ["/store.db"], script);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, "code|doubled\nA1|10\nB2|24\nitems\n");

  const dumpRes = await runSqlite3(fs, ["/store.db", ".dump"]);
  assert.equal(dumpRes.code, 0, dumpRes.stderr);
  assert.match(dumpRes.stdout, /CREATE TABLE "items"/);
  assert.match(dumpRes.stdout, /INSERT INTO items VALUES\('A1','5'\);/);
});

test("sqlite3 supports INSERT INTO ... WITH RECURSIVE and CREATE TABLE ... AS WITH", async () => {
  const fs = createMemoryFileSystem();
  const res = await runSqlite3(fs, [
    ":memory:",
    `CREATE TABLE nums (n INTEGER, label TEXT);
     INSERT INTO nums WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM seq WHERE x < 5) SELECT x, 'n-' || x FROM seq;
     CREATE TABLE summary AS WITH totals(cnt, s) AS (SELECT COUNT(*), SUM(n) FROM nums) SELECT cnt, s FROM totals;
     SELECT * FROM nums ORDER BY n;
     SELECT * FROM summary;`
  ]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, "1|n-1\n2|n-2\n3|n-3\n4|n-4\n5|n-5\n5|15\n");
});

test("sqlite3 matches native /usr/bin/sqlite3 for COALESCE/IFNULL/IIF projections, ROUND/TOTAL REAL formatting, QUOTE(blob) uppercase, and -html output", async () => {
  const fs = createMemoryFileSystem();
  const sql = [
    "SELECT COALESCE(NULL, NULL, 'fallback'), IFNULL(NULL, 99), IIF(1 > 0, 'yes', 'no'), IIF(0, 'yes', 'no'), IIF(NULL, 'yes', 'no');",
    "SELECT QUOTE(NULL), QUOTE(42), QUOTE(3.14), QUOTE('it''s'), QUOTE(X'deadbeef');",
    "SELECT ROUND(3.14159, 2), ROUND(3.5), ROUND(-3.5), typeof(ROUND(3.5));",
    "CREATE TABLE empty_t(x INT); SELECT TOTAL(x), typeof(TOTAL(x)) FROM empty_t;",
  ].join(" ");
  const r1 = await runSqlite3(fs, [":memory:", sql]);
  assert.equal(r1.code, 0, r1.stderr);
  assert.equal(
    r1.stdout,
    [
      "fallback|99|yes|no|no",
      "NULL|42|3.14|'it''s'|X'DEADBEEF'",
      "3.14|4.0|-4.0|real",
      "0.0|real",
      "",
    ].join("\n")
  );

  const rHtml = await runSqlite3(fs, ["-html", "-header", ":memory:", "SELECT 1 AS id, 'alice' AS name;"]);
  assert.equal(rHtml.code, 0, rHtml.stderr);
  assert.equal(rHtml.stdout, "<TR><TH>id</TH>\n<TH>name</TH>\n</TR>\n<TR><TD>1</TD>\n<TD>alice</TD>\n</TR>\n");

  const rModeSwitch = await runSqlite3(fs, [":memory:", ".mode csv", "SELECT 1, 2;", ".mode list", "SELECT 3, 4;"]);
  assert.equal(rModeSwitch.code, 0, rModeSwitch.stderr);
  assert.equal(rModeSwitch.stdout, "1,2\n3|4\n");

  const rColNoHeader = await runSqlite3(fs, ["-column", ":memory:", "SELECT 3779 AS number, 'open' AS state, 1 AS version;"]);
  assert.equal(rColNoHeader.code, 0, rColNoHeader.stderr);
  assert.equal(rColNoHeader.stdout, "3779    open   1      \n");

  const rColHeader = await runSqlite3(fs, ["-column", "-header", ":memory:", "SELECT 3779 AS number, 'open' AS state, 1 AS version;"]);
  assert.equal(rColHeader.code, 0, rColHeader.stderr);
  assert.equal(rColHeader.stdout, "number  state  version\n------  -----  -------\n3779    open   1      \n");

  const rTablesGrid = await runSqlite3(fs, [
    ":memory:",
    "CREATE TABLE agents(x); CREATE TABLE comments(x); CREATE TABLE issue_status_updates(x); CREATE TABLE issues(x); CREATE TABLE projects(x);",
    ".tables"
  ]);
  assert.equal(rTablesGrid.code, 0, rTablesGrid.stderr);
  assert.equal(
    rTablesGrid.stdout,
    "agents                issue_status_updates  projects            \ncomments              issues              \n"
  );
});

test("sqlite3 supports Cloudflare Durable Object SqlStorage (ctx.storage.sql) and D1Database (env.DB) engine injection with VFS binary B-tree bridge", async () => {
  const { SqliteDatabase } = await import("./engine.js");
  const fs = createMemoryFileSystem();

  // First create a binary SQLite file in VFS using the default engine
  const seedRes = await runSqlite3(fs, [
    "/hey-boss.db",
    "CREATE TABLE issues(number INT PRIMARY KEY, state TEXT, title TEXT); CREATE INDEX idx_issues_state ON issues(state); INSERT INTO issues VALUES (3781, 'closed', 'B-tree reserved space'), (3783, 'open', 'Cloudflare SqlStorage injection');"
  ]);
  assert.equal(seedRes.code, 0, seedRes.stderr);

  // Simulate Cloudflare Durable Object ctx.storage.sql (only exposes exec(sql, ...bindings) -> SqlStorageCursor)
  const backingDoDb = new SqliteDatabase();
  const cloudflareDoSqlStorage = {
    exec(query: string) {
      const sets = backingDoDb.exec(query);
      const last = sets[sets.length - 1];
      const columnNames = last?.columns ?? [];
      const rawRows = last?.rows ?? [];
      return {
        columnNames,
        *raw() {
          for (const r of rawRows) {
            yield r;
          }
        },
        toArray() {
          return rawRows.map((r) => Object.fromEntries(columnNames.map((c, idx) => [c, r[idx]])));
        }
      };
    }
  };

  const cmdDo = createSqlite3Command({ engine: () => cloudflareDoSqlStorage });
  const pipeOut = createBytePipe();
  const pipeErr = createBytePipe();
  const resDo = await cmdDo.execute({
    command: "sqlite3",
    args: createCommandArguments([
      "/hey-boss.db",
      "UPDATE issues SET state = 'closed' WHERE number = 3783;",
      "SELECT number, state, title FROM issues ORDER BY number;",
      ".indexes",
      ".dump"
    ]).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: pipeOut.writable,
    stderr: pipeErr.writable,
    signal: new AbortController().signal
  });
  await pipeOut.close();
  await pipeErr.close();
  const outDo = Buffer.from(await collectBytes(pipeOut.readable, { maxBytes: 1_000_000 })).toString("utf8");
  assert.equal(resDo.exitCode, 0);
  assert.match(outDo, /3781\|closed\|B-tree reserved space\n3783\|closed\|Cloudflare SqlStorage injection/);
  assert.match(outDo, /idx_issues_state/);
  assert.match(outDo, /INSERT INTO issues VALUES\(3783,'closed','Cloudflare SqlStorage injection'\);/);

  // Verify the updated database was persisted back to VFS as a valid SQLite format 3 binary file
  const verifySaved = await runSqlite3(fs, ["/hey-boss.db", "SELECT number, state FROM issues ORDER BY number;"]);
  assert.equal(verifySaved.code, 0, verifySaved.stderr);
  assert.equal(verifySaved.stdout, "3781|closed\n3783|closed\n");

  // Simulate Cloudflare D1 (env.DB with prepare(sql).bind(...).raw({ columnNames: true }) / run())
  const backingD1Db = new SqliteDatabase();
  const cloudflareD1 = {
    prepare(query: string) {
      let bound: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          bound = values;
          return this;
        },
        async raw(opts?: { columnNames?: boolean }) {
          const sets = backingD1Db.exec(query, bound as any);
          const last = sets[sets.length - 1];
          if (!last || last.columns.length === 0) return [];
          return opts?.columnNames ? [last.columns, ...last.rows] : last.rows;
        },
        async run() {
          backingD1Db.exec(query, bound as any);
          return { success: true };
        }
      };
    }
  };
  const cmdD1 = createSqlite3Command({ engine: cloudflareD1 });
  const d1Out = createBytePipe();
  const d1Err = createBytePipe();
  const resD1 = await cmdD1.execute({
    command: "sqlite3",
    args: createCommandArguments(["/hey-boss.db", "SELECT COUNT(*), MIN(number), MAX(number) FROM issues;"]).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: d1Out.writable,
    stderr: d1Err.writable,
    signal: new AbortController().signal
  });
  await d1Out.close();
  await d1Err.close();
  const outD1Text = Buffer.from(await collectBytes(d1Out.readable, { maxBytes: 1_000_000 })).toString("utf8");
  assert.equal(resD1.exitCode, 0);
  assert.equal(outD1Text, "2|3781|3783\n");
});


test("sqlite3 rejects missing columns and supports double-quoted string fallback", async () => {
  for (const sql of ["SELECT no_such_col;", "CREATE TABLE t(a INT); SELECT no_such_col FROM t;", "SELECT CASE WHEN 0 THEN no_such_col END;", "CREATE TABLE t(a INT); INSERT INTO t VALUES (NULL); SELECT other.a FROM t;", "SELECT [missing];", "SELECT `missing`;", "CREATE TABLE t(a INT); INSERT INTO t VALUES (1); SELECT no_such_col FROM t;"]) {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql]);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("Error: in prepare, no such column:"), result.stderr);
  }
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", 'CREATE TABLE t(a INT); INSERT INTO t VALUES (1); SELECT "a", "hello", CASE 1 WHEN 1 THEN "matched" END FROM t;']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "1|hello|matched\n");
});

test("sqlite3 preserves REAL expression types and JSON numeric representation", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT 4.0, typeof(4.0), CAST(4 AS REAL), typeof(CAST(4 AS REAL)), ROUND(3.5) + 1, typeof(ROUND(3.5) + 1), AVG(x), typeof(AVG(x)) FROM (SELECT 2 AS x UNION ALL SELECT 4 AS x);"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "4.0|real|4.0|real|5.0|real|3.0|real\n");
  const json = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", "SELECT ROUND(3.5) AS r, TOTAL(x) AS t FROM (SELECT 1 AS x);"]);
  assert.equal(json.stdout, '[{"r":4.0,"t":1.0}]\n');
});


test("sqlite3 REAL arithmetic preserves affinity without changing integer division", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT -4.0, +4.0, 4e0, 0xFE, 4.0-1, 4.0*2, 4.0/2, 4.0%3, 5/2, 5.0/2;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "-4.0|4.0|4.0|254|3.0|8.0|2.0|1.0|2|2.5\n");
});

for (const [name, sql, expected] of [
  ['SUM preserves REAL', 'CREATE TABLE r(x REAL); INSERT INTO r VALUES (1.0),(2.0); SELECT SUM(x),typeof(SUM(x)) FROM r;', '3.0|real\n'],
  ['ABS preserves REAL', 'SELECT ABS(-4.0),typeof(ABS(-4.0)),typeof(ABS(-4));', '4.0|real|integer\n'],
  ['JSON preserves REAL', `SELECT json_array(4.0,4),json_object('r',4.0,'i',4);`, '[4.0,4]|{"r":4.0,"i":4}\n'],
  ['INSERT applies REAL affinity', `CREATE TABLE r(x REAL,y FLOAT,z DOUBLE); INSERT INTO r VALUES (4,'5',6); SELECT x,typeof(x),y,typeof(y),z,typeof(z) FROM r;`, '4.0|real|5.0|real|6.0|real\n'],
  ['unqualified correlated columns', 'CREATE TABLE a(outer_id INT); CREATE TABLE b(aid INT,score INT); INSERT INTO a VALUES (1),(2); INSERT INTO b VALUES (1,99),(2,88); SELECT (SELECT score FROM b WHERE aid=outer_id) FROM a;', '99\n88\n'],
  ['inner columns shadow outer columns', 'CREATE TABLE a(id INT); CREATE TABLE b(id INT); INSERT INTO a VALUES (1); INSERT INTO b VALUES (2); SELECT (SELECT id FROM b), (SELECT a.id FROM b), (SELECT \'a.id\' FROM b) FROM a;', '2|1|a.id\n'],
] as const) {
  test(`sqlite3 ${name}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [':memory:', sql]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}

test('sqlite3 validates JOIN ON identifiers before visiting rows', async () => {
  for (const join of ['JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN']) {
    const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE a(id INT); CREATE TABLE b(id INT); SELECT * FROM a ${join} b ON a.id=b.no_such_col;`]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no such column: b.no_such_col/);
  }
});


test('sqlite3 resolves nested, EXISTS, and IN correlations', async () => {
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, [':memory:', `CREATE TABLE a(outer_id INT); CREATE TABLE b(aid INT); INSERT INTO a VALUES (1),(2); INSERT INTO b VALUES (1); SELECT outer_id,EXISTS(SELECT aid FROM b WHERE aid=outer_id),outer_id IN (SELECT aid FROM b WHERE aid=outer_id),(SELECT (SELECT outer_id) FROM b) FROM a;`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '1|1|1|1\n2|0|0|2\n');
});

test('sqlite3 REAL affinity survives persistence and preserves nonnumeric values', async () => {
  const fs = createMemoryFileSystem();
  const inserted = await runSqlite3(fs, ['/real.db', `CREATE TABLE r(x REAL); INSERT INTO r VALUES (4),(NULL),('text');`]);
  assert.equal(inserted.code, 0, inserted.stderr);
  const result = await runSqlite3(fs, ['/real.db', 'SELECT x,typeof(x) FROM r;']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '4.0|real\n|null\ntext|text\n');
});

test('sqlite3 JSON aggregates preserve REAL numbers and escaped strings', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE r(x REAL); INSERT INTO r VALUES (4),(5); SELECT json_group_array(x),json_group_object('r',x) FROM r; SELECT json_array('quote"',NULL,4.5);`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '[4.0,5.0]|{"r":5.0}\n["quote\\"",null,4.5]\n');
});


test('sqlite3 emits valid JSON for exponential REAL numbers', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', 'SELECT json_array(1e21,1e-20);']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [1e21, 1e-20]);
});
