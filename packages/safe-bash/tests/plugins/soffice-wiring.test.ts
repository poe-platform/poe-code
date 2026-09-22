import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { commandRuntimeIdentity } from '../../src/contracts/command.js';
import { createSofficeCommand, soffice, sofficeCommands } from '../../src/commands/soffice/index.js';

test('soffice registration is opt-in and composes the canonical runtime', async t => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs });
  t.after(() => shell.dispose());
  assert.equal(createSofficeCommand().runtimeIdentity, commandRuntimeIdentity);
  assert.equal((await shell.exec('soffice --help')).exitCode, 127);
  shell.use(sofficeCommands());
  assert.equal((await shell.exec('soffice --help')).exitCode, 0);
  assert.match((await shell.exec('soffice --version')).stdout, /native conversion unqualified/);
  assert.deepEqual(await fs.readdir('/'), []);
});
test('shell byte argv, CLI/SDK and denied Office capabilities share admission', async t => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs }).use(sofficeCommands());
  t.after(() => shell.dispose());
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('network denied'); });
  shell.use({ name: 'soffice-sdk', setup(host) {
    host.commands.register({ name: 'sdk-soffice', execute(context) {
      return soffice(context, { conversion: { extension: 'pdf', filter: '', options: '' }, files: ['--literal.docx'] });
    } });
  } });
  const cli = await shell.exec('soffice --convert-to pdf -- --literal.docx');
  assert.equal(cli.exitCode, 1); assert.deepEqual(await shell.exec('sdk-soffice'), cli);
  for (const option of ['--accept=socket,host=example.invalid', '--print-to-file', '-env:UserInstallation=/host']) {
    const result = await shell.exec('soffice ' + option);
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /host capability denied/);
  }
  const malformed = await shell.exec("soffice $'\\xff'");
  assert.equal(malformed.exitCode, 1); assert.match(malformed.stderr, /invalid UTF-8/);
  assert.equal(network.mock.callCount(), 0); assert.deepEqual(await fs.readdir('/'), []);
});

test('actual pipelines, redirects and VFS scripts preserve failure boundaries', async t => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs }).use(agentCommands()).use(sofficeCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/source.docx', Uint8Array.of(0, 255, 80, 75));
  await fs.writeFile('/run.sh', new TextEncoder().encode('soffice --convert-to pdf /source.docx > /progress 2> /error\n'));
  assert.equal((await shell.exec('sh /run.sh')).exitCode, 1);
  assert.equal(new TextDecoder().decode(await fs.readFile('/progress')), '');
  assert.match(new TextDecoder().decode(await fs.readFile('/error')), /conversion is not qualified/);
  assert.deepEqual(await fs.readFile('/source.docx'), Uint8Array.of(0, 255, 80, 75));
  assert.equal((await fs.readdir('/')).includes('source.pdf'), false);
  const piped = await shell.exec('soffice --help | cat > /help');
  assert.equal(piped.exitCode, 0);
  assert.match(new TextDecoder().decode(await fs.readFile('/help')), /^Usage: soffice/);
  assert.equal((await shell.exec('printf hostile | soffice --cat -')).exitCode, 1);
  // The shell opens redirects before command admission, with destructive effects.
  await fs.symlink('/source.docx', '/alias.docx');
  assert.equal((await shell.exec('soffice --convert-to pdf /source.docx > /alias.docx')).exitCode, 1);
  assert.equal((await fs.readFile('/source.docx')).length, 0);
  await shell.dispose(); await shell.dispose();
});

test('shell never dispatches an ambient Office executable or remote source', async t => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs }).use(sofficeCommands());
  t.after(() => shell.dispose());
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('network denied'); });
  assert.equal((await shell.exec('/usr/bin/soffice --version')).exitCode, 127);
  const result = await shell.exec('AWS_SECRET_ACCESS_KEY=sentinel HOME=/host soffice --convert-to pdf https://example.invalid/private.docx');
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /conversion is not qualified/);
  assert.equal(network.mock.callCount(), 0);
  assert.deepEqual(await fs.readdir('/'), []);
});
