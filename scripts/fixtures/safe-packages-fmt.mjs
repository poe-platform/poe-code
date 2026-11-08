import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createFmtEngine, parseFmtArguments, fmtCommand, fmtCommands, fmt, defaultFmtLimits, fmtBaseline, FmtError }
  from '@poe-platform/safe-bash/commands/fmt';
import { CommandRegistry, Shell, agentCommands, createMemoryFileSystem } from '@poe-platform/safe-bash';
import { commandRuntimeIdentity } from '@poe-platform/safe-bash/contracts';

assert.equal(fmtBaseline.archiveSha256, '16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25');
assert.equal(fmtCommand().runtimeIdentity, commandRuntimeIdentity);
const options = parseFmtArguments([new TextEncoder().encode('-w8')]);
const engine = createFmtEngine(options, defaultFmtLimits, new AbortController().signal);
const machine = engine.run(); assert.equal(machine.next().value, 'input');
assert.equal(machine.next(runInNewContext('Uint8Array.of(97,97,32,98,98,32,99,99,32,100,100,32,101,101)')).value, 'input');
assert.deepEqual(machine.next(null).value, new TextEncoder().encode('aa bb cc\ndd ee\n'));
assert.equal(machine.next().done, true);
assert.equal(engine.accounting().retainedBytes, 0);
assert.throws(() => engine.run().next(), error => error instanceof FmtError && error.code === 'CLOSED');

const fs = createMemoryFileSystem();
await fs.writeFile('/input', new TextEncoder().encode('aa bb cc dd ee'));
await fs.writeFile('/run.sh', new TextEncoder().encode('fmt -w8 </input'));
const shell = new Shell({ fs, env: { LC_ALL: 'C' }, commands: new CommandRegistry([fmtCommand()]) });
try {
  const direct = await shell.exec('fmt -w8 /input');
  assert.deepEqual([direct.exitCode, direct.stdout, direct.stderr], [0, 'aa bb cc\ndd ee\n', '']);
  shell.use(agentCommands({ replace: true }));
  assert.deepEqual(await shell.exec('sh /run.sh'), direct);
  const piped = await shell.exec("printf 'aa bb cc dd ee' | fmt -w8");
  assert.deepEqual(piped, direct);
  shell.commands.register({ name: 'fmt-sdk', runtimeIdentity: commandRuntimeIdentity,
    execute(context) { return fmt(context, { arguments: [new TextEncoder().encode('-w8'), new TextEncoder().encode('/input')] }); } });
  assert.deepEqual(await shell.exec('fmt-sdk'), direct);
  shell.use(fmtCommands({ replace: true }));
  shell.commands.register({ name: 'fmt-typed-sdk', runtimeIdentity: commandRuntimeIdentity,
    execute(context) { return fmt(context, { width: 8, files: ['/input'] }); } });
  assert.deepEqual(await shell.exec('fmt-typed-sdk'), direct);
  shell.commands.register({ name: 'raw-fmt-argument', async execute(context) { await context.stdout.write(Uint8Array.of(255)); return { exitCode: 0 }; } });
  const raw = await shell.exec('fmt -up"$(raw-fmt-argument)"', { stdin: Uint8Array.of(255, 32, 97, 32, 32, 98, 10, 254, 32, 99, 32, 32, 100, 10) });
  assert.equal(raw.exitCode, 0); assert.equal(raw.stderr, '');
  assert.deepEqual(raw.stdoutBytes, Uint8Array.of(255, 32, 97, 32, 98, 10, 254, 32, 99, 32, 32, 100, 10));
} finally { await shell.dispose(); }
console.log('Installed fmt parser/engine, canonical byte arguments and CLI/SDK passed');
