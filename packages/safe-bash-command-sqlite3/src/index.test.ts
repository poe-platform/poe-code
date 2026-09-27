import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { CommandRegistry, commandRuntimeIdentity, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
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
});
