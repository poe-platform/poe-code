import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, CommandRegistry, commandRuntimeIdentity, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, createSqlite3Commands, evalSyncSqlite3, settings, type Sqlite3CommandsOptions } from "./index.js";

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
  stdinText = "",
  options: Sqlite3CommandsOptions = {},
  signal = new AbortController().signal
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdin = createBytePipe();
  if (stdinText) {
    await writeText(stdin.writable, stdinText);
  }
  await stdin.close();

  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const output = collectBytes(stdout.readable, { maxBytes: Infinity });
  const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
  const cmd = createSqlite3Command(options);
  let res;
  try { res = await cmd.execute({
    command: "sqlite3",
    args: createCommandArguments(args).args,
    stdin: stdin.readable,
    stdout: stdout.writable,
    stderr: stderr.writable,
    fs,
    cwd: "/",
    env: {},
    signal
  }); } finally { await stdout.close(); await stderr.close(); }
  const [outBytes, errBytes] = await Promise.all([output, errors]);
  return {
    code: res.exitCode,
    stdout: Buffer.from(outBytes).toString("utf8"),
    stderr: Buffer.from(errBytes).toString("utf8")
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
  assert.equal(rModeSwitch.stdout, "1,2\r\n3|4\n");

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
  assert.equal(result.stdout, '[4.0,5.0]|{"r":4.0,"r":5.0}\n["quote\\"",null,4.5]\n');
});


test('sqlite3 emits valid JSON for exponential REAL numbers', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', 'SELECT json_array(1e21,1e-20);']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [1e21, 1e-20]);
});

test("sqlite3 settings disable all resource ceilings by default", () => {
  assert.deepEqual(settings.limits, { maxInputBytes: Infinity, maxOutputBytes: Infinity, maxRows: Infinity });
});

for (const operation of ["INSERT", "UPDATE", "UPSERT"]) {
  test(`sqlite3 applies column affinities on ${operation}`, async () => {
    for (const [values, expected] of [
      ["'42', 42, '42.0', '42'", "42|integer|42|text|42|integer|42.0|real\n"],
      ["42.0, 42.5, 42.0, 7", "42|integer|42.5|text|42|integer|7.0|real\n"],
      ["'42.5', 'hello', '42.5', 'hello'", "42.5|real|hello|text|42.5|real|hello|text\n"],
      ["NULL, x'4142', '0x10', NULL", "|null|AB|blob|0x10|text||null\n"]
    ] as const) {
      const assignments = values.split(", ").map((value, index) => `${["i", "s", "n", "r"][index]} = ${value}`).join(", ");
      const write = operation === "INSERT" ? `INSERT INTO t VALUES (1, ${values});`
        : operation === "UPDATE" ? `INSERT INTO t VALUES (1, NULL, NULL, NULL, NULL); UPDATE t SET ${assignments};`
        : `INSERT INTO t VALUES (1, NULL, NULL, NULL, NULL); INSERT INTO t VALUES (1, NULL, NULL, NULL, NULL) ON CONFLICT(id) DO UPDATE SET ${assignments};`;
      const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
        `CREATE TABLE t(id INT PRIMARY KEY, i INT, s TEXT, n NUMERIC, r REAL); ${write} SELECT i, typeof(i), s, typeof(s), n, typeof(n), r, typeof(r) FROM t;`]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, expected, values);
    }
  });
}

for (const query of [
  "SELECT (SELECT no_such_col FROM b) FROM a",
  "SELECT * FROM a WHERE EXISTS (SELECT no_such_col FROM b)",
  "SELECT * FROM a WHERE id IN (SELECT no_such_col FROM b)",
  "SELECT (SELECT (SELECT no_such_col FROM b)) FROM a"
]) {
  test(`sqlite3 prepares empty-table subqueries: ${query}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
      `CREATE TABLE a(id INT); CREATE TABLE b(id INT); ${query};`]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no such column: no_such_col/);
  });
}

test("sqlite3 prepares correlated and CTE subqueries without evaluating skipped expressions", async () => {
  for (const rows of ["", "INSERT INTO a VALUES (1);"]) {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
      `CREATE TABLE a(id INT); CREATE TABLE b(id INT); ${rows}
       WITH c(v) AS (SELECT 1) SELECT (SELECT v FROM c WHERE v = a.id),
       CASE WHEN 0 THEN (SELECT abs(-9223372036854775808)) ELSE 2 END FROM a;`]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, rows ? "1|2\n" : "");
  }
});


test("sqlite3 preparation validates table-function arguments without executing them", async () => {
  const valid = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE a(id INT); SELECT (SELECT value FROM json_each('malformed')) FROM a;"]);
  assert.equal(valid.code, 0, valid.stderr);
  const invalid = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE a(id INT); SELECT (SELECT value FROM json_each(no_such_col)) FROM a;"]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /no such column: no_such_col/);
});

test("sqlite3 affinity respects declared-type precedence and preserves unconvertible values", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    `CREATE TABLE t(a CHARINT, b CLOB, c DOUBLE, d BLOB, e, f DECIMAL, g FLOATINGPOINT);
     INSERT INTO t VALUES ('3.0e+5', 42.0, '4.5', 42.0, '42', ' 42 ', '42.0');
     SELECT a, typeof(a), b, typeof(b), c, typeof(c), d, typeof(d), e, typeof(e), f, typeof(f), g, typeof(g) FROM t;`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "300000|integer|42.0|text|4.5|real|42.0|real|42|text|42|integer|42|integer\n");
});

test("sqlite3 prepares table-function correlations against preceding FROM sources", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE a(id INT); CREATE TABLE b(doc TEXT); SELECT (SELECT value FROM b, json_each(b.doc)) FROM a;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("sqlite3 prepares recursive CTE terms inside empty-table subqueries", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE a(id INT); SELECT (WITH RECURSIVE c(v) AS (SELECT 1 UNION ALL SELECT no_such_col FROM c) SELECT v FROM c) FROM a;"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no such column: no_such_col/);
});

test("sqlite3 CLI preserves mutation scopes and exact integers", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE TABLE t(a INT, b INT); INSERT INTO t VALUES (1, 9007199254740993), (2, 1); " +
    "DELETE FROM t AS u WHERE u.a = 999; " +
    "WITH c(v) AS (SELECT 1) UPDATE t AS u SET b = u.b + (SELECT v FROM c) WHERE u.a = 1 RETURNING t.b, _rowid_, oid; " +
    "SELECT SUM(b), CAST('9007199254740993' AS INTEGER) FROM t; " +
    "WITH c(v) AS (SELECT 2) DELETE FROM t WHERE a = (SELECT v FROM c) RETURNING t.a;"
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "9007199254740994|1|1\n9007199254740995|9007199254740993\n2\n");
});

test("sqlite3 JSON output retains exact int64 numeric tokens", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", "SELECT 9007199254740993 AS x, -9223372036854775808 AS y"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), '[{"x":9007199254740993,"y":-9223372036854775808}]');
});

test("sqlite3 rejects invalid configured limits", () => {
  for (const key of ["maxInputBytes", "maxOutputBytes", "maxRows"] as const) {
    for (const value of [-1, NaN, -Infinity, 1.5]) {
      assert.throws(() => createSqlite3Command({ limits: { [key]: value } }), RangeError);
    }
    assert.doesNotThrow(() => createSqlite3Command({ limits: { [key]: Infinity } }));
    assert.doesNotThrow(() => createSqlite3Command({ limits: { [key]: 0 } }));
  }
});

test("sqlite3 reports unknown dot commands and honors bail", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), ["-bail", ":memory:"], ".not_a_command\n.print unreachable");
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, 'Error: unknown command or invalid arguments:  "not_a_command". Enter ".help" for help\n');
  assert.equal((await runSqlite3(createMemoryFileSystem(), [":memory:", ".help"])).code, 0);
});

test("sqlite3 counts UTF-8 input across stdin, SQL arguments and input files", async () => {
  for (const source of ["stdin", "argument", "read", "init", "import", "database"] as const) {
    const fs = createMemoryFileSystem();
    const text = "SELECT 'é';";
    await fs.writeFile("/input", new TextEncoder().encode(text));
    const args = source === "argument" ? [":memory:", text]
      : source === "read" ? [":memory:", ".read /input"]
      : source === "init" ? ["-init", "/input", ":memory:"]
      : source === "import" ? [":memory:", ".import /input t"]
      : source === "database" ? ["/input"] : [":memory:"];
    const result = await runSqlite3(fs, args, source === "stdin" ? text : "", { limits: { maxInputBytes: 1 } });
    assert.equal(result.code, 1, source);
    assert.match(result.stderr, /maxInputBytes/, source);
  }
  const exact = new TextEncoder().encode("SELECT 'é';").length;
  assert.equal((await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT 'é';"], "", { limits: { maxInputBytes: exact } })).code, 0);
});

test("sqlite3 bounds cumulative output including UTF-8 and output files", async () => {
  for (const destination of ["stdout", "output", "once"] as const) {
    const fs = createMemoryFileSystem();
    const args = [":memory:", ...(destination === "stdout" ? [] : [`.${destination} /result`]), "SELECT 'é';", "SELECT 'é';"];
    const result = await runSqlite3(fs, args, "", { limits: { maxOutputBytes: 3 } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /maxOutputBytes/);
    if (destination === "stdout") assert.equal(result.stdout, "é\n");
    else assert.equal(new TextDecoder().decode(await fs.readFile("/result")), "é\n");
  }
});

test("sqlite3 bounds result sets and table rows before persistence", async () => {
  for (const sql of ["SELECT 1 UNION ALL SELECT 2;", "CREATE TABLE t(x); INSERT INTO t VALUES (1), (2);"]) {
    const fs = createMemoryFileSystem();
    const result = await runSqlite3(fs, ["/db", sql], "", { limits: { maxRows: 1 } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /maxRows/);
    assert.equal(result.stdout, "");
    await assert.rejects(fs.readFile("/db"));
  }
});

test("sqlite3 applies output limit to serialized databases", async () => {
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, ["/db", "CREATE TABLE t(x);"], "", { limits: { maxOutputBytes: 1 } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /maxOutputBytes/);
  await assert.rejects(fs.readFile("/db"));
});


test("sqlite3 enforces row budgets on imports, database reloads and injected engines", async () => {
  const fs = createMemoryFileSystem();
  const seed = await runSqlite3(fs, ["/seed.db", "CREATE TABLE t(x); INSERT INTO t VALUES (1),(2);"]);
  assert.equal(seed.code, 0);
  const loaded = await runSqlite3(fs, ["/seed.db"], "", { limits: { maxRows: 1 } });
  assert.equal(loaded.code, 1);
  assert.match(loaded.stderr, /maxRows/);
  await fs.writeFile("/rows.csv", new TextEncoder().encode("x\n1\n2\n"));
  const imported = await runSqlite3(fs, ["/import.db", ".import --csv /rows.csv t"], "", { limits: { maxRows: 1 } });
  assert.equal(imported.code, 1);
  assert.match(imported.stderr, /maxRows/);
  await assert.rejects(fs.readFile("/import.db"));
  const { SqliteDatabase } = await import("./engine.js");
  const backing = new SqliteDatabase();
  const injected = await runSqlite3(fs, [":memory:", "CREATE TABLE t(x); INSERT INTO t VALUES (1),(2);"], "", {
    engine: { exec: (sql: string) => backing.exec(sql) }, limits: { maxRows: 1 }
  });
  assert.equal(injected.code, 1);
  assert.match(injected.stderr, /maxRows/);
});

test("sqlite3 supports exact and zero budgets and counts repeated reads", async () => {
  const fs = createMemoryFileSystem();
  const empty = await runSqlite3(fs, [":memory:"], "", { limits: { maxInputBytes: 0, maxOutputBytes: 0, maxRows: 0 } });
  assert.equal(empty.code, 0);
  const zero = await runSqlite3(fs, [":memory:", "SELECT 1;"], "", { limits: { maxRows: 0 } });
  assert.equal(zero.code, 1);
  await fs.writeFile("/script", new TextEncoder().encode("SELECT 1;"));
  const script = ".read /script\n.read /script";
  const repeated = await runSqlite3(fs, [":memory:", script], "", { limits: { maxInputBytes: script.length + 9 } });
  assert.equal(repeated.code, 1);
  assert.equal(repeated.stdout, "1\n");
  assert.match(repeated.stderr, /maxInputBytes/);
  const quit = await runSqlite3(fs, ["/quit.db"], "CREATE TABLE t(x);\n.quit");
  assert.equal(quit.code, 0);
  assert.ok((await fs.readFile("/quit.db")).length > 0);
});

test("dot-command CSV uses CRLF and returning to list restores separators", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:", ".mode csv", "SELECT 1,2;", ".mode list", "SELECT 3,4;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "1,2\r\n3|4\n");
});

test("CLI CSV flag retains LF row separators", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), ["-csv", ":memory:", "SELECT 1,2;"]);
  assert.equal(result.stdout, "1,2\n");
});

for (const [name, script, expected] of [
  ["CSV to list", ".mode csv\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1,2\r\n3|4\n"],
  ["tabs to list", ".mode tabs\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1\t2\n3|4\n"],
  ["CSV to tabs to list", ".mode csv\nSELECT 1,2;\n.mode tabs\nSELECT 3,4;\n.mode list\nSELECT 5,6;", "1,2\r\n3\t4\r\n5|6\n"],
  ["list resets both custom separators", ".separator : !\n.mode list\nSELECT 1,2;\n.separator @ ~\nSELECT 3,4;\n.mode list\nSELECT 5,6;", "1|2\n3@4~5|6\n"],
  ["tabs honors separator overrides", ".mode tabs\n.separator : !\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1:2!3|4\n"],
  ["CSV honors a pipe separator", ".mode csv\n.separator | !\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1|2!3|4\n"],
  ["ASCII to tabs", ".mode ascii\nSELECT 1,2;\n.mode tabs\nSELECT 3,4;\n.mode list\nSELECT 5,6;", "1\x1f2\x1e3\t4\x1e5|6\n"],
  ["ASCII honors separator overrides", ".mode ascii\n.separator : !\nSELECT 1,2;\n.mode list\nSELECT 3,4;", "1:2!3|4\n"]
] as const) {
  test(`sqlite3 sync and async mode separators: ${name}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"]), expected);
  });
}

for (const mode of ["line", "column", "quote"]) {
  test(`sqlite3 ${mode} mode resets the row separator in both execution paths`, async () => {
    const script = `.separator : !\n.mode ${mode}\n.mode tabs\n.headers off\nSELECT 1,2;`;
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "1\t2\n");
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"]), "1\t2\n");
  });
}

test("sqlite3 imports typed CSV columns with affinity and retains their types after reopening", async () => {
  const fs = createMemoryFileSystem();
  const csv = new TextEncoder().encode('"Bob, Jr.",10,88.0,3.0e+5,4,5\n');
  await fs.writeFile("/typed.csv", csv);
  const script = [
    "CREATE TABLE imp(a TEXT, b INT, c REAL, d NUMERIC, e FLOAT, f DOUBLE);",
    ".mode csv", ".import /typed.csv imp", ".mode list",
    "SELECT a,b,typeof(b),c,typeof(c),d,typeof(d),e,typeof(e),f,typeof(f) FROM imp;",
    ".mode json", "SELECT * FROM imp;"
  ].join("\n");
  const expected = 'Bob, Jr.|10|integer|88.0|real|300000|integer|4.0|real|5.0|real\n[{"a":"Bob, Jr.","b":10,"c":88.0,"d":300000,"e":4.0,"f":5.0}]\n';
  const result = await runSqlite3(fs, ["/typed.db"], script);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, expected);
  const reopened = await runSqlite3(fs, ["-json", "/typed.db", "SELECT * FROM imp;"]);
  assert.equal(reopened.code, 0, reopened.stderr);
  assert.equal(reopened.stdout, expected.slice(expected.indexOf("[")));

  const files = new Map<string, Uint8Array>([["/typed.csv", csv]]);
  const read = (path: string) => files.get(path);
  const write = (path: string, bytes: Uint8Array) => { files.set(path, bytes); return true; };
  assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), ["/typed.db"], read, write), expected);
  assert.equal(evalSyncSqlite3(undefined, ["-json", "/typed.db", "SELECT * FROM imp;"], read, write), reopened.stdout);
});

for (const [mode, separator, importOptions, data] of [
  ["csv", "|", "", "foo|10\nbar|20\n"],
  ["list", ":", "--csv ", "foo,10\nbar,20\n"]
] as const) {
  test(`sqlite3 import respects ${importOptions || mode} separators and column affinity`, async () => {
    const fs = createMemoryFileSystem();
    const bytes = new TextEncoder().encode(data);
    await fs.writeFile("/rows.csv", bytes);
    const script = `CREATE TABLE imp(a TEXT,b INT);\n.mode ${mode}\n.separator ${separator}\n.import ${importOptions}/rows.csv imp\n.mode list\nSELECT a,b,typeof(b) FROM imp;`;
    const expected = "foo|10|integer\nbar|20|integer\n";
    const result = await runSqlite3(fs, [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"], () => bytes), expected);
  });
}

for (const [mode, expected] of [
  ["-list", "88.0|4.0|5.0|real|real|real\n"],
  ["-csv", "88.0,4.0,5.0,real,real,real\n"],
  ["-line", "    r = 88.0\n    f = 4.0\n    d = 5.0\n   rt = real\n   ft = real\n   dt = real\n"],
  ["-json", '[{"r":88.0,"f":4.0,"d":5.0,"rt":"real","ft":"real","dt":"real"}]\n']
] as const) {
  test(`sqlite3 REAL, FLOAT and DOUBLE storage classes survive ${mode} formatting and persistence`, async () => {
    const fs = createMemoryFileSystem();
    const select = "SELECT r,f,d,typeof(r) AS rt,typeof(f) AS ft,typeof(d) AS dt FROM t;";
    const sql = `CREATE TABLE t(r REAL, f FLOAT, d DOUBLE); INSERT INTO t VALUES (88.0, 4, '5'); ${select}`;
    const result = await runSqlite3(fs, [mode, "/real.db", sql]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    const reopened = await runSqlite3(fs, [mode, "/real.db", select]);
    assert.equal(reopened.code, 0, reopened.stderr);
    assert.equal(reopened.stdout, expected);
    assert.equal(evalSyncSqlite3(undefined, [mode, ":memory:", sql]), expected);
  });
}

for (const sql of [
  "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<50000) SELECT count(*) FROM c;",
  "SELECT count(*) FROM generate_series(1,150000);",
  "SELECT count(*) FROM t a CROSS JOIN t b;",
  "SELECT sum(x) FROM t;",
  Array.from({ length: 1000 }, () => "SELECT 1;").join("")
]) {
  test(`cooperatively yields and cancels with a frozen Workers clock: ${sql.slice(0, 80)}`, async () => {
    const fs = createMemoryFileSystem();
    if (sql.includes("FROM t")) {
      const setup = await runSqlite3(fs, [
        "/db",
        "CREATE TABLE t(x); INSERT INTO t SELECT value FROM generate_series(1,5000);"
      ]);
      assert.equal(setup.code, 0, setup.stderr);
    }
    const host = globalThis as typeof globalThis & { setImmediate?: typeof setImmediate };
    const immediate = host.setImmediate;
    const timeout = host.setTimeout;
    const now = Date.now;
    const performanceNow = Object.getOwnPropertyDescriptor(performance, "now");
    let turns = 0;
    const controller = new AbortController();
    try {
      Reflect.deleteProperty(host, "setImmediate");
      Date.now = () => 0;
      Object.defineProperty(performance, "now", { configurable: true, value: () => 0 });
      host.setTimeout = ((
        callback: (...args: unknown[]) => void,
        ms?: number,
        ...args: unknown[]
      ) => {
        if (ms === 0) {
          turns++;
          if (turns === 3)
            return timeout(() => controller.abort(new Error("cancel SQLite workload")), 0);
        }
        return timeout(callback, ms, ...args);
      }) as typeof setTimeout;
      const pending = runSqlite3(
        fs,
        [sql.includes("FROM t") ? "/db" : ":memory:", sql],
        "",
        {},
        controller.signal
      );
      await assert.rejects(pending, /cancel SQLite workload/);
      assert.ok(turns >= 3);
    } finally {
      host.setImmediate = immediate;
      host.setTimeout = timeout;
      Date.now = now;
      if (performanceNow) Object.defineProperty(performance, "now", performanceNow);
      else Reflect.deleteProperty(performance, "now");
    }
  });
}

for (const sql of [
  "SELECT count(*) FROM generate_series(1,1000);",
  "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<1000) SELECT count(*) FROM c;"
]) {
  test(`maxRows bounds generated rows before aggregation: ${sql}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql], "", {
      limits: { maxRows: 10 }
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /maxRows/);
    assert.equal(result.stdout, "");
  });
}

test("maxRows bounds joins before aggregation and prevents saving earlier writes", async () => {
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, ["/db", "CREATE TABLE t(x); INSERT INTO t VALUES (1),(2); SELECT count(*) FROM t a CROSS JOIN t b;"], "", { limits: { maxRows: 2 } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /maxRows/);
  assert.equal(result.stdout, "");
  await assert.rejects(fs.readFile("/db"));
});

test('sqlite3 applies REAL affinity on UPDATE and ALTER defaults', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', "CREATE TABLE r(x REAL); INSERT INTO r VALUES(1); UPDATE r SET x='4'; ALTER TABLE r ADD y DOUBLE DEFAULT 5; SELECT x,typeof(x),y,typeof(y) FROM r;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '4.0|real|5.0|real\n');
});

test('sqlite3 JSON constructors distinguish text and JSON and preserve duplicate keys', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `SELECT json_array('[1]',json('[1]')),json_object('a',1,'a',2); CREATE TABLE t(x TEXT); INSERT INTO t VALUES('[1]'),('[2]'); SELECT json_group_array(x),json_group_object('a',x) FROM t;`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '["[1]",[1]]|{"a":1,"a":2}\n["[1]","[2]"]|{"a":"[1]","a":"[2]"}\n');
});

for (const expression of ['(SELECT missing FROM b)', 'id IN (SELECT missing FROM b)', 'EXISTS(SELECT missing FROM b)', '(SELECT id FROM b WHERE missing = a.id)']) {
  test(`sqlite3 validates subquery columns with empty outer rows: ${expression}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE a(id INT); CREATE TABLE b(id INT); SELECT ${expression} FROM a;`]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no such column: missing/);
  });
}

test('sqlite3 accepts correlated schema references with empty outer rows', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', 'CREATE TABLE a(outer_id INT); CREATE TABLE b(id INT); SELECT (SELECT outer_id FROM b),outer_id IN (SELECT id FROM b WHERE id=a.outer_id),(SELECT (SELECT outer_id) FROM b) FROM a;']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
});


test('sqlite3 JSON subtype is cleared by stored and derived tables and scalar subqueries', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE t(x TEXT); INSERT INTO t VALUES(json('[1]')); SELECT json_array(x),typeof(x) FROM t; SELECT json_array(x) FROM (SELECT json('[1]') AS x); SELECT json_array((SELECT json('[1]'))); SELECT json_array(json_extract('{"x":"[1]"}','$.x'),json_extract('{"x":[1]}','$.x')); SELECT json_array(json('{"a":1,"a":2}')); SELECT json('[1]')='[1]',typeof(json('[1]')),quote(json('[1]'));`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '["[1]"]|text\n["[1]"]\n["[1]"]\n["[1]",[1]]\n[{"a":1,"a":2}]\n1|text|\'[1]\'\n');
});


test('sqlite3 preserves ALTER REAL column defaults across database reopen and later inserts', async () => {
  const fs = createMemoryFileSystem();
  const created = await runSqlite3(fs, ['/alter.db', 'CREATE TABLE r(x INTEGER); INSERT INTO r VALUES(1); ALTER TABLE r ADD y DOUBLE DEFAULT 5;']);
  assert.equal(created.code, 0, created.stderr);
  const reopened = await runSqlite3(fs, ['/alter.db', 'INSERT INTO r(x) VALUES(2); SELECT x,y,typeof(y) FROM r ORDER BY x;']);
  assert.equal(reopened.code, 0, reopened.stderr);
  assert.equal(reopened.stdout, '1|5.0|real\n2|5.0|real\n');
});


test('sqlite3 applies REAL affinity to integer and numeric TEXT updates and REAL ALTER defaults', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', "CREATE TABLE r(x REAL); INSERT INTO r VALUES(1); UPDATE r SET x=6; SELECT x,typeof(x) FROM r; UPDATE r SET x='7'; ALTER TABLE r ADD y REAL DEFAULT 5; SELECT x,typeof(x),y,typeof(y) FROM r;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '6.0|real\n7.0|real|5.0|real\n');
});

test('sqlite3 quotes JSON-looking TEXT literals in quote, array, and object constructors', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `SELECT json_quote('[1, 2]'),json_array('[1, 2]'),json_object('k','{"a":1}');`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `"[1, 2]"|["[1, 2]"]|{"k":"{\\"a\\":1}"}\n`);
});


test('sqlite3 checks unboxed JSON text before applying REAL affinity', async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [':memory:', `CREATE TABLE r(x REAL); INSERT INTO r VALUES(json('7')),(json('"x"')); SELECT x,typeof(x) FROM r;`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '7.0|real\n"x"|text\n');
});

for (const [name, sql, expected] of [
  ["conditional projections over nullable rows",
    "CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES (1, 'x'), (2, NULL), (3, 'y'); SELECT a, COALESCE(b, 'none'), IFNULL(b, 'fallback'), IIF(a > 1, 'yes', 'no') FROM t ORDER BY a DESC;",
    "3|y|y|yes\n2|none|fallback|yes\n1|x|x|no\n"],
  ["aggregate IN in HAVING",
    "CREATE TABLE items(g TEXT, v INT); INSERT INTO items VALUES ('a', 1), ('a', 2), ('b', 5), ('c', 9); SELECT g FROM items GROUP BY g HAVING SUM(v) IN (3, 5) ORDER BY g;",
    "a\nb\n"],
  ["aggregate IN operands and NULL semantics",
    "CREATE TABLE t(v INT); INSERT INTO t VALUES (1), (2); SELECT COUNT(*) IN (1, 2), 3 IN (SUM(v)), SUM(v) NOT IN (4, 5), SUM(v) IN (4, NULL), SUM(v) NOT IN (4, NULL), SUM(v) IN (), SUM(v) NOT IN () FROM t;",
    "1|1|1|||0|1\n"],
  ["empty aggregate IN operands",
    "CREATE TABLE t(v INT); SELECT COUNT(*) IN (0, 1), SUM(v) IN (0), SUM(v) IN (), SUM(v) NOT IN () FROM t;",
    "1||0|1\n"],
  ["double-quoted INSERT strings and column precedence (DQS enabled)",
    'CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES (1, "x"), (2, NULL), (3, "y"); SELECT "a", "b", "---" FROM t ORDER BY a;',
    "1|x|---\n2||---\n3|y|---\n"],
  ["recursive aggregate REAL formatting",
    "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 5) SELECT SUM(x), COUNT(*), AVG(x), TOTAL(x) FROM cnt;",
    "15|5|3.0|15.0\n"]
]) {
  test(`sqlite3 preserves expression parity: ${name}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql!]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}

for (const limits of [undefined, { maxInputBytes: Infinity, maxOutputBytes: Infinity, maxRows: Infinity }]) {
  test(`sqlite3 executes beyond former byte and row ceilings with ${limits ? "explicit Infinity" : "defaults"}`, async () => {
    const payload = "x".repeat(16 * 1024 * 1024 + 1);
    const sql = `SELECT '${payload}';`;
    const large = await runSqlite3(createMemoryFileSystem(), [":memory:", sql], "", {
      limits,
      engine: { exec: (query: string) => {
        assert.equal(query.length, sql.length - 1);
        assert.ok(query === sql.slice(0, -1));
        return [{ columns: ["value"], rows: [[payload]] }];
      } }
    });
    assert.equal(large.code, 0, large.stderr);
    assert.equal(large.stdout, payload + "\n");
    const rows = await runSqlite3(createMemoryFileSystem(), [":memory:", "SELECT value;"], "", {
      limits,
      engine: { exec: () => [{ columns: ["value"], rows: Array.from({ length: 100_001 }, () => [1]) }] }
    });
    assert.equal(rows.code, 0, rows.stderr);
    assert.equal(rows.stdout, "1\n".repeat(100_001));
  });
}

// Expected results checked against /usr/bin/sqlite3 3.43.2.
for (const [label, sql, expected] of [
  ["REAL arithmetic and aggregates", "SELECT 5.0 / 2, 10.0 / 4, CAST(5 AS REAL) / 2, 1.0 + 2.0, TOTAL(NULL), 5 / 2;", "2.5|2.5|2.5|3.0|0.0|2\n"],
  ["NULL boolean truth tables", "WITH t(x) AS (VALUES(NULL),(0),(1)) SELECT a.x AND b.x, a.x OR b.x FROM t a CROSS JOIN t b;", "|\n0|\n|1\n0|\n0|0\n0|1\n|1\n0|1\n1|1\n"],
  ["NULL BETWEEN comparisons", "SELECT 5 BETWEEN NULL AND 3, 5 NOT BETWEEN NULL AND 3, 5 NOT BETWEEN 6 AND NULL, 5 BETWEEN NULL AND 6, 5 NOT BETWEEN 3 AND NULL, NULL BETWEEN 1 AND 2;", "0|1|1|||\n"],
  ["NULL BETWEEN filtering", "WITH t(x) AS (VALUES(2),(5),(7)) SELECT x FROM t WHERE x NOT BETWEEN NULL AND 3;", "5\n7\n"],
  ["substring zero and out-of-range starts", "SELECT SUBSTR('abcdef',0,3), SUBSTR('abcdef',0,1), SUBSTR('abcdef',0,0), SUBSTR('abcdef',0,-3), SUBSTR('abcdef',0), SUBSTR('abcdef',-9,5), SUBSTR('abcdef',3,-2), SUBSTR('😀abc',0,3);", "ab||||abcdef|ab|ab|😀a\n"]
] as const) {
  test(`sqlite3 native semantics in both execution paths: ${label}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(undefined, [":memory:", sql]), expected);
  });
}

for (const [name, pattern, matches] of [
  ["a[b_c", "a[b_c", true], ["a[b]_c", "a[b]_c", true],
  ["a(b_c", "a(b_c", true], ["a\\b_c", "a\\b_c", true],
  ["abc_def", "abc_def", true], ["abc_def", "%bc_d%", true],
  ["abc_def", "bc_d", false], ["abc_def", "bc", false],
  ["abc_def", "abc*", false], ["ABC_def", "abc%", true]
] as const) {
  test(`sqlite3 .tables uses literal SQL LIKE patterns: ${name}, ${pattern}`, async () => {
    const script = `CREATE TABLE "${name}"(id INT);\n.tables ${pattern}\n`;
    const expected = matches ? `${name}\n` : "";
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"]), expected);
  });
}

test("sqlite3 preserves REAL storage after reopening", async () => {
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, ["/real.db", "CREATE TABLE t(x REAL); INSERT INTO t VALUES (5); SELECT x, x / 2, typeof(x) FROM t;"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "5.0|2.5|real\n");
  const reopened = await runSqlite3(fs, ["/real.db", "SELECT x, x / 2, typeof(x) FROM t;"]);
  assert.deepEqual(reopened, { code: 0, stdout: result.stdout, stderr: "" });
});

for (const sql of ["-- comment\nINSERT INTO t VALUES(2)", "/* comment */ INSERT INTO t VALUES(2)", "WITH s AS (SELECT 2) INSERT INTO t SELECT * FROM s"]) {
  test(`sqlite3 persists and guards prefixed mutations: ${sql}`, async () => {
    const fs = createMemoryFileSystem();
    assert.equal((await runSqlite3(fs, ["/db", "CREATE TABLE t(x); INSERT INTO t VALUES(1)"])).code, 0);
    const denied = await runSqlite3(fs, ["-readonly", "/db", sql]);
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /readonly/);
    const written = await runSqlite3(fs, ["/db", sql]);
    assert.equal(written.code, 0, written.stderr);
    assert.equal((await runSqlite3(fs, ["/db", "SELECT * FROM t ORDER BY x"])).stdout, "1\n2\n");
  });
}
for (const command of [".import /data t", ".restore /backup"]) {
  test(`sqlite3 readonly rejects ${command}`, async () => {
    const fs = createMemoryFileSystem();
    await runSqlite3(fs, ["/db", "CREATE TABLE t(x); INSERT INTO t VALUES(1)"]);
    await fs.writeFile("/data", new TextEncoder().encode("2\n"));
    await fs.writeFile("/backup", await fs.readFile("/db"));
    const result = await runSqlite3(fs, ["-readonly", "/db"], command + "\n");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /readonly/);
    assert.equal((await runSqlite3(fs, ["/db", "SELECT * FROM t"])).stdout, "1\n");
  });
}

test("sqlite3 sync persists comment and CTE mutations", () => {
  const files = new Map<string, Uint8Array>();
  const read = (path: string) => files.get(path);
  const write = (path: string, bytes: Uint8Array) => { files.set(path, bytes); return true; };
  assert.equal(evalSyncSqlite3(undefined, ["/db", "/* comment */ CREATE TABLE t(x)"], read, write), "");
  for (const sql of ["-- comment\nINSERT INTO t VALUES(1)", "WITH s AS (SELECT 2) INSERT INTO t SELECT * FROM s"]) {
    assert.equal(evalSyncSqlite3(undefined, ["/db", sql], read, write), "");
  }
  assert.equal(evalSyncSqlite3(undefined, ["/db", "SELECT * FROM t ORDER BY x"], read, write), "1\n2\n");
});

for (const strict of [false, true]) {
  for (const key of ["INT", "INTEGER PRIMARY KEY"]) {
    test(`sqlite3 imports affinity with STRICT ANY (${strict}) and ${key}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/aff.csv", new TextEncoder().encode("1,0006,6,6,6\n2,0039,39,39,39\n"));
      const result = await runSqlite3(fs, ["/aff.db"], [
        `CREATE TABLE aff(id ${key}, a ANY, i INT, r REAL, t TEXT) ${strict ? "STRICT" : ""};`,
        ".import --csv /aff.csv aff",
        "SELECT a,typeof(a),i,typeof(i),typeof(r),typeof(t) FROM aff ORDER BY i;",
        "SELECT MIN(i),MAX(i) FROM aff;"
      ].join("\n"));
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, strict
        ? "0006|text|6|integer|real|text\n0039|text|39|integer|real|text\n6|39\n"
        : "6|integer|6|integer|real|text\n39|integer|39|integer|real|text\n6|39\n");
      const reopened = await runSqlite3(fs, ["/aff.db", "SELECT a,typeof(a) FROM aff ORDER BY i;"]);
      assert.equal(reopened.code, 0, reopened.stderr);
      assert.equal(reopened.stdout, strict ? "0006|text\n0039|text\n" : "6|integer\n39|integer\n");
    });
  }
}

test("sqlite3 conditional projection values reach command stdout", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "SELECT COALESCE(1, 2), COALESCE(NULL, 'fallback'), IFNULL(NULL, 9), IIF(10 > 5, 'yes', 'no');"]);
  assert.deepEqual(result, { code: 0, stdout: "1|fallback|9|yes\n", stderr: "" });
});

for (const end of ["COMMIT", "ROLLBACK"]) {
  test(`sqlite3 sync and async imports accept dot commands inside BEGIN TRANSACTION with ${end}`, async () => {
    const fs = createMemoryFileSystem();
    const csv = new TextEncoder().encode("1,first\n2,second\n");
    await fs.writeFile("/rows.csv", csv);
    const script = [
      "CREATE TABLE t(id INTEGER PRIMARY KEY, value TEXT);",
      "CREATE TABLE audit(id INTEGER);",
      "CREATE TRIGGER imported AFTER INSERT ON t BEGIN",
      "INSERT INTO audit VALUES(new.id);",
      "END;",
      "BEGIN TRANSACTION;",
      ".mode csv",
      ".import /rows.csv t",
      ".mode list",
      "SELECT count(*) FROM t;",
      `${end};`,
      "SELECT count(*) FROM t;",
      "SELECT count(*) FROM audit;"
    ].join("\n");
    const expected = end === "COMMIT" ? "2\n2\n2\n" : "2\n0\n0\n";
    const result = await runSqlite3(fs, [":memory:"], script);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"], () => csv), expected);
  });
}

test("sqlite3 imports 25000 primary keys in sync and async transactions", async () => {
  const fs = createMemoryFileSystem();
  const csv = new TextEncoder().encode(Array.from({ length: 25000 }, (_, i) => `${i},value${i}\n`).join(""));
  await fs.writeFile("/rows.csv", csv);
  const script = [
    "CREATE TABLE t(id INTEGER PRIMARY KEY, value TEXT);",
    "BEGIN TRANSACTION;", ".mode csv", ".import /rows.csv t", "COMMIT;", ".mode list",
    "SELECT count(*), min(id), max(id) FROM t;",
    "INSERT OR IGNORE INTO t VALUES(24999, 'duplicate');",
    "SELECT value FROM t WHERE id = 24999;"
  ].join("\n");
  const expected = "25000|0|24999\nvalue24999\n";
  const result = await runSqlite3(fs, [":memory:"], script);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"], () => csv), expected);
});

test("sqlite3 creates and queries an in-memory FTS5 table", async () => {
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
    "CREATE VIRTUAL TABLE docs USING fts5(title, body); INSERT INTO docs VALUES ('hello', 'world'); SELECT * FROM docs; SELECT title FROM docs WHERE docs MATCH 'WORLD';"]);
  assert.deepEqual(result, { code: 0, stdout: "hello|world\nhello\n", stderr: "" });
});
