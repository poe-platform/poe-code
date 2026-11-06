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
  for (const [patterns, tables, views] of [
    ["a b", ["a", "b"], []],
    ["pkg_%", ["pkg_a"], ["pkg_v"]],
    ["a*", [], []],
    ["a% a abc", ["a", "abc"], []],
    ["PKG__", ["pkg_a"], ["pkg_v"]],
    ['""', [], []],
    ["é", ["é"], []],
    ["pkg_a ix tr", ["pkg_a"], []]
  ] as const) {
    test(`dump SQL LIKE patterns ${patterns} (${mode})`, async () => {
      const source = new sqlite.oo1.DB();
      const restored = new sqlite.oo1.DB();
      try {
        for (const name of ["a", "abc", "b", "c", "pkg_a", "é", "É"]) {
          source.exec(`CREATE TABLE "${name}"(x); INSERT INTO "${name}" VALUES(42);`);
        }
        source.exec("CREATE VIEW pkg_v AS SELECT * FROM pkg_a; CREATE INDEX ix ON pkg_a(x); CREATE TRIGGER tr AFTER INSERT ON pkg_a BEGIN SELECT 1; END;");
        const fs = createMemoryFileSystem();
        const sourceBytes = sqlite.capi.sqlite3_js_db_export(source);
        await fs.writeFile("/source.db", sourceBytes);
        const input = new TextEncoder().encode(`.dump ${patterns}\n`);
        let stdout = "", stderr = "";
        if (mode === "sync") {
          stdout = evalSyncSqlite3(input, ["/source.db"], () => sourceBytes)!;
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
            stdin: { async *[Symbol.asyncIterator]() { yield input; } },
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
          });
          assert.equal(result.exitCode, 0, stderr);
        }
        restored.exec(stdout);
        assert.deepEqual(restored.selectArrays("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"), tables.map(name => [name]));
        assert.deepEqual(restored.selectArrays("SELECT name FROM sqlite_schema WHERE type='view' ORDER BY name"), views.map(name => [name]));
        assert.deepEqual(restored.selectArrays("SELECT name FROM sqlite_schema WHERE type IN ('index','trigger') ORDER BY name"), patterns === "pkg_a ix tr" ? [["ix"], ["tr"]] : []);
        for (const name of tables) assert.deepEqual(restored.selectArrays(`SELECT * FROM "${name}"`), [[42]]);
        for (const name of views) assert.deepEqual(restored.selectArrays(`SELECT * FROM "${name}"`), [[42]]);
      } finally { source.close(); restored.close(); }
    });
  }
}
