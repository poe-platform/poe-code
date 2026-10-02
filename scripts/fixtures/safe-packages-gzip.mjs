import {
  Shell, CommandRegistry, createMemoryFileSystem, createReadOnlyFileSystem,
  createStandardCommands, createByteCommands, FsError, getCommandArguments,
  commandRuntimeIdentity,
} from '@poe-platform/safe-bash';
import * as contracts from '@poe-platform/safe-bash/contracts';
import { shellValueBytes } from '@poe-platform/safe-bash/contracts/value';
import { createGzipCommands, gzipCommands } from '@poe-platform/safe-bash/commands/gzip';

function check(condition, message) { if (!condition) throw new Error(message); }
function equal(actual, expected) { check(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }

export const verification = (async () => {
  check(FsError === contracts.FsError, 'canonical filesystem errors');
  check(getCommandArguments === contracts.getCommandArguments, 'canonical argument implementation');
  check(commandRuntimeIdentity === contracts.commandRuntimeIdentity, 'canonical command runtime');
  const names = ['gzip', 'gunzip', 'zcat'];
  equal(createGzipCommands().map(command => command.name), names);
  equal(createByteCommands().filter(command => names.includes(command.name)).map(command => command.name), names);
  const collision = new CommandRegistry([createGzipCommands()[1]]);
  let rejected = false;
  try { gzipCommands().setup({ commands: collision }); } catch { rejected = true; }
  check(rejected && !collision.has('gzip'), 'plugin collision preflight must be atomic');
  gzipCommands({ replace: true }).setup({ commands: collision });
  equal(collision.list().map(command => command.name).sort(), [...names].sort());
  const commands = new CommandRegistry(createStandardCommands());
  let invocations = 0;
  for (const command of createGzipCommands()) {
    check(command.runtimeIdentity === commandRuntimeIdentity, 'gzip runtime identity');
    commands.register({ ...command, async execute(context) {
      const carrier = getCommandArguments(context);
      check(carrier === contracts.getCommandArguments(context), 'command argv brand');
      check(carrier.args === context.args, 'paired command argv');
      invocations++;
      return command.execute(context);
    } });
  }
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, commands });
  const payload = Uint8Array.of(0, 10, 127, 128, 255, 239, 187, 191, 65);
  try {
    const result = await shell.exec('gzip -c | zcat', { stdin: payload });
    equal(result.exitCode, 0);
    equal([...result.stdoutBytes], [...payload]);
    await fs.writeFile('/bytes', payload);
    await fs.writeFile('/script.sh', new TextEncoder().encode('gzip -k /bytes\ngunzip -c /bytes.gz'));
    const script = await shell.exec('sh /script.sh');
    equal(script.exitCode, 0);
    equal([...script.stdoutBytes], [...payload]);
    equal([...await fs.readFile('/bytes')], [...payload]);
    const member = await fs.readFile('/bytes.gz');
    const corrupt = member.slice();
    corrupt[corrupt.length - 8] ^= 1;
    const damaged = await shell.exec('gunzip -t', { stdin: corrupt });
    equal(damaged.exitCode, 1);
    equal(damaged.stderr, 'gunzip: incorrect data check (CRC)\n');
    const invalid = await shell.exec('gzip --unknown');
    equal(invalid.exitCode, 2);
    check(invalid.stderr.includes('unknown'), 'canonical usage diagnostics');
    commands.register({ name: 'argv-probe', execute(context) {
      const values = contracts.getCommandArguments(context);
      equal([...shellValueBytes(values.values[0])], [128]);
      equal(values.args[0], values.args[1]);
      equal([...values.bytes(0)], [128]);
      equal([...values.bytes(1)], [129]);
      return { exitCode: 0 };
    } });
    equal((await shell.exec("argv-probe $'\\x80' $'\\x81' | gzip -c | zcat")).exitCode, 0);
    check(invocations > 3, 'actual Shell gzip invocations exercised');
    for (const command of createGzipCommands({ maxDecodedBytes: payload.length - 1 })) commands.register(command, { replace: true });
    equal((await shell.exec('zcat /bytes.gz')).exitCode, 1);
    for (const command of createGzipCommands()) commands.register(command, { replace: true });
    equal((await shell.exec('zcat /bytes.gz')).exitCode, 0);
    equal([...await fs.readFile('/bytes')], [...payload]);
  } finally { await shell.dispose(); }
  const denied = new Shell({ fs: createReadOnlyFileSystem(fs), commands: new CommandRegistry(createGzipCommands()) });
  try {
    equal((await denied.exec('gzip /bytes')).exitCode, 1);
    equal((await denied.exec('gzip -c /bytes')).exitCode, 0);
  } finally { await denied.dispose(); }
  const controller = new AbortController();
  const reason = new Error('packed gzip cancellation');
  let closed = false;
  const values = contracts.createCommandArguments(['-c']);
  let failure;
  try {
    await createGzipCommands()[0].execute({
      command: 'gzip', args: values.args, argumentValues: values, cwd: '/', env: {}, fs,
      signal: controller.signal,
      stdin: (async function* () {
        try { yield payload; controller.abort(reason); controller.signal.throwIfAborted(); }
        finally { closed = true; }
      })(),
      stdout: { async write() {} }, stderr: { async write() {} },
    });
  } catch (error) { failure = error; }
  check(failure === reason && closed, 'original cancellation identity and source cleanup');
})();
