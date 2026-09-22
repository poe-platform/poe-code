import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { pdftotext, pdftotextCommands } from '../../src/commands/pdftotext/index.js';

test('pdftotext registration stays opt-in and CLI/SDK share invocation semantics', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  t.after(() => shell.dispose());
  assert.equal((await shell.exec('pdftotext -h')).exitCode, 127);
  shell.use(pdftotextCommands());
  shell.use({ name: 'sdk-pdftotext', setup(host) {
    host.commands.register({ name: 'sdk-pdftotext', execute(context) {
      return pdftotext(context, { input: '-literal.pdf', output: '-', numbers: { resolution: 144 }, flags: { raw: true } });
    } });
  } });
  assert.deepEqual(await shell.exec('sdk-pdftotext'), await shell.exec('pdftotext -r 144 -raw -- -literal.pdf -'));
  await fs.writeFile('/run.sh', new TextEncoder().encode('pdftotext -h | cat > /help; cat /help'));
  const result = await shell.exec('sh /run.sh');
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
  assert.match(result.stdout, /^Usage: pdftotext/);
  assert.deepEqual(await fs.readFile('/help'), new TextEncoder().encode(result.stdout));
});
test('unavailable extraction preserves VFS bytes and makes no network calls', async t => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs }).use(pdftotextCommands());
  t.after(() => shell.dispose());
  const bytes = new Uint8Array([0, 128, 255]);
  await fs.writeFile('/input.pdf', bytes); await fs.writeFile('/output.txt', bytes);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden'); });
  const result = await shell.exec('pdftotext /input.pdf /output.txt');
  assert.equal(result.exitCode, 99); assert.equal(result.stdout, '');
  assert.match(result.stderr, /engine is unavailable/);
  assert.deepEqual(await fs.readFile('/input.pdf'), bytes);
  assert.deepEqual(await fs.readFile('/output.txt'), bytes);
  assert.equal(fetch.mock.callCount(), 0);
});
