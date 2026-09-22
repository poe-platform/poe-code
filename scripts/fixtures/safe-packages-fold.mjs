import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createFoldEngine, parseFoldArguments, FoldError, adjustFoldColumn, portableWidth } from '@poe-platform/safe-bash/commands/fold';
const limits = { inputBytes: 1000, outputBytes: 2000, work: 10000, retainedBytes: 8196, argumentBytes: 1000 };
assert.throws(() => parseFoldArguments(['-12b'], limits), error => error instanceof FoldError && error.code === 'WIDTH');
const engine = createFoldEngine(parseFoldArguments(['-b', '--wid=5'], limits), 'UTF-8/Unicode-17.0.0', limits);
const output = [...engine.push(new TextEncoder().encode('界界界\n')), ...engine.endFile()];
assert.deepEqual(Uint8Array.from(output.flatMap(bytes => [...bytes])), new TextEncoder().encode('界\n界\n界\n'));
engine.dispose();
assert.throws(() => engine.push(Uint8Array.of(97)), error => error instanceof FoldError && error.code === 'CLOSED');
assert.equal(portableWidth(0x754c), 2);
assert.deepEqual(adjustFoldColumn({ column: 8, lastWidth: 2 }, { codePoint: 8, byteLength: 1 }, 'columns', 'C'), { column: 6, lastWidth: 2 });
console.log('Installed fold engine runtime passed');

// Exercise the command from a public artifact, never the private workspace.
const root = await import('@poe-platform/safe-bash');
const contracts = await import('@poe-platform/safe-bash/contracts');
const { createFoldCommand, fold, foldCommands } = await import('@poe-platform/safe-bash/commands/fold');
assert.equal(createFoldCommand().runtimeIdentity, contracts.commandRuntimeIdentity);
const fs = root.createMemoryFileSystem();
await fs.writeFile('/input', new TextEncoder().encode('界界界\n'));
const shell = new root.Shell({ fs });
try {
  assert.equal((await shell.exec('fold /input')).exitCode, 127);
  shell.use(root.agentCommands());
  shell.use(foldCommands({ replace: true }));
  const result = await shell.exec('fold -b --wid=5 /input');
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, '界\n界\n界\n'); assert.equal(result.stderr, '');
  const pipeline = await shell.exec("printf abcdef | fold -w3");
  assert.equal(pipeline.stdout, 'abc\ndef'); assert.equal(pipeline.exitCode, 0);
  await fs.writeFile('/run.sh', new TextEncoder().encode('fold -c -w2 /input'));
  assert.equal((await shell.exec('sh /run.sh')).stdout, '界界\n界\n');
  const failure = await shell.exec('fold -w5 /missing /input');
  assert.equal(failure.exitCode, 1); assert.equal(failure.stdout, '界界\n界\n');
  shell.use({ name: 'fold-sdk-witness', setup(host) {
    host.commands.register({ name: 'sdk-fold', runtimeIdentity: contracts.commandRuntimeIdentity, execute(context) { return fold(context, { width: 5, mode: 'bytes', files: ['/input'] }); } });
    host.commands.register({ name: 'sdk-fold-owned', runtimeIdentity: contracts.commandRuntimeIdentity, execute(context) {
      const files = ['/input'];
      const running = fold(context, { width: 5, mode: 'bytes', files });
      files[0] = '/missing';
      return running;
    } });
    host.commands.register({ name: 'raw-fold-byte', async execute(context) { await context.stdout.write(Uint8Array.of(255)); return { exitCode: 0 }; } });
  } });
  assert.deepEqual(await shell.exec('sdk-fold'), result);
  assert.deepEqual(await shell.exec('sdk-fold-owned'), result);
  const raw = await shell.exec('fold "$(raw-fold-byte)"');
  assert.equal(raw.exitCode, 1); assert.equal(raw.stderr, 'fold: Only UTF-8 VFS arguments are available\n');
  assert.throws(() => foldCommands().setup({ commands: shell.commands }), /already registered/);
} finally { await shell.dispose(); }
console.log('Installed opt-in fold command and SDK passed');
// Direct SDK hosts may implement cleanup as a receiver-dependent capability.
let registrations = 0;
const direct = {
  command: 'fold', args: [], cwd: '/', env: {}, fs,
  signal: new AbortController().signal,
  stdin: (async function* () { yield Uint8Array.of(97); })(),
  stdout: { async write(bytes) { assert.deepEqual(bytes, Uint8Array.of(97)); } },
  stderr: { async write() { throw new Error('Unexpected direct-host diagnostic'); } },
  registerCleanup() { assert.equal(this, direct); registrations++; },
};
assert.equal((await createFoldCommand().execute(direct)).exitCode, 0);
assert.equal(registrations, 3);
const speciesBytes = Uint8Array.of(97);
Object.defineProperty(speciesBytes, 'constructor', { get() { throw new Error('Producer constructor used'); } });
assert.equal((await fold({ ...direct, registerCleanup: undefined, stdin: (async function* () { yield speciesBytes; })() })).exitCode, 0);
const empty = { ...direct, registerCleanup: undefined, stdin: (async function* () { for (let n = 0; n < 1000; n++) yield new Uint8Array(); })() };
await assert.rejects(fold(empty, { limits: { work: 20 } }), error => error instanceof FoldError && error.code === 'LIMIT');
const detached = new Uint8Array(1);
structuredClone(detached.buffer, { transfer: [detached.buffer] });
await assert.rejects(fold({ ...empty, stdin: (async function* () { yield detached; })() }), error => error instanceof FoldError && error.code === 'INPUT');
console.log('Installed fold capability receiver and empty-storage admission passed');
for (const route of ['stdin', 'stream', 'file']) {
  for (const sdk of [false, true]) {
    const bytes = runInNewContext('Uint8Array.of(120, 97, 98, 99, 100, 101, 102, 120).subarray(1, 7)');
    Object.defineProperty(bytes, 'byteLength', { get() { throw new Error('Producer byteLength accessed'); } });
    Object.defineProperty(bytes, Symbol.iterator, { value: function* () { yield 120; } });
    const carrier = contracts.createCommandArguments(['-w3', ...(route === 'stdin' ? [] : ['--', '-literal'])]);
    const output = [], cleanups = [];
    const input = (async function* () { yield bytes; bytes.fill(120); })();
    const host = {
      command: 'fold', args: carrier.args, argumentValues: carrier, cwd: '/vfs', env: {},
      signal: new AbortController().signal,
      stdin: route === 'stdin' ? input : { [Symbol.asyncIterator]() { throw new Error('Unexpected stdin'); } },
      fs: route === 'stdin' ? { readStream() { throw new Error('Unexpected VFS read'); } }
        : route === 'stream' ? { readStream(path, options) {
          assert.equal(path, '/vfs/-literal'); assert.ok(options.signal); return input;
        } } : { async readFile(path, options) {
          assert.equal(path, '/vfs/-literal'); assert.ok(options.signal); return bytes;
        } },
      stdout: { async write(chunk) { output.push(...chunk); } },
      stderr: { async write() { throw new Error('Unexpected diagnostic'); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); },
    };
    const result = sdk ? await fold(host, { width: 3, files: route === 'stdin' ? [] : ['-literal'] })
      : await createFoldCommand().execute(host);
    assert.equal(result.exitCode, 0);
    bytes.fill(120);
    assert.deepEqual(Uint8Array.from(output), new TextEncoder().encode('abc\ndef'));
    await Promise.all(cleanups.map(cleanup => cleanup()));
  }
}
console.log('Installed cross-realm CLI/SDK byte input routes passed');
{
  const controller = new AbortController(), reason = new Error('caller cancelled during cleanup');
  let acquired, closing, release;
  const started = new Promise(resolve => { acquired = resolve; });
  const draining = new Promise(resolve => { closing = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const cleanups = [];
  const host = {
    command: 'fold', args: [], cwd: '/', env: {}, signal: controller.signal,
    stdin: { [Symbol.asyncIterator]() { throw new Error('Unexpected stdin'); } },
    fs: { readStream(_path, { signal }) { return (async function* () {
      acquired();
      try {
        await new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
        yield new Uint8Array();
      } finally { closing(); await barrier; }
    })(); } },
    stdout: { async write() { throw new Error('Unexpected stdout'); } },
    stderr: { async write() { throw new Error('Unexpected diagnostic'); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  const observed = assert.rejects(fold(host, { files: ['/input'] }), error => error === reason);
  await started;
  const cleanup = cleanups[0]();
  await draining;
  controller.abort(reason);
  release();
  await Promise.all([cleanup, observed]);
}
console.log('Installed caller cancellation during producer cleanup passed');
