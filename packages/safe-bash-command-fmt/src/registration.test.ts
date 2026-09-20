import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandRegistry, commandRuntimeIdentity } from 'safe-bash-contracts/command';
import { fmtCommands } from './index.js';
import type { PluginHost } from 'safe-bash-contracts/plugin';

test('fmt plugin registers explicitly and refuses collisions unless replacement is requested', () => {
  const commands = new CommandRegistry();
  const host = { commands } as PluginHost;
  fmtCommands().setup(host);
  assert.deepEqual(commands.list().map(command => command.name), ['fmt']);
  assert.equal(commands.get('fmt')!.runtimeIdentity, commandRuntimeIdentity);
  assert.throws(() => fmtCommands().setup(host));
  assert.doesNotThrow(() => fmtCommands({ replace: true }).setup(host));
  assert.equal(commands.list().length, 1);
});
