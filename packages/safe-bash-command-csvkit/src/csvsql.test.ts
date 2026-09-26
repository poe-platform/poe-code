import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Volume } from 'memfs';
import { execute, run, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import type { CsvkitContext, DatabaseProvider, DatabaseResult } from './contracts.js';
import reference from '../../../docs/csvkit/csvsql-reference.json' with { type: 'json' };
import { csvsql } from './commands/csvsql.js';

function fixture(argv: string[], input = '', files: Record<string, string> = {}, fail?: string) {
  const volume = Volume.fromJSON(files); const effects: unknown[] = []; const cleanups: (() => Promise<void>)[] = [];
  let stdout = '', stderr = '';
  const result = (sql: string): DatabaseResult => ({ columns: sql.trimStart().startsWith('SELECT') ? ['value'] : null,
    rows: (async function* () { yield [sql]; })(), close: async () => { effects.push(['result-close', sql]); } });
  const provider: DatabaseProvider = { schemes: ['sqlite'], profile: 'test-only', connect: async (url, options) => {
    effects.push(['connect', url, { ...options }]);
    return { profile: 'test-only', begin: async () => { effects.push('begin'); },
      commit: async () => { effects.push('commit'); }, rollback: async () => { effects.push('rollback'); }, close: async () => { effects.push('close'); },
      query: async (sql, values) => { effects.push(['query', sql, values]); if (sql === fail) throw new Error('driver failure'); return result(sql); }
    };
  } };
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: '/',
    fs: { readFile: async path => { effects.push(['read', path]); return new Uint8Array(volume.readFileSync(path) as Buffer); }, writeFile: async () => { assert.fail('write'); } },
    stdin: (async function* () { effects.push('stdin'); yield new TextEncoder().encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [provider], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  return { context, effects, cleanups, output: () => ({ stdout, stderr }) };
}
for (const sdk of [false, true]) test(`csvsql query-only connects before input, splits naively and commits (${sdk ? 'SDK' : 'argv'})`, async () => {
  const f = fixture(['--query', "SELECT 'a;b'; SELECT last", '-I', '-y', '0', '-l', '--add-bom']);
  const status = sdk ? await run({ command: 'csvsql', settings: { queries: ["SELECT 'a;b'; SELECT last"], no_inference: true, sniff_limit: 0, line_numbers: true, add_bom: true } }, f.context) : await execute('csvsql', f.context);
  assert.equal(status, 0); assert.deepEqual(f.output(), { stdout: '\ufeffline_number,value\n1, SELECT last\n', stderr: '' });
  assert.deepEqual(f.effects.filter(effect => Array.isArray(effect) && effect[0] === 'query'), [["query", "SELECT 'a", []], ['query', "b'", []], ['query', ' SELECT last', []]]);
  assert.deepEqual(f.effects.slice(0, 3), [['connect', 'sqlite:///:memory:', {}], 'begin', 'stdin']);
  assert.deepEqual(f.effects.slice(-2), ['commit', 'close']);
  await Promise.all(f.cleanups.map(cleanup => cleanup())); assert.equal(f.effects.filter(effect => effect === 'close').length, 1);
});
test('csvsql rolls back on query failure and reads query filenames before executing any query', async () => {
  const f = fixture(['--db', 'sqlite://', '--query', '/query.sql', '--query', 'BROKEN', '-I', '-y', '0'], '', { '/query.sql': 'SELECT first;' }, 'BROKEN');
  await assert.rejects(execute('csvsql', f.context), /driver failure/);
  assert.deepEqual(f.effects.slice(-2), ['rollback', 'close']); assert.ok(!f.effects.includes('commit')); assert.equal(f.output().stdout, '');
});
test('csvsql only emits the final executed query if it returns rows', async () => {
  const f = fixture(['--query', 'SELECT first;UPDATE t; ', '-I', '-y', '0']);
  assert.equal(await execute('csvsql', f.context), 0); assert.deepEqual(f.output(), { stdout: '', stderr: '' });
});
test('csvsql audits literal flags and repeat/arity meanings', () => {
  const flags = csvsql.actions.flatMap(action => action.optionStrings);
  assert.equal(new Set(flags).size, flags.length);
  assert.deepEqual([...flags].sort(), '-h --help -d --delimiter -t --tabs -q --quotechar -u --quoting -b --no-doublequote -p --escapechar -z --maxfieldsize -e --encoding -L --locale -S --skipinitialspace --blanks --null-value --date-format --datetime-format --no-leading-zeroes -H --no-header-row -K --skip-lines -v --verbose -l --linenumbers --add-bom --zero -V --version -i --dialect --db --engine-option --query --insert --prefix --before-insert --after-insert --sql-delimiter --tables --no-constraints --unique-constraint --no-create --create-if-not-exists --overwrite --db-schema -y --snifflimit -I --no-inference --chunk-size --min-col-len --col-len-multiplier'.split(' ').sort());
  assert.ok(!flags.includes('-f')); assert.ok(!flags.includes('--execution-option')); assert.ok(!flags.includes('--output'));
  for (const dest of ['queries', 'prefix', 'engine_option']) assert.equal(csvsql.actions.find(action => action.dest === dest)?.action, '_AppendAction');
  assert.equal(csvsql.actions.find(action => action.dest === 'engine_option')?.nargs, 2);
});

for (const [index, item] of reference.cases.entries()) {
  if (item.argv.includes('--query')) continue;
  test(`csvsql frozen inferred/schema-only differential ${index}`, async () => {
    const f = fixture(item.argv, item.stdin);
    const status = await execute('csvsql', f.context);
    assert.deepEqual({ ...f.output(), status }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

test('csvsql batches bound rows, checks overwrite before create, and commits after hooks/results close', async () => {
  const f = fixture(['--db', 'sqlite://', '--insert', '--overwrite', '--chunk-size', '2', '--before-insert', 'before;', '--after-insert', 'after', '--tables', 'owned', '--db-schema', 'main', '--unique-constraint', 'a', '--prefix', 'OR IGNORE', '-y', '0', '-I'], 'a\nx\ny\nz\n');
  const base = f.context.databases[0]!;
  const provider: DatabaseProvider = { ...base, connect: async (...args) => {
    const session = await base.connect(...args);
    return { ...session, hasTable: async (name, schema) => { f.effects.push(['hasTable', name, schema]); return true; },
      executeMany: async (sql, rows) => {
        f.effects.push(['batch', sql, rows]);
        return { columns: null, rows: (async function* () {})(), close: async () => { f.effects.push('batch-close'); } };
      }
    };
  } };
  assert.equal(await execute('csvsql', { ...f.context, databases: [provider] }), 0);
  assert.deepEqual(f.output(), { stdout: '', stderr: '' });
  assert.deepEqual(f.effects.filter(effect => Array.isArray(effect) && effect[0] === 'batch'), [
    ['batch', 'INSERT OR IGNORE INTO main.owned (a) VALUES (?)', [['x'], ['y']]],
    ['batch', 'INSERT OR IGNORE INTO main.owned (a) VALUES (?)', [['z']]]
  ]);
  assert.deepEqual(f.effects.flatMap(effect => Array.isArray(effect) && effect[0] === 'query' ? [effect[1]] : []), [
    'before', '', 'DROP TABLE main.owned', '\nCREATE TABLE main.owned (\n\ta VARCHAR NOT NULL, \n\tUNIQUE (a)\n)\n\n', 'after'
  ]);
  assert.ok(f.effects.findIndex(effect => Array.isArray(effect) && effect[0] === 'hasTable') < f.effects.findIndex(effect => Array.isArray(effect) && effect[1] === 'DROP TABLE main.owned'));
  assert.deepEqual(f.effects.slice(-2), ['commit', 'close']);
});
test('csvsql checkfirst preserves existing table and still inserts without creating', async () => {
  const f = fixture(['--db', 'sqlite://', '--insert', '--create-if-not-exists', '-y', '0', '-I'], 'a\nx\n');
  const base = f.context.databases[0]!;
  const provider: DatabaseProvider = { ...base, connect: async (...args) => ({ ...await base.connect(...args), hasTable: async () => true }) };
  assert.equal(await execute('csvsql', { ...f.context, databases: [provider] }), 0);
  assert.deepEqual(f.effects.filter(effect => Array.isArray(effect) && effect[0] === 'query'), [['query', 'INSERT INTO stdin (a) VALUES (?)', ['x']]]);
});
test('csvsql zero chunk size fails after creation; negative one-row batch emits DEFAULT VALUES', async () => {
  for (const chunk of ['0', '-1']) {
    const f = fixture(['--db', 'sqlite://', '--insert', '--chunk-size', chunk, '-y', '0', '-I'], 'a\nx\n');
    assert.equal(await execute('csvsql', f.context), chunk === '0' ? 1 : 0);
    assert.deepEqual(f.effects.flatMap(effect => Array.isArray(effect) && effect[0] === 'query' ? [effect[1]] : []), [
      '\nCREATE TABLE stdin (\n\ta VARCHAR NOT NULL\n)\n\n', ...(chunk === '-1' ? ['INSERT INTO stdin DEFAULT VALUES'] : [])
    ]);
    if (chunk === '0') { assert.equal(f.output().stderr, 'ZeroDivisionError: division by zero\n'); assert.deepEqual(f.effects.slice(-2), ['rollback', 'close']); }
  }
});
test('csvsql whitespace-only query preserves the native NoneType failure with rollback', async () => {
  const f = fixture(['--query', '; ;', '-y', '0']);
  assert.equal(await execute('csvsql', f.context), 1);
  assert.equal(f.output().stderr, "AttributeError: 'NoneType' object has no attribute 'returns_rows'\n");
  assert.deepEqual(f.effects.slice(-2), ['rollback', 'close']);
});
test('csvsql database connection failure wins over CSV reader failure without consuming input', async () => {
  const f = fixture(['--db', 'sqlite://', '-y', '0'], 'a\nx,y\n');
  const provider: DatabaseProvider = { schemes: ['sqlite'], profile: 'test-only', connect: async () => { throw false; } };
  await assert.rejects(execute('csvsql', { ...f.context, databases: [provider] }), reason => reason === false);
  assert.deepEqual(f.effects, []);
});
test('csvsql no-db path never connects or emits INSERT and ignores text length controls', async () => {
  const f = fixture(['-i', 'mysql', '-y', '0', '-I', '--min-col-len', '99', '--col-len-multiplier', '8', '--prefix', 'OR IGNORE'], 'a\nx\n');
  assert.equal(await execute('csvsql', f.context), 0);
  assert.deepEqual(f.output(), { stdout: 'CREATE TABLE stdin (\n\ta VARCHAR(1) NOT NULL\n);\n', stderr: '' });
  assert.deepEqual(f.effects, ['stdin']);
});
test('csvsql Python chunk arithmetic stays exact beyond JavaScript numeric range', async () => {
  const f = fixture(['--db', 'sqlite://', '--insert', '--chunk-size', '-1' + '0'.repeat(400), '-y', '0', '-I'], 'a\nx\ny\n');
  assert.equal(await execute('csvsql', f.context), 0);
  assert.deepEqual(f.effects.flatMap(effect => Array.isArray(effect) && effect[0] === 'query' ? [effect[1]] : []), ['\nCREATE TABLE stdin (\n\ta VARCHAR NOT NULL\n)\n\n']);
});
test('csvsql connected MySQL applies length threshold before minimum and preserves zero times huge multiplier', async () => {
  for (const [input, minimum, multiplier, type] of [['a\nx\n', '30000', '1', 'VARCHAR(30000) NOT NULL'], ['a\nnull\n', '1', '1' + '0'.repeat(400), 'VARCHAR(1)']] as const) {
    const f = fixture(['--db', 'sqlite://', '-I', '-y', '0', '--min-col-len', minimum, '--col-len-multiplier', multiplier], input);
    const base = f.context.databases[0]!;
    const provider: DatabaseProvider = { ...base, connect: async (...args) => ({ ...await base.connect(...args), dialect: 'mysql' }) };
    assert.equal(await execute('csvsql', { ...f.context, databases: [provider] }), 0);
    assert.deepEqual(f.effects.flatMap(effect => Array.isArray(effect) && effect[0] === 'query' ? [effect[1]] : []), ['\nCREATE TABLE stdin (\n\ta ' + type + '\n)\n\n']);
  }
});
test('csvsql connected MySQL rounds multiplied text lengths with the frozen Decimal context', async () => {
  for (const [multiplier, length] of [
    ['-123456789012345678901234567890123', '-370370367037037036703703703700000'],
    ['-33333333333333333333333333335', '-100000000000000000000000000000'],
    ['-33333333333333333333333333345', '-100000000000000000000000000000']
  ] as const) {
    const f = fixture(['--db', 'sqlite://', '-I', '-y', '0', '--min-col-len', '-10000000000000000000000000000000000000000', '--col-len-multiplier', multiplier], 'a\nabc\n');
    const base = f.context.databases[0]!;
    const provider: DatabaseProvider = { ...base, connect: async (...args) => ({ ...await base.connect(...args), dialect: 'mysql' }) };
    assert.equal(await execute('csvsql', { ...f.context, databases: [provider] }), 0);
    assert.deepEqual(f.output(), { stdout: '', stderr: '' });
    assert.deepEqual(f.effects.flatMap(effect => Array.isArray(effect) && effect[0] === 'query' ? [effect[1]] : []), [`\nCREATE TABLE stdin (\n\ta VARCHAR(${length}) NOT NULL\n)\n\n`]);
    assert.deepEqual(f.effects.slice(-2), ['commit', 'close']);
  }
});
test('csvsql CSV and query files consume one input byte budget', async () => {
  const f = fixture(['--db', 'sqlite://', '--query', '/q.sql', '-y', '0', '-I'], 'a\nx\n', { '/q.sql': 'SELECT abcde' });
  assert.equal(await execute('csvsql', { ...f.context, limits: { ...defaultLimits, maxInputBytes: 14 } }), 78);
  assert.equal(f.output().stdout, '');
  assert.equal(f.output().stderr, 'csvkit: unsupported or unqualified: input byte budget exceeded\n');
  assert.deepEqual(f.effects.slice(-2), ['rollback', 'close']);
});
test('csvsql injected path-existence probe avoids opening literal SQL and treats existing query paths as files', async () => {
  const f = fixture(['--query', 'SELECT literal', '--query', '/q.sql', '-y', '0'], '', { '/q.sql': 'SELECT file\r\n' });
  assert.equal(await execute('csvsql', { ...f.context, fs: { ...f.context.fs, exists: async path => path === '/q.sql' } }), 0);
  assert.deepEqual(f.effects.filter(effect => Array.isArray(effect) && effect[0] === 'read'), [['read', '/q.sql']]);
  assert.deepEqual(f.effects.flatMap(effect => Array.isArray(effect) && effect[0] === 'query' ? [effect[1]] : []), ['SELECT literal', 'SELECT file\n']);
});
test('csvsql query-only injected drivers do not require DDL metadata for an empty input', async () => {
  const f = fixture(['--db', 'bound://owned', '--query', 'SELECT owned', '-y', '0']);
  const provider: DatabaseProvider = { ...f.context.databases[0]!, schemes: ['bound'] };
  assert.equal(await execute('csvsql', { ...f.context, databases: [provider] }), 0);
  assert.deepEqual(f.output(), { stdout: 'value\nSELECT owned\n', stderr: '' });
});

for (const readFails of [false, true]) test(`csvsql cancellation drains pending ${readFails ? 'rejected' : 'successful'} result reads before closing database`, async () => {
  const f = fixture(['--query', 'SELECT pending', '-y', '0']);
  const controller = new AbortController();
  let started!: () => void, release!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const base = f.context.databases[0]!;
  const provider: DatabaseProvider = { ...base, connect: async (...args) => ({
    ...await base.connect(...args),
    query: async () => ({ columns: ['value'], close: async () => { f.effects.push('result-close'); },
      rows: { [Symbol.asyncIterator]: () => ({
        next: async () => { f.effects.push('next-start'); started(); await pending; f.effects.push('next-settled'); if (readFails) throw new Error('late read failure'); return { done: true, value: undefined }; },
        return: async () => { f.effects.push('iterator-return'); return { done: true, value: undefined }; }
      }) }
    })
  }) };
  const execution = execute('csvsql', { ...f.context, databases: [provider], signal: controller.signal });
  const rejection = assert.rejects(execution, reason => reason === false);
  try {
    await admitted;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.ok(f.effects.includes('iterator-return'), 'iterator return must be requested to unblock cooperative reads');
    assert.ok(!f.effects.includes('close'), 'database must stay open while read is pending');
    release();
    await rejection;
    assert.deepEqual(f.effects.slice(-5), ['iterator-return', 'next-settled', 'result-close', 'rollback', 'close']);
  } finally { release(); await rejection; }
});
