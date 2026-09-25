import assert from 'node:assert/strict';
import { Shell, createMemoryFileSystem, standardCommands, columnCommands, createColumnCommand as rootColumn, FsError } from '@poe-platform/safe-bash';
import { createColumnCommand, createColumnCommands } from '@poe-platform/safe-bash/commands/column';
import { FsError as contractError, getCommandArguments, commandRuntimeIdentity } from '@poe-platform/safe-bash/contracts';
assert.equal(FsError, contractError);
assert.equal(rootColumn, createColumnCommand);
const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(standardCommands()).use(columnCommands());
try {
  await fs.writeFile('/input', new TextEncoder().encode('a 1\nlong 2\n'));
  const expected = 'a     1\nlong  2\n';
  assert.equal((await shell.exec('column -t /input')).stdout, expected);
  assert.equal((await shell.exec("printf 'a 1\\nlong 2\\n' | column -t")).stdout, expected);
  await fs.writeFile('/run.sh', new TextEncoder().encode('cat /input | column -t'));
  assert.equal((await shell.exec('sh /run.sh')).stdout, expected);
  assert.throws(() => columnCommands().setup({ commands: shell.commands }), /already registered/);
  shell.use(columnCommands({ replace: true }));
  assert.equal(createColumnCommands().length, 1);
  await fs.writeFile("/�", new TextEncoder().encode("a 1\n"));
  shell.commands.register({ name: "raw-column-byte", async execute(context) { await context.stdout.write(Uint8Array.of(255)); return { exitCode: 0 }; } });
  shell.commands.register({ name: 'carrier', runtimeIdentity: commandRuntimeIdentity, async execute(context) {
    const carrier = getCommandArguments(context);
    assert.equal(carrier.args, context.args);
    assert.deepEqual([...carrier.bytes(1)], [255]);
    const result = await createColumnCommand().execute(context);
    assert.equal(getCommandArguments(context), carrier);
    return result;
  } });
  const carried = await shell.exec('carrier -t "$(raw-column-byte)"');
  assert.equal(carried.exitCode, 0); assert.equal(carried.stdout, "a  1\n");
  const failure = await shell.exec('column -t /missing');
  assert.equal(failure.exitCode, 1);
  assert.equal(failure.stderr, "column: ENOENT: no such file or directory, stat '/missing'\n");
  const controller = new AbortController(), reason = new FsError('EPIPE');
  controller.abort(reason);
  await assert.rejects(shell.exec('column -t /input', { signal: controller.signal }), error => error === reason);
} finally { await shell.dispose(); }
console.log('Installed column package boundary passed');
