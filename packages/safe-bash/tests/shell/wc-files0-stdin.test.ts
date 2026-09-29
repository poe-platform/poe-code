import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.js';
import { streamCommands } from '../../src/commands/streams.js';

test('wc reads NUL-delimited filenames from asynchronous stdin', async context => {
  const { fs, shell, commands } = setup();
  context.after(() => shell.dispose());
  for (const command of streamCommands()) commands.register(command);
  await fs.writeFile('/input', new TextEncoder().encode('one\ntwo\n'));
  const result = await shell.exec('wc -l --total=only --files0-from=-', {
    stdin: (async function* () { await Promise.resolve(); yield new TextEncoder().encode('/input\0'); })(),
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), '2');
  assert.equal(result.stderr, '');
});
