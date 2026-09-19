import test from 'node:test';
import assert from 'node:assert/strict';
import { createCsvpyInterpreter, createSqliteDatabaseProvider, createMemorySqliteFileSystem, utf8Codec } from '@poe-code/csvkit';
import { PythonSession } from '@poe-code/safe-python';
import { readFile } from 'node:fs/promises';
import initSqlite from '@sqlite.org/sqlite-wasm';
import { Volume } from 'memfs';
import { Shell, type ShellCommandContext } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { arraysExtension } from '../../src/shell/extensions/arrays/index.js';
import { csvkitCommands } from '../../src/commands/csvkit/index.js';
import { printfCommand } from '../../src/commands/basic.js';
import workbook from '../../../../docs/csvkit/in2csv-workbook-package-reference.json' with { type: 'json' };
import statistics from '../../../../docs/csvkit/csvstat-reference.json' with { type: 'json' };

const encoder = new TextEncoder();
const bindings = {
  codecs: [utf8Codec], clock: { now: () => 0 },
  locale: { profile: 'C', timezone: 'UTC', formatNumber: () => { throw new Error('unqualified locale'); } },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test('requested pipeline uses literal direct argv inside actual safe-bash byte pipes', async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  const stages = [
    ['csvcut', ['-c', 'name,amount']], ['csvgrep', ['-c', 'name', '-m', 'A']],
    ['csvsort', ['-c', 'amount']], ['csvlook', []]
  ] as const;
  const completed: number[] = [];
  shell.commands.register({ name: 'direct-stage', async execute(context) {
    const index = Number(context.args[0]);
    const stage = stages[index]!;
    assert.ok(stage);
    context.signal.throwIfAborted();
    const result = await (context as ShellCommandContext).invoke(stage[0], stage[1]);
    completed.push(index);
    assert.equal(result.exitCode, 0);
    return result;
  } });
  try {
    const result = await shell.exec('direct-stage 0 | direct-stage 1 | direct-stage 2 | direct-stage 3', { stdin: 'name,amount\nA,10\nB,1\nA,2\n' });
    assert.deepEqual({ stdout: result.stdoutBytes, stderr: result.stderrBytes, status: result.exitCode }, {
      stdout: encoder.encode('| name | amount |\n| ---- | ------ |\n| A    |      2 |\n| A    |     10 |\n'), stderr: new Uint8Array(), status: 0
    });
    assert.deepEqual(completed.sort(), [0, 1, 2, 3]);
    assert.deepEqual(await fs.readdir('/'), []);
  } finally { await shell.dispose(); }
});

test('requested VFS script preserves quoted expansion, four pipes, redirection and PIPESTATUS', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const input = encoder.encode('name,amount\nA,10\nB,1\nA,2\n');
  await fs.writeFile('/work/input data.csv', input);
  await fs.writeFile('/work/broken.csv', encoder.encode('name,amount\nA\nB,1,extra\n'));
  await fs.writeFile('/work/check.sh', encoder.encode([
    "file='input data.csv'",
    'csvcut -c name,amount "$file" | csvgrep -c name -m A | csvsort -c amount | csvlook',
    'printf "%s\\n" "${PIPESTATUS[*]}"',
    'csvclean --length-mismatch broken.csv 2> errors.csv | csvformat -T > cleaned.tsv',
    'printf "%s\\n" "${PIPESTATUS[*]}"'
  ].join('\n')));
  const shell = new Shell({ fs, cwd: '/work', extensions: [arraysExtension()] }).use(csvkitCommands(bindings));
  shell.commands.register(printfCommand);
  try {
    const result = await shell.exec('sh check.sh');
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: '| name | amount |\n| ---- | ------ |\n| A    |      2 |\n| A    |     10 |\n0 0 0 0\n1 0\n', stderr: '', status: 0
    });
    assert.deepEqual(await fs.readFile('/work/cleaned.tsv'), encoder.encode('name\tamount\nA\nB\t1\textra\n'));
    assert.deepEqual(await fs.readFile('/work/errors.csv'), encoder.encode('line_number,msg,name,amount\n1,"Expected 2 columns, found 1 columns",A\n2,"Expected 2 columns, found 3 columns",B,1,extra\n'));
    assert.deepEqual(await fs.readFile('/work/input data.csv'), input);
    assert.deepEqual((await fs.readdir('/work')).map(entry => entry.name).sort(), ['broken.csv', 'check.sh', 'cleaned.tsv', 'errors.csv', 'input data.csv']);
  } finally { await shell.dispose(); }
});

test('requested join, filename stack and frozen typed JSON statistics execute from a VFS script', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/one.csv', encoder.encode('id,name\n2,A\n3,B\n'));
  await fs.writeFile('/two.csv', encoder.encode('id,amount\n2,10\n4,20\n'));
  const capture = statistics.cases.find(item => item.argv.includes('--json'))!;
  assert.ok(capture);
  await fs.writeFile('/stats.csv', encoder.encode(capture.stdin));
  await fs.writeFile('/check.sh', encoder.encode("csvjoin -c id one.csv two.csv > joined.csv\ncsvstack --filenames one.csv two.csv > stacked.csv\ncsvstat --json stats.csv > stats.json\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec('sh /check.sh');
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: '', stderr: capture.stderr, status: capture.status });
    assert.deepEqual(await fs.readFile('/joined.csv'), encoder.encode('id,name,amount\n2,A,10\n'));
    assert.deepEqual(await fs.readFile('/stacked.csv'), encoder.encode('group,id,name,amount\none.csv,2,A,\none.csv,3,B,\ntwo.csv,2,,10\ntwo.csv,4,,20\n'));
    assert.deepEqual(await fs.readFile('/stats.json'), encoder.encode(capture.stdout));
  } finally { await shell.dispose(); }
});

test('requested SQL CSV stdin and configured owned database execute using injected SQLite', async () => {
  // Existing pinned engine asset only; product receives an initialized capability.
  const wasmBinary = await readFile(new URL(import.meta.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm')));
  const sqlite = await initSqlite({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof initSqlite>[0]);
  const volume = Volume.fromJSON({ '/owned/.keep': '' });
  const database = createSqliteDatabaseProvider({ sqlite, cwd: '/owned', clock: { now: () => 0 }, random: bytes => bytes.fill(7),
    vfs: createMemorySqliteFileSystem(volume, { authorize: path => path.startsWith('/owned/'), maxBytes: 1_000_000 }) });
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands({ ...bindings, databases: [database] }));
  try {
    const input = 'name,amount\nA,10\nB,2\n';
    const query = await shell.exec("csvsql --query 'select * from stdin'", { stdin: input });
    assert.deepEqual({ stdout: query.stdout, stderr: query.stderr, status: query.exitCode }, { stdout: 'name,amount\nA,10.0\nB,2.0\n', stderr: '', status: 0 });
    const seeded = await shell.exec('csvsql --db sqlite:////owned/fixture.db --insert --tables owned', { stdin: input });
    assert.deepEqual({ stdout: seeded.stdout, stderr: seeded.stderr, status: seeded.exitCode }, { stdout: '', stderr: '', status: 0 });
    const before = volume.readFileSync('/owned/fixture.db');
    await fs.writeFile('/sql.sh', encoder.encode("sql2csv --db sqlite:////owned/fixture.db --query 'select * from owned'\n"));
    const selected = await shell.exec('sh /sql.sh');
    assert.deepEqual({ stdout: selected.stdout, stderr: selected.stderr, status: selected.exitCode }, { stdout: 'name,amount\nA,10.0\nB,2.0\n', stderr: '', status: 0 });
    assert.deepEqual(volume.readFileSync('/owned/fixture.db'), before);
  } finally { await shell.dispose(); await database.dispose(); }
});

test('requested csvpy FILE consumes explicitly bound Python stdin with exactly one guest closure', async () => {
  const fs = new MemoryFileSystem();
  const input = encoder.encode('name,amount\nA,0010\n');
  await fs.writeFile('/data.csv', input);
  let closed = 0;
  let lines: readonly string[] = [], index = 0;
  class Guest extends PythonSession { override close() { closed++; super.close(); } }
  const interpreter = createCsvpyInterpreter({
    createSession: options => new Guest({ ...options, hashSeed: [1n, 2n], limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 } }),
    terminal: { async readLine(signal) { signal.throwIfAborted(); return lines[index++] ?? null; } }
  });
  const failures: unknown[] = [];
  const shell = new Shell({ fs, onInternalError(error) { failures.push(error); } }).use(csvkitCommands({ ...bindings, interpreter }));
  shell.use(async (context, next) => {
    const fragments: Uint8Array[] = [];
    for await (const bytes of context.stdin) fragments.push(Uint8Array.from(bytes));
    const source = Buffer.concat(fragments).toString('utf8');
    lines = source.split('\n').slice(0, -1).map(line => line + '\n');
    return next();
  });
  try {
    const result = await shell.exec('csvpy /data.csv', { stdin: 'next(reader)\nlist(reader)\n' });
    assert.deepEqual(failures, []);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: ">>> ['name', 'amount']\n>>> [['A', '0010']]\n>>> ",
      stderr: 'Welcome! "/data.csv" has been loaded in an agate.csv.reader object named "reader".\n\nnow exiting InteractiveConsole...\n', status: 0
    });
    assert.equal(closed, 1);
    assert.deepEqual(await fs.readFile('/data.csv'), input);
  } finally { await shell.dispose(); }
});

test('requested direct argv keeps raw JSON strings and tab/ASV bytes without shell reinterpretation', async () => {
  const fs = new MemoryFileSystem();
  const filename = '/input $(touch forbidden).csv';
  const input = encoder.encode('name,amount\nA,0010\nB,\n');
  await fs.writeFile(filename, input);
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  const cases = [
    { name: 'csvformat', argv: ['-T', filename], stdout: 'name\tamount\nA\t0010\nB\t\n' },
    { name: 'csvformat', argv: ['-A', filename], stdout: 'name\x1famount\x1eA\x1f0010\x1eB\x1f\x1e' },
    { name: 'csvjson', argv: ['--stream', '-I', '-y', '0', filename], stdout: '{"name": "A", "amount": "0010"}\n{"name": "B", "amount": ""}\n' }
  ];
  shell.commands.register({ name: 'literal-check', async execute(context) {
    const host = context as ShellCommandContext;
    for (const item of cases) {
      const stdout: number[] = [], stderr: number[] = [];
      const result = await host.invoke(item.name, item.argv, {
        stdout: { async write(bytes) { stdout.push(...bytes); } }, stderr: { async write(bytes) { stderr.push(...bytes); } }
      });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(Uint8Array.from(stdout), encoder.encode(item.stdout));
      assert.deepEqual(stderr, []);
    }
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec('literal-check');
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: '', stderr: '', status: 0 });
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), [filename.slice(1)]);
    assert.deepEqual(await fs.readFile(filename), input);
  } finally { await shell.dispose(); }
});

test('requested XLSX VFS filename and dash stdin share conversion bytes', async () => {
  const fs = new MemoryFileSystem();
  const bytes = Uint8Array.from(Buffer.from(workbook.binary.relocated, 'base64'));
  await fs.writeFile('/book.xlsx', bytes);
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    for (const command of ['in2csv -f xlsx /book.xlsx', 'in2csv -f xlsx -']) {
      const result = await shell.exec(command, { stdin: bytes });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: 'n,text\n3,second\n', stderr: '', status: 0 }, command);
    }
    assert.deepEqual(await fs.readFile('/book.xlsx'), bytes);
  } finally { await shell.dispose(); }
});

test('requested XLSX side files use source basename or stdin rather than descriptor URI aliases', async () => {
  const capture = workbook.cases.find(item => item.name === 'relocated' && item.argv.includes('--write-sheets'))!;
  for (const named of [true, false]) {
    const fs = new MemoryFileSystem();
    const bytes = Uint8Array.from(Buffer.from(workbook.binary.relocated, 'base64'));
    if (named) await fs.writeFile('/book.xlsx', bytes);
    const shell = new Shell({ fs }).use(csvkitCommands(bindings));
    try {
      const result = await shell.exec(`in2csv -f xlsx --write-sheets - ${named ? '/book.xlsx' : '-'}`, { stdin: bytes });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: capture.stdout, stderr: capture.stderr, status: capture.status });
      for (const [path, base64] of Object.entries(capture.effects)) {
        const suffix = path.slice('relocated'.length);
        assert.deepEqual(await fs.readFile(`/${named ? 'book' : 'stdin'}${suffix}`), Uint8Array.from(Buffer.from(base64, 'base64')));
      }
      assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), named ? ['book.xlsx', 'book_0.csv', 'book_1.csv'] : ['stdin_0.csv', 'stdin_1.csv']);
    } finally { await shell.dispose(); }
  }
});

test('BLOCKER: requested XLSX named shell descriptor path is not exposed by the VFS', { todo: 'shell /dev/fd descriptor paths are unavailable; stdin dash and ordinary VFS paths are measured separately' }, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/book.xlsx', Uint8Array.from(Buffer.from(workbook.binary.relocated, 'base64')));
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec('in2csv -f xlsx /dev/fd/3 3< /book.xlsx');
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: 'n,text\n3,second\n', stderr: '', status: 0 });
  } finally { await shell.dispose(); }
});
