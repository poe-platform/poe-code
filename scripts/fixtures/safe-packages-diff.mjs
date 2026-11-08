import * as root from "@poe-platform/safe-bash";
import { MemoryFileSystem, FsError } from "@poe-platform/safe-fs/core";
import { createCommandArguments, getCommandArguments } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { createDiffCommand, createDiffCommands, diffCommands } from "@poe-platform/safe-bash/commands/diff";
import { createDiffPatchCommands } from "@poe-platform/safe-bash";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(root.createDiffCommand === createDiffCommand && root.diffCommands === diffCommands, "diff public factory identity");
  check(root.FsError === FsError, "diff filesystem error identity");
  check(JSON.stringify(createDiffCommands().map(command => command.name)) === '["diff"]', "diff inventory");
  check(JSON.stringify(createDiffPatchCommands().map(command => command.name)) === '["diff","patch"]', "diff/patch compatibility inventory");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/old", Uint8Array.of(255, 10));
  await fs.writeFile("/new", Uint8Array.of(254, 10));
  const shell = new root.Shell({ fs }).use(diffCommands());
  try {
    check((await shell.exec("diff /old /old")).exitCode === 0, "diff initial registration");
    const original = shell.commands.get("diff");
    let collision;
    const host = { commands: shell.commands, use() {}, registerFileSystem() {} };
    try { diffCommands().setup(host); } catch (error) { collision = error; }
    check(collision && shell.commands.get("diff") === original, "diff collision preserves registration");
    diffCommands({ replace: true }).setup(host);
    check(shell.commands.get("diff") !== original, "diff replacement registration");
    shell.commands.register({ name: "relay", async execute(context) {
      for await (const chunk of context.stdin) await context.stdout.write(chunk);
      return { exitCode: 0 };
    } });
    await fs.writeFile("/compare.sh", new TextEncoder().encode('diff -a /old /new | relay\n'));
    const expected = [49, 99, 49, 10, 60, 32, 255, 10, 45, 45, 45, 10, 62, 32, 254, 10];
    const direct = await shell.exec("diff -a /old /new");
    check(direct.exitCode === 1 && direct.stderr === "" && JSON.stringify([...direct.stdoutBytes]) === JSON.stringify(expected), "diff raw byte output and status");
    const script = await shell.exec("sh /compare.sh");
    check(script.exitCode === 0 && script.stderr === "" && JSON.stringify([...script.stdoutBytes]) === JSON.stringify(expected), "diff VFS script and pipeline");
    shell.commands.register({ name: "argv", async execute(context) {
      const args = getCommandArguments(context);
      check(args.args === context.args, "diff shell canonical argv pairing");
      check(JSON.stringify([...args.bytes(0)]) === '[255]' && JSON.stringify([...args.bytes(1)]) === '[254]', "diff shell byte values retain identity");
      const carrier = createCommandArguments(["-a", "/old", "/new"]);
      return createDiffCommand().execute({ ...context, args: carrier.args, argumentValues: carrier });
    } });
    check((await shell.exec("argv $'\\xff' $'\\xfe'")).exitCode === 1, "diff canonical argv execution");
    const limited = new root.Shell({ fs }).use(diffCommands({ maxInputBytes: 1 }));
    try { check((await limited.exec("diff /old /new")).exitCode === 2, "diff explicit input limit"); }
    finally { await limited.dispose(); }
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments(["-a", shellValueFromBytes(new TextEncoder().encode("/old")), "/new"]);
  const sink = { async write() {} };
  const context = { command: "diff", args: carrier.args, argumentValues: carrier, fs, cwd: "/", env: {}, stdin: root.toByteSource(""), stdout: sink, stderr: sink, signal: new AbortController().signal };
  check((await createDiffCommand().execute(context)).exitCode === 1, "diff accepts canonical carrier");
  const reason = new FsError("EIO", "/old", "packed diff cancellation");
  const controller = new AbortController(); controller.abort(reason);
  let cancellation;
  try { await createDiffCommand().execute({ ...context, signal: controller.signal }); } catch (error) { cancellation = error; }
  check(cancellation === reason, "diff cancellation identity");
  let diagnostic = "";
  const failure = await createDiffCommand().execute({ ...context,
    stdout: { async write() { throw reason; } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } },
  });
  check(failure.exitCode === 2 && diagnostic.includes("EIO"), "diff canonical filesystem error classification");
})();
