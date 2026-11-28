import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

const setup = "CREATE TABLE t(a, b); INSERT INTO t VALUES(1,'x'),(1,'z'),(2,'y'),(2,'w');";

for (const [query, expected] of [
  ["SELECT a, b, max(rowid) FROM t GROUP BY a;", "1|z|2\n2|w|4\n"],
  ["SELECT a, b, min(b) FROM t GROUP BY a;", "1|x|x\n2|w|w\n"],
  ["SELECT max(a), b FROM t;", "2|y\n"],
  ["SELECT *, max(rowid) FROM t GROUP BY a;", "1|z|2\n2|w|4\n"],
  ["SELECT b, max(rowid) + 1 FROM t HAVING b = 'w';", "w|5\n"],
  ["SELECT b FROM t HAVING max(rowid) = 4;", "w\n"],
  ["SELECT b, max(rowid) FILTER (WHERE b != 'w') FROM t;", "y|3\n"],
  ["SELECT b, min(b COLLATE NOCASE) FROM t;", "w|w\n"],
  ["SELECT b, max(DISTINCT a) FROM t;", "y|2\n"],
  ["SELECT b, max(rowid) FROM t WHERE 0;", "|\n"],
  ["SELECT b, sum(a) FROM t;", "x|6\n"],
  ["SELECT b, max(a, 0) FROM t;", "x|1\nz|1\ny|2\nw|2\n"],
  ["SELECT a, b, max(rowid) FROM t GROUP BY a; SELECT a, b, min(b) FROM t GROUP BY a; SELECT max(a), b FROM t;", "1|z|2\n2|w|4\n1|x|x\n2|w|w\n2|y\n"]
]) {
  test(`bare columns: ${query}`, async () => {
    const args = [":memory:", setup + query];
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const result = await createSqlite3Command().execute({
      command: "sqlite3", args: createCommandArguments(args).args,
      stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
      fs: createMemoryFileSystem(), cwd: "/work", env: {}, signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(await errors).toString(), "");
    assert.equal(Buffer.from(await output).toString(), expected);
    assert.equal(evalSyncSqlite3(undefined, args), expected);
  });
}
