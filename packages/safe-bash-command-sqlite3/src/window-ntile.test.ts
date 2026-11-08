import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

const setup = "CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1),(2),(3),(4),(5),(6),(7);";

for (const [buckets, partition, values] of [
  ["id+1", "", [1, 1, 1, 1, 2, 2, 2]],
  ["id+1", "PARTITION BY id % 2", [1, 1, 1, 2, 2, 3, 2]],
  ["8-id", "", [1, 2, 3, 4, 5, 6, 7]],
  ["2-id+1", "", [1, 1, 1, 1, 2, 2, 2]],
  ["2.9", "", [1, 1, 1, 1, 2, 2, 2]],
  ["'2x'", "", [1, 1, 1, 1, 2, 2, 2]],
  [5, "", [1, 1, 2, 2, 3, 4, 5]],
  [10, "", [1, 2, 3, 4, 5, 6, 7]],
  [3, "", [1, 1, 1, 2, 2, 3, 3]],
  [1, "", [1, 1, 1, 1, 1, 1, 1]],
  [7, "", [1, 2, 3, 4, 5, 6, 7]],
  [2, "PARTITION BY id % 2", [1, 1, 1, 1, 2, 2, 2]],
] as const) {
  test(`ntile(${buckets}) distributes larger buckets first ${partition}`, async () => {
    const db = new SqliteDatabase();
    db.exec(setup);
    const sql = `SELECT ntile(${buckets}) OVER(${partition} ORDER BY id) FROM t ORDER BY id`;
    const expected = values.map(value => [value]);
    assert.deepEqual(db.exec(sql)[0]!.rows, expected);
    assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, expected);
    assert.equal(evalSyncSqlite3(undefined, [":memory:", setup, sql]), values.join("\n") + "\n");
  });
}

for (const buckets of ["0", "-1", "NULL", "0.9", "'invalid'", "id-1"]) {
  test(`ntile rejects invalid first bucket count ${buckets}`, async () => {
    const db = new SqliteDatabase();
    db.exec(setup);
    const sql = `SELECT ntile(${buckets}) OVER(ORDER BY id) FROM t`;
    const message = "argument of ntile must be a positive integer";
    assert.throws(() => db.exec(sql), { message });
    await assert.rejects(db.executeStatementAsync(sql, new AbortController().signal), { message });
    assert.equal(evalSyncSqlite3(undefined, [":memory:", setup, sql]), undefined);
    let stdout = "", stderr = "";
    const result = await createSqlite3Command().execute({
      command: "sqlite3", ...createCommandArguments([":memory:", setup, sql]),
      cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 1);
    assert.equal(stdout, "");
    assert.ok(stderr.includes(message));
  });
}

test("ntile takes the count from the first row in window order", async () => {
  const db = new SqliteDatabase();
  db.exec(setup);
  const sql = "SELECT ntile(8-id) OVER(ORDER BY id DESC) FROM t ORDER BY id";
  const expected = Array.from({ length: 7 }, () => [1]);
  assert.deepEqual(db.exec(sql)[0]!.rows, expected);
  assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, expected);
});
