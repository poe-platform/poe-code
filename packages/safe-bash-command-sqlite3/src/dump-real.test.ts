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

for (const mode of ["async", "sync"]) {
  for (const output of ["dump", "quote", "insert"]) {
    test(`${mode} ${output} restores REAL exponent values and storage classes`, async () => {
      const source = new sqlite.oo1.DB();
      const restored = new sqlite.oo1.DB();
      try {
        source.exec("CREATE TABLE t(x); INSERT INTO t VALUES(1.0),(1.2345678901234567),(9007199254740993),(1e300),(-1e300),(1e21),(1e20),(0.00000095367431640625);");
        const bytes = sqlite.capi.sqlite3_js_db_export(source);
        const input = output === "dump" ? ".dump\n" : `.mode ${output}${output === "insert" ? " t" : ""}\nSELECT x FROM t;\n`;
        let stdout = "", stderr = "";
        if (mode === "sync") {
          stdout = evalSyncSqlite3(new TextEncoder().encode(input), ["/source.db"], () => bytes)!;
          assert.equal(typeof stdout, "string");
        } else {
          const fs = createMemoryFileSystem();
          await fs.writeFile("/source.db", bytes);
          const result = await createSqlite3Command().execute({
            command: "sqlite3", ...createCommandArguments(["/source.db"]),
            fs, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(input); } },
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
          });
          assert.equal(result.exitCode, 0, stderr);
        }
        if (output !== "dump") restored.exec("CREATE TABLE t(x)");
        restored.exec(output === "quote"
          ? stdout.trim().split("\n").map(value => `INSERT INTO t VALUES(${value});`).join("\n")
          : stdout);
        assert.deepEqual(restored.selectArrays("SELECT quote(x), typeof(x) FROM t"),
          source.selectArrays("SELECT quote(x), typeof(x) FROM t"));
      } finally {
        source.close();
        restored.close();
      }
    });
  }
}
