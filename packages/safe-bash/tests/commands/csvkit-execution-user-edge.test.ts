import test from "node:test";
import assert from "node:assert/strict";
import { CsvkitBlocked, createMemorySqliteFileSystem, createSqliteDatabaseProvider, utf8Codec } from "@poe-code/csvkit";
import { readFile } from "node:fs/promises";
import { Volume } from "memfs";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import reference from "../../../../docs/csvkit/io-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const encoder = new TextEncoder();
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

for (const [index, observation] of reference.cases.entries()) {
  test(`csvkit execution user edge ${index}: ${observation.command} ${observation.argv.join(" ")}`, async () => {
    const fs = new MemoryFileSystem();
    for (const [path, text] of Object.entries(observation.files)) await fs.writeFile(`/${path}`, encoder.encode(text));
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    let inputClosed = 0;
    let inputStarted = false;
    const input = encoder.encode(observation.stdin);
    const fragmented = { async *[Symbol.asyncIterator]() {
      inputStarted = true;
      const byte = new Uint8Array(1);
      try {
        for (const value of input) { byte[0] = value; yield byte; yield new Uint8Array(); }
      } finally { byte[0] = 255; inputClosed++; }
    } };
    try {
      const command = [observation.command, ...observation.argv].map(quote).join(" ");
      const result = await shell.exec(command, { stdin: fragmented });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdoutBytes, stderr: result.stderrBytes }, {
        status: observation.status, stdout: encoder.encode(observation.stdout), stderr: encoder.encode(observation.stderr)
      });
      assert.equal(inputClosed, inputStarted ? 1 : 0, "admitted borrowed input must close exactly once");
      for (const [path, text] of Object.entries(observation.files)) assert.deepEqual(await fs.readFile(`/${path}`), encoder.encode(text));
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), Object.keys(observation.files).sort());
    } finally { await shell.dispose(); }
  });
}

test("bound SQLite shell reports revoked read authority and releases files before reopening", async () => {
  // Existing pinned infrastructure asset only; product receives the engine.
  const wasmBinary = await readFile(new URL(import.meta.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")));
  const sqlite = await sqlite3InitModule({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof sqlite3InitModule>[0]);
  const volume = Volume.fromJSON({ "/authorized/.keep": "" });
  const vfs = createMemorySqliteFileSystem(volume, { authorize: path => path.startsWith("/authorized/"), maxBytes: 1_000_000 });
  let denied = false, acquired = 0, closed = 0;
  const database = createSqliteDatabaseProvider({ sqlite, cwd: "/authorized", clock: { now: () => 0 }, random: bytes => bytes.fill(7),
    vfs: { ...vfs, open(path, flags) {
      const file = vfs.open(path, flags);
      acquired++;
      let fileClosed = false;
      return { ...file,
        read(...args: Parameters<typeof file.read>) {
          if (denied) throw new CsvkitBlocked("SQLite host divergence: revoked read authorization");
          return file.read(...args);
        },
        close() { assert.equal(fileClosed, false); fileClosed = true; closed++; file.close(); }
      };
    } }
  });
  const signal = new AbortController().signal;
  const seed = await database.connect("sqlite:///test.db", {}, signal);
  for (const query of ["CREATE TABLE t(x)", "INSERT INTO t VALUES(42)"]) {
    const result = await seed.query(query, [], {}, signal);
    for await (const row of result.rows) assert.fail(`unexpected DDL/DML row ${String(row)}`);
    await result.close();
  }
  await seed.commit(signal);
  await seed.close();
  const snapshot = volume.readFileSync("/authorized/test.db");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, databases: [database] }));
  try {
    denied = true;
    const result = await shell.exec("sql2csv --db sqlite:////authorized/test.db --query 'SELECT x FROM t'");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 78, stdout: "", stderr: "csvkit: unsupported or unqualified: SQLite host divergence: revoked read authorization\n"
    });
    assert.equal(closed, acquired, "failed acquisition must release every VFS file");
    assert.deepEqual(volume.readFileSync("/authorized/test.db"), snapshot);
    denied = false;
    const reopened = await shell.exec("sql2csv --db sqlite:////authorized/test.db --query 'SELECT x FROM t'");
    assert.deepEqual({ status: reopened.exitCode, stdout: reopened.stdout, stderr: reopened.stderr }, { status: 0, stdout: "x\n42\n", stderr: "" });
    assert.equal(closed, acquired, "reopened query must release every VFS file");
  } finally { await shell.dispose(); await database.dispose(); }
});
