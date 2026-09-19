import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Codec } from '@poe-code/csvkit';
import reference from '../../../../docs/csvkit/in2csv-geojson-stress-reference.json' with { type: 'json' };
import extendedReference from '../../../../docs/csvkit/in2csv-geojson-reference.json' with { type: 'json' };
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { csvkitCommands, createCsvkitCommands } from '../../src/commands/csvkit/index.js';

const options = {
  codecs: [utf8Codec],
  locale: { profile: 'C', timezone: 'UTC', formatNumber: () => { throw new Error('raw converter must not use locale'); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const observations = [
  ...reference.rawCases.map(item => ({ ...item, argv: reference.argv })),
  ...reference.cases.map(item => ({ ...item, argv: reference.argv, stdin: JSON.stringify({ type: 'FeatureCollection', features: item.features }) })),
  ...extendedReference.cases
];
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";

for (const [index, item] of observations.entries()) {
  test(`in2csv geojson independent frozen differential ${index}: borrowed chunks and named-file effects`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode(item.stdin);
    await fs.writeFile('/input.geojson', bytes);
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    const expected = { stdout: item.stdout, stderr: item.stderr, status: item.status };
    try {
      const stdin = { async *[Symbol.asyncIterator]() {
        const chunk = new Uint8Array(1);
        yield new Uint8Array();
        for (const byte of bytes) { chunk[0] = byte; yield chunk; }
        chunk[0] = 0;
      } };
      const command = ['in2csv', ...item.argv.map(quote)].join(' ');
      const streamed = await shell.exec(command, { stdin });
      assert.deepEqual({ stdout: streamed.stdout, stderr: streamed.stderr, status: streamed.exitCode }, expected);
      const named = await shell.exec(command + ' /input.geojson');
      assert.deepEqual({ stdout: named.stdout, stderr: named.stderr, status: named.exitCode }, expected);
      assert.deepEqual(await fs.readFile('/input.geojson'), bytes);
      assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input.geojson']);
    } finally { await shell.dispose(); }
  });
}

test('in2csv geojson awaits injected stdout backpressure and registers idempotent cleanup before reading', async () => {
  const item = observations[0]!;
  const command = createCsvkitCommands(options).find(command => command.name === 'in2csv')!;
  const cleanups: (() => void | Promise<void>)[] = [];
  const writes: string[] = [];
  let releaseWrite!: () => void;
  let startedWrite!: () => void;
  const writing = new Promise<void>(resolve => { startedWrite = resolve; });
  const gate = new Promise<void>(resolve => { releaseWrite = resolve; });
  let settled = false;
  let returns = 0;
  const input = new TextEncoder().encode(item.stdin);
  const pending = Promise.resolve(command.execute({
    command: 'in2csv', args: ['-f', 'geojson'], cwd: '/', env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() {
      assert.ok(cleanups.length > 0, 'cleanup must be registered before input acquisition');
      let delivered = false;
      return {
        async next() { if (delivered) return { done: true as const, value: undefined }; delivered = true; return { done: false as const, value: input }; },
        async return() { returns++; return { done: true as const, value: undefined }; }
      };
    } },
    stdout: { async write(bytes) { writes.push(new TextDecoder().decode(bytes)); startedWrite(); await gate; } },
    stderr: { async write() { assert.fail('valid raw conversion must not emit diagnostics'); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  })).then(result => { settled = true; return result; });
  await writing;
  assert.equal(settled, false);
  assert.deepEqual(writes, [item.stdout]);
  releaseWrite();
  assert.deepEqual(await pending, { exitCode: 0 });
  await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
  assert.equal(returns, 1);
});

test('in2csv geojson caller cancellation drains a cooperative pending borrowed input exactly once', async () => {
  const command = createCsvkitCommands(options).find(command => command.name === 'in2csv')!;
  const caller = new AbortController();
  const reason = new Error('cancel raw GeoJSON input');
  const cleanups: (() => void | Promise<void>)[] = [];
  let startRead!: () => void;
  let finishRead!: () => void;
  const reading = new Promise<void>(resolve => { startRead = resolve; });
  const gate = new Promise<void>(resolve => { finishRead = resolve; });
  let returns = 0;
  const pending = Promise.resolve(command.execute({
    command: 'in2csv', args: ['-f', 'geojson'], cwd: '/', env: {}, fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { [Symbol.asyncIterator]() {
      assert.ok(cleanups.length > 0);
      return {
        async next() { startRead(); await gate; return { done: true as const, value: undefined }; },
        async return() { returns++; finishRead(); return { done: true as const, value: undefined }; }
      };
    } },
    stdout: { async write() { assert.fail('cancelled input cannot publish stdout'); } },
    stderr: { async write() { assert.fail('caller cancellation cannot become a converter diagnostic'); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  const rejected = assert.rejects(pending, caught => caught === reason);
  await reading;
  caller.abort(reason);
  await rejected;
  await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
  assert.equal(returns, 1);
});
