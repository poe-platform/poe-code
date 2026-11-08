import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const trigger of [false, true]) {
  const script = [
    "CREATE TABLE t(a UNIQUE,b);",
    ...(trigger ? ["CREATE TRIGGER inserted AFTER INSERT ON t BEGIN SELECT 1; END;"] : []),
    ".import --csv rows.csv t",
    "SELECT * FROM t ORDER BY a;"
  ].join("\n");
  const rows = new TextEncoder().encode("1,a\n1,b\n2,c\n");

  test(`CSV import preserves later valid rows after a UNIQUE violation (trigger=${trigger})`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/rows.csv", rows);
    let stdout = "", stderr = "";
    const result = await createSqlite3Command().execute({
      command: "sqlite3", ...createCommandArguments([":memory:"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(script); } },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(stdout, "1|a\n2|c\n");
    assert.equal(stderr, "rows.csv:2: INSERT failed: UNIQUE constraint failed: t.a\n");
    assert.equal(result.exitCode, 1);
  });

  test(`sync CSV import defers UNIQUE violation diagnostics (trigger=${trigger})`, () => {
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"], () => rows), undefined);
  });
}
