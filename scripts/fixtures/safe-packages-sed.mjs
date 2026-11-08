import { Shell, commandRuntimeIdentity } from '@poe-platform/safe-bash';
import { MemoryFileSystem, FsError as filesystemError } from '@poe-platform/safe-fs/core';
import { createSedCommand, createSedCommands, sedCommands } from '@poe-platform/safe-bash/commands/sed';
import { createCommandArguments, getCommandArguments, commandRuntimeIdentity as contractIdentity } from '@poe-platform/safe-bash/contracts/command';
import { FsError } from '@poe-platform/safe-bash/contracts/errors';
import { shellValueFromBytes } from '@poe-platform/safe-bash/contracts/value';

function assert(condition, message) { if (!condition) throw new Error(message); }

export async function verifySed() {
  assert(FsError === filesystemError, 'sed filesystem error identity');
  assert(commandRuntimeIdentity === contractIdentity, 'sed runtime identity');
  assert(createSedCommands().map(command => command.name).join() === 'sed', 'sed inventory');
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input', new TextEncoder().encode('old old\nkeep\n'));
  await fs.writeFile('/edit.sed', new TextEncoder().encode('1s/old/new/g'));
  const shell = new Shell({ fs }).use(sedCommands());
  let paired = false;
  const definition = createSedCommand();
  shell.use({ name: 'sed-boundary-witness', setup(host) {
    host.commands.register({ name: 'raw-byte', async execute(context) {
      await context.stdout.write(Uint8Array.of(255)); return { exitCode: 0 };
    } });
    host.commands.register({ ...definition, runtimeIdentity: commandRuntimeIdentity, async execute(context) {
      if (context.args[0] === 's/x/' + '\ufffd' + '/') {
        paired = getCommandArguments(context) === context.argumentValues;
        assert(context.argumentValues.bytes(0)[4] === 255, 'Shell byte argv was decoded');
      }
      return definition.execute(context);
    } }, { replace: true });
  } });
  try {
    const pipeline = await shell.exec('sed -f /edit.sed /input | sed -n 1p');
    assert(pipeline.exitCode === 0 && pipeline.stdout === 'new new\n', 'sed file/pipeline: ' + JSON.stringify(pipeline));
    const raw = await shell.exec('sed "s/x/$(raw-byte)/"', { stdin: 'x\n' });
    assert(raw.exitCode === 0 && paired, 'sed canonical Shell argv');
    // Sed's established program parser consumes decoded argument text.
    assert(raw.stdout === '\ufffd\n', 'sed decoded replacement policy');
    const inplace = await shell.exec("sed -i.bak 's/old/new/g' /input");
    assert(inplace.exitCode === 0 && inplace.stdout === '', 'sed in-place status');
    assert(new TextDecoder().decode(await fs.readFile('/input')) === 'new new\nkeep\n', 'sed publication');
    assert(new TextDecoder().decode(await fs.readFile('/input.bak')) === 'old old\nkeep\n', 'sed backup');
    const missing = await shell.exec('sed p /missing');
    assert(missing.exitCode === 1 && missing.stderr.includes('ENOENT'), 'sed filesystem diagnostic');
    shell.use(sedCommands({ replace: true, maxProgramInstructions: 1 }));
    const bounded = await shell.exec('sed "p;p"', { stdin: 'x\n' });
    assert(bounded.exitCode === 2 && bounded.stderr.includes('program instruction limit'), 'sed explicit budget');
  } finally { await shell.dispose(); }
  const collision = new Shell({ fs }).use(sedCommands()).use(sedCommands());
  try {
    let rejected = false;
    try { await collision.exec(':'); } catch (error) { rejected = error.message.includes('already registered'); }
    assert(rejected, 'sed collision policy');
  } finally { await collision.dispose(); }

  const value = shellValueFromBytes(Uint8Array.of(115, 47, 120, 47, 254, 47));
  const carrier = createCommandArguments([value]);
  const chunks = [];
  const context = { command: 'sed', args: carrier.args, argumentValues: carrier, fs, cwd: '/', env: { LC_ALL: 'C' },
    stdin: (async function* () { yield Uint8Array.of(120, 10); })(), signal: new AbortController().signal,
    stdout: { async write(chunk) { chunks.push(...chunk); } }, stderr: { async write() { throw new Error('unexpected sed diagnostic'); } },
  };
  assert((await definition.execute(context)).exitCode === 0 && chunks.join() === '239,191,189,10', 'sed owned byte value');
  assert(carrier.bytes(0)[4] === 254, 'sed must retain the original owned argument');
  const cancelled = new AbortController();
  const reason = new Error('sed cancelled');
  cancelled.abort(reason);
  let rejection;
  try { await definition.execute({ ...context, signal: cancelled.signal }); } catch (error) { rejection = error; }
  assert(rejection === reason, 'sed cancellation identity');
  const active = new AbortController();
  const activeReason = new Error('sed stream cancelled');
  let closed = false;
  rejection = undefined;
  const binary = [];
  const binaryResult = await definition.execute({ ...context, args: ['-z', 's/x/y/'], argumentValues: undefined,
    stdin: (async function* () { yield Uint8Array.of(255, 120, 0, 254, 120, 0); })(),
    stdout: { async write(chunk) { binary.push(...chunk); } },
  });
  assert(binaryResult.exitCode === 0 && binary.join() === '255,121,0,254,121,0', 'sed binary null records');
  try {
    await definition.execute({ ...context, args: ['p'], argumentValues: undefined, signal: active.signal,
      stdin: (async function* () {
        try { yield Uint8Array.of(120, 10); active.abort(activeReason); yield Uint8Array.of(121, 10); }
        finally { closed = true; }
      })(),
      stdout: { async write() {} },
    });
  } catch (error) { rejection = error; }
  assert(rejection === activeReason && closed, 'sed active cancellation and input cleanup');
}

export const verification = verifySed();
