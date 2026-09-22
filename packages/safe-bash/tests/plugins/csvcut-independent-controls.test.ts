import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { csvcut, csvcutCommands } from '../../src/commands/csvcut/index.js';
import { csvgrepCommands } from '../../src/commands/csvgrep/index.js';

test('csvcut to csvgrep independent multiline and authority controls', async (t) => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(csvcutCommands()).use(csvgrepCommands());
  t.after(() => shell.dispose());
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('network forbidden'); });
  const input = new TextEncoder().encode('id,note,extra\n1,"a\nb",x\n2,no,y\n3,a,z\nshort\n');
  await fs.writeFile('/input', input);
  await fs.writeFile('/sentinel', new TextEncoder().encode('unchanged'));
  shell.register({ name: 'sdkcut', execute: context => csvcut(context, { include: 'note,id,note', filePath: '/input' }) });
  const expected = 'note,id,note\n"a\nb",1,"a\nb"\na,3,a\n';
  for (const command of ['csvcut -cnote,id,note /input', 'sdkcut']) {
    const result = await shell.exec(`${command} | csvgrep -cnote -ma`);
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, expected); assert.equal(result.stderr, '');
  }
  for (const pipefail of [false, true]) {
    const result = await shell.exec(`${pipefail ? 'set -o pipefail' : 'set +o pipefail'}; csvcut -cmissing /input | cat`);
    assert.equal(result.exitCode, pipefail ? 1 : 0); assert.equal(result.stdout, ''); assert.ok(result.stderr.length);
  }
  const missing = await shell.exec('csvcut /etc/absent-independent-csvcut-control');
  assert.equal(missing.exitCode, 1); assert.equal(missing.stdout, '');
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(await fs.readFile('/input'), input);
  assert.deepEqual(await fs.readFile('/sentinel'), new TextEncoder().encode('unchanged'));
});
