import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import init from "@sqlite.org/sqlite-wasm";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

const wasmBinary = await readFile(createRequire(import.meta.url).resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"));
const sqlite = await init({ wasmBinary } as Parameters<typeof init>[0]);

for (const mode of ["async", "sync", "injected"]) {
  for (const empty of [false, true]) {
    test(`dump preserves AUTOINCREMENT after deletions (${mode}, empty=${empty})`, async () => {
      const source = new sqlite.oo1.DB();
      const restored = new sqlite.oo1.DB();
      try {
        source.exec("CREATE TABLE t(id INTEGER PRIMARY KEY AUTOINCREMENT,n); INSERT INTO t VALUES(1,'kept'),(81,'deleted'); DELETE FROM t WHERE id=81;");
        if (empty) source.exec("DELETE FROM t");
        const fs = createMemoryFileSystem();
        const sourceBytes = sqlite.capi.sqlite3_js_db_export(source);
        await fs.writeFile("/source.db", sourceBytes);
        let stdout = "", stderr = "";
        if (mode === "sync") {
          stdout = evalSyncSqlite3(new TextEncoder().encode(".dump\n"), ["/source.db"], () => sourceBytes)!;
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
            stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(".dump\n"); } },
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
          });
          assert.equal(result.exitCode, 0, stderr);
        }
        restored.exec(stdout);
        restored.exec("INSERT INTO t(n) VALUES('new')");
        assert.deepEqual(restored.selectArrays("SELECT max(id) FROM t"), [[82]]);
        assert.deepEqual(restored.selectArrays("SELECT * FROM sqlite_sequence"), [["t", 82]]);
        assert.deepEqual(restored.selectArrays("PRAGMA integrity_check"), [["ok"]]);
      } finally { source.close(); restored.close(); }
    });
  }
}
