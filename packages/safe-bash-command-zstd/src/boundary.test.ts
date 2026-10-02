import assert from 'node:assert/strict';
import test from 'node:test';
import { createZstdCommand, createZstdCommands, zstdCommands } from './index.js';
import { CommandRegistry, commandRuntimeIdentity } from 'safe-bash-contracts';

test('zstd workspace owns the alias family and canonical runtime identity', () => {
  const commands = createZstdCommands();
  assert.deepEqual(commands.map(command => command.name), ['zstd', 'unzstd', 'zstdcat']);
  for (const command of commands) assert.equal(command.runtimeIdentity, commandRuntimeIdentity);
  assert.throws(() => createZstdCommands({ maxDecodedBytes: -1 }), RangeError);
  assert.throws(() => createZstdCommand({ limits: { maxDecodedBytes: NaN } }), RangeError);
  assert.doesNotThrow(() => createZstdCommand({ limits: { maxDecodedBytes: 0 } }));
});

test('plugin rejects collisions atomically and replaces only when requested', () => {
  const commands = new CommandRegistry();
  const existing = createZstdCommand({}, 'unzstd');
  commands.register(existing);
  const host = { commands } as Parameters<ReturnType<typeof zstdCommands>['setup']>[0];
  assert.throws(() => zstdCommands().setup(host), /already registered/);
  assert.equal(commands.has('zstd'), false);
  assert.equal(commands.get('unzstd')?.execute, existing.execute);
  zstdCommands({ replace: true }).setup(host);
  assert.equal(commands.has('zstdcat'), true);
  assert.notEqual(commands.get('unzstd')?.execute, existing.execute);
});
