import {
  Shell, CommandRegistry, createMemoryFileSystem, createReadOnlyFileSystem,
  createStandardCommands, createByteCommands, FsError, getCommandArguments,
  commandRuntimeIdentity, createBzip2Command, bzip2Commands,
} from '@poe-platform/safe-bash';
import * as contracts from '@poe-platform/safe-bash/contracts';
import { shellValueBytes } from '@poe-platform/safe-bash/contracts/value';
import * as bzip2 from '@poe-platform/safe-bash/commands/bzip2';

function check(condition, message) { if (!condition) throw new Error(message); }
function equal(actual, expected) { check(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }

export const verification = (async () => {
  check(FsError === contracts.FsError, 'canonical filesystem errors');
  check(getCommandArguments === contracts.getCommandArguments, 'canonical argv');
  check(commandRuntimeIdentity === contracts.commandRuntimeIdentity, 'canonical runtime');
  check(createBzip2Command === bzip2.createBzip2Command, 'root/subpath factory identity');
  check(bzip2Commands === bzip2.bzip2Commands, 'root/subpath plugin identity');
  const names = ['bzip2', 'bunzip2', 'bzcat'];
  equal(bzip2.createBzip2Commands().map(command => command.name), names);
  equal(createByteCommands().filter(command => names.includes(command.name)).map(command => command.name), names);
  const commands = new CommandRegistry(createStandardCommands());
  let invocations = 0;
  for (const command of bzip2.createBzip2Commands()) {
    check(command.runtimeIdentity === commandRuntimeIdentity, 'command runtime identity');
    commands.register({ ...command, async execute(context) {
      const carrier = getCommandArguments(context);
      check(carrier === contracts.getCommandArguments(context), 'canonical carrier');
      check(carrier.args === context.args, 'paired argv');
      invocations++;
      return command.execute(context);
    } });
  }
  let collided = false;
  try { commands.register(createBzip2Command()); } catch { collided = true; }
  check(collided, 'duplicate registration rejected');
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, commands });
  const payload = Uint8Array.of(0, 10, 127, 128, 255, 239, 187, 191, 65);
  try {
    const piped = await shell.exec('bzip2 -c | bunzip2 -c', { stdin: payload });
    equal(piped.exitCode, 0);
    equal([...piped.stdoutBytes], [...payload]);
    await fs.writeFile('/bytes', payload);
    await fs.writeFile('/script.sh', new TextEncoder().encode('bzip2 -k /bytes\nbzcat /bytes.bz2'));
    const script = await shell.exec('sh /script.sh');
    equal(script.exitCode, 0);
    equal([...script.stdoutBytes], [...payload]);
    equal([...await fs.readFile('/bytes')], [...payload]);
    const encoded = await fs.readFile('/bytes.bz2');
    const concatenated = new Uint8Array(encoded.length * 2);
    concatenated.set(encoded); concatenated.set(encoded, encoded.length);
    const decoded = await shell.exec('bunzip2 -sc', { stdin: concatenated });
    equal(decoded.exitCode, 0);
    equal([...decoded.stdoutBytes], [...payload, ...payload]);
    equal((await shell.exec('bunzip2 -c', { stdin: encoded.slice(0, -1) })).exitCode, 2);
    equal((await shell.exec('bzip2 --unsupported')).exitCode, 2);
    equal((await shell.exec('bzcat /missing')).exitCode, 1);
    commands.register({ name: 'argv-probe', execute(context) {
      const carrier = getCommandArguments(context);
      equal(carrier.args[0], carrier.args[1]);
      equal([...shellValueBytes(carrier.values[0])], [128]);
      equal([...carrier.bytes(0)], [128]);
      equal([...carrier.bytes(1)], [129]);
      return { exitCode: 0 };
    } });
    equal((await shell.exec("argv-probe $'\\x80' $'\\x81' | bzip2 -c | bzcat")).exitCode, 0);
    check(invocations > 3, 'actual Shell execution');
    shell.use(bzip2Commands({ replace: true, limits: { maxDecodedBytes: payload.length - 1 } }));
    equal((await shell.exec('bzcat /bytes.bz2')).exitCode, 1);
    shell.use(bzip2Commands({ replace: true }));
    equal((await shell.exec('bzcat /bytes.bz2')).exitCode, 0);
  } finally { await shell.dispose(); }
  const denied = new Shell({ fs: createReadOnlyFileSystem(fs), commands: new CommandRegistry(bzip2.createBzip2Commands()) });
  try {
    equal((await denied.exec('bzip2 /bytes')).exitCode, 1);
    equal((await denied.exec('bzip2 -c /bytes')).exitCode, 0);
  } finally { await denied.dispose(); }
  const controller = new AbortController();
  const reason = new Error('packed bzip2 cancellation');
  let closed = false;
  const carrier = contracts.createCommandArguments(['-c']);
  let failure;
  try {
    await createBzip2Command().execute({
      command: 'bzip2', args: carrier.args, argumentValues: carrier, cwd: '/', env: {}, fs,
      signal: controller.signal,
      stdin: (async function* () {
        try { yield payload; controller.abort(reason); controller.signal.throwIfAborted(); }
        finally { closed = true; }
      })(), stdout: { async write() {} }, stderr: { async write() {} },
    });
  } catch (error) { failure = error; }
  check(failure === reason && closed, 'cancellation identity and producer cleanup');
})();
await verification;
