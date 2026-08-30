import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = process.env.SORT_ROOT, variant = process.env.SORT_VARIANT;
const library = await import(pathToFileURL(`${root}/${variant}/dist/index.js`));
const sort = library.createStandardCommands().find(command => command.name === 'sort');
async function direct(args, overrides = {}) {
  const fs = library.createMemoryFileSystem(); await fs.mkdir('/work');
  const stdout = [], stderr = [];
  const context = { command: 'sort', args, cwd: '/work', env: { LC_ALL: 'C' }, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } }, ...overrides };
  const result = await sort.execute(context);
  return { status: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}
function native(args, bytes) {
  const result = spawnSync(`${root}/native/sort`, args, { input: bytes, cwd: `${root}/tmp`, env: { LC_ALL: 'C', TZ: 'UTC' }, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.signal, null);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
function borrowed(bytes, width, buffer = true) {
  return (async function* () {
    const allocation = buffer ? Buffer.alloc(width + 14, 90) : new Uint8Array(width + 14).fill(90);
    for (let offset = 0; offset < bytes.length; offset += width) {
      allocation.fill(88); const size = Math.min(width, bytes.length - offset);
      allocation.set(bytes.subarray(offset, offset + size), 7);
      yield allocation.subarray(7, 7 + size);
    }
    allocation.fill(81);
  })();
}
for (const buffer of [false, true]) for (const width of [1, 2, 5, 17]) test(`hidden borrowed byteOffset source Buffer=${buffer} width=${width}`, async () => {
  const bytes = Buffer.from('zeta\nalpha\n雪\nalpha\nbeta');
  assert.deepEqual(await direct(['-u'], { stdin: borrowed(bytes, width, buffer) }), native(['-u'], bytes));
});
for (const [args, bytes] of [
  [[], Buffer.from('b1\na1\n')], [['-z'], Buffer.from('b1\0a1\0')], [['-n', '-s'], Buffer.from('20 z\n-1 a\n3 y')],
  [['-u'], Buffer.from('z\nalpha\nalpha\n')], [['-o', '/work/output'], Buffer.from('long-z\nlong-a\n')],
]) test(`hidden public named VFS borrowed Buffer ${args}`, async () => {
  const fs = library.createMemoryFileSystem(); await fs.mkdir('/work'); await fs.writeFile('/work/input', bytes); await fs.writeFile('/work/output', Buffer.from('preserve'));
  const original = fs.readStream.bind(fs);
  fs.readStream = (path, options) => path === '/work/input' ? borrowed(bytes, 2) : original(path, options);
  const shell = new library.Shell({ fs, cwd: '/work' }).use(library.agentCommands());
  try {
    const result = await shell.exec(['sort', ...args, '/work/input'].join(' '));
    const expected = native(args[0] === '-o' ? [] : args, bytes);
    assert.equal(result.exitCode, expected.status); assert.equal(result.stderr, '');
    if (args[0] === '-o') { assert.equal(result.stdoutBytes.length, 0); assert.deepEqual(Buffer.from(await fs.readFile('/work/output')), expected.stdout); }
    else assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(await fs.readFile('/work/input')), bytes);
  } finally { await shell.dispose(); }
});
test('hidden public stdin ownership is already protected by ShellInput', async () => {
  const shell = new library.Shell({ fs: library.createMemoryFileSystem() }).use(library.agentCommands());
  try { const result = await shell.exec('sort', { stdin: borrowed(Buffer.from('b1\na1\n'), 2) }); assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'a1\nb1\n'); }
  finally { await shell.dispose(); }
});
test('hidden check mode borrowed spanning Buffer remains separately measured', async () => {
  const actual = await direct(['-c'], { stdin: borrowed(Buffer.from('b1\na1\n'), 2) });
  assert.equal(actual.status, native(['-c'], Buffer.from('b1\na1\n')).status);
});
for (const [args, bytes] of [
  [[], Buffer.from([0xff, 10, 0, 10, 0xc0, 0x80, 10, 0x80, 10, 0xff])],
  [['-zru'], Buffer.from('雪\0😀\0\uE000\0𐀀\0a\0雪')],
  [['-ns'], Buffer.from('-0000 first\n0 second\n.00000000000001 a\n-.00000000000001 b\n100000000000000000000.1 c\n99999999999999999999.9 d\n')],
  [['-t:', '-k2,2nr', '-k1,1'], Buffer.from('z:2\na:2\nx:10\ny:-0.1\n')],
  [['-bf', '-s'], Buffer.from('  a\n A\n\tB\n b\n')],
  [[], Buffer.alloc(0)], [[], Buffer.from('\n\n')], [['-z'], Buffer.from([0, 0, 0])],
]) test(`hidden native byte/numeric/empty ${JSON.stringify(args)} ${bytes.toString('hex').slice(0,25)}`, async () => {
  const expected = native(args, bytes); assert.equal(expected.status, 0);
  assert.deepEqual(await direct(args, { stdin: borrowed(bytes, 11, false) }), expected);
});
for (const extra of [0, 1]) test(`hidden exact total-byte limit boundary excess=${extra}`, async () => {
  const length = 32 * 1024 * 1024 - 1 + extra, bytes = new Uint8Array(length).fill(97);
  const expectedHash = createHash('sha256').update(bytes).update('\n').digest('hex'), actualHash = createHash('sha256');
  let emitted = 0;
  const result = await direct([], { stdin: (async function* () { yield bytes; })(), stdout: { async write(chunk) { emitted += chunk.length; actualHash.update(chunk); } } });
  if (extra) { assert.equal(result.status, 2); assert.match(result.stderr.toString(), /EFBIG/); assert.equal(emitted, 0); }
  else { assert.equal(result.status, 0); assert.equal(emitted, length + 1); assert.equal(actualHash.digest('hex'), expectedHash); }
});
test('hidden source error after retained records preserves output file', async () => {
  const fs = library.createMemoryFileSystem(); await fs.mkdir('/work'); await fs.writeFile('/work/output', Buffer.from('original'));
  let returned = false;
  const result = await direct(['-o', 'output'], { fs, stdin: (async function* () { try { yield Buffer.from('z\na\n'); throw new library.FsError('EIO'); } finally { returned = true; } })() });
  assert.equal(result.status, 2); assert.equal(result.stdout.length, 0); assert.match(result.stderr.toString(), /EIO/);
  assert.equal(Buffer.from(await fs.readFile('/work/output')).toString(), 'original'); assert.equal(returned, true);
});
test('hidden missing later file never publishes retained earlier records', async () => {
  const fs = library.createMemoryFileSystem(); await fs.mkdir('/work'); await fs.writeFile('/work/input', Buffer.from('z\na\n'));
  const result = await direct(['-o', 'input', 'input', 'absent'], { fs });
  assert.equal(result.status, 2); assert.equal(result.stdout.length, 0); assert.equal(Buffer.from(await fs.readFile('/work/input')).toString(), 'z\na\n');
});
test('hidden pending input cancellation keeps reason and observes late rejection', async () => {
  const controller = new AbortController(), reason = Object.freeze({ pendingInput: true });
  let admit, rejectRead, returned = 0;
  const ready = new Promise(resolve => { admit = resolve; });
  const stdin = { [Symbol.asyncIterator]() { return { next() { admit(); return new Promise((resolve, reject) => { rejectRead = reject; }); }, async return() { returned++; return { done: true }; } }; } };
  const result = direct([], { stdin, signal: controller.signal }); const rejection = assert.rejects(result, error => error === reason);
  await ready; controller.abort(reason); await rejection; rejectRead(new Error('late read failure')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, 1); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
test('hidden empty-chunk cancellation stops further pulls before publication', async () => {
  const controller = new AbortController(), reason = new Error('empty chunks'); let pulls = 0, writes = 0;
  const stdin = (async function* () { for (;;) { pulls++; if (pulls === 9) controller.abort(reason); yield new Uint8Array(); } })();
  await assert.rejects(direct([], { stdin, signal: controller.signal, stdout: { async write() { writes++; } } }), error => error === reason);
  assert.equal(pulls, 9); assert.equal(writes, 0);
});
test('hidden output is owned and backpressured after all input admission', async () => {
  let admitted = false, release, entered; const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const retained = []; let writes = 0;
  const bytes = Buffer.from('b\na\n'.repeat(20000));
  const pending = direct([], { stdin: (async function* () { yield bytes; admitted = true; })(), stdout: { async write(chunk) { assert.equal(admitted, true); retained.push(chunk); writes++; if (writes === 1) { entered(); await gate; } } } });
  await ready; assert.equal(writes, 1); const first = Buffer.from(retained[0]); await new Promise(resolve => setImmediate(resolve)); assert.equal(writes, 1);
  release(); assert.equal((await pending).status, 0); assert.deepEqual(Buffer.from(retained[0]), first); assert.deepEqual(Buffer.concat(retained), native([], bytes).stdout);
});
