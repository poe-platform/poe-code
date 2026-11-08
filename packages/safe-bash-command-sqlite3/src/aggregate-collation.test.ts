import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const { declaration, expression, values, suffix, expected } of [
  { declaration: "TEXT", expression: "v COLLATE NOCASE", values: "('a'),('B'),('C'),(NULL)", suffix: "", expected: [{ lo: "a", hi: "C" }] },
  { declaration: "TEXT COLLATE NOCASE", expression: "v", values: "('a'),('B'),('C')", suffix: "", expected: [{ lo: "a", hi: "C" }] },
  { declaration: "TEXT COLLATE NOCASE", expression: "v COLLATE BINARY", values: "('a'),('B'),('C')", suffix: "", expected: [{ lo: "B", hi: "a" }] },
  { declaration: "TEXT", expression: "v", values: "('a'),('B'),('C')", suffix: "", expected: [{ lo: "B", hi: "a" }] },
  { declaration: "TEXT", expression: "v COLLATE RTRIM", values: "('a '),('a')", suffix: "", expected: [{ lo: "a ", hi: "a " }] },
  { declaration: "TEXT", expression: "v COLLATE NOCASE", values: "('a'),('A')", suffix: "", expected: [{ lo: "a", hi: "a" }] },
  { declaration: "TEXT", expression: "v COLLATE NOCASE", values: "('é'),('É')", suffix: "", expected: [{ lo: "É", hi: "é" }] },
  { declaration: "TEXT", expression: "v COLLATE NOCASE", values: "(NULL)", suffix: "", expected: [{ lo: null, hi: null }] },
  { declaration: "TEXT", expression: "v COLLATE NOCASE", values: "('a')", suffix: "WHERE 0", expected: [{ lo: null, hi: null }] },
  { declaration: "TEXT COLLATE NOCASE", expression: "v", values: "('a'),('B'),('C')", suffix: "GROUP BY 1+0", expected: [{ lo: "a", hi: "C" }] },
  { declaration: "TEXT COLLATE NOCASE", expression: "v", values: "('a'),('B'),('C')", suffix: "WINDOW w AS ()", expected: Array.from({ length: 3 }, () => ({ lo: "a", hi: "C" })) }
]) {
  test(`MIN/MAX collation: ${declaration}, ${expression}, ${values}, ${suffix}`, async () => {
    const window = suffix.startsWith("WINDOW") ? " OVER w" : "";
    const sql = `CREATE TABLE t(v ${declaration}); INSERT INTO t VALUES${values};
      SELECT MIN(${expression})${window} AS lo, MAX(${expression})${window} AS hi FROM t ${suffix};`;
    const args = ["-json", ":memory:", sql];
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const result = await createSqlite3Command().execute({
      command: "sqlite3", args: createCommandArguments(args).args,
      stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
      fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(await errors).toString(), "");
    assert.deepEqual(JSON.parse(Buffer.from(await output).toString()), expected);
    const syncOutput = evalSyncSqlite3(undefined, args);
    assert.equal(typeof syncOutput, "string");
    assert.deepEqual(JSON.parse(syncOutput!), expected);
  });
}
