import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

test('Python implementation is an admitted private workspace with canonical dependencies', () => {
  const command = json('packages/safe-bash-command-python/package.json');
  const parent = json('packages/safe-bash/package.json');
  assert.equal(command.name, 'safe-bash-command-python');
  assert.equal(command.private, true);
  assert.equal(command.devDependencies['safe-bash-contracts'], '*');
  assert.equal(command.devDependencies['@poe-platform/safe-bash'], undefined);
  assert.equal(parent.devDependencies[command.name], '*');
  assert.equal(parent.poeCode.integration.privateWorkspaces[command.name].version, command.version);
  assert.equal(parent.poeCode.integration.privateWorkspaces[command.name].portable, true);
  for (const route of ['./node', './docker', './llm-assets-node']) {
    for (const profile of ['workerd', 'worker', 'browser']) assert.equal(command.exports[route][profile], null);
  }
  assert.equal(readFileSync(new URL('packages/safe-bash/src/commands/python/index.ts', root), 'utf8').trim(), 'export * from "safe-bash-command-python";');
  assert.ok(readFileSync(new URL('packages/safe-bash-command-python/src/executor.ts', root), 'utf8').includes('createPythonExecutorCommands'));
});
