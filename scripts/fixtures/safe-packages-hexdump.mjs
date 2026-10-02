import { Shell, createMemoryFileSystem, createHexdumpCommand as rootCommand, hexdumpCommands as rootPlugin } from "@poe-platform/safe-bash";
import { FsError as canonicalFsError } from "@poe-platform/safe-fs/core";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createCommandArguments, getCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { createHexdumpCommand, createHdCommand, createHexdumpCommands, hexdumpCommands } from "@poe-platform/safe-bash/commands/hexdump";

function check(value, message) { if (!value) throw new Error(message); }
export const verification = (async () => {
  check(rootCommand === createHexdumpCommand && rootPlugin === hexdumpCommands, "hexdump public factory identity");
  check(FsError === canonicalFsError, "hexdump canonical filesystem errors");
  check(JSON.stringify(createHexdumpCommands().map(command => command.name)) === '["hexdump","hd"]', "hexdump inventory");
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input', new Uint8Array([0, 255, 65]));
  await fs.writeFile('/run.sh', new TextEncoder().encode('hd /input | relay'));
  const shell = new Shell({ fs }).use(hexdumpCommands());
  shell.commands.register({ name: 'relay', async execute(context) {
    for await (const bytes of context.stdin) await context.stdout.write(bytes);
    return { exitCode: 0 };
  } });
  shell.commands.register({ name: 'identity', async execute(context) {
    await context.stdout.write(getCommandArguments(context).bytes(0));
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec('sh /run.sh');
    check(result.exitCode === 0 && result.stdout === '00000000  00 ff 41                                          |..A|\n00000003\n' && result.stderr === '', 'hd VFS script and pipeline');
    check((await shell.exec('hexdump -C /input')).stdout === result.stdout, 'hexdump and hd alias parity');
    for (const byte of [254, 255]) {
      const result = await shell.exec(`hd /input | identity $'\\x${byte.toString(16)}'`);
      check(result.exitCode === 0 && result.stdoutBytes.length === 1 && result.stdoutBytes[0] === byte, 'hexdump pipeline canonical byte argv');
    }
    await fs.chmod('/input', 0);
    const denied = await shell.exec('hd /input');
    check(denied.exitCode === 1 && denied.stderr.includes('Permission denied'), 'hd canonical filesystem error handling');
    await fs.chmod('/input', 0o644);
    const original = shell.commands.get('hexdump'), alias = shell.commands.get('hd');
    let collision;
    try { hexdumpCommands().setup(shell); } catch (error) { collision = error; }
    check(collision && shell.commands.get('hexdump') === original && shell.commands.get('hd') === alias, 'hexdump collision preflight');
    hexdumpCommands({ replace: true, limits: { maxOutputBytes: 1 } }).setup(shell);
    for (const command of ['hexdump -C', 'hd']) {
      const limited = await shell.exec(`${command} /input`);
      check(limited.exitCode === 1 && limited.stdout === '' && limited.stderr.includes('output bytes limit'), 'hexdump explicit output limit');
    }
  } finally { await shell.dispose(); }
  const collisionShell = new Shell({ fs });
  try {
    collisionShell.commands.register(createHdCommand());
    let collision;
    try { hexdumpCommands().setup(collisionShell); } catch (error) { collision = error; }
    check(collision && !collisionShell.commands.has('hexdump'), 'hd collision prevents partial registration');
  } finally { await collisionShell.dispose(); }
  const carrier = createCommandArguments(['-C', shellValueFromBytes(new TextEncoder().encode('/input'))]);
  const context = { command: 'hexdump', args: carrier.args, argumentValues: carrier, cwd: '/', env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() {} }, signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } };
  check((await createHexdumpCommand().execute(context)).exitCode === 0, 'hexdump accepts canonical value carrier');
  let mismatch;
  try { getCommandArguments({ ...context, args: [...carrier.args] }); } catch (error) { mismatch = error; }
  check(mismatch instanceof CommandArgumentIdentityError, 'hexdump carrier negative control');
  for (const factory of [createHexdumpCommand, createHdCommand]) {
    const controller = new AbortController(); const reason = new FsError('EACCES'); controller.abort(reason);
    let cancelled;
    try { await factory().execute({ ...context, signal: controller.signal }); } catch (error) { cancelled = error; }
    check(cancelled === reason, 'hexdump cancellation preserves canonical errno reason');
  }
})();
