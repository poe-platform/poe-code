import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command } from "./index.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";

for (const keyword of ["", "RECURSIVE "]) {
  for (const seed of ["VALUES(1)", "SELECT 1 WHERE 0"]) {
    for (const [member, message] of [
      ["SELECT max(n)+1 FROM c WHERE n<3", "recursive aggregate queries not supported"],
      ["SELECT n+row_number() OVER () FROM c WHERE n<3", "cannot use window functions in recursive queries"],
      ["SELECT coalesce(sum(n),0)+1 FROM c WHERE n<3", "recursive aggregate queries not supported"],
      ["SELECT n+1 FROM c WHERE n<3 GROUP BY n", "recursive aggregate queries not supported"],
      ["SELECT n+sum(n) OVER w FROM c WHERE n<3 WINDOW w AS ()", "cannot use window functions in recursive queries"],
      ["SELECT n+1 FROM c WHERE n<3 UNION ALL SELECT max(n)+1 FROM c WHERE n<3", "recursive aggregate queries not supported"]
    ]) {
      test(`recursive function validation: ${keyword}${seed} / ${member}`, async () => {
        const sql = `WITH ${keyword}c(n) AS (${seed} UNION ALL ${member}) SELECT * FROM c`;
        const db = new SqliteDatabase(200);
        assert.throws(() => db.exec(sql), { message });
        await assert.rejects(db.executeStatementAsync(sql, new AbortController().signal), { message });
      });
    }
  }
}

for (const [seed, expression] of [
  ["SELECT max(1)", "max(n,0)+1"],
  ["SELECT row_number() OVER ()", "min(n,3)+1"],
  ["VALUES(1)", "n+(SELECT max(1))"],
  ["VALUES(1)", "n+(SELECT row_number() OVER ())"]
]) {
  test(`recursive query permits seed and nested functions: ${seed} / ${expression}`, () => {
    const sql = `WITH RECURSIVE c(n) AS (${seed} UNION ALL SELECT ${expression} FROM c WHERE n<3) SELECT * FROM c`;
    assert.deepEqual(new SqliteDatabase(200).exec(sql)[0]!.rows, [[1], [2], [3]]);
  });
}

for (const [expression, message] of [
  ["max(n)+1", "recursive aggregate queries not supported"],
  ["n+row_number() OVER ()", "cannot use window functions in recursive queries"]
]) {
  test(`sqlite3 rejects recursive ${expression} without output`, async () => {
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const sql = `WITH RECURSIVE c(n) AS (VALUES(1) UNION SELECT ${expression} FROM c WHERE n<3) SELECT * FROM c`;
    const result = await createSqlite3Command({ limits: { maxRows: 200 } }).execute({
      command: "sqlite3", args: createCommandArguments([":memory:", sql]).args,
      stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
      fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.from(await output).toString(), "");
    assert.ok(Buffer.from(await errors).toString().includes(message!));
  });
}
