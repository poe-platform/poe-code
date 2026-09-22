import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { unrtf, unrtfCommands } from '../../src/commands/unrtf/index.js';

const encoder = new TextEncoder();

test('unrtf runs actual pipelines, redirects and VFS scripts with SDK parity', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(unrtfCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/input', encoder.encode('{\\rtf1 A{\\b B}\\par C}'));
  await fs.writeFile('/run.sh', encoder.encode('cat /input | unrtf --text > /output; cat /output'));
  const script = await shell.exec('sh /run.sh');
  assert.equal(script.exitCode, 0);
  assert.equal(script.stderr, '');
  assert.equal(script.stdout, 'AB\nC');
  assert.deepEqual(await fs.readFile('/output'), encoder.encode('AB\nC'));
  shell.use({ name: 'sdk-unrtf-boundary', setup(host) {
    host.commands.register({ name: 'sdk-unrtf', execute(context) { return unrtf(context, { format: 'text', file: '/input' }); } });
  } });
  assert.deepEqual(await shell.exec('sdk-unrtf'), await shell.exec('unrtf --text /input'));
});

test('unrtf redirects expose partial output and destructive same-file alias semantics', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(unrtfCommands());
  t.after(() => shell.dispose());
  await fs.writeFile('/bad', encoder.encode('{\\rtf1 PREFIX\\bin4 x'));
  const partial = await shell.exec('unrtf --text /bad > /partial');
  assert.equal(partial.exitCode, 1);
  assert.match(partial.stderr, /E_PARSE.*Truncated binary/);
  assert.deepEqual(await fs.readFile('/partial'), encoder.encode('PREFIX'));
  await fs.writeFile('/source', encoder.encode('{\\rtf1 KEEP}'));
  await fs.symlink('/source', '/alias');
  assert.equal(await fs.realpath('/source'), await fs.realpath('/alias'));
  const same = await shell.exec('unrtf --text /source > /alias');
  assert.equal(same.exitCode, 1);
  assert.match(same.stderr, /E_PARSE/);
  assert.deepEqual(await fs.readFile('/source'), new Uint8Array());
});

test('unrtf cannot fall back to host paths, executables, credentials or network', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(unrtfCommands());
  t.after(() => shell.dispose());
  const denied = t.mock.method(globalThis, 'fetch', () => { throw new Error('Network denied'); });
  for (const operand of ['/etc/passwd', '/usr/bin/unrtf', 'https://example.invalid/secret']) {
    const result = await shell.exec(`unrtf --text '${operand}'`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /ENOENT/);
  }
  assert.equal((await shell.exec('/usr/bin/unrtf')).exitCode, 127);
  await fs.writeFile('/inert', encoder.encode('{\\rtf1{\\field{\\*\\fldinst HYPERLINK "https://example.invalid"}{\\fldrslt label}}{\\object{\\objdata dead}}}'));
  const inert = await shell.exec('UNRTF_SEARCH_PATH=/etc AWS_SECRET_ACCESS_KEY=sentinel unrtf --text /inert');
  assert.equal(inert.exitCode, 0);
  assert.equal(inert.stdout, 'label');
  assert.equal(inert.stderr, '');
  assert.equal(denied.mock.callCount(), 0);
});
