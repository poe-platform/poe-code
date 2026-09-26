import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Volume } from "memfs";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { createSqliteDatabaseProvider, createMemorySqliteFileSystem, utf8Codec } from "safe-bash-command-csvkit";
import { FsError } from "../../src/contracts/errors.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, createCsvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

// The test loader reads the existing pinned WASM infrastructure asset. Product
// registration receives this initialized capability and never loads host assets.
const wasmBinary = await readFile(new URL(import.meta.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")));
const sqlite = await sqlite3InitModule({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof sqlite3InitModule>[0]);
const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec], locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 }, terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
const provider = () => createSqliteDatabaseProvider({ sqlite, cwd: "/", clock: { now: () => 0 }, random: bytes => { bytes.fill(7); } });

const cases = [
  { name: "reference SQLite version", sql: "SELECT sqlite_version() AS version", stdout: "version\n3.50.4\n" },
  { name: "recursive CTE with aggregate", sql: "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4) SELECT sum(x) AS total,count(*) AS n FROM n", stdout: "total,n\n10,4\n" },
  { name: "join, window and order", sql: "WITH a(x) AS (VALUES(3),(1),(2)), b(y) AS (VALUES(1),(3)) SELECT x,row_number() OVER (ORDER BY x DESC) AS position FROM a JOIN b ON x=y ORDER BY x DESC", stdout: "x,position\n3,1\n1,2\n" },
  { name: "subquery, NULL and integer boundaries", sql: "SELECT (SELECT max(x) FROM (SELECT 2 AS x UNION ALL SELECT 9)) AS value,NULL AS blank,9223372036854775807 AS maximum", stdout: "value,blank,maximum\n9,,9223372036854775807\n" },
  { name: "semicolons in string literals and trailing comments", sql: "SELECT 'a;b' AS value; -- harmless trailing comment", stdout: "value\na;b\n" },
  { name: "floating point result representation", sql: "SELECT 2.0 AS integral,1.5 AS fraction", stdout: "integral,fraction\n2.0,1.5\n" },
  { name: "SQLite date functions", sql: "SELECT date('2000-02-28','+1 day') AS date,julianday('2000-01-01') AS julian", stdout: "date,julian\n2000-02-29,2451544.5\n" },
  { name: "blob result representation", sql: "SELECT x'616263' AS blob", stdout: "blob\nb'abc'\n" },
  { name: "case-insensitive collation", sql: "WITH t(x) AS (VALUES('B'),('a')) SELECT x FROM t ORDER BY x COLLATE NOCASE", stdout: "x\na\nB\n" }
];
for (const item of cases) test(`bound SQLite actual Shell ${item.name}`, async () => {
  const database = provider();
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, databases: [database] }));
  try {
    const result = await shell.exec(`sql2csv --query ${quote(item.sql)}`);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: item.stdout, stderr: "", status: 0 });
  } finally { await shell.dispose(); await database.dispose(); }
});

test("bound SQLite csvsql imports and executes the same actual engine", async () => {
  const database = provider();
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, databases: [database] }));
  try {
    const sql = "WITH selected AS (SELECT a FROM stdin WHERE a IN (SELECT a FROM stdin WHERE a <> 'z')) SELECT count(*) AS n FROM selected";
    const result = await shell.exec(`csvsql -I -y 0 --query ${quote(sql)}`, { stdin: "a\nx\ny\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "n\n2\n", stderr: "", status: 0 });
  } finally { await shell.dispose(); await database.dispose(); }
});

for (const item of [
  { name: "ATTACH", argv: `--query ${quote("ATTACH DATABASE '/outside.db' AS outside")}` },
  { name: "VACUUM INTO", argv: `--query ${quote("VACUUM INTO '/outside.db'")}` },
  { name: "load_extension", argv: `--query ${quote("SELECT load_extension('/outside.so')")}` },
  { name: "PRAGMA encoding omitted by engine (parity blocker)", argv: `--query ${quote("PRAGMA encoding")}` },
  { name: "file URL", argv: `--db sqlite:////outside.db --query ${quote("SELECT 1")}` }
]) test(`bound SQLite refuses unbound ${item.name} without VFS effects`, async () => {
  const fs = new MemoryFileSystem();
  const before = await fs.readdir("/");
  const database = provider();
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, databases: [database] }));
  try {
    const result = await shell.exec(`sql2csv ${item.argv}`);
    assert.equal(result.exitCode, 78, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /csvkit: unsupported or unqualified:/);
    if (item.name.startsWith("PRAGMA encoding")) assert.match(result.stderr, /SQLite host divergence:.*encoding/);
    assert.deepEqual(await fs.readdir("/"), before);
  } finally { await shell.dispose(); await database.dispose(); }
});

test("bound SQLite actual Shell cancellation drains an acquired real session once", async () => {
  const database = provider();
  const effects: string[] = [];
  const controller = new AbortController();
  let announce!: () => void;
  const acquired = new Promise<void>(resolve => { announce = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const binding = { ...database, async connect(...args: Parameters<typeof database.connect>) {
    const session = await database.connect(...args);
    announce();
    await barrier;
    return { ...session,
      async rollback() { effects.push("rollback"); await session.rollback(); },
      async close() { effects.push("close"); await session.close(); }
    };
  } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, databases: [binding] }));
  let settled = false;
  const reason = new Error("cancel acquired SQLite session");
  try {
    const execution = shell.exec("sql2csv --query 'SELECT 1'", { signal: controller.signal });
    const rejected = assert.rejects(execution, caught => caught === reason).then(() => { settled = true; });
    await acquired;
    controller.abort(reason);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(settled, false);
    assert.deepEqual(effects, []);
    release();
    await rejected;
    assert.deepEqual(effects, ["rollback", "close"]);
    await shell.dispose();
    assert.deepEqual(effects, ["rollback", "close"]);
  } finally { release(); await shell.dispose(); await database.dispose(); }
});

test("bound SQLite output consumer closure finalizes real statement and session once", async () => {
  const database = provider();
  const effects: string[] = [];
  const binding = { ...database, async connect(...args: Parameters<typeof database.connect>) {
    const session = await database.connect(...args);
    return { ...session,
      async query(...queryArgs: Parameters<typeof session.query>) {
        const result = await session.query(...queryArgs);
        return { ...result, async close() { effects.push("result-close"); await result.close(); } };
      },
      async rollback() { effects.push("rollback"); await session.rollback(); },
      async close() { effects.push("session-close"); await session.close(); }
    };
  } };
  const definition = createCsvkitCommands({ ...options, databases: [binding] }).find(command => command.name === "sql2csv")!;
  const consumer = new AbortController(), caller = new AbortController();
  const reason = new FsError("EPIPE");
  const cleanups: (() => void | Promise<void>)[] = [];
  const writes: string[] = [];
  const write = async (bytes: Uint8Array) => {
    if (writes.length) { consumer.abort(reason); throw reason; }
    writes.push(new TextDecoder().decode(bytes));
  };
  const execution = Promise.resolve(definition.execute({ command: "sql2csv", args: ["--query", "WITH t(x) AS (VALUES(1),(2),(3)) SELECT x FROM t"],
    cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { async *[Symbol.asyncIterator]() { assert.fail("explicit SQL must not acquire stdin"); yield new Uint8Array(); } },
    stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } },
    stderr: { async write() { assert.fail("output cancellation must not emit diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  try {
    await assert.rejects(execution, caught => caught === reason);
    assert.deepEqual(writes, ["x\n"]);
    assert.equal(caller.signal.aborted, false);
    assert.deepEqual(effects, ["result-close", "rollback", "session-close"]);
    await Promise.all(cleanups.map(cleanup => cleanup()));
    assert.deepEqual(effects, ["result-close", "rollback", "session-close"]);
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); await database.dispose(); }
});

test("bound SQLite actual Shell relative URL follows invocation cwd and persists committed rows", async () => {
  const volume = new Volume();
  volume.mkdirSync("/authorized/sub", { recursive: true });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/authorized"); await fs.mkdir("/authorized/sub");
  const vfs = createMemorySqliteFileSystem(volume, { authorize: path => path.startsWith("/authorized/sub/"), maxBytes: 1_000_000 });
  const database = createSqliteDatabaseProvider({ sqlite, vfs, cwd: "/", clock: { now: () => 0 }, random: bytes => { bytes.fill(7); } });
  const shell = new Shell({ fs, cwd: "/authorized/sub" }).use(csvkitCommands({ ...options, databases: [database] }));
  try {
    const inserted = await shell.exec("csvsql --db sqlite:///rows.db --insert --tables owned -I -y 0", { stdin: "a\nx\ny\n" });
    assert.deepEqual({ stdout: inserted.stdout, stderr: inserted.stderr, status: inserted.exitCode }, { stdout: "", stderr: "", status: 0 });
    assert.equal(volume.existsSync("/authorized/sub/rows.db"), true);
    assert.equal(volume.existsSync("/rows.db"), false);
    const selected = await shell.exec("sql2csv --db sqlite:///rows.db --query 'SELECT a FROM owned ORDER BY a'");
    assert.deepEqual({ stdout: selected.stdout, stderr: selected.stderr, status: selected.exitCode }, { stdout: "a\nx\ny\n", stderr: "", status: 0 });
    assert.ok(volume.statSync("/authorized/sub/rows.db").size > 0);
    assert.equal(volume.existsSync("/authorized/sub/rows.db-journal"), false);
  } finally { await shell.dispose(); await database.dispose(); }
});
