import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = process.env.SORT_ROOT, variant = process.env.SORT_VARIANT;
const library = await import(pathToFileURL(`${root}/${variant}/dist/index.js`));
const command = library.createStandardCommands().find(command => command.name === 'sort');
async function direct(args, overrides = {}) {
  const fs = library.createMemoryFileSystem(); await fs.mkdir('/work');
  const stdout = [], stderr = [];
  const context = { command: 'sort', args, fs, cwd: '/work', env: { LC_ALL: 'C' }, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } }, ...overrides };
  const result = await command.execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), context };
}
async function* chunks(bytes, width) { for (let offset = 0; offset < bytes.length; offset += width) yield bytes.subarray(offset, offset + width); }
const cases = [
  { name: 'C all byte values except LF', args: [], bytes: Buffer.concat(Array.from({ length: 256 }, (_, byte) => byte === 10 ? Buffer.alloc(0) : Buffer.from([255 - byte, byte, 10]))) },
  { name: 'invalid UTF8 and non-BMP codepoint order', args: [], bytes: Buffer.concat([Buffer.from('😀\n\uE000\né\n雪\n𐀀\n'), Buffer.from([0xff, 10, 0xc0, 0x80, 10])]) },
  { name: 'NUL records with embedded LF', args: ['-z'], bytes: Buffer.from([255, 10, 0, 65, 10, 0, 0, 128, 0, 65]) },
  { name: 'reverse NUL unique', args: ['-rzu'], bytes: Buffer.from('b\0a\0a\0\0c') },
  { name: 'large precise numeric stable', args: ['-ns'], bytes: Buffer.from('0001 second\n1 first\n1.000000000000000000000001\n1.000000000000000000000002\n-999999999999999999999999\n-0 zero\n') },
  { name: 'stable reverse keys', args: ['-s', '-r', '-t:', '-k2,2n'], bytes: Buffer.from('a:2\nb:1\nc:2\nd:1\n') },
  { name: 'fold unique', args: ['-fu'], bytes: Buffer.from('A\na\nB\nb\n\n') },
  { name: 'blank key character ranges', args: ['-b', '-k1.2,1.3'], bytes: Buffer.from('  abc 3\n  aba 2\n  zac 1\n') },
  { name: 'long equal prefix', args: [], bytes: Buffer.from(Array.from({ length: 200 }, (_, index) => 'prefix'.repeat(300) + String(199 - index) + '\n').join('')) },
  { name: 'unterminated final empty-adjacent records', args: [], bytes: Buffer.from('\n\nb\n\na') },
  { name: 'only delimiters', args: [], bytes: Buffer.from('\n\n\n') },
  { name: 'empty input', args: [], bytes: Buffer.alloc(0) },
];
for (const specimen of cases) test(`fresh GNU heldout: ${specimen.name}`, async () => {
  const cwd = await mkdtemp(`${root}/tmp/sort-native-`);
  try {
    const native = spawnSync(`${root}/native/sort`, specimen.args, { cwd, env: { LC_ALL: 'C' }, input: specimen.bytes, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(native.error); assert.equal(native.signal, null); assert.equal(native.status, 0);
    for (const width of [1, 3, 17, 65536]) {
      const actual = await direct(specimen.args, { stdin: chunks(specimen.bytes, width) });
      assert.equal(actual.exitCode, native.status); assert.deepEqual(actual.stdout, native.stdout); assert.deepEqual(actual.stderr, native.stderr);
    }
  } finally { await rm(cwd, { recursive: true }); }
});

for (const buffer of [false, true]) for (const split of [false, true]) test(`owned input chunks: Buffer=${buffer}, spanning=${split}`, async () => {
  const mutable = buffer ? Buffer.alloc(2) : new Uint8Array(2);
  const input = (async function* () {
    for (const part of split ? ['b1', '\na', '1\n'] : ['b\n', 'a\n']) { mutable.set(Buffer.from(part)); yield mutable; }
    mutable.fill(120);
  })();
  const result = await direct([], { stdin: input });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout.toString(), split ? 'a1\nb1\n' : 'a\nb\n');
});

for (const args of [['input', 'missing'], ['-o', 'input', 'input', 'missing']]) test(`failed input preserves publication: ${args}`, async () => {
  const fs = library.createMemoryFileSystem(); await fs.mkdir('/work'); await fs.writeFile('/work/input', Buffer.from('z\na\n'));
  const result = await direct(args, { fs });
  assert.equal(result.exitCode, 2); assert.equal(result.stdout.length, 0); assert.match(result.stderr.toString(), /ENOENT/);
  assert.equal(Buffer.from(await fs.readFile('/work/input')).toString(), 'z\na\n');
});

test('buffer cap retains original output before publication', async () => {
  const fs = library.createMemoryFileSystem(); await fs.mkdir('/work'); await fs.writeFile('/work/output', Buffer.from('preserve'));
  const result = await direct(['-o', 'output'], { fs, stdin: (async function* () { yield new Uint8Array(32 * 1024 * 1024); })() });
  assert.equal(result.exitCode, 2); assert.equal(result.stdout.length, 0); assert.match(result.stderr.toString(), /EFBIG/);
  assert.equal(Buffer.from(await fs.readFile('/work/output')).toString(), 'preserve');
});

test('late read failure closes input and cannot delete/overwrite destination', async () => {
  const fs = library.createMemoryFileSystem(); await fs.mkdir('/work'); await fs.writeFile('/work/output', Buffer.from('preserve'));
  let closed = false;
  const source = (async function* () { try { yield Buffer.from('z\na\n'); throw new library.FsError('EIO'); } finally { closed = true; } })();
  const result = await direct(['-o', 'output'], { fs, stdin: source });
  assert.equal(result.exitCode, 2); assert.equal(result.stdout.length, 0); assert.equal(closed, true);
  assert.equal(Buffer.from(await fs.readFile('/work/output')).toString(), 'preserve');
});

test('check mode still stops at first disorder without a later pull', async () => {
  let pulls = 0, closed = false;
  const source = (async function* () { try { pulls++; yield Buffer.from('z\na\n'); pulls++; throw Error('must not pull'); } finally { closed = true; } })();
  const result = await direct(['-c'], { stdin: source });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout.length, 0); assert.equal(pulls, 1); assert.equal(closed, true);
});

for (const before of [false, true]) test(`exact cancellation reason before/during input: ${before}`, async () => {
  const controller = new AbortController(), reason = new library.FsError('EACCES');
  let entered, rejectRead, returned = false;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const input = { [Symbol.asyncIterator]() { return { next() { entered(); return new Promise((resolve, reject) => { rejectRead = reject; }); }, async return() { returned = true; return { done: true }; } }; } };
  if (before) controller.abort(reason);
  const result = direct([], { stdin: input, signal: controller.signal });
  const rejected = assert.rejects(result, error => error === reason);
  if (!before) { await enteredPromise; controller.abort(reason); }
  await rejected;
  if (!before) { rejectRead(Error('late source failure')); await new Promise(resolve => setImmediate(resolve)); assert.equal(returned, true); }
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('owned output, awaited backpressure, and unchanged 64KiB partial-output boundary', async () => {
  const input = Buffer.from(Array.from({ length: 5000 }, (_, index) => `${String(4999 - index).padStart(4, '0')}:${'x'.repeat(70)}\n`).join(''));
  const expected = Buffer.from(input.toString().trimEnd().split('\n').sort().join('\n') + '\n');
  const retained = [], copies = []; let writing = false;
  const result = await direct([], { stdin: chunks(input, 19), stdout: { async write(bytes) {
    assert.equal(writing, false); writing = true; assert.ok(bytes.length <= 65536); retained.push(bytes); copies.push(new Uint8Array(bytes));
    await new Promise(resolve => setImmediate(resolve)); writing = false;
  } } });
  assert.equal(result.exitCode, 0); assert.deepEqual(Buffer.concat(retained), expected); assert.deepEqual(Buffer.concat(retained), Buffer.concat(copies));
  const published = [], reason = new library.FsError('EFBIG');
  const failed = await direct([], { stdin: chunks(input, 65536), stdout: { async write(bytes) { if (published.length) throw reason; published.push(new Uint8Array(bytes)); } } });
  assert.equal(failed.exitCode, 1); assert.match(failed.stderr.toString(), /EFBIG/);
  assert.equal(published[0].length, 65536); assert.deepEqual(Buffer.from(published[0]), expected.subarray(0, 65536));
});

test('abort blocked output retains reason and observes late rejection', async () => {
  const controller = new AbortController(), reason = Error('output abort'); let entered, rejectWrite;
  const ready = new Promise(resolve => { entered = resolve; });
  const result = direct([], { stdin: chunks(Buffer.from('b\na\n'), 1), signal: controller.signal,
    stdout: { write() { entered(); return new Promise((resolve, reject) => { rejectWrite = reject; }); } } });
  const rejected = assert.rejects(result, error => error === reason);
  await ready; controller.abort(reason); await rejected; rejectWrite(Error('late sink failure'));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('actual Shell pipeline, in-place sort, and shared output quota', async () => {
  const fs = library.createMemoryFileSystem(), shell = new library.Shell({ fs }).use(library.agentCommands());
  try {
    const result = await shell.exec("printf 'z\\na\\nz\\n' | sort -u | tee /result | wc -l; sort -r -o /result /result; cat /result");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, '2\nz\na\n');
    assert.equal(Buffer.from(await fs.readFile('/result')).toString(), 'z\na\n');
    await assert.rejects(shell.exec('sort', { stdin: Buffer.from('b\na\n'), limits: { maxOutputBytes: 3 } }), error => error instanceof library.ShellLimitError && error.limit === 'maxOutputBytes');
  } finally { await shell.dispose(); }
});
