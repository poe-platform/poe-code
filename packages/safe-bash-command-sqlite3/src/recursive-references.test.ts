import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command } from "./index.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";

const invalidMembers = [
  ["SELECT n+1 FROM (SELECT * FROM c) WHERE n<3", "circular reference: c"],
  ["SELECT a.n+b.n FROM c a,c b WHERE a.n+b.n<5", "multiple references to recursive table: c"],
  ["SELECT a.n+b.n FROM c a JOIN c b ON a.n=b.n WHERE a.n+b.n<5", "multiple references to recursive table: c"],
  ["SELECT n+1 FROM c WHERE n<3 AND EXISTS(SELECT 1 FROM c)", "multiple recursive references: c"],
  ["SELECT (SELECT n+1 FROM c WHERE n<3)", "circular reference: c"],
  ['SELECT a.n+b.n FROM "C" a, [c] b WHERE a.n+b.n<5', "multiple references to recursive table: c"]
];

for (const [member, message] of invalidMembers) {
  for (const seed of ["VALUES(1)", "SELECT 1 WHERE 0"]) {
    test(`recursive reference validation: ${seed} / ${member}`, async () => {
      const sql = `WITH RECURSIVE c(n) AS (${seed} UNION ${member}) SELECT * FROM c`;
      const db = new SqliteDatabase(200);
      assert.throws(() => db.exec(sql), { message });
      await assert.rejects(db.executeStatementAsync(sql, new AbortController().signal), { message });
    });
  }
}

for (const [member, message] of invalidMembers.slice(0, 2)) {
  test(`sqlite3 rejects ${member} without output`, async () => {
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const sql = `WITH RECURSIVE c(n) AS (VALUES(1) UNION ${member}) SELECT * FROM c`;
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

test("each recursive SELECT may reference the table once and use unrelated subqueries", () => {
  const sql = `WITH RECURSIVE c(n) AS (
    VALUES(1) UNION ALL SELECT n+(SELECT 1) FROM c WHERE n<2
    UNION ALL SELECT n+2 FROM c WHERE n<2
  ) SELECT * FROM c ORDER BY n`;
  assert.deepEqual(new SqliteDatabase(200).exec(sql)[0]!.rows, [[1], [2], [3]]);
});
