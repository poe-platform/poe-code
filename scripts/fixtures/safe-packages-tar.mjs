import {
  Shell, CommandRegistry, createMemoryFileSystem, createStandardCommands,
  createTarCommand as rootFactory, createArchiveCommands, FsError,
  getCommandArguments, commandRuntimeIdentity,
} from '@poe-platform/safe-bash';
import { createTarCommand, createTarCommands, tarCommands } from '@poe-platform/safe-bash/commands/tar';
import * as contracts from '@poe-platform/safe-bash/contracts';
import { shellValueBytes } from '@poe-platform/safe-bash/contracts/value';

function check(value, message) { if (!value) throw new Error(message); }
function equal(actual, expected) { check(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }

export const verification = (async () => {
  check(FsError === contracts.FsError, 'canonical filesystem error');
  check(getCommandArguments === contracts.getCommandArguments, 'canonical argument owner');
  check(commandRuntimeIdentity === contracts.commandRuntimeIdentity, 'canonical runtime owner');
  equal(rootFactory().name, 'tar');
  equal(createTarCommands().map(command => command.name), ['tar']);
  check(createArchiveCommands().some(command => command.name === 'tar'), 'archive composition retains tar');
  const commands = new CommandRegistry(createStandardCommands());
  tarCommands().setup({ commands });
  let collision = false;
  try { commands.register(createTarCommand()); } catch { collision = true; }
  check(collision, 'duplicate registration rejected');
  const implementation = createTarCommand();
  let calls = 0;
  commands.register({ ...implementation, execute(context) {
    const carrier = getCommandArguments(context);
    check(carrier === contracts.getCommandArguments(context), 'shared argv carrier');
    check(carrier.args === context.args, 'paired argv identity');
    calls++;
    return implementation.execute(context);
  } }, { replace: true });
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, commands });
  const bytes = Uint8Array.of(0, 10, 127, 128, 255, 239, 187, 191, 65);
  await fs.writeFile('/payload', bytes);
  try {
    for (const flag of ['', 'z', 'j', 'J']) {
      const result = await shell.exec(`tar -c${flag}f - payload | tar -xOf -`);
      equal(result.exitCode, 0);
      equal([...result.stdoutBytes], [...bytes]);
    }
    await fs.writeFile('/script.sh', new TextEncoder().encode('tar -cf /archive.tar payload\ntar -tf /archive.tar\ntar -xOf /archive.tar'));
    const result = await shell.exec('sh /script.sh');
    equal(result.exitCode, 0);
    equal([...result.stdoutBytes], [...new TextEncoder().encode('payload\n'), ...bytes]);
    await fs.writeFile('/extra', new TextEncoder().encode('extra'));
    equal((await shell.exec('tar -rf /archive.tar extra')).exitCode, 0);
    equal((await shell.exec('tar -tf /archive.tar')).stdout, 'payload\nextra\n');
    equal((await shell.exec('tar --delete -f /archive.tar extra')).exitCode, 0);
    equal((await shell.exec('tar -tf /archive.tar')).stdout, 'payload\n');
    await fs.mkdir('/out');
    equal((await shell.exec('tar -xf /archive.tar -C /out')).exitCode, 0);
    equal([...await fs.readFile('/out/payload')], [...bytes]);
    await fs.writeFile('/out/payload', new TextEncoder().encode('keep'));
    equal((await shell.exec('tar --skip-old-files -xf /archive.tar -C /out')).exitCode, 0);
    equal(new TextDecoder().decode(await fs.readFile('/out/payload')), 'keep');
    commands.register({ name: 'argv-probe', execute(context) {
      const carrier = contracts.getCommandArguments(context);
      equal(carrier.args[0], carrier.args[1]);
      equal([...shellValueBytes(carrier.values[0])], [128]);
      equal([...carrier.bytes(1)], [129]);
      return { exitCode: 0 };
    } });
    equal((await shell.exec("argv-probe $'\\x80' $'\\x81' | tar -tf /archive.tar")).exitCode, 0);
    check(calls >= 15, 'real Shell tar execution');
    commands.register(createTarCommand({ limits: { maxArchiveBytes: 512 } }), { replace: true });
    equal((await shell.exec('tar -tf /archive.tar')).exitCode, 2);
    commands.register(createTarCommand(), { replace: true });
    equal((await shell.exec('tar -tf /archive.tar')).exitCode, 0);
  } finally { await shell.dispose(); }

  const filesystemError = new FsError('EACCES', { syscall: 'lstat', path: '/denied' });
  const deniedFs = new Proxy(fs, { get(target, property) {
    if (property === 'lstat') return async () => { throw filesystemError; };
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const denied = new Shell({ fs: deniedFs, commands: new CommandRegistry(createTarCommands()) });
  try {
    const result = await denied.exec('tar -cf - /denied');
    equal(result.exitCode, 2);
    check(result.stderr.includes('EACCES') || result.stderr.includes('permission denied'), 'filesystem error crosses tar boundary');
  } finally { await denied.dispose(); }

  const controller = new AbortController();
  const reason = new Error('packed tar cancellation');
  let closed = false;
  const argv = contracts.createCommandArguments(['-tf', '-']);
  const context = { command: 'tar', args: argv.args, argumentValues: argv, cwd: '/', env: {}, fs,
    signal: controller.signal,
    stdin: (async function* () {
      try { yield new Uint8Array(512); controller.abort(reason); controller.signal.throwIfAborted(); }
      finally { closed = true; }
    })(),
    stdout: { async write() {} }, stderr: { async write() {} },
  };
  let failure;
  try { await createTarCommand().execute(context); } catch (error) { failure = error; }
  check(failure === reason && closed, 'cancellation identity and iterator cleanup');
})();
