import {
  Shell, CommandRegistry, createMemoryFileSystem, createReadOnlyFileSystem,
  createStandardCommands, createByteCommands, FsError, getCommandArguments,
  commandRuntimeIdentity,
} from '@poe-platform/safe-bash';
import * as contracts from '@poe-platform/safe-bash/contracts';
import { shellValueBytes } from '@poe-platform/safe-bash/contracts/value';
import { createXzCommands } from '@poe-platform/safe-bash/commands/xz';

function check(condition, message) { if (!condition) throw new Error(message); }
function equal(actual, expected) { check(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }

export const verification = (async () => {
  check(FsError === contracts.FsError, 'canonical filesystem errors');
  check(getCommandArguments === contracts.getCommandArguments, 'canonical argument implementation');
  check(commandRuntimeIdentity === contracts.commandRuntimeIdentity, 'canonical command runtime');
  equal(createXzCommands().map(command => command.name), ['xz', 'unxz', 'xzcat']);
  equal(createByteCommands().filter(command => ['xz', 'unxz', 'xzcat'].includes(command.name)).map(command => command.name), ['xz', 'unxz', 'xzcat']);
  const commands = new CommandRegistry(createStandardCommands());
  let invocations = 0;
  for (const command of createXzCommands()) commands.register({
    ...command,
    async execute(context) {
      const carrier = getCommandArguments(context);
      if (context.argumentValues) {
        check(carrier === contracts.getCommandArguments(context), 'command argv brand');
        check(carrier.args === context.args, 'paired command argv');
      } else equal(carrier.args, context.args);
      invocations++;
      return command.execute(context);
    },
  });
  let collided = false;
  try { commands.register(createXzCommands()[0]); } catch { collided = true; }
  check(collided, 'duplicate registration must fail');
  commands.register(createXzCommands()[0], { replace: true });
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, commands });
  const payload = Uint8Array.of(0, 10, 127, 128, 255, 239, 187, 191, 65);
  try {
    for (const format of ['xz', 'lzma', 'raw']) {
      const flags = format === 'raw' ? '--format=raw --lzma2=dict=1MiB' : `--format=${format}`;
      const result = await shell.exec(`xz -c ${flags} | xzcat ${flags}`, { stdin: payload });
      equal(result.exitCode, 0);
      equal([...result.stdoutBytes], [...payload]);
    }
    await fs.writeFile('/bytes', payload);
    await fs.writeFile('/script.sh', new TextEncoder().encode('xz -k --check=sha256 /bytes\nxz --robot --list /bytes.xz\nunxz -c /bytes.xz'));
    const script = await shell.exec('sh /script.sh');
    equal(script.exitCode, 0);
    check(script.stdout.includes('SHA-256'), 'robot listing preserves checks');
    equal([...script.stdoutBytes.slice(-payload.length)], [...payload]);
    equal([...await fs.readFile('/bytes')], [...payload]);
    const corrupted = await shell.exec('xz -dc', { stdin: Uint8Array.of(1, 2, 3) });
    equal(corrupted.exitCode, 1);
    check(corrupted.stderr.includes('compressed') || corrupted.stderr.includes('file'), 'codec diagnostics survive packing');
    const invalid = await shell.exec('xz --check=unknown');
    equal(invalid.exitCode, 2);
    check(invalid.stderr.includes('unsupported XZ integrity check'), 'canonical usage diagnostics');
    commands.register({ name: 'argv-probe', execute(context) {
      const values = contracts.getCommandArguments(context);
      equal([...shellValueBytes(values.values[0])], [128]);
      equal(values.args[0], values.args[1]);
      equal([...values.bytes(0)], [128]);
      equal([...values.bytes(1)], [129]);
      return { exitCode: 0 };
    } });
    equal((await shell.exec("argv-probe $'\\x80' $'\\x81' | xz -c | xzcat")).exitCode, 0);
    check(invocations > 3, 'actual Shell XZ invocations exercised');
    for (const command of createXzCommands({ maxDecodedBytes: payload.length - 1 })) commands.register(command, { replace: true });
    equal((await shell.exec('xzcat /bytes.xz')).exitCode, 1);
    for (const command of createXzCommands()) commands.register(command, { replace: true });
    equal((await shell.exec('xzcat /bytes.xz')).exitCode, 0);
    equal([...await fs.readFile('/bytes')], [...payload]);
  } finally { await shell.dispose(); }
  const denied = new Shell({ fs: createReadOnlyFileSystem(fs), commands: new CommandRegistry(createXzCommands()) });
  try {
    equal((await denied.exec('xz /bytes')).exitCode, 1);
    equal((await denied.exec('xz -c /bytes')).exitCode, 0);
  } finally { await denied.dispose(); }
  const controller = new AbortController();
  const reason = new Error('packed XZ cancellation');
  let closed = false;
  const command = createXzCommands()[0];
  const context = {
    command: 'xz', args: ['-c'], cwd: '/', env: {}, fs,
    signal: controller.signal,
    stdin: (async function* () {
      try { yield payload; controller.abort(reason); controller.signal.throwIfAborted(); }
      finally { closed = true; }
    })(),
    stdout: { async write() {} }, stderr: { async write() {} },
  };
  let failure;
  try { await command.execute(context); } catch (error) { failure = error; }
  check(failure === reason && closed, 'original cancellation identity and source cleanup');
})();
