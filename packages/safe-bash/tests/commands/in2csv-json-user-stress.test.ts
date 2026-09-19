import test from 'node:test';
import assert from 'node:assert/strict';
import { pythonCodecs, utf8Codec } from '@poe-code/csvkit';
import reference from '../../../../docs/csvkit/in2csv-json-native-reference.json' with { type: 'json' };
import edgeReference from '../../../../docs/csvkit/in2csv-json-user-edge-reference.json' with { type: 'json' };
import codecReference from '../../../../docs/csvkit/in2csv-json-user-codec-reference.json' with { type: 'json' };
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { csvkitCommands, createCsvkitCommands } from '../../src/commands/csvkit/index.js';

const options = {
  codecs: [utf8Codec, ...pythonCodecs],
  locale: { profile: 'C', timezone: 'UTC', formatNumber: () => { throw new Error('unqualified locale'); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  columnWarnings: { utilsPath: reference.warningPath }
};
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";

for (const [index, item] of edgeReference.cases.entries()) {
  if (index < 70 || index > 74) continue;
  for (const format of ['json', 'ndjson']) test(`in2csv user trailing-backslash differential ${index} ${format}`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode(item.stdin);
    await fs.writeFile('/input', bytes);
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    try {
      for (const named of [false, true]) {
        const source = { async *[Symbol.asyncIterator]() {
          assert.equal(named, false, 'named malformed input must not consume stdin');
          const fragment = new Uint8Array(1);
          for (const byte of bytes) { fragment[0] = byte; yield fragment; }
          fragment[0] = 0;
        } };
        const result = await shell.exec(`in2csv -f ${format}` + (named ? ' -- /input' : ''), { stdin: source });
        assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
          stdout: item.stdout, stderr: item.stderr, status: item.status
        });
      }
      assert.deepEqual(await fs.readFile('/input'), bytes);
      assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input']);
    } finally { await shell.dispose(); }
  });
}

for (const [index, item] of reference.cases.entries()) {
  if (index < 17) continue;
  test(`in2csv user stress frozen root/value/diagnostic case ${index}`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode(item.stdin);
    await fs.writeFile('/input', bytes);
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    const command = ['in2csv', ...item.argv.map(quote)].join(' ');
    const expected = { stdout: item.stdout, stderr: item.stderr, status: item.status };
    try {
      const source = { async *[Symbol.asyncIterator]() {
        const chunk = new Uint8Array(1);
        for (const byte of bytes) { chunk[0] = byte; yield chunk; }
        chunk[0] = 0;
      } };
      const result = await shell.exec(command, { stdin: source });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, expected);
      // Named text input has universal-newline decoding; borrowed stdin does not.
      if (index !== 40) {
        const named = await shell.exec(command + ' -- /input', { stdin: {
          async *[Symbol.asyncIterator]() { assert.fail('named JSON input must not consume borrowed stdin'); yield new Uint8Array(); }
        } });
        const namedExpected = index === 39
          ? { ...expected, stderr: 'JSONDecodeError: Expecting value: line 2 column 1 (char 1)\n' }
          : expected;
        assert.deepEqual({ stdout: named.stdout, stderr: named.stderr, status: named.exitCode }, namedExpected);
      }
      assert.deepEqual(await fs.readFile('/input'), bytes);
      assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input']);
    } finally { await shell.dispose(); }
  });
}

for (const [index, item] of codecReference.cases.entries()) test(`in2csv user codec differential ${index}`, async () => {
  const fs = new MemoryFileSystem();
  const bytes = Uint8Array.from(item.bytes);
  await fs.writeFile('/input', bytes);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const command = ['in2csv', ...item.argv.map(quote)].join(' ');
  try {
    for (const named of [false, true]) {
      const source = { async *[Symbol.asyncIterator]() {
        const fragment = new Uint8Array(1);
        for (const byte of bytes) { fragment[0] = byte; yield fragment; }
        fragment[0] = 0;
      } };
      const result = await shell.exec(command + (named ? ' -- /input' : ''), { stdin: named ? {
        async *[Symbol.asyncIterator]() { assert.fail('named codec input must not consume borrowed stdin'); yield new Uint8Array(); }
      } : source });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: item.stdout, stderr: item.stderr, status: item.status
      });
    }
    assert.deepEqual(await fs.readFile('/input'), bytes);
  } finally { await shell.dispose(); }
});

test('JSON consumer closure drains cooperative stdout before invocation cleanup settles', async () => {
  const fs = new MemoryFileSystem();
  const consumer = new AbortController();
  const caller = new AbortController();
  const reason = new Error('JSON stdout consumer closed');
  const cleanups: (() => void | Promise<void>)[] = [];
  const writes: string[] = [];
  let inputClosed = 0;
  let active = false;
  const write = async (bytes: Uint8Array) => {
    assert.equal(active, false);
    active = true;
    await Promise.resolve();
    writes.push(new TextDecoder().decode(bytes));
    if (writes.length === 2) consumer.abort(reason);
    active = false;
  };
  const command = createCsvkitCommands(options).find(item => item.name === 'in2csv')!;
  await assert.rejects(Promise.resolve(command.execute({
    command: 'in2csv', args: ['-f', 'json'], cwd: '/', env: {}, fs, signal: caller.signal,
    stdin: { async *[Symbol.asyncIterator]() {
      try { yield new TextEncoder().encode('[{"n":2},{"n":3}]'); }
      finally { inputClosed++; }
    } },
    stdout: { write, ownedOutput: { write, consumerClosed: consumer.signal } },
    stderr: { write: async () => { assert.fail('consumer closure must preserve the cancellation reason'); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  })), caught => caught === reason);
  assert.ok(cleanups.length > 0);
  await Promise.all(cleanups.map(cleanup => cleanup()));
  assert.deepEqual(writes, ['n\n', '2\n']);
  assert.equal(inputClosed, 1);
  assert.equal(active, false);
  assert.equal(caller.signal.aborted, false);
  assert.deepEqual(await fs.readdir('/'), []);
});
