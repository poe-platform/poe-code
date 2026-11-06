import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command } from "./index.js";
import { SqliteDatabase } from "./engine.js";

const graph = `CREATE TABLE edge(src TEXT,dst TEXT);
INSERT INTO edge VALUES
('safe-bash-command-jq','@poe-code/safe-fs'),
('safe-bash-command-jq','safe-bash-byte-engine'),
('safe-bash-command-jq','safe-bash-contracts'),
('safe-bash-command-jq','safe-bash-io-engine'),
('safe-bash-command-jq','safe-bash-query-engine'),
('safe-bash-query-engine','@poe-code/safe-fs'),
('safe-bash-query-engine','safe-bash-contracts'),
('safe-bash-query-engine','safe-bash-regex-engine');`;
const root = [["safe-bash-command-jq", 0]];
const children = ["safe-bash-query-engine", "safe-bash-io-engine", "safe-bash-contracts", "safe-bash-byte-engine", "@poe-code/safe-fs"].map(name => [name, 1]);
const grandchildren = ["safe-bash-regex-engine", "safe-bash-contracts", "@poe-code/safe-fs"].map(name => [name, 2]);

for (const union of ["UNION", "UNION ALL"]) {
  for (const direction of ["ASC", "DESC"]) {
    test(`recursive ${union} prioritizes the whole queue with depth ${direction}`, () => {
      const db = new SqliteDatabase();
      db.exec(graph);
      const result = db.exec(`WITH RECURSIVE walk(name,depth) AS (
        SELECT 'safe-bash-command-jq',0 ${union}
        SELECT edge.dst,walk.depth+1 FROM walk JOIN edge ON edge.src=walk.name
        WHERE depth<3 ORDER BY 2 ${direction},1 DESC
      ) SELECT name,depth FROM walk`);
      assert.deepEqual(result[0]!.rows, direction === "ASC"
        ? [...root, ...children, ...grandchildren]
        : [...root, children[0], ...grandchildren, ...children.slice(1)]);
    });
  }
}

test("recursive queue orders anchors and suppresses already queued UNION rows", () => {
  const db = new SqliteDatabase();
  assert.deepEqual(db.exec(`WITH RECURSIVE walk(n) AS (
    VALUES(1),(3) UNION SELECT n+1 FROM walk WHERE n<3 ORDER BY 1 DESC
  ) SELECT n FROM walk`)[0]!.rows, [[3], [1], [2]]);
});


test("sqlite3 command emits newly discovered deeper dependencies before pending siblings", async () => {
  const stdin = createBytePipe();
  await stdin.close();
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const output = collectBytes(stdout.readable, { maxBytes: Infinity });
  const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
  try {
    const result = await createSqlite3Command({ limits: { maxRows: 200 } }).execute({
      command: "sqlite3",
      args: createCommandArguments([":memory:", `${graph}
        WITH RECURSIVE walk(name,depth) AS (SELECT 'safe-bash-command-jq',0
        UNION ALL SELECT edge.dst,walk.depth+1 FROM walk JOIN edge ON edge.src=walk.name
        WHERE depth<3 ORDER BY 2 DESC,1 DESC) SELECT name,depth FROM walk;`]).args,
      stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
      fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal
    });
    assert.equal(result.exitCode, 0);
  } finally {
    await stdout.close();
    await stderr.close();
  }
  assert.equal(new TextDecoder().decode(await errors), "");
  assert.equal(new TextDecoder().decode(await output),
    [...root, children[0]!, ...grandchildren, ...children.slice(1)].map(row => row.join("|") + "\n").join(""));
});
