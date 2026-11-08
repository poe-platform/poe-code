import { Shell, createMemoryFileSystem, createDuCommand as rootCommand, duCommands as rootPlugin } from "@poe-platform/safe-bash";
import { FsError as canonicalFsError } from "@poe-platform/safe-fs/core";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createCommandArguments, getCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { createDuCommand, createDuCommands, duCommands } from "@poe-platform/safe-bash/commands/du";

function check(value, message) { if (!value) throw new Error(message); }
export const verification = (async () => {
  check(rootCommand === createDuCommand && rootPlugin === duCommands, "du public factory identity");
  check(FsError === canonicalFsError, "du canonical filesystem errors");
  check(JSON.stringify(createDuCommands().map(command => command.name)) === '["du"]', "du inventory");
  const fs = createMemoryFileSystem();
  await fs.mkdir('/tree');
  await fs.writeFile('/tree/a', new Uint8Array(3));
  await fs.link('/tree/a', '/tree/b');
  await fs.symlink('a', '/tree/link');
  await fs.writeFile('/run.sh', new TextEncoder().encode('du -bs /tree | relay'));
  const shell = new Shell({ fs }).use(duCommands());
  shell.commands.register({ name: 'relay', async execute(context) {
    for await (const bytes of context.stdin) await context.stdout.write(bytes);
    return { exitCode: 0 };
  } });
  shell.commands.register({ name: 'identity', async execute(context) {
    const values = getCommandArguments(context);
    await context.stdout.write(values.bytes(0));
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec('sh /run.sh');
    check(result.exitCode === 0 && result.stdout === '4\t/tree\n' && result.stderr === '', 'du VFS script and pipeline');
    for (const byte of [254, 255]) {
      const result = await shell.exec(`du -bs /tree | identity $'\\x${byte.toString(16)}'`);
      check(result.exitCode === 0 && result.stdoutBytes.length === 1 && result.stdoutBytes[0] === byte, 'du pipeline canonical byte argv');
    }
    const followed = await shell.exec('du -bsL /tree');
    check(followed.stdout === '3\t/tree\n' && followed.exitCode === 0, 'du symlink and hardlink identity');
    check((await shell.exec('du -bs --exclude=link /tree')).stdout === '3\t/tree\n', 'du exclusions');
    const original = shell.commands.get('du');
    let collision;
    try { duCommands().setup(shell); } catch (error) { collision = error; }
    check(collision && shell.commands.get('du') === original, 'du collision preflight');
    duCommands({ replace: true, limits: { maxOutputBytes: 1 } }).setup(shell);
    const limited = await shell.exec('du -bs /tree');
    check(limited.exitCode === 1 && limited.stdout === '' && limited.stderr === '', 'du explicit output limit');
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments(['-bs', shellValueFromBytes(new TextEncoder().encode('/tree'))]);
  const context = { command: 'du', args: carrier.args, argumentValues: carrier, cwd: '/', env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() {} }, signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } };
  check((await createDuCommand().execute(context)).exitCode === 0, 'du accepts canonical value carrier');
  let mismatch;
  try { getCommandArguments({ ...context, args: [...carrier.args] }); } catch (error) { mismatch = error; }
  check(mismatch instanceof CommandArgumentIdentityError, 'du carrier negative control');
  const controller = new AbortController(); const reason = new FsError('EACCES'); controller.abort(reason);
  let cancelled;
  try { await createDuCommand().execute({ ...context, signal: controller.signal }); } catch (error) { cancelled = error; }
  check(cancelled === reason, 'du cancellation preserves canonical errno reason');
})();
