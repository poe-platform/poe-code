import { test } from 'vitest';
import assert from 'node:assert/strict';
import reference from '../../../docs/csvkit/sql-schema-reference.json' with { type: 'json' };
import { execute, run, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import { databases } from './databases.js';
import { Runtime } from './runtime.js';
import { csvsql } from './commands/csvsql.js';
import { deriveSchema, compileCreateTable } from './sql/schema.js';
import { inferTable } from './table/index.js';
import type { CsvkitContext } from './contracts.js';

function fixture(input: string, argv: readonly string[]) {
  let stdout = '', stderr = '';
  const encoder = new TextEncoder(), cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(arg => encoder.encode(arg)), defaultLimits), cwd: '/',
    fs: { readFile: async () => { assert.fail('unexpected file read'); }, writeFile: async () => { assert.fail('unexpected file write'); } },
    stdin: (async function* () { yield encoder.encode(input); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [],
    locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' }, clock: { now: () => 0 },
    limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  return { context, result: () => ({ stdout, stderr }), close: () => Promise.all(cleanups.map(cleanup => cleanup())) };
}

test('core dialect names and order match the captured SQLAlchemy inventory', () => {
  assert.deepEqual(databases.filter(dialect => !dialect.default).map(dialect => dialect.name), reference.dialects);
});
test('declarative quoting providers match every frozen SQLAlchemy compiler profile', () => {
  assert.deepEqual(databases.map(dialect => ({ name: dialect.name, quoteStart: dialect.quoteStart, quoteEnd: dialect.quoteEnd,
    reserved: [...dialect.reserved].sort(), illegalInitial: [...dialect.illegalInitial].sort(), doublePercent: Boolean(dialect.doublePercent)
  })), reference.compilerProfiles);
});
for (const [index, item] of [...reference.cases, ...reference.schemaCases].entries()) test(`schema exact frozen differential ${index}`, async () => {
  const f = fixture(item.stdin, item.argv);
  try {
    assert.deepEqual({ status: await execute('csvsql', f.context), ...f.result() }, { status: item.status, stdout: item.stdout, stderr: item.stderr });
  } finally { await f.close(); }
});
for (const [index, item] of reference.connected.entries()) test(`connected CREATE compilation exact frozen differential ${index}`, async () => {
  const f = fixture('', []);
  const runtime = new Runtime(f.context, csvsql, { min_col_len: item.minimum, col_len_multiplier: item.multiplier, unique_constraint: 'flag,text,flag' });
  const table = inferTable(['text', 'amount', 'flag'], [['hello', '12.34', 'true'], ['🌍', '', 'false']], { now: 0, timezone: 'UTC' }, runtime.step);
  try {
    const dialect = databases.find(dialect => dialect.name === item.dialect)!;
    assert.equal(compileCreateTable(runtime, deriveSchema(runtime, table, 'owned', dialect, true), dialect).statement, item.statement);
  } finally { await f.close(); }
});
test('SDK and argv share the schema-only length option behavior', async () => {
  const f = fixture('text\nhello\n', []);
  try {
    assert.equal(await run({ command: 'csvsql', settings: { dialect: 'mysql', sniff_limit: 0, min_col_len: 100, col_len_multiplier: 3 } }, f.context), 0);
    assert.deepEqual(f.result(), { stdout: 'CREATE TABLE stdin (\n\ttext VARCHAR(5) NOT NULL\n);\n', stderr: '' });
  } finally { await f.close(); }
});

test('optional entry-point dialect requires an explicitly injected compiler profile', async () => {
  for (const supplied of [false, true]) for (const textOverride of ['textType', 'typedTypes'] as const) {
    const f = fixture('text\nhello\n', ['--db', 'optional://', '-y0']);
    const effects: string[] = [];
    const generic = databases.find(item => item.default)!;
    const dialect = { ...generic, name: 'optional', default: false,
      ...(textOverride === 'textType' ? { textType: 'CUSTOM_TEXT' } : { typedTypes: { ...generic.typedTypes, Text: 'CUSTOM_TEXT' } })
    };
    const context = { ...f.context,
      sqlDialects: supplied ? [dialect] : [],
      databases: [{ schemes: ['optional'], profile: 'test-only', connect: async () => ({
        profile: 'test-only', dialect: 'optional', begin: async () => {}, commit: async () => { effects.push('commit'); },
        rollback: async () => { effects.push('rollback'); }, close: async () => { effects.push('close'); },
        query: async (sql: string) => { effects.push(sql); return { columns: null, rows: (async function* () {})(), close: async () => {} }; }
      }) }]
    };
    try {
      assert.equal(await execute('csvsql', context), supplied ? 0 : 78);
      assert.deepEqual(f.result(), supplied ? { stdout: '', stderr: '' } : { stdout: '', stderr: 'csvkit: unsupported or unqualified: database DDL dialect metadata\n' });
      assert.deepEqual(effects, supplied ? ['\nCREATE TABLE stdin (\n\ttext CUSTOM_TEXT NOT NULL\n)\n\n', 'commit', 'close'] : ['rollback', 'close']);
    } finally { await f.close(); }
  }
});

test('compiler diagnoses empty table identifiers before unconstrained MySQL VARCHAR', async () => {
  const f = fixture('a\nx\n', ['-i', 'mysql', '--tables', ',', '--no-constraints', '-y0']);
  try {
    assert.equal(await execute('csvsql', f.context), 1);
    assert.deepEqual(f.result(), { stdout: '', stderr: 'IndexError: string index out of range\n' });
  } finally { await f.close(); }
});

test('empty schema model preserves exact SQLAlchemy CREATE parentheses whitespace', () => {
  const runtime = { options: {}, step: () => {}, retain: () => {} };
  const dialect = databases.find(item => item.default)!;
  const table = inferTable([], [], { now: 0, timezone: 'UTC' }, runtime.step);
  assert.equal(compileCreateTable(runtime, deriveSchema(runtime, table, 'owned', dialect, false), dialect).statement, '\nCREATE TABLE owned (\n)\n\n');
});
