import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

const setup = "CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1),(2),(3),(4),(5),(6),(7);";

for (const [position, frame, values] of [
  ["2", "ROWS CURRENT ROW", [null,null,null,null,null,null,null]],
  ["2", "ROWS BETWEEN 1 PRECEDING AND CURRENT ROW", [null,2,3,4,5,6,7]],
  ["1", "ROWS BETWEEN 2 PRECEDING AND 1 PRECEDING", [null,1,1,2,3,4,5]],
  ["'2.0'", "", [null,2,2,2,2,2,2]],
  ["9223372036854775807", "", [null,null,null,null,null,null,null]],
] as const) {
  test(`nth_value(${position}) respects ${frame || "the default frame"}`, async () => {
    const db = new SqliteDatabase();
    db.exec(setup);
    const sql = `SELECT nth_value(id,${position}) OVER(ORDER BY id ${frame}) FROM t ORDER BY id`;
    assert.deepEqual(db.exec(sql)[0]!.rows, values.map(value => [value]));
    assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, values.map(value => [value]));
    assert.equal(evalSyncSqlite3(undefined, [":memory:", setup, sql]), values.map(value => value ?? "").join("\n") + "\n");
  });
}

for (const position of ["0", "-1", "1.5", "NULL", "'2x'", "x'32'", "9223372036854775808", "id-1"]) {
  test(`nth_value rejects invalid position ${position}`, async () => {
    const db = new SqliteDatabase();
    db.exec(setup);
    const sql = `SELECT nth_value(id,${position}) OVER(ORDER BY id) FROM t`;
    const error = /second argument to nth_value must be a positive integer/;
    assert.throws(() => db.exec(sql), error);
    await assert.rejects(db.executeStatementAsync(sql, new AbortController().signal), error);
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
    assert.match(stderr, error);
  });
}
