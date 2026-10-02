import { Shell, createPrCommand as rootCommand, createPrCommands as rootCommands, prCommands as rootPlugin } from "@poe-platform/safe-bash";
import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { createCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createPrCommand, createPrCommands, prCommands } from "@poe-platform/safe-bash/commands/pr";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(rootCommand === createPrCommand && rootCommands === createPrCommands && rootPlugin === prCommands, "pr public factory identity");
  check(JSON.stringify(createPrCommands().map(command => command.name)) === '["pr"]', "pr inventory");
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(prCommands());
  try {
    check((await shell.exec("pr -t", { stdin: "ready\n" })).stdout === "ready\n", "pr registration");
    const host = { commands: shell.commands, use() {}, registerFileSystem() {} };
    const original = shell.commands.get("pr");
    let collision;
    try { await prCommands().setup(host); } catch (error) { collision = error; }
    check(collision && shell.commands.get("pr") === original, "pr collision preserves registration");
    await prCommands({ replace: true }).setup(host);
    check(shell.commands.get("pr") !== original, "pr explicit replacement");
    shell.commands.register({ name: "relay", async execute(context) {
      for await (const chunk of context.stdin) await context.stdout.write(chunk);
      return { exitCode: 0 };
    } });
    await fs.writeFile("/pr.sh", new TextEncoder().encode('pr -t -l2 "$1" | relay'));
    await fs.writeFile("/input", Uint8Array.of(255, 10, 254, 10, 65, 10));
    const result = await shell.exec("sh /pr.sh /input");
    check(result.exitCode === 0 && result.stderr === "" && JSON.stringify([...result.stdoutBytes]) === '[255,10,254,10,65,10]', "pr VFS script, bytes and pipeline");
    const page = await shell.exec("pr -t -2 -s,", { stdin: "a\nb\nc\nd\n" });
    check(page.stdout === "a,c\nb,d\n" && page.exitCode === 0, "pr multicolumn layout");
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments(["-t", shellValueFromBytes(Uint8Array.of(45))]);
  let output = [];
  const context = { command: "pr", args: carrier.args, argumentValues: carrier, cwd: "/", env: { LC_ALL: "C" }, fs,
    stdin: { async *[Symbol.asyncIterator]() { yield Uint8Array.of(255, 10); } }, signal: new AbortController().signal,
    stdout: { async write(chunk) { output.push(...chunk); } }, stderr: { async write() {} } };
  check((await createPrCommand().execute(context)).exitCode === 0 && JSON.stringify(output) === '[255,10]', "pr canonical value identity");
  let identity;
  try { await createPrCommand().execute({ ...context, args: [...carrier.args] }); } catch (error) { identity = error; }
  check(identity instanceof CommandArgumentIdentityError, "pr canonical argument error identity");
  const reason = new FsError("EIO", "/output", "packed sink failure");
  let failure;
  try { await createPrCommand().execute({ ...context, stdout: { async write() { throw reason; } } }); } catch (error) { failure = error; }
  check(failure === reason && failure instanceof FsError, "pr sink error identity");
  const controller = new AbortController(); controller.abort(reason);
  let cancellation;
  try { await createPrCommand().execute({ ...context, signal: controller.signal }); } catch (error) { cancellation = error; }
  check(cancellation === reason, "pr cancellation identity");
  output = [];
  check((await createPrCommand({ limits: { maxOutputBytes: 1 } }).execute(context)).exitCode === 1 && output.length === 0, "pr explicit output limit");
})();
