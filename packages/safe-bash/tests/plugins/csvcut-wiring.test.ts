import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { csvcutCommands } from '../../src/commands/csvcut/index.js';

test('csvcut is opt-in and collision preflight preserves registration', async (t) => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs }).use(agentCommands());
  t.after(() => shell.dispose()); await shell.exec('true');
  assert.equal(shell.commands.has('csvcut'), false);
  shell.register({ name: 'csvcut', execute: () => ({ exitCode: 23 }) });
  const before = shell.commands.list();
  const host = { commands: shell.commands, use() { throw new Error('Unexpected middleware'); }, registerFileSystem() { throw new Error('Unexpected filesystem'); } };
  assert.throws(() => csvcutCommands().setup(host), { message: 'Command already registered: csvcut' });
  assert.deepEqual(shell.commands.list(), before);
  shell.use(csvcutCommands({ replace: true }));
  const result = await shell.exec("printf 'a,b\\nx,y\\n' | csvcut -c2");
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'b\ny\n'); assert.equal(result.stderr, '');
});
test('csvcut pipelines, redirects and byte argv use canonical contracts with no network', async (t) => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs }).use(agentCommands()).use(csvcutCommands());
  t.after(() => shell.dispose());
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('network forbidden'); });
  await fs.writeFile('/-input', new TextEncoder().encode('a,b\nx,y\n'));
  for (const pipefail of [false, true]) {
    const result = await shell.exec(`${pipefail ? 'set -o pipefail' : 'set +o pipefail'}; csvcut --unknown /-input | cat`);
    assert.equal(result.exitCode, pipefail ? 2 : 0); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'csvcut: Unknown option --unknown\n');
  }
  const result = await shell.exec('csvcut -c2 -- /-input > /output && cat /output');
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'b\ny\n');
  const invalid = await shell.exec("csvcut $'\\xff'");
  assert.equal(invalid.exitCode, 2); assert.equal(invalid.stderr, 'csvcut: Arguments must be valid UTF-8\n');
  const missing = await shell.exec('csvcut /etc/absent-csvcut-control');
  assert.equal(missing.exitCode, 1); assert.equal(fetch.mock.callCount(), 0);
});
