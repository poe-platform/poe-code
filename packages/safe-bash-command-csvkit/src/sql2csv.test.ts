import { test } from "vitest";
import assert from "node:assert/strict";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext, DatabaseProvider } from "./contracts.js";
import type { DatabaseCell } from './contracts.js';
import { Volume } from 'memfs';
import { pythonCodecs } from './codecs/python.js';
import { CsvkitDiagnostic } from './errors.js';
import { sql2csv } from './commands/sql2csv.js';
import reference from '../../../docs/csvkit/sql2csv-reference.json' with { type: 'json' };
import scalarReference from '../../../docs/csvkit/sql-scalar-options-reference.json' with { type: 'json' };
import scalarStressReference from '../../../docs/csvkit/sql-scalar-stress-reference.json' with { type: 'json' };

function setup(argv: string[], provider: DatabaseProvider) {
  let output = "";
  const callbacks: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(arg => new TextEncoder().encode(arg)), defaultLimits), cwd: "/work",
    fs: { readFile: async () => { throw new Error("unexpected query file"); }, writeFile: async () => { throw new Error("unexpected write"); } },
    stdin: { [Symbol.asyncIterator]() { assert.fail("query must override stdin"); } }, stdinIsDefault: false,
    stdout: { write: async bytes => { output += new TextDecoder().decode(bytes); } },
    stderr: { write: async () => { assert.fail("unexpected diagnostic"); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [provider],
    locale: { profile: "C", timezone: "UTC", formatNumber: () => "" }, clock: { now: () => 0 },
    limits: defaultLimits, signal: new AbortController().signal, registerCleanup: callback => { callbacks.push(callback); }
  };
  return { context, callbacks, output: () => output };
}
test('sql2csv preserves null-prototype execution options and ordered overrides at the provider boundary', async () => {
  let queried = false;
  const fixture = setup(['--db', 'stress://owned', '--query', 'SELECT value',
    '--execution-option', '__proto__', "'owned'", '--execution-option', 'constructor', 'True',
    '--execution-option', 'constructor', 'False'], {
    schemes: ['stress'], profile: 'in-memory-prototype-stress', async connect() {
      return { profile: 'in-memory-prototype-stress', async begin() {}, async commit() {}, async rollback() {}, async close() {},
        async query(_sql, _values, options) {
          queried = true;
          assert.equal(Object.getPrototypeOf(options), null);
          assert.equal(options.__proto__, 'owned');
          assert.equal(options.constructor, false);
          assert.equal(options.no_parameters, true);
          assert.equal(options.stream_results, true);
          return { columns: ['value'], rows: (async function* () { yield ['owned']; })(), async close() {} };
        }
      };
    }
  });
  try {
    assert.equal(await execute('sql2csv', fixture.context), 0);
    assert.equal(fixture.output(), 'value\nowned\n');
    assert.equal(queried, true);
  } finally { await Promise.all(fixture.callbacks.map(callback => callback())); }
});
test('sql2csv exposes precisely the overridden source argument inventory', () => {
  assert.deepEqual(sql2csv.actions.flatMap(action => action.optionStrings), [
    '-h', '--help', '-v', '--verbose', '-l', '--linenumbers', '-V', '--version',
    '--db', '--engine-option', '--execution-option', '--query', '-e', '--encoding', '-H', '--no-header-row'
  ]);
  assert.equal(new Set(sql2csv.actions.map(action => action.dest)).size, sql2csv.actions.length);
});

for (const item of reference.cases) test(`sql2csv frozen command differential: ${item.name}`, async () => {
  const effects: string[] = [];
  const fixture = setup(item.argv, {
    schemes: ['sqlite'], profile: 'frozen-result-fixture',
    connect: async (url, options) => {
      assert.equal(url, 'sqlite://'); assert.deepEqual({ ...options }, {}); effects.push('connect');
      return { profile: 'frozen-result-fixture', begin: async () => { assert.fail('unexpected begin'); },
        commit: async () => { assert.fail('unexpected commit'); }, rollback: async () => { effects.push('rollback'); }, close: async () => { effects.push('close'); },
        query: async (sql, values, options) => {
          effects.push('query'); assert.deepEqual(values, []);
          assert.deepEqual({ ...options }, { no_parameters: true, stream_results: true });
          assert.equal(sql, 'query' in item ? item.query : item.argv.includes('--query') ? item.argv[item.argv.indexOf('--query') + 1]!.trim() : item.stdin);
          // The fixture binds measured driver values/errors; this qualifies command
          // behavior, not an unmeasured native driver implementation.
          if (item.status === 1) throw new CsvkitDiagnostic(item.stderr.slice(0, -1));
          const rows: DatabaseCell[][] = ('rows' in item ? item.rows ?? [] : []).map(row => row.map(cell => {
            if (cell && typeof cell === 'object') {
              if (cell.kind === 'bytes') return Uint8Array.from(Buffer.from(cell.hex!, 'hex'));
              return { kind: 'float' as const, value: cell.value! };
            }
            return cell;
          }));
          return { columns: 'columns' in item ? item.columns ?? null : null,
            rows: { async *[Symbol.asyncIterator]() { effects.push('rows'); yield* rows; } }, close: async () => { effects.push('result-close'); } };
        }
      };
    }
  });
  const volume = Volume.fromJSON(Object.fromEntries(Object.entries(item.files).map(([name, data]) => [`/work/${name}`, Buffer.from(data, 'base64')])), '/work');
  const before = volume.toJSON(); let stderr = '';
  const status = await execute('sql2csv', { ...fixture.context, codecs: pythonCodecs,
    fs: { readFile: async path => { assert.equal(effects[0], 'connect'); return Uint8Array.from(volume.readFileSync(path) as Buffer); },
      writeFile: async () => { assert.fail('unexpected write'); } },
    stdin: { async *[Symbol.asyncIterator]() { assert.equal(effects[0], 'connect'); yield new TextEncoder().encode(item.stdin); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.deepEqual({ stdout: fixture.output(), stderr, status }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
  assert.deepEqual(volume.toJSON(), before);
  const snapshot = [...effects]; await Promise.all(fixture.callbacks.map(callback => callback())); assert.deepEqual(effects, snapshot);
  if (item.status === 2 || item.name === 'help' || item.name === 'version') assert.deepEqual(effects, []);
  else assert.deepEqual(effects, ['connect', 'query', ...(item.status === 1 ? [] : [...('columns' in item ? ['rows'] : []), 'result-close']), 'rollback', 'close']);
});
test('sql2csv SDK execution options retain source defaults and last-pair precedence', async () => {
  const f = setup([], {
    schemes: ['sqlite'], profile: 'test-only',
    connect: async () => ({ profile: 'test-only', begin: async () => { assert.fail('unexpected begin'); },
      commit: async () => { assert.fail('unexpected commit'); }, rollback: async () => {}, close: async () => {},
      query: async (sql, values, options) => {
        assert.equal(sql, 'SELECT 1'); assert.deepEqual(values, []);
        assert.deepEqual({ ...options }, { no_parameters: true, stream_results: false, custom: 2 });
        return { columns: ['1'], rows: (async function* () { yield [1]; })(), close: async () => {} };
      }
    })
  });
  assert.equal(await run({ command: 'sql2csv', settings: { query: 'SELECT 1', execution_option: [
    ['stream_results', 'False'], ['custom', '1'], ['custom', '2']
  ] } }, f.context), 0);
  assert.equal(f.output(), '1\n1\n');
});
test("sql2csv forwards options and query, streams rows and rolls back on close", async () => {
  const effects: unknown[] = [];
  const f = setup(["--db", "bound://owned", "--query", "  select value  ", "--engine-option", "echo", "True", "--execution-option", "stream_results", "False"], {
    schemes: ["bound"], profile: "test-only",
    connect: async (url, options) => {
      effects.push(["connect", url, { ...options }]);
      return { profile: "test-only", begin: async () => { assert.fail("unexpected begin"); },
        commit: async () => { assert.fail("unexpected commit"); }, rollback: async () => { effects.push("rollback"); }, close: async () => { effects.push("close"); },
        query: async (query, values, options) => {
          effects.push(["query", query, values, { ...options }]);
          return { columns: ["value", "other"], rows: (async function* () { yield ["x,y", null]; yield [2, "z"]; })(), close: async () => { effects.push("result-close"); } };
        }
      };
    }
  });
  assert.equal(await execute("sql2csv", f.context), 0);
  assert.equal(f.output(), 'value,other\n"x,y",\n2,z\n');
  assert.deepEqual(effects, [["connect", "bound://owned", { echo: true }], ["query", "select value", [], { no_parameters: true, stream_results: false }], "result-close", "rollback", "close"]);
  await Promise.all(f.callbacks.map(callback => callback()));
  assert.equal(effects.length, 5);
});
test("sql2csv preserves falsey driver failures while draining result and connection", async () => {
  const effects: string[] = [];
  const f = setup(["--query", "select broken"], {
    schemes: ["sqlite"], profile: "test-only",
    connect: async () => ({ profile: "test-only", begin: async () => {}, commit: async () => {},
      rollback: async () => { effects.push("rollback"); }, close: async () => { effects.push("close"); throw new Error("cleanup"); },
      query: async () => { throw false; }
    })
  });
  await assert.rejects(execute("sql2csv", f.context), reason => reason === false);
  assert.deepEqual(effects, ["rollback", "close"]);
});

test('sql2csv awaits output backpressure before requesting the next driver row', async () => {
  const effects: string[] = [];
  let release!: () => void;
  let admitted!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { admitted = resolve; });
  const f = setup(['--query', 'select value'], {
    schemes: ['sqlite'], profile: 'in-memory-backpressure',
    connect: async () => ({ profile: 'in-memory-backpressure', begin: async () => {}, commit: async () => { assert.fail('unexpected commit'); },
      rollback: async () => { effects.push('rollback'); }, close: async () => { effects.push('session-close'); },
      query: async () => ({ columns: ['value'], rows: { async *[Symbol.asyncIterator]() {
        effects.push('first-read'); yield ['first']; effects.push('second-read'); yield ['second'];
      } }, close: async () => { effects.push('result-close'); } })
    })
  });
  let stdout = '';
  const execution = execute('sql2csv', { ...f.context, stdout: { write: async bytes => {
    const text = new TextDecoder().decode(bytes);
    if (text === 'first\n') { admitted(); await pending; }
    stdout += text;
  } } });
  try {
    await writing;
    assert.equal(stdout, 'value\n');
    assert.deepEqual(effects, ['first-read']);
  } finally { release(); }
  assert.equal(await execution, 0);
  assert.equal(stdout, 'value\nfirst\nsecond\n');
  assert.deepEqual(effects, ['first-read', 'second-read', 'result-close', 'rollback', 'session-close']);
});

for (const failure of [false, new Error('output unavailable')]) test(`sql2csv preserves ${failure === false ? 'falsey' : 'Error'} output failure and closes the driver iterator`, async () => {
  const effects: string[] = [];
  const f = setup(['--query', 'select value'], {
    schemes: ['sqlite'], profile: 'in-memory-output-failure',
    connect: async () => ({ profile: 'in-memory-output-failure', begin: async () => {}, commit: async () => { assert.fail('unexpected commit'); },
      rollback: async () => { effects.push('rollback'); }, close: async () => { effects.push('session-close'); },
      query: async () => ({ columns: ['value'], rows: { async *[Symbol.asyncIterator]() {
        try { effects.push('first-read'); yield ['first']; assert.fail('output failure must stop row reads'); }
        finally { effects.push('iterator-return'); }
      } }, close: async () => { effects.push('result-close'); } })
    })
  });
  let stdout = '';
  await assert.rejects(execute('sql2csv', { ...f.context, stdout: { write: async bytes => {
    const text = new TextDecoder().decode(bytes);
    if (text === 'first\n') throw failure;
    stdout += text;
  } } }), reason => reason === failure);
  assert.equal(stdout, 'value\n');
  assert.deepEqual(effects, ['first-read', 'iterator-return', 'result-close', 'rollback', 'session-close']);
  await Promise.all(f.callbacks.map(callback => callback()));
  assert.equal(effects.length, 5);
});

test('sql2csv execution-option SyntaxError happens after connection acquisition with owned cleanup', async () => {
  const effects: string[] = [];
  const f = setup(['--db', 'bound://owned', '--query', 'select 1', '--execution-option', 'stream_results', '['], {
    schemes: ['bound'], profile: 'test', connect: async () => {
      effects.push('connect');
      return { profile: 'test', begin: async () => {}, commit: async () => {}, rollback: async () => { effects.push('rollback'); }, close: async () => { effects.push('close'); }, query: async () => { assert.fail('invalid execution options must not query'); } };
    }
  });
  let stderr = '';
  assert.equal(await execute('sql2csv', { ...f.context, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } } }), 1);
  assert.equal(stderr, "SyntaxError: '[' was never closed (<unknown>, line 1)\n");
  assert.deepEqual(effects, ['connect', 'rollback', 'close']);
});

test('SQL literal key comparisons consume the shared command work budget before connection acquisition', async () => {
  let connects = 0, stderr = '';
  const f = setup([], { schemes: ['bound'], profile: 'test', connect: async () => { connects++; assert.fail('work budget must close acquisition admission'); } });
  const status = await run({ command: 'sql2csv', settings: { connection_string: 'bound://owned', query: 'select 1', engine_option: [['value', '{' + Array.from({ length: 100 }, (_, index) => index).join(',') + '}']] } }, {
    ...f.context, limits: { ...defaultLimits, maxWork: 100 }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(status, 78); assert.equal(connects, 0);
  // Diagnostic writes consume the same exhausted runtime work budget.
  assert.equal(stderr, '');
});

test("sql2csv strips query boundary whitespace with the frozen Python profile", async () => {
 const f = setup(["--query", "\u0085 SELECT 1 AS value \u0085"], {
  schemes: ["sqlite"], profile: "test-only",
  connect: async () => ({ profile: "test-only", begin: async () => {}, commit: async () => {}, rollback: async () => {}, close: async () => {},
   query: async sql => { assert.equal(sql, "SELECT 1 AS value"); return { columns: ["value"], rows: (async function* () { yield [1]; })(), close: async () => {} }; }
  })
 });
 assert.equal(await execute("sql2csv", f.context), 0); assert.equal(f.output(), "value\n1\n");
});

for (const item of [...scalarReference.cases, ...scalarStressReference.cases].filter(item => item.kind !== 'SyntaxError' && item.kind !== 'list' && !item.raw.includes('\\N{'))) {
  for (const sdk of [false, true]) test(`sql2csv injected database scalar ${item.raw} (${sdk ? 'SDK' : 'argv'})`, async () => {
    const effects: unknown[] = [];
    const expected = item.kind === 'int' ? BigInt(item.value as string) : item.negativeZero ? -0 : item.value;
    const provider: DatabaseProvider = {
      schemes: ['bound'], profile: 'test-only',
      connect: async (url, options) => {
        effects.push(['connect', url]);
        if (item.kind === 'int') {
          assert.ok(typeof options.option === 'number' || typeof options.option === 'bigint');
          assert.equal(BigInt(options.option), expected);
        } else assert.equal(options.option, expected);
        return {
          profile: 'test-only', begin: async () => { assert.fail('unexpected begin'); }, commit: async () => { assert.fail('unexpected commit'); },
          rollback: async () => { effects.push('rollback'); }, close: async () => { effects.push('close'); },
          query: async (sql, values, settings) => {
            effects.push(['query', sql, values, { ...settings }]);
            return { columns: ['value'], rows: (async function* () { yield ['owned']; })(), close: async () => { effects.push('result-close'); } };
          }
        };
      }
    };
    const fixture = setup(['--db', 'bound://owned', '--query', 'select value', '--engine-option', 'option', item.raw], provider);
    const status = sdk ? await run({ command: 'sql2csv', settings: {
      connection_string: 'bound://owned', query: 'select value', engine_option: [['option', item.raw]]
    } }, fixture.context) : await execute('sql2csv', fixture.context);
    assert.deepEqual({ stdout: fixture.output(), stderr: '', status }, { stdout: 'value\nowned\n', stderr: '', status: 0 });
    assert.deepEqual(effects, [['connect', 'bound://owned'], ['query', 'select value', [], { no_parameters: true, stream_results: true }], 'result-close', 'rollback', 'close']);
    await Promise.all(fixture.callbacks.map(callback => callback()));
    assert.equal(effects.length, 5);
  });
}
