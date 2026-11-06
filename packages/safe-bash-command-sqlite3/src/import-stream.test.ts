import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type ByteSource } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3, type Sqlite3CommandsOptions } from "./index.js";

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

for (const existing of [false, true]) {
  test(`empty import ${existing ? "preserves an existing table" : "fails without creating a table"}`, async () => {
    const script = [
      ...(existing ? ['CREATE TABLE t(x);'] : []),
      '.import --csv /input t',
      existing ? 'SELECT count(*) FROM t;' : "SELECT count(*) FROM sqlite_master WHERE name='t';"
    ];
    assert.deepEqual(await importFile('', script), {
      code: existing ? 0 : 1, stdout: '0\n', stderr: existing ? '' : '/input: empty file\n'
    });
  });
  test(`sync empty import ${existing ? "succeeds for an existing table" : "defers missing-table diagnostics"}`, () => {
    const script = `${existing ? 'CREATE TABLE t(x);\n' : ''}.import --csv /input t\n`;
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [':memory:'], () => new Uint8Array()),
      existing ? '' : undefined);
  });
}

test("imports quoted UTF-8 fields across chunk boundaries without whole-file reads", async () => {
  const result = await importFile('\ufeffname,value\r\n"é😀","one\r\ntwo"\r\n"a""b",42\r\nlast,',
    ['.import --csv /input t', 'SELECT * FROM t;']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'é😀|one\r\ntwo\na"b|42\nlast|\n');
});

for (const [skip, expected] of [[0, '1\n2\n3\n'], [1, '2\n3\n'], [-1, '1\n2\n3\n'], [-2, '1\n2\n3\n'], [1.9, '2\n3\n'], [Infinity, ''], [-Infinity, '1\n2\n3\n']] as const) {
  test(`imports with skip ${skip}`, async () => {
    const result = await importFile('1\n2\n3\n', ['CREATE TABLE t(x);', `.import --skip ${skip} /input t`, 'SELECT * FROM t;']);
    assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, expected);
  });
}

for (const existing of [false, true]) {
  for (const skip of [-1, -2, -10, 0, 1]) {
    const content = `${existing ? '' : 'a,b\n'}1,a\n2,b\n3,c\n`;
    const script = [
      ...(existing ? ['CREATE TABLE t(a,b);'] : []),
      `.import --csv --skip ${skip} /input t`,
      'SELECT * FROM t;'
    ];
    const expected = skip > 0 ? '2|b\n3|c\n' : '1|a\n2|b\n3|c\n';
    test(`CSV import skip ${skip} with ${existing ? 'existing' : 'inferred'} table`, async () => {
      assert.deepEqual(await importFile(content, script), { code: 0, stdout: expected, stderr: '' });
    });
    test(`sync CSV import skip ${skip} with ${existing ? 'existing' : 'inferred'} table`, () => {
      assert.equal(evalSyncSqlite3(new TextEncoder().encode(script.join('\n')), [':memory:'],
        () => new TextEncoder().encode(content)), expected);
    });
  }
}

test("imports custom multi-character separators, empty records and permissive quotes", async () => {
  const result = await importFile('a<>b\n\n"x<>y"<>"z"tail\nend<>"unclosed',
    ['.separator <>', '.import /input t', '.mode list', 'SELECT * FROM t;']);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, '|\nx<>y|z"tail\nend<>"unclosed\n');
  assert.equal(result.stderr, '/input:2: expected 2 columns but found 1 - filling the rest with NULL\n' +
    '/input:3: unescaped " character\n/input:4: unescaped " character\n/input:3: unterminated "-quoted field\n');
});

test("preserves native bulk-import change counts across many rows", async () => {
  const result = await importFile(Array.from({ length: 1201 }, (_, i) => `${i}\n`).join(''),
    ['CREATE TABLE t(x INTEGER);', '.import /input t', 'SELECT count(*), changes(), total_changes() FROM t;']);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, '1201|1|1201\n');
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

for (const key of ['', 'trigger']) {
  for (const constraint of ['', 'NOT NULL']) {
    test(`imports missing fields as NULL and continues after rejected rows (${key}, ${constraint})`, async () => {
      const result = await importFile('x\ny,z\nend,\na,b,c\n\n', [
        `CREATE TABLE t(a TEXT, b TEXT ${constraint}); ${key ? "CREATE TRIGGER inserted AFTER INSERT ON t BEGIN SELECT 1; END;" : ""}`,
        '.import --csv /input t', 'SELECT quote(a),quote(b),typeof(b) FROM t;'
      ]);
      assert.deepEqual(result, {
        code: constraint ? 1 : 0,
        stdout: (constraint ? '' : "'x'|NULL|null\n") + "'y'|'z'|text\n'end'|''|text\n'a'|'b'|text\n" + (constraint ? '' : "''|NULL|null\n"),
        stderr: '/input:1: expected 2 columns but found 1 - filling the rest with NULL\n' +
          (constraint ? '/input:1: INSERT failed: NOT NULL constraint failed: t.b\n' : '') +
          '/input:4: expected 2 columns but found 3 - extras ignored\n' +
          '/input:5: expected 2 columns but found 1 - filling the rest with NULL\n' +
          (constraint ? '/input:5: INSERT failed: NOT NULL constraint failed: t.b\n' : '')
      });
    });
  }
}

test('import diagnostics use physical record start lines after skipped and multiline records', async () => {
  const result = await importFile('skip\na,b\n"one\ntwo"\nlast,x,extra', [
    '.import --csv --skip 1 /input t', 'SELECT quote(a),quote(b) FROM t;'
  ]);
  assert.deepEqual(result, { code: 0, stdout: "'one\ntwo'|NULL\n'last'|'x'\n", stderr:
    '/input:3: expected 2 columns but found 1 - filling the rest with NULL\n' +
    '/input:5: expected 2 columns but found 3 - extras ignored\n' });
});

for (const content of ['x\n', 'a,b,c\n', '\n']) {
  test(`sync imports defer records needing diagnostics: ${JSON.stringify(content)}`, () => {
    const script = 'CREATE TABLE t(a,b);\n.import --csv /input t\nSELECT * FROM t;';
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [':memory:'],
      () => new TextEncoder().encode(content)), undefined);
  });
}

for (const schema of [
  'CREATE TABLE t(x INTEGER);',
  'CREATE TABLE t(x INTEGER PRIMARY KEY);',
  'CREATE TABLE t(x); CREATE TABLE audit(x); CREATE TRIGGER inserted AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(new.x); END;'
]) {
  test(`sync and async imports count the last row: ${schema}`, async () => {
    const content = Array.from({ length: 502 }, (_, i) => `${i}\n`).join('');
    const script = [schema, '.import --csv /input t', 'SELECT count(*),changes(),total_changes() FROM t;'];
    const expected = `502|1|${schema.includes('TRIGGER') ? 1004 : 502}\n`;
    assert.deepEqual(await importFile(content, script), { code: 0, stdout: expected, stderr: '' });
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script.join('\n')), [':memory:'],
      () => new TextEncoder().encode(content)), expected);
  });
}

test('empty import preserves preceding change counters', async () => {
  const script = ['CREATE TABLE t(x); INSERT INTO t VALUES(1),(2);', '.import --csv /input t',
    'SELECT changes(),total_changes();'];
  assert.equal((await importFile('', script)).stdout, '2|2\n');
  assert.equal(evalSyncSqlite3(new TextEncoder().encode(script.join('\n')), [':memory:'],
    () => new Uint8Array()), '2|2\n');
});

test('bulk import ending in a rejected row reports zero changes', async () => {
  const result = await importFile('1\n2\n2\n', ['CREATE TABLE t(x UNIQUE);', '.import --csv /input t',
    'SELECT count(*),changes(),total_changes() FROM t;']);
  assert.deepEqual(result, { code: 1, stdout: '2|0|2\n',
    stderr: '/input:3: INSERT failed: UNIQUE constraint failed: t.x\n' });
});
