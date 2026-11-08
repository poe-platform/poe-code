import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command } from "./index.js";


for (const { declaration, target, expected } of [
  { declaration: "", target: "v COLLATE NOCASE", expected: ["a", "b", "ä", "Ä"] },
  { declaration: "COLLATE NOCASE", target: "v", expected: ["a", "b", "ä", "Ä"] },
  { declaration: "COLLATE NOCASE", target: "t.v", expected: ["a", "b", "ä", "Ä"] },
  { declaration: "COLLATE NOCASE", target: "*", expected: ["a", "b", "ä", "Ä"] },
  { declaration: "COLLATE NOCASE", target: "v COLLATE BINARY", expected: ["a", "A", "b", "B", "ä", "Ä"] },
  { declaration: "COLLATE NOCASE", target: "v || ''", expected: ["a", "A", "b", "B", "ä", "Ä"] }
]) {
  test(`SELECT DISTINCT ${target}, column ${declaration || "BINARY"}`, async () => {
    const sql = `CREATE TABLE t(v TEXT ${declaration});
      INSERT INTO t VALUES('a'),('A'),('b'),('B'),('ä'),('Ä');
      SELECT DISTINCT ${target === "*" ? "*" : `${target} AS v`} FROM t;`;
    const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", sql]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected.map(v => ({ v })));
  });
}

test("SELECT DISTINCT applies each joined column's collation and keeps original values", async () => {
  const sql = `CREATE TABLE a(v TEXT COLLATE NOCASE);
    CREATE TABLE b(v TEXT COLLATE RTRIM);
    INSERT INTO a VALUES('a'),('A');
    INSERT INTO b VALUES('x '),('x'),('X'),('x'||char(9));
    SELECT DISTINCT l.v AS a, r.v AS b FROM a AS l CROSS JOIN b AS r;`;
  const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", sql]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ a: "a", b: "x " }, { a: "a", b: "X" }, { a: "a", b: "x\t" }]);
});

test("SELECT DISTINCT NOCASE precedes ORDER BY and LIMIT and collapses NULLs", async () => {
  const sql = `CREATE TABLE t(v TEXT);
    INSERT INTO t VALUES('a'),('A'),('b'),('B'),(NULL),(NULL);
    SELECT DISTINCT v COLLATE NOCASE AS v FROM t ORDER BY v COLLATE NOCASE LIMIT 3;`;
  const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", sql]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ v: null }, { v: "a" }, { v: "b" }]);
});

test("SELECT DISTINCT collation preserves storage classes and numeric equality", async () => {
  const sql = `CREATE TABLE t(v);
    INSERT INTO t VALUES('a'),('A'),(x'61'),(x'41'),(1),(1.0),('1'),(NULL),(NULL);
    SELECT typeof(v) AS type, hex(v) AS value FROM
      (SELECT DISTINCT v COLLATE NOCASE AS v FROM t);`;
  const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", sql]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    { type: "text", value: "61" },
    { type: "blob", value: "61" },
    { type: "blob", value: "41" },
    { type: "integer", value: "31" },
    { type: "text", value: "31" },
    { type: "null", value: "" }
  ]);
});

async function runSqlite3(
  fs: FileSystem,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdin = createBytePipe();
  await stdin.close();

  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const output = collectBytes(stdout.readable, { maxBytes: Infinity });
  const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
  const cmd = createSqlite3Command();
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
    signal: new AbortController().signal
  }); } finally { await stdout.close(); await stderr.close(); }
  const [outBytes, errBytes] = await Promise.all([output, errors]);
  return {
    code: res.exitCode,
    stdout: Buffer.from(outBytes).toString("utf8"),
    stderr: Buffer.from(errBytes).toString("utf8")
  };
}
