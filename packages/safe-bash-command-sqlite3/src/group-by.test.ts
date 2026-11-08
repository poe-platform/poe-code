import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command } from "./index.js";


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
