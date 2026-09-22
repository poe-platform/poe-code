import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { pdftotextCommands } from '../../src/commands/pdftotext/index.js';

test('named extraction outputs preserve source identity, aliases and existing destinations', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(pdftotextCommands());
  t.after(() => shell.dispose());
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0xff]);
  await fs.writeFile('/source.pdf', bytes);
  await fs.writeFile('/existing.txt', bytes);
  await fs.symlink('/source.pdf', '/alias.pdf');
  for (const output of ['/source.pdf', '/alias.pdf', '/existing.txt', '/new.txt']) {
    const result = await shell.exec('pdftotext /source.pdf ' + output);
    assert.equal(result.exitCode, 99);
    assert.match(result.stderr, /engine is unavailable/);
    assert.deepEqual(await fs.readFile('/source.pdf'), bytes);
    assert.deepEqual(await fs.readFile('/alias.pdf'), bytes);
    assert.deepEqual(await fs.readFile('/existing.txt'), bytes);
    await assert.rejects(async () => fs.stat('/new.txt'), { code: 'ENOENT' });
  }
});

test('VFS script pipelines close rejected input and redirects have independent non-atomic effects', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(pdftotextCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/run.sh', new TextEncoder().encode('printf "%s" "%PDF-hostile" | pdftotext - - > /out.txt 2> /error.txt'));
  const result = await shell.exec('sh /run.sh');
  assert.equal(result.exitCode, 99);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(await fs.readFile('/out.txt'), new Uint8Array());
  await fs.writeFile('/source.pdf', new Uint8Array([1, 2, 3]));
  await fs.symlink('/source.pdf', '/alias');
  assert.equal(await fs.realpath('/source.pdf'), await fs.realpath('/alias'));
  assert.equal((await shell.exec('pdftotext /source.pdf - > /alias')).exitCode, 99);
  assert.deepEqual(await fs.readFile('/source.pdf'), new Uint8Array());
  assert.match(new TextDecoder().decode(await fs.readFile('/error.txt')), /engine is unavailable/);
  await fs.writeFile('/out.txt', new Uint8Array([1, 2, 3]));
  assert.equal((await shell.exec('pdftotext /missing.pdf - > /out.txt')).exitCode, 99);
  assert.deepEqual(await fs.readFile('/out.txt'), new Uint8Array());
  assert.equal((await shell.exec('pdftotext -h | cat')).exitCode, 0);
});

test('ambient-looking paths and remote-looking operands cannot acquire external authority', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(pdftotextCommands());
  t.after(() => shell.dispose());
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('Network denied'); });
  for (const path of ['/etc/passwd', '/proc/self/environ', 'https://example.invalid/file.pdf', 'file:///etc/passwd']) {
    const result = await shell.exec('pdftotext ' + path + ' -');
    assert.equal(result.exitCode, 99);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /engine is unavailable/);
  }
  assert.equal(network.mock.callCount(), 0);
  const credentials = await shell.exec('AWS_SECRET_ACCESS_KEY=sentinel PATH=/usr/bin pdftotext /usr/bin/pdftotext -');
  assert.equal(credentials.exitCode, 99);
  assert.equal(credentials.stdout, '');
  assert.match(credentials.stderr, /engine is unavailable/);
  assert.equal((await shell.exec('/usr/bin/pdftotext -h')).exitCode, 127);
  assert.deepEqual(await fs.readdir('/'), []);
});
