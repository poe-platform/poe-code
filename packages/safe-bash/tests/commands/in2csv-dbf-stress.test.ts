import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Codec, pythonCodecs } from 'safe-bash-command-csvkit';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { csvkitCommands } from '../../src/commands/csvkit/index.js';

const options = {
  codecs: [utf8Codec, ...pythonCodecs],
  locale: { profile: 'C', timezone: 'UTC', formatNumber: () => { throw new Error('DBF must use default inference'); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
function dbf(type: string, values: readonly Uint8Array[], version = 3): Uint8Array {
  const width = values[0]!.length;
  const bytes = new Uint8Array(66 + values.length * (width + 1));
  const view = new DataView(bytes.buffer);
  bytes[0] = version; view.setUint32(4, values.length, true); view.setUint16(8, 65, true); view.setUint16(10, width + 1, true);
  bytes[32] = 118; bytes[43] = type.charCodeAt(0); bytes[48] = width; bytes[64] = 13;
  let position = 65;
  for (const value of values) { bytes[position++] = 32; bytes.set(value, position); position += width; }
  bytes[position] = 26; return bytes;
}
const from64 = (text: string) => Uint8Array.from(Buffer.from(text, 'base64'));
const ascii = (text: string) => new TextEncoder().encode(text);
const scalarCases = [
  { name: 'early native date objects', type: 'D', values: ['MDAwMTAxMDE=', 'MDA5OTEyMzE=', 'MDEwMDAxMDE='], stdout: 'v\n0001-01-01\n0099-12-31\n0100-01-01\n' },
  { name: 'Decimal currency integral singleton boolean inference', type: 'Y', values: ['ECcAAAAAAAA='], stdout: 'v\nTrue\n' },
  { name: 'Decimal currency integral column numeric inference', type: 'Y', values: ['AAAAAAAAAAA=', 'ECcAAAAAAAA=', '8Nj///////8='], stdout: 'v\n0\n1\n-1\n' },
  { name: 'binary float object integral singleton stays numeric', type: 'O', values: ['AAAAAAAA8D8='], stdout: 'v\n1.0\n' },
  { name: 'ASCII float object preserves integral fraction', type: 'F', values: ['ICAgICAxLjA='], stdout: 'v\n1.0\n' },
  { name: 'native early timestamp objects', type: 'T', values: ['UkQaAAEAAAA=', 'vUUaAAAAAAA='], stdout: 'v\n0001-01-01T00:00:00.001000\n0001-12-30T00:00:00\n' }
];
for (const item of scalarCases) {
  test(`in2csv DBF independent native differential: ${item.name}`, async () => {
    const fs = new MemoryFileSystem(); const input = dbf(item.type, item.values.map(from64));
    await fs.writeFile('/input.dbf', input);
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    try {
      const result = await shell.exec('in2csv -f dbf /input.dbf');
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: item.stdout, stderr: '', status: 0 });
      assert.deepEqual(await fs.readFile('/input.dbf'), input);
      assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input.dbf']);
    } finally { await shell.dispose(); }
  });
}

test('in2csv DBF memo out-of-file pointer reports native header error without effects', async () => {
  const fs = new MemoryFileSystem(); const input = dbf('M', [from64('/////w==')], 48); const companion = new Uint8Array(512);
  new DataView(companion.buffer).setUint16(6, 512, false);
  await fs.writeFile('/input.dbf', input); await fs.writeFile('/input.fpt', companion);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec('in2csv -f dbf /input.dbf');
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: '', stderr: 'error: unpack requires a buffer of 8 bytes\n', status: 1 });
    assert.deepEqual(await fs.readFile('/input.dbf'), input); assert.deepEqual(await fs.readFile('/input.fpt'), companion);
  } finally { await shell.dispose(); }
});

test('in2csv DBF actual Shell named stream preserves reused producer bytes and awaits stdout backpressure', async () => {
  const fs = new MemoryFileSystem(); const input = dbf('C', [ascii('alpha'), ascii('omega')]);
  await fs.writeFile('/input.dbf', input);
  let returns = 0;
  fs.readStream = () => ({ [Symbol.asyncIterator]() {
    const chunk = new Uint8Array(1); let offset = 0;
    return { async next() { if (offset === input.length) { chunk[0] = 0; return { done: true as const, value: undefined }; } chunk[0] = input[offset++]!; return { done: false as const, value: chunk }; }, async return() { returns++; chunk[0] = 0; return { done: true as const, value: undefined }; } };
  } });
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const writing = new Promise<void>(resolve => { started = resolve; });
  const shell = new Shell({ fs }).use(csvkitCommands(options)); let settled = false;
  const pending = shell.exec('in2csv -f dbf /input.dbf', { stdout: { async write() { started(); await gate; } } }).then(result => { settled = true; return result; });
  try {
    await writing; assert.equal(settled, false); release();
    const result = await pending;
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: 'v\nalpha\nomega\n', stderr: '', status: 0 });
    assert.equal(returns, 1); assert.deepEqual(await fs.readFile('/input.dbf'), input);
  } finally { release(); await shell.dispose(); }
});

test('in2csv DBF actual Shell cancellation drains admitted cooperative named input', async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile('/input.dbf', dbf('C', [ascii('hello')]));
  let started!: () => void; let release!: () => void; let returns = 0;
  let closing!: () => void; let finishCleanup!: () => void;
  const cleanupStarted = new Promise<void>(resolve => { closing = resolve; });
  const cleanupGate = new Promise<void>(resolve => { finishCleanup = resolve; });
  const reading = new Promise<void>(resolve => { started = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  fs.readStream = () => ({ [Symbol.asyncIterator]() { return {
    async next() { started(); await gate; return { done: true as const, value: undefined }; },
    async return() { returns++; release(); closing(); await cleanupGate; return { done: true as const, value: undefined }; }
  }; } });
  const caller = new AbortController(); const shell = new Shell({ fs }).use(csvkitCommands(options));
  let settled = false;
  const pending = shell.exec('in2csv -f dbf /input.dbf', { signal: caller.signal });
  void pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await reading; const reason = new Error('stop DBF read'); caller.abort(reason);
    await cleanupStarted; assert.equal(settled, false); finishCleanup();
    await assert.rejects(pending, failure => failure === reason); assert.equal(returns, 1);
  } finally { release(); finishCleanup(); await shell.dispose(); }
});
