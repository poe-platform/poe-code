import { Shell, createMemoryFileSystem, createFileCommand as rootCommand, fileCommands as rootPlugin } from "@poe-platform/safe-bash";
import { FsError as canonicalFsError } from "@poe-platform/safe-fs/core";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createCommandArguments, getCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { createFileCommand, createFileCommands, fileCommands } from "@poe-platform/safe-bash/commands/file";

function check(value, message) { if (!value) throw new Error(message); }
export const verification = (async () => {
  check(rootCommand === createFileCommand && rootPlugin === fileCommands, "file public factory identity");
  check(FsError === canonicalFsError, "file canonical filesystem errors");
  check(JSON.stringify(createFileCommands().map(command => command.name)) === '["file"]', "file inventory");
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input', new TextEncoder().encode('hello\n'));
  await fs.symlink('/input', '/link');
  await fs.writeFile('/run.sh', new TextEncoder().encode('file -bi /input | relay'));
  const shell = new Shell({ fs }).use(fileCommands());
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
    check(result.exitCode === 0 && result.stdout === 'text/plain; charset=us-ascii\n' && result.stderr === '', 'file VFS script and pipeline');
    for (const byte of [254, 255]) {
      const result = await shell.exec(`file -bi /input | identity $'\\x${byte.toString(16)}'`);
      check(result.exitCode === 0 && result.stdoutBytes.length === 1 && result.stdoutBytes[0] === byte, 'file pipeline canonical byte argv');
    }
    check((await shell.exec('file -bi /link')).stdout === 'inode/symlink; charset=binary\n', 'file default symlink policy');
    check((await shell.exec('file -biL /link')).stdout === 'text/plain; charset=us-ascii\n', 'file dereference');
    const stdin = await shell.exec('file -bi -', { stdin: Uint8Array.of(0, 255) });
    check(stdin.exitCode === 0 && stdin.stdout === 'application/octet-stream; charset=binary\n', 'file binary stdin');
    const nul = await shell.exec('file -00 /input');
    check(nul.stdout === '/input\0ASCII text\0', 'file exact NUL output');
    const original = shell.commands.get('file');
    let collision;
    try { fileCommands().setup(shell); } catch (error) { collision = error; }
    check(collision && shell.commands.get('file') === original, 'file collision preflight');
    fileCommands({ replace: true, limits: { maxOutputBytes: 1 } }).setup(shell);
    const limited = await shell.exec('file -bi /input');
    check(limited.exitCode === 1 && limited.stdout === '' && limited.stderr === 'f', 'file explicit output limit');
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments(['-bi', shellValueFromBytes(new TextEncoder().encode('/input'))]);
  const context = { command: 'file', args: carrier.args, argumentValues: carrier, cwd: '/', env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() {} }, signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } };
  check((await createFileCommand().execute(context)).exitCode === 0, 'file accepts canonical value carrier');
  let mismatch;
  try { getCommandArguments({ ...context, args: [...carrier.args] }); } catch (error) { mismatch = error; }
  check(mismatch instanceof CommandArgumentIdentityError, 'file carrier negative control');
  let diagnostic = '';
  const denied = new FsError('EACCES', { path: '/input', syscall: 'read' });
  const deniedFs = new Proxy(fs, { get(target, key) {
    if (key === 'lstat') return async () => { throw denied; };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const failure = await createFileCommand().execute({ ...context, fs: deniedFs,
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } } });
  check(failure.exitCode === 1 && diagnostic.includes('permission denied'), 'file recognizes canonical filesystem errors');
  const controller = new AbortController(); const reason = new FsError('EACCES'); controller.abort(reason);
  let cancelled;
  try { await createFileCommand().execute({ ...context, signal: controller.signal }); } catch (error) { cancelled = error; }
  check(cancelled === reason, 'file cancellation preserves canonical errno reason');
})();
