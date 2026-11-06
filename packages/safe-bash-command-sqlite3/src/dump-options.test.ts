import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import init from "@sqlite.org/sqlite-wasm";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";
import { sqlQuoteParts } from "./stream-output.js";

const wasmBinary = await readFile(createRequire(import.meta.url).resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"));
const sqlite = await init({ wasmBinary } as Parameters<typeof init>[0]);

for (const [value, expected] of [
  ["a\r\nb'c", "replace(replace('a\\r\\nb''c','\\r',char(13)),'\\n',char(10))"],
  ["\\n\\012(\\n0)\n", "replace('\\n\\012(\\n0)(\\n1)','(\\n1)',char(10))"],
  ["\\r\\015(\\r0)\r", "replace('\\r\\015(\\r0)(\\r1)','(\\r1)',char(13))"],
  ["a".repeat(4095) + "\r\n'", "replace(replace('" + "a".repeat(4095) + "\\r\\n''','\\r',char(13)),'\\n',char(10))"],
  ["plain' text", "'plain'' text'"]
] as const) {
  test(`dump newline quoting matches native SQLite for ${JSON.stringify(value.slice(-40))}`, () => {
    const expression = [...sqlQuoteParts(value, false)].join("");
    assert.equal(expression, expected);
    const db = new sqlite.oo1.DB();
    try {
      assert.equal(db.selectValue(`SELECT ${expression}`), value);
      assert.equal(db.selectValue(`SELECT ${[...sqlQuoteParts(value, true)].join("")}`), value);
    } finally { db.close(); }
  });
}

for (const mode of ["async", "sync", "injected"]) {
  for (const pattern of [" t", ""]) {
    for (const option of ["", "--data-only", "--preserve-rowids", "--nosys", "--newlines", "--data-only --preserve-rowids --nosys", "--preserve-rowids --newlines"]) {
      test(`dump options restore actual data (${mode}, ${option}, pattern=${pattern})`, async () => {
        const source = new sqlite.oo1.DB();
        const restored = new sqlite.oo1.DB();
        const extraSchema = "CREATE TABLE shadow(rowid TEXT, n); CREATE TABLE keyed(id INTEGER PRIMARY KEY,n); CREATE TABLE no_rowid(k TEXT PRIMARY KEY,n) WITHOUT ROWID;";
        try {
          source.exec(`CREATE TABLE t(n); INSERT INTO t(rowid,n) VALUES(33,'a'||char(10)||'.quit'||char(10)||'b'); CREATE TABLE unrelated(x); INSERT INTO unrelated VALUES(9); ANALYZE;`);
          source.exec(extraSchema + "INSERT INTO shadow(_rowid_,rowid,n) VALUES(42,'named',8); INSERT INTO keyed VALUES(51,7); INSERT INTO no_rowid VALUES('key',6);");
          if (option.includes("--data-only")) restored.exec("CREATE TABLE t(n); CREATE TABLE unrelated(x); ANALYZE;" + extraSchema);
          const fs = createMemoryFileSystem();
          const sourceBytes = sqlite.capi.sqlite3_js_db_export(source);
          await fs.writeFile("/source.db", sourceBytes);
          let stdout = "", stderr = "";
          if (mode === "sync") {
            stdout = evalSyncSqlite3(new TextEncoder().encode(`.dump ${option}${pattern}\n`), ["/source.db"], () => sourceBytes)!;
            assert.equal(typeof stdout, "string");
          } else {
            const result = await createSqlite3Command(mode === "injected" ? {
              engine: { exec(sql: string) {
                const rows: (string | number | bigint | Uint8Array | null)[][] = [];
                const columns: string[] = [];
                source.exec({ sql, rowMode: "array", resultRows: rows, columnNames: columns });
                return [{ rows, columns }];
              } }
            } : {}).execute({
              command: "sqlite3", ...createCommandArguments([mode === "injected" ? ":memory:" : "/source.db"]),
              fs, cwd: "/", env: {}, signal: new AbortController().signal,
              stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(`.dump ${option}${pattern}\n`); } },
              stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
              stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            assert.equal(result.exitCode, 0, stderr);
          }
          restored.exec(stdout);
          assert.deepEqual(restored.selectArrays(`SELECT * FROM t`), [["a\n.quit\nb"]]);
          if (pattern && !option.includes("--data-only")) assert.deepEqual(restored.selectArrays("SELECT name FROM sqlite_master WHERE name='unrelated'"), []);
          if (!pattern && option.includes("--nosys")) assert.ok(!stdout.includes("sqlite_stat1"));
          if (option.includes("--preserve-rowids")) assert.deepEqual(restored.selectArrays("SELECT rowid FROM t"), [[33]]);
          if (option.includes("--data-only")) assert.ok(!stdout.includes("CREATE") && !stdout.includes("TRANSACTION"));
          if (option.includes("--newlines")) assert.ok(stdout.includes("a\n.quit\nb"));
          else {
            assert.ok(!stdout.includes("a\n.quit\nb"));
            assert.ok(stdout.includes("replace('a\\n.quit\\nb','\\n',char(10))"), stdout);
          }
          if (!pattern) {
            assert.deepEqual(restored.selectArrays("SELECT * FROM shadow"), [["named", 8]]);
            assert.deepEqual(restored.selectArrays("SELECT * FROM keyed"), [[51, 7]]);
            assert.deepEqual(restored.selectArrays("SELECT * FROM no_rowid"), [["key", 6]]);
            if (option.includes("--preserve-rowids")) assert.deepEqual(restored.selectArrays("SELECT _rowid_ FROM shadow"), [[42]]);
          }
          assert.deepEqual(restored.selectArrays("PRAGMA integrity_check"), [["ok"]]);
        } finally { source.close(); restored.close(); }
      });
    }
  }
}

test("dump rejects unknown options before emitting a backup", async () => {
  let stdout = "", stderr = "";
  const result = await createSqlite3Command().execute({
    command: "sqlite3", ...createCommandArguments([":memory:", ".dump --unknown"]),
    fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, 1);
  assert.equal(stdout, "");
  assert.ok(stderr.includes("unknown option: --unknown"), stderr);
});
