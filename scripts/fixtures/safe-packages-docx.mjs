import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { FsError as CoreFsError } from "@poe-platform/safe-fs/core";
import { createCommandArguments, getCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { createDocxCommand, createDocxCommands, docxCommands } from "@poe-platform/safe-bash/commands/docx";
function check(value, message) { if (!value) throw new Error(message); }
export const verification = (async () => {
  check(FsError === CoreFsError, "DOCX canonical errors");
  check(JSON.stringify(createDocxCommands().map(command => command.name)) === '["docx"]', "DOCX inventory");
  const fs = createMemoryFileSystem();
  await fs.writeFile('/run.sh', new TextEncoder().encode('docx version | relay'));
  const shell = new Shell({ fs }).use(docxCommands());
  shell.commands.register({ name: 'relay', async execute(context) {
    for await (const bytes of context.stdin) await context.stdout.write(bytes);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec('sh /run.sh');
    check(result.exitCode === 0 && result.stdout === 'docx 0.0.1\n' && result.stderr === '', 'DOCX built-in engine through VFS script and pipeline');
    const schema = await shell.exec('docx schema text replace');
    check(schema.exitCode === 0 && JSON.parse(schema.stdout).ok, 'DOCX discovery');
    await fs.writeFile('/content.json', new TextEncoder().encode(JSON.stringify({ version: 1, blocks: [{ kind: 'paragraph', text: 'Packed DOCX coast' }] })));
    const created = await shell.exec('docx create --content-file /content.json --output /document.docx --json');
    check(created.exitCode === 0 && JSON.parse(created.stdout).ok, 'DOCX packed archive creation');
    const extracted = await shell.exec('docx text /document.docx');
    check(extracted.exitCode === 0 && extracted.stdout.includes('Packed DOCX coast'), 'DOCX packed archive reading');
    const original = shell.commands.get('docx');
    let collision;
    try { docxCommands().setup(shell); } catch (error) { collision = error; }
    check(collision && shell.commands.get('docx') === original, 'DOCX collision preflight');
    docxCommands({ replace: true, engine: { async execute(request) {
      await request.stdout.write(request.args[0]);
      return { exitCode: 0 };
    } } }).setup(shell);
    for (const byte of [254, 255]) {
      const value = await shell.exec(`docx $'\\x${byte.toString(16)}' | relay`);
      check(value.exitCode === 0 && value.stdoutBytes.length === 1 && value.stdoutBytes[0] === byte, 'DOCX raw shell byte argv');
    }
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  let invoked = false;
  const engine = { async execute(request) {
    invoked = true;
    check(request.args[0][0] === 255, 'DOCX canonical value bytes');
    return { exitCode: 0 };
  } };
  const context = { command: 'docx', args: carrier.args, argumentValues: carrier, cwd: '/', env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() {} }, signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } };
  check((await createDocxCommand({ engine }).execute(context)).exitCode === 0 && invoked, 'DOCX canonical carrier');
  let mismatch;
  try { getCommandArguments({ ...context, args: [...carrier.args] }); } catch (error) { mismatch = error; }
  check(mismatch instanceof CommandArgumentIdentityError, 'DOCX carrier pairing');
  let limited;
  try { await createDocxCommand({ engine, limits: { maxArgumentBytes: 0 } }).execute(context); } catch (error) { limited = error; }
  check(limited instanceof FsError && limited.code === 'EFBIG', 'DOCX explicit limit and error identity');
  const abort = new AbortController();
  const reason = new Error('cancel DOCX');
  const cancelled = createDocxCommand({ engine: { async execute() { abort.abort(reason); return { exitCode: 0 }; } } });
  let failure;
  try { await cancelled.execute({ ...context, signal: abort.signal }); } catch (error) { failure = error; }
  check(failure === reason, 'DOCX cancellation identity');
})();
await verification;
