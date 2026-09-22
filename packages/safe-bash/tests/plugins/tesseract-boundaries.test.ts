import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { tesseractCommands } from '../../src/commands/tesseract/index.js';

const encode = (value: string) => new TextEncoder().encode(value);

test('failed recognition in VFS pipelines and scripts leaves named output untouched', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(tesseractCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/scan', Uint8Array.of(0, 255, 128));
  await fs.writeFile('/result.txt', encode('KEEP'));
  await fs.symlink('/scan', '/result-alias.txt');
  await fs.writeFile('/run.sh', encode('cat /scan | tesseract - /result > /stdout 2> /stderr'));
  const result = await shell.exec('sh /run.sh');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile('/stdout'), new Uint8Array());
  assert.deepEqual(await fs.readFile('/stderr'), encode('tesseract: qualified recognition engine is unavailable\n'));
  assert.deepEqual(await fs.readFile('/result.txt'), encode('KEEP'));
  assert.equal((await shell.exec('tesseract /scan /result-alias')).exitCode, 1);
  assert.deepEqual(await fs.readFile('/scan'), Uint8Array.of(0, 255, 128));
});

test('shell redirection is destructive before command admission, including symlink aliases', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(tesseractCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/scan', encode('KEEP'));
  await fs.symlink('/scan', '/alias');
  assert.equal(await fs.realpath('/alias'), await fs.realpath('/scan'));
  const result = await shell.exec('tesseract /scan /result > /alias');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile('/scan'), new Uint8Array());
  // No atomic guarantee is made for the shell's stdout redirection.
});

test('ambient credentials, model paths, host executable paths and URLs provide no authority', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(tesseractCommands());
  t.after(() => shell.dispose());
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('network forbidden'); });
  const result = await shell.exec('TESSDATA_PREFIX=/etc AWS_SECRET_ACCESS_KEY=sentinel tesseract /usr/bin/tesseract /out --tessdata-dir /etc -c debug_file=/host-debug');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, 'tesseract: qualified recognition engine is unavailable\n');
  assert.equal(result.stdout, '');
  assert.equal((await shell.exec('/usr/bin/tesseract --version')).exitCode, 127);
  const url = await shell.exec('tesseract https://example.invalid/scan /out');
  assert.equal(url.exitCode, 1);
  assert.equal(url.stderr, 'tesseract: implicit URL input is denied\n');
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(await fs.readdir('/'), []);
});
