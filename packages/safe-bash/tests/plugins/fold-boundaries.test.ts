import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { fold, foldCommands } from '../../src/commands/fold/index.js';

const encoder = new TextEncoder();

test('private fold executes actual pipes, redirects and VFS scripts with SDK parity', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(foldCommands({ replace: true }));
  t.after(() => shell.dispose());
  await fs.writeFile('/input', encoder.encode('界界界\n'));
  await fs.writeFile('/run.sh', encoder.encode('cat /input | fold -b -w5 > /output; cat /output'));
  const expected = '界\n界\n界\n';
  const script = await shell.exec('sh /run.sh');
  assert.equal(script.exitCode, 0); assert.equal(script.stderr, ''); assert.equal(script.stdout, expected);
  assert.deepEqual(await fs.readFile('/output'), encoder.encode(expected));
  shell.use({ name: 'sdk-fold-boundary', setup(host) {
    host.commands.register({ name: 'sdk-fold', execute(context) { return fold(context, { width: 5, mode: 'bytes', files: ['/input'] }); } });
  } });
  assert.deepEqual(await shell.exec('sdk-fold'), await shell.exec('fold -b -w5 /input'));
  const partial = await shell.exec('fold -w2 /missing /input > /partial');
  assert.equal(partial.exitCode, 1);
  assert.match(partial.stderr, /No such file/);
  assert.deepEqual(await fs.readFile('/partial'), encoder.encode(expected));
});

test('fold redirection has shell truncation semantics through same-file symlink aliases', async t => {
  // Fold writes only stdout. Shell opens/truncates its redirect before reading
  // operands: this is deliberately qualified as destructive, not atomic output.
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(foldCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/source', encoder.encode('abcdef'));
  await fs.symlink('/source', '/alias');
  assert.equal(await fs.realpath('/source'), await fs.realpath('/alias'));
  const result = await shell.exec('fold -w3 /source > /alias');
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.deepEqual(await fs.readFile('/source'), new Uint8Array());
});

test('fold cannot resolve an absent VFS path using host files, URLs or executables', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(foldCommands());
  t.after(() => shell.dispose());
  const denied = t.mock.method(globalThis, 'fetch', () => { throw new Error('Network denied'); });
  for (const operand of ['/etc/passwd', 'https://example.invalid/secret', '/usr/bin/fold']) {
    const result = await shell.exec(`fold '${operand}'`);
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /No such file/);
  }
  assert.equal((await shell.exec('/usr/bin/fold')).exitCode, 127);
  assert.equal(denied.mock.callCount(), 0);
});
