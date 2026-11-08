import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const [join, expected] of [
  ["JOIN b ON a.v=b.v", "a|A\n"],
  ["JOIN b USING(v)", "a|A\n"],
  ["NATURAL JOIN b", "a|A\n"],
  ["JOIN b ON b.v=a.v", ""],
  ["JOIN b ON a.v=b.v AND a.id=b.id", "a|A\n"],
  ["JOIN b USING(id,v)", "a|A\n"],
  ["JOIN b ON a.v COLLATE BINARY=b.v", ""],
  ["JOIN b ON b.v=a.v COLLATE NOCASE", "a|A\n"],
  ["LEFT JOIN b USING(v)", "a|A\né|\n|\n"],
  ["RIGHT JOIN b USING(v)", "a|A\n|É\n|\n"],
] as const) {
  test(`join column collation: ${join}`, () => {
    const sql = `CREATE TABLE a(v TEXT COLLATE NOCASE,id INT);
      CREATE TABLE b(v TEXT,id INT);
      INSERT INTO a VALUES('a',1),('é',2),(NULL,3);
      INSERT INTO b VALUES('A',1),('É',2),(NULL,3);
      SELECT a.v,b.v FROM a ${join};`;
    assert.equal(evalSyncSqlite3(undefined, [":memory:", sql]), expected);
  });
}

test("join hash keys respect RTRIM collation", () => {
  assert.equal(evalSyncSqlite3(undefined, [":memory:", `
    CREATE TABLE a(v TEXT COLLATE RTRIM); CREATE TABLE b(v TEXT);
    INSERT INTO a VALUES('a '); INSERT INTO b VALUES('a');
    SELECT a.v,b.v FROM a JOIN b USING(v);
  `]), "a |a\n");
});

for (const join of ["JOIN b ON a.v=b.v", "JOIN b USING(v)", "NATURAL JOIN b"]) {
  test(`public sqlite3 command preserves join collation: ${join}`, async () => {
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const result = await createSqlite3Command().execute({
      command: "sqlite3",
      args: createCommandArguments(["-json", ":memory:", `
        CREATE TABLE a(v TEXT COLLATE NOCASE); CREATE TABLE b(v TEXT);
        INSERT INTO a VALUES('a'); INSERT INTO b VALUES('A');
        SELECT a.v AS a,b.v AS b FROM a ${join};
      `]).args,
      stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
      fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(await errors).toString(), "");
    assert.deepEqual(JSON.parse(Buffer.from(await output).toString()), [{ a: "a", b: "A" }]);
  });
}
