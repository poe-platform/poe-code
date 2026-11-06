import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

const setup = `CREATE TABLE t(id INTEGER PRIMARY KEY,n INTEGER,k INTEGER);
  INSERT INTO t VALUES(1,1637,1),(2,560,0),(3,1072,1),(4,976,0),(5,1795,1),(6,2584,2),(7,1103,1);`;

for (const [expression, windows, expected] of [
  ["sum(n) OVER w", "w AS (ORDER BY id)", [1637,2197,3269,4245,6040,8624,9727]],
  ['sum(n) OVER "W"', 'w AS (PARTITION BY k)', [5607,1536,5607,1536,5607,2584,5607]],
  ["sum(n) OVER w", "w AS (ORDER BY id ROWS CURRENT ROW)", [1637,560,1072,976,1795,2584,1103]],
  ["sum(n) OVER (w ROWS CURRENT ROW)", "w AS (ORDER BY id)", [1637,560,1072,976,1795,2584,1103]],
  ["sum(n) OVER framed", "w AS (ORDER BY id), framed AS (w ROWS CURRENT ROW)", [1637,560,1072,976,1795,2584,1103]],
] as const) {
  test(`named window ${expression} WINDOW ${windows}`, async () => {
    const db = new SqliteDatabase();
    db.exec(setup);
    const sql = `SELECT ${expression} FROM t WINDOW ${windows} ORDER BY id`;
    assert.deepEqual(db.exec(sql)[0]!.rows, expected.map(n => [n]));
    assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, expected.map(n => [n]));
    assert.equal(evalSyncSqlite3(undefined, [":memory:", setup + sql]), expected.join("\n") + "\n");
  });
}

test("unknown named windows fail even without rows and remain scoped to their SELECT", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(n)");
  for (const sql of [
    "SELECT sum(n) OVER missing FROM t",
    "SELECT sum(n) OVER missing FROM t WINDOW w AS (ORDER BY n)",
  ]) {
    assert.throws(() => db.exec(sql), { message: "no such window: missing" });
  }
  db.exec("INSERT INTO t VALUES(1)");
  assert.throws(() => db.exec("SELECT (SELECT sum(n) OVER missing FROM t) FROM t WINDOW missing AS (ORDER BY n)"),
    { message: "no such window: missing" });
});

test("window chaining cannot overwrite inherited clauses", () => {
  const db = new SqliteDatabase();
  db.exec(setup);
  for (const [definition, extension, message] of [
    ["PARTITION BY k", "PARTITION BY id", "PARTITION clause"],
    ["ORDER BY id", "ORDER BY n", "ORDER BY clause"],
    ["ROWS CURRENT ROW", "", "frame specification"],
  ]) {
    assert.throws(() => db.exec(`SELECT sum(n) OVER (w ${extension}) FROM t WINDOW w AS (${definition})`),
      { message: `cannot override ${message} of window: w` });
  }
});

test("multiple windows and wildcard targets keep independent definitions", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(n); INSERT INTO t VALUES(1),(2)");
  assert.deepEqual(db.exec(`SELECT *, sum(n) OVER w, sum(n) OVER v FROM t
    WINDOW w AS (ORDER BY n), v AS () ORDER BY n`)[0]!.rows, [[1,1,3],[2,3,3]]);
});

for (const known of [true, false]) {
  test(`sqlite3 command resolves named windows: known=${known}`, async () => {
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const result = await createSqlite3Command().execute({
      command: "sqlite3",
      args: createCommandArguments([":memory:", setup,
        `SELECT sum(n) OVER ${known ? "w" : "missing"} FROM t WINDOW w AS (ORDER BY id) ORDER BY id`]).args,
      stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
      fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, known ? 0 : 1);
    assert.equal(Buffer.from(await output).toString(), known ? "1637\n2197\n3269\n4245\n6040\n8624\n9727\n" : "");
    const diagnostic = Buffer.from(await errors).toString();
    if (known) assert.equal(diagnostic, "");
    else assert.ok(diagnostic.includes("no such window: missing"), diagnostic);
  });
}
