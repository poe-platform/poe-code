import { Shell, createSplitCommand as rootCommand, createSplitCommands as rootCommands, splitCommands as rootPlugin } from "@poe-platform/safe-bash";
import { MemoryFileSystem, FsError as FileSystemError } from "@poe-platform/safe-fs/core";
import { createCommandArguments, getCommandArguments } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createSplitCommand, createSplitCommands, splitCommands } from "@poe-platform/safe-bash/commands/split";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(FsError === FileSystemError, "split canonical filesystem error identity");
  check(rootCommand === createSplitCommand && rootCommands === createSplitCommands && rootPlugin === splitCommands, "split public factory identity");
  check(JSON.stringify(createSplitCommands().map(command => command.name)) === '["split"]', "split inventory");
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(splitCommands());
  try {
    check((await shell.exec("split --help")).exitCode === 0, "split registration");
    const original = shell.commands.get("split");
    let collision;
    try { splitCommands().setup({ commands: shell.commands }); } catch (error) { collision = error; }
    check(collision && shell.commands.get("split") === original, "split collision preserves registration");
    shell.use(splitCommands({ replace: true }));
    check((await shell.exec("split --help")).exitCode === 0 && shell.commands.get("split") !== original, "split explicit replacement");
    shell.commands.register({ name: "relay", async execute(context) {
      for await (const chunk of context.stdin) await context.stdout.write(chunk);
      return { exitCode: 0 };
    } });
    await fs.writeFile("/split.sh", new TextEncoder().encode('split -n 2/2 "$1" | relay'));
    await fs.writeFile("/input", Uint8Array.of(255, 10, 254, 10));
    const result = await shell.exec("sh /split.sh /input");
    check(result.exitCode === 0 && result.stderr === "" && JSON.stringify([...result.stdoutBytes]) === '[254,10]', "split VFS script and pipeline preserve bytes");
    const split = await shell.exec("relay | split -l 1 - /piece", { stdin: Uint8Array.of(255, 10, 254, 10) });
    check(split.exitCode === 0, "split streaming pipeline");
    check(JSON.stringify([...await fs.readFile("/pieceaa")]) === '[255,10]' && JSON.stringify([...await fs.readFile("/pieceab")]) === '[254,10]', "split file byte preservation");
    const elided = await shell.exec("split -e -n 5 --numeric-suffixes=98 - /number", { stdin: "ab" });
    check(elided.exitCode === 0 && new TextDecoder().decode(await fs.readFile("/number98")) === "a" && new TextDecoder().decode(await fs.readFile("/number99")) === "b", "split suffix width and empty-file elision");
    shell.commands.register({ name: "argv-probe", async execute(context) {
      const carrier = getCommandArguments(context);
      check(JSON.stringify([...carrier.bytes(0)]) === '[255]' && JSON.stringify([...carrier.bytes(1)]) === '[254]', "split pipeline canonical byte argv");
      await context.stdout.write(Uint8Array.of(255, 254));
      return { exitCode: 0 };
    } });
    check((await shell.exec("argv-probe $'\\xff' $'\\xfe' | split -b 1 - /argv")).exitCode === 0, "split shell-created byte arguments");
    check(JSON.stringify([...await fs.readFile("/argvaa")]) === '[255]' && JSON.stringify([...await fs.readFile("/argvab")]) === '[254]', "split pipeline byte values");
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments(["-n", shellValueFromBytes(Uint8Array.of(49, 47, 50))]);
  let output = [];
  const context = { command: "split", args: carrier.args, argumentValues: carrier, cwd: "/", env: { LC_ALL: "C" }, fs,
    stdin: { async *[Symbol.asyncIterator]() { yield Uint8Array.of(255, 10, 254, 10); } }, signal: new AbortController().signal,
    stdout: { async write(bytes) { output.push(...bytes); } }, stderr: { async write() {} } };
  check((await createSplitCommand().execute(context)).exitCode === 0 && JSON.stringify(output) === '[255,10]', "split canonical value carrier");
  const reason = new FsError("EIO", "/output", "packed sink failure");
  let diagnostic = "";
  const failure = await createSplitCommand().execute({ ...context,
    stdout: { async write() { throw reason; } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
  });
  check(failure.exitCode === 1 && diagnostic === `split: ${reason.message.slice(reason.code.length + 2)}\n`, "split canonical filesystem error classification");
  const controller = new AbortController(); controller.abort(reason);
  let cancellation;
  try { await createSplitCommand().execute({ ...context, signal: controller.signal }); } catch (error) { cancellation = error; }
  check(cancellation === reason, "split cancellation identity");
  check((await createSplitCommand({ limits: { maxOutputBytes: 1 } }).execute(context)).exitCode === 1, "split explicit output limit");
})();
