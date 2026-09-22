import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { tesseract, tesseractCommands } from '../../src/commands/tesseract/index.js';

test('tesseract stays opt-in and executes VFS scripts, pipes and SDK with equal results', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  t.after(() => shell.dispose());
  assert.equal((await shell.exec('tesseract --help')).exitCode, 127);
  shell.use(tesseractCommands());
  shell.use({ name: 'sdk-tesseract', setup(host) {
    host.commands.register({ name: 'sdk-tesseract', execute(context) {
      return tesseract(context, { psm: 7 });
    } });
  } });
  assert.deepEqual(await shell.exec('sdk-tesseract'), await shell.exec('tesseract --psm 7'));
  await fs.writeFile('/run.sh', new TextEncoder().encode('tesseract --help | cat > /help; cat /help'));
  const script = await shell.exec('sh /run.sh');
  assert.equal(script.exitCode, 0);
  assert.equal(script.stderr, '');
  assert.match(script.stdout, /^Usage: tesseract/);
  assert.deepEqual(await fs.readFile('/help'), new TextEncoder().encode(script.stdout));
});

test('unqualified recognition has no image, model, output or network effects', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(tesseractCommands());
  t.after(() => shell.dispose());
  const original = new Uint8Array([0, 255, 128]);
  await fs.writeFile('/scan.pbm', original);
  await fs.writeFile('/result.txt', original);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Network denied'); });
  for (const input of ['/scan.pbm', '/etc/passwd', '/usr/bin/tesseract', '-literal', '-']) {
    const result = await shell.exec(`tesseract -- '${input}' /result`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'tesseract: qualified recognition engine is unavailable\n');
  }
  const denied = await shell.exec('tesseract https://example.invalid/scan /result');
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.stderr, 'tesseract: implicit URL input is denied\n');
  assert.deepEqual(await fs.readFile('/scan.pbm'), original);
  assert.deepEqual(await fs.readFile('/result.txt'), original);
  assert.equal(fetch.mock.callCount(), 0);
});
