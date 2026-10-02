import { Shell, createMemoryFileSystem, agentCommands, createNumfmtCommand } from "@poe-platform/safe-bash";
import { createNumfmtCommand as subpathFactory, numfmtCommands } from "@poe-platform/safe-bash/commands/numfmt";
import { commandRuntimeIdentity, createCommandArguments, getCommandArguments, FsError } from "@poe-platform/safe-bash/contracts";
import { FsError as publicFsError } from "@poe-platform/safe-bash/contracts/errors";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(FsError === publicFsError, "numfmt canonical error identity");
  check(subpathFactory().runtimeIdentity === commandRuntimeIdentity, "numfmt canonical runtime identity");
  check(createNumfmtCommand().runtimeIdentity === commandRuntimeIdentity, "numfmt root runtime identity");
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    await fs.writeFile("/numbers", new TextEncoder().encode("1000\n2000\n"));
    await fs.writeFile("/format.sh", new TextEncoder().encode("cat /numbers | numfmt --to=si"));
    const result = await shell.exec("sh /format.sh");
    check(result.stdout === "1.0k\n2.0k\n" && result.exitCode === 0 && result.stderr === "", "numfmt VFS script/pipe");
    let collision = false;
    try { numfmtCommands().setup({ commands: shell.commands }); } catch { collision = true; }
    check(collision, "numfmt registration collision");
    shell.use(numfmtCommands({ replace: true }));
    shell.commands.register({ name: "raw-numfmt", async execute(context) {
      await context.stdout.write(Uint8Array.of(255, 44, 49, 48, 48, 48));
      return { exitCode: 0 };
    } });
    const raw = await shell.exec('numfmt --delimiter=, --field=2 --to=si "$(raw-numfmt)"');
    check(raw.exitCode === 0 && Array.from(raw.stdoutBytes).join() === "255,44,49,46,48,107,10", "numfmt Shell byte argv");
  } finally { await shell.dispose(); }

  const carrier = createCommandArguments(["--field=2", "--delimiter=,", shellValueFromBytes(Uint8Array.of(254, 44, 49))]);
  const chunks = [];
  const context = { command: "numfmt", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { chunks.push(...chunk); } },
    stderr: { async write() {} }, signal: new AbortController().signal };
  check(getCommandArguments(context) === carrier, "numfmt carrier brand");
  let forgedRejected = false;
  try { getCommandArguments({ ...context, argumentValues: { ...carrier } }); } catch { forgedRejected = true; }
  check(forgedRejected, "numfmt rejects unowned carrier");
  await subpathFactory().execute(context);
  check(chunks.join() === "254,44,49,10", "numfmt value brand");
  const failure = new FsError("EACCES");
  const errors = [];
  const failed = await subpathFactory().execute({ ...context, args: [], argumentValues: undefined,
    stdin: { [Symbol.asyncIterator]() { return { async next() { throw failure; } }; } },
    stderr: { async write(chunk) { errors.push(...chunk); } } });
  check(failed.exitCode === 0 && new TextDecoder().decode(Uint8Array.from(errors)).includes("Permission denied"), "numfmt canonical input error");
  const controller = new AbortController();
  const reason = new Error("numfmt cancellation");
  controller.abort(reason);
  let cancelled;
  try { await subpathFactory().execute({ ...context, signal: controller.signal }); } catch (error) { cancelled = error; }
  check(cancelled === reason, "numfmt cancellation identity");
})();
