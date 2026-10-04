import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type ByteSource } from "safe-bash-contracts";
import { createSqlite3Command, type Sqlite3CommandsOptions } from "./index.js";

async function importFile(content: string, script: string[], options: Sqlite3CommandsOptions = {}) {
  const fs = createMemoryFileSystem(), bytes = new TextEncoder().encode(content);
  await fs.writeFile("/input", bytes);
  let returned = 0, stdout = "", stderr = "";
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => { throw new Error("whole-file import forbidden"); };
    if (key === "readStream") return (): ByteSource => ({ async *[Symbol.asyncIterator]() {
      try { for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7); }
      finally { returned++; }
    } });
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await createSqlite3Command(options).execute({ command: "sqlite3", ...createCommandArguments([":memory:", ...script]),
    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.equal(returned, 1);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
  return { code: result.exitCode, stdout, stderr };
}

test("imports quoted UTF-8 fields across chunk boundaries without whole-file reads", async () => {
  const result = await importFile('\ufeffname,value\r\n"é😀","one\r\ntwo"\r\n"a""b",42\r\nlast,',
    ['.import --csv /input t', 'SELECT * FROM t;']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'é😀|one\r\ntwo\na"b|42\nlast|\n');
});

for (const [skip, expected] of [[0, '1\n2\n3\n'], [1, '2\n3\n'], [-1, '3\n'], [-2, '2\n3\n'], [1.9, '2\n3\n'], [Infinity, ''], [-Infinity, '1\n2\n3\n']] as const) {
  test(`retains import skip semantics for ${skip}`, async () => {
    const result = await importFile('1\n2\n3\n', ['CREATE TABLE t(x);', `.import --skip ${skip} /input t`, 'SELECT * FROM t;']);
    assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, expected);
  });
}

test("imports custom multi-character separators, empty records and permissive quotes", async () => {
  const result = await importFile('a<>b\n\n"x<>y"<>"z"tail\nend<>"unclosed',
    ['.separator <>', '.import /input t', '.mode list', 'SELECT * FROM t;']);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, 'x<>y|ztail\nend|unclosed\n');
});

test("preserves native bulk-import change counts across many rows", async () => {
  const result = await importFile(Array.from({ length: 1201 }, (_, i) => `${i}\n`).join(''),
    ['CREATE TABLE t(x INTEGER);', '.import /input t', 'SELECT count(*), changes(), total_changes() FROM t;']);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, '1201|1201|1201\n');
});

test("retains trigger and constraint fallback behavior", async () => {
  const result = await importFile('1\n2\n3\n', [
    'CREATE TABLE t(x INTEGER PRIMARY KEY); CREATE TABLE audit(v); CREATE TRIGGER inserted AFTER INSERT ON t BEGIN INSERT INTO audit VALUES (new.x); END;',
    '.import /input t', 'SELECT * FROM audit;'
  ]);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, '1\n2\n3\n');
});

test("native bulk imports yield to cancellation and close their row source", async () => {
  const { SqliteDatabase } = await import('./engine.js');
  const db = new SqliteDatabase(), controller = new AbortController(), reason = new Error('cancel import');
  db.executeStatement('CREATE TABLE t(x);');
  let closed = false;
  const rows = (async function* () { try { for (let i = 0; i < 10000; i++) yield [String(i)]; } finally { closed = true; } })();
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(db.bulkImportRowsAsync('t', rows, controller.signal), error => error === reason); }
  finally { clearTimeout(timer); }
  assert.equal(closed, true); assert.ok(db.findTable('t')!.rows.length < 10000);
});
