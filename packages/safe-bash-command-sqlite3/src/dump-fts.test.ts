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
  for (const options of ["", ", tokenize='porter'"]) {
    test(`FTS5 dump restores its inverted index after reopening (${mode}, ${options})`, async () => {
      const source = new sqlite.oo1.DB();
      const restored = new sqlite.oo1.DB();
      const reopened = new sqlite.oo1.DB();
      try {
        source.exec(`CREATE VIRTUAL TABLE t USING fts5(n${options})`);
        for (let i = 1; i <= 10; i++) {
          source.exec({ sql: "INSERT INTO t(rowid,n) VALUES (?,?)", bind: [i * 3, `fftools/file${i}.c`] });
        }
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
        const bytes = sqlite.capi.sqlite3_js_db_export(restored);
        restored.close();
        const pointer = sqlite.wasm.allocFromTypedArray(bytes);
        assert.equal(sqlite.capi.sqlite3_deserialize(reopened, "main", pointer, bytes.length, bytes.length,
          sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE), 0);
        assert.deepEqual(reopened.selectArrays("SELECT count(*) FROM t WHERE t MATCH 'fftools'"), [[10]]);
        assert.deepEqual(reopened.selectArrays("SELECT rowid,n FROM t ORDER BY rowid"), source.selectArrays("SELECT rowid,n FROM t ORDER BY rowid"));
        assert.deepEqual(reopened.selectArrays("PRAGMA integrity_check"), [["ok"]]);
        reopened.exec("INSERT INTO t(t) VALUES('integrity-check')");
      } finally { source.close(); restored.close(); reopened.close(); }
    });
  }
}
