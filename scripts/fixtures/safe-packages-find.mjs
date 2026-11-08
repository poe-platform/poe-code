import { Shell, createFindCommand as rootCommand, findCommands as rootPlugin } from "@poe-platform/safe-bash";
import { MemoryFileSystem, FsError as CanonicalFsError } from "@poe-platform/safe-fs/core";
import { createCommandArguments, getCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createFindCommand, createFindCommands, findCommands } from "@poe-platform/safe-bash/commands/find";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(rootCommand === createFindCommand && rootPlugin === findCommands, "find public factory identity");
  check(FsError === CanonicalFsError, "find canonical filesystem errors");
  check(JSON.stringify(createFindCommands().map(command => command.name)) === '["find"]', "find inventory");
  const fs = new MemoryFileSystem();
  const encoder = new TextEncoder();
  await fs.mkdir("/tree");
  await fs.writeFile("/tree/file", encoder.encode("content"));
  await fs.symlink("file", "/tree/link");
  await fs.writeFile("/run.sh", encoder.encode(`find /tree -type f -exec probe "$1" {} ';' | relay\n`));
  const shell = new Shell({ fs }).use(findCommands());
  shell.commands.register({ name: "probe", async execute(context) {
    const args = getCommandArguments(context);
    check(args.args[1] === "/tree/file", "find child path");
    await context.stdout.write(args.bytes(0));
    return { exitCode: 0 };
  } });
  shell.commands.register({ name: "relay", async execute(context) {
    for await (const bytes of context.stdin) await context.stdout.write(bytes);
    return { exitCode: 0 };
  } });
  try {
    for (const byte of [255, 254]) {
      const result = await shell.exec(`sh /run.sh $'\\x${byte.toString(16)}'`);
      check(result.exitCode === 0 && result.stdoutBytes.length === 1 && result.stdoutBytes[0] === byte && result.stderr === "", "find VFS script, pipe and byte argv");
    }
    const followed = await shell.exec("find -L /tree/link -printf '%y:%f'");
    check(followed.stdout === "f:link" && followed.exitCode === 0, "find logical symlink traversal");
    const original = shell.commands.get("find");
    let collision;
    try { await findCommands().setup(shell); } catch (error) { collision = error; }
    check(collision && shell.commands.get("find") === original, "find collision preserves registration");
    await findCommands({ replace: true, limits: { maxDirectoryEntries: 1 } }).setup(shell);
    const limited = await shell.exec("find /tree -type f");
    check(limited.exitCode !== 0 && limited.stderr.includes("EFBIG"), "find finite directory admission");
    await findCommands({ replace: true }).setup(shell);
    const controller = new AbortController();
    const reason = Object.freeze({ cancelled: "find" });
    shell.commands.register({ name: "cancel", async execute() { controller.abort(reason); return { exitCode: 0 }; } });
    let cancelled;
    try { await shell.exec("find /tree -exec cancel {} \\;", { signal: controller.signal }); } catch (error) { cancelled = error; }
    check(cancelled === reason, "find child cancellation identity");
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments([".", "-maxdepth", "0", "-printf", shellValueFromBytes(Uint8Array.of(255))]);
  const bytes = [];
  const context = { command: "find", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() {} }, signal: new AbortController().signal,
    stdout: { async write(chunk) { bytes.push(...chunk); } }, stderr: { async write() {} } };
  check((await createFindCommand().execute(context)).exitCode === 0 && bytes.length === 1 && bytes[0] === 255, "find canonical printf byte value");
  const invalid = { ...context, args: [...carrier.args] };
  let identity;
  try { getCommandArguments(invalid); } catch (error) { identity = error; }
  check(identity instanceof CommandArgumentIdentityError, "find canonical carrier negative control");
  let diagnostic = "";
  const rejected = await createFindCommand().execute({ ...invalid, stderr: {
    async write(chunk) { diagnostic += new TextDecoder().decode(chunk); },
  } });
  check(rejected.exitCode === 1 && diagnostic.includes(identity.message), "find reports canonical argument errors");
})();
