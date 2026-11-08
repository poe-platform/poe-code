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
  for (const storage of ["STORED", "VIRTUAL"]) {
    const name = 'generated "table';
    test(`dump omits generated columns and restores their values (${mode}, ${storage})`, async () => {
      const source = new sqlite.oo1.DB();
      const restored = new sqlite.oo1.DB();
      const identifier = `"${name.replaceAll('"', '""')}"`;
      try {
        source.exec(`CREATE TABLE ${identifier}(n, generated TEXT GENERATED ALWAYS AS (upper(n)) ${storage}, "last column" INTEGER)`);
        source.exec({ sql: `INSERT INTO ${identifier}(n, "last column") VALUES (?, 42)`, bind: ["safe-bash-command-zip"] });
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
        assert.deepEqual(restored.selectArrays(`SELECT * FROM ${identifier}`), [["safe-bash-command-zip", "SAFE-BASH-COMMAND-ZIP", 42]]);
        assert.deepEqual(restored.selectArrays("PRAGMA integrity_check"), [["ok"]]);
      } finally { source.close(); restored.close(); }
    });
  }
}
