import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

test("GROUP BY emits groups in key order through async and sync sqlite3 commands", async () => {
  const args = [":memory:", "create table t(a); insert into t values('b'),('a'),('c'),('a'); select a, count(*) from t group by a;"];
  const result = await runSqlite3(createMemoryFileSystem(), args);
  assert.deepEqual(result, { code: 0, stdout: "a|2\nb|1\nc|1\n", stderr: "" });
  assert.equal(evalSyncSqlite3(undefined, args), result.stdout);
});

for (const { sql, stdout } of [
  {
    sql: "CREATE TABLE t(a); INSERT INTO t VALUES(x'62'),('2'),(10),(NULL),(2),(1.5),(x'61'),(NULL); SELECT typeof(a), a, count(*) FROM t GROUP BY a;",
    stdout: "null||2\nreal|1.5|1\ninteger|2|1\ninteger|10|1\ntext|2|1\nblob|a|1\nblob|b|1\n"
  },
  {
    sql: "CREATE TABLE t(a TEXT COLLATE NOCASE, b); INSERT INTO t VALUES('B',2),('a',10),('A',2),('b',1),('a',2); SELECT a, b, count(*) FROM t GROUP BY a, b;",
    stdout: "A|2|2\na|10|1\nb|1|1\nB|2|1\n"
  },
  {
    sql: "CREATE TABLE t(a); INSERT INTO t VALUES('b'),('a '),('a'),('A'); SELECT a, count(*) FROM t GROUP BY a COLLATE RTRIM;",
    stdout: "A|1\na |2\nb|1\n"
  },
  {
    sql: "CREATE TABLE t(a TEXT COLLATE NOCASE); INSERT INTO t VALUES('b'),('a'),('B'); SELECT a, count(*) FROM t GROUP BY a COLLATE BINARY;",
    stdout: "B|1\na|1\nb|1\n"
  },
  ...["label", "1"].map(group => ({
    sql: `CREATE TABLE t(a); INSERT INTO t VALUES('B'),('a'),('C'); SELECT lower(a) AS label, count(*) FROM t GROUP BY ${group};`,
    stdout: "a|1\nb|1\nc|1\n"
  })),
  {
    sql: "CREATE TABLE t(a); INSERT INTO t VALUES('c'),('b'),('a'),('a'),('b'); SELECT a, count(*) AS n FROM t GROUP BY a HAVING n > 1 LIMIT 1;",
    stdout: "a|2\n"
  },
  {
    sql: "CREATE TABLE t(a); INSERT INTO t VALUES('b'),('a'),('c'),('a'); SELECT a, count(*) FROM t GROUP BY a ORDER BY a DESC;",
    stdout: "c|1\nb|1\na|2\n"
  }
]) {
  test(`GROUP BY key ordering: ${sql}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:", sql]);
    assert.deepEqual(result, { code: 0, stdout, stderr: "" });
  });
}


for (const { declaration, target, group, counts } of [
  { declaration: "", target: "v", group: "v COLLATE NOCASE", counts: [2, 2, 1, 1] },
  { declaration: "COLLATE NOCASE", target: "v", group: "v", counts: [2, 2, 1, 1] },
  { declaration: "COLLATE NOCASE", target: "v", group: "t.v", counts: [2, 2, 1, 1] },
  { declaration: "", target: "v COLLATE NOCASE", group: "1", counts: [2, 2, 1, 1] },
  { declaration: "", target: "v COLLATE NOCASE", group: "value", counts: [2, 2, 1, 1] },
  { declaration: "COLLATE NOCASE", target: "v", group: "v COLLATE BINARY", counts: [1, 1, 1, 1, 1, 1] },
  { declaration: "COLLATE NOCASE", target: "v", group: "+v", counts: [2, 2, 1, 1] },
  { declaration: "COLLATE NOCASE", target: "v", group: "CAST(v AS TEXT)", counts: [2, 2, 1, 1] },
  { declaration: "COLLATE NOCASE", target: "v", group: "v || ''", counts: [1, 1, 1, 1, 1, 1] },
  { declaration: "", target: "v", group: "(v COLLATE NOCASE) || ''", counts: [2, 2, 1, 1] }
]) {
  test(`GROUP BY ${group}, SELECT ${target}, column ${declaration || "BINARY"}`, async () => {
    const sql = `CREATE TABLE t(v TEXT ${declaration});
      INSERT INTO t VALUES('a'),('A'),('b'),('B'),('ä'),('Ä');
      SELECT ${target} AS value, COUNT(*) AS n FROM t GROUP BY ${group} ORDER BY value COLLATE BINARY;`;
    const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", sql]);
    assert.equal(result.code, 0, result.stderr);
    const rows = JSON.parse(result.stdout);
    assert.deepEqual(rows.map((row: { n: number }) => row.n), counts);
    if (counts.length === 4) assert.deepEqual(rows.map((row: { value: string }) => row.value), ["a", "b", "Ä", "ä"]);
  });
}

test("GROUP BY keeps independent keys, NULLs and storage classes with collations", async () => {
  const sql = `CREATE TABLE t(v COLLATE NOCASE, bucket);
    INSERT INTO t VALUES ('a',1),('A',1),('A',2),('ä',1),('Ä',1),
      (NULL,1),(NULL,1),(x'61',1),(x'41',1),(1,1),('1',1);
    SELECT typeof(v) AS type, hex(v) AS value, bucket, count(*) AS n
      FROM t GROUP BY v, bucket ORDER BY type, value, bucket;`;
  const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", sql]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    { type: "blob", value: "41", bucket: 1, n: 1 },
    { type: "blob", value: "61", bucket: 1, n: 1 },
    { type: "integer", value: "31", bucket: 1, n: 1 },
    { type: "null", value: "", bucket: 1, n: 2 },
    { type: "text", value: "31", bucket: 1, n: 1 },
    { type: "text", value: "41", bucket: 2, n: 1 },
    { type: "text", value: "61", bucket: 1, n: 2 },
    { type: "text", value: "C384", bucket: 1, n: 1 },
    { type: "text", value: "C3A4", bucket: 1, n: 1 }
  ]);
});

test("GROUP BY uses each joined column's declared collation", async () => {
  const sql = `CREATE TABLE a(v TEXT COLLATE NOCASE);
    CREATE TABLE b(v TEXT COLLATE RTRIM);
    INSERT INTO a VALUES('a'),('A');
    INSERT INTO b VALUES('x'),('x '),('X');
    SELECT left_side.v AS a, right_side.v AS b, count(*) AS n
      FROM a AS left_side CROSS JOIN b AS right_side
      GROUP BY left_side.v, right_side.v ORDER BY b;`;
  const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", sql]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ a: "a", b: "X", n: 2 }, { a: "a", b: "x", n: 4 }]);
});

for (const { query, stdout } of [
  { query: "SELECT a AS n, b FROM t WHERE n > 1", stdout: "2|y\n3|z\n" },
  { query: "SELECT a + 1 AS n FROM t GROUP BY n HAVING n > 2", stdout: "3\n4\n" },
  { query: "SELECT a + 1 AS N FROM t WHERE n > 2", stdout: "3\n4\n" },
  { query: "SELECT a + 1 AS a FROM t WHERE a > 2", stdout: "4\n" },
  { query: "SELECT a AS n, b FROM t WHERE n > 1; SELECT a + 1 AS n FROM t GROUP BY n HAVING n > 2", stdout: "2|y\n3|z\n3\n4\n" }
]) {
  test(`result aliases: ${query}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), [":memory:",
      `CREATE TABLE t(a, b); INSERT INTO t VALUES(1,'x'),(2,'y'),(3,'z'); ${query};`]);
    assert.deepEqual(result, { code: 0, stdout, stderr: "" });
  });
}

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
