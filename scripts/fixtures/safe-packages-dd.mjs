import { Shell } from "@poe-platform/safe-bash";
import { MemoryFileSystem, FsError as FileError } from "@poe-platform/safe-fs/core";
import { commandRuntimeIdentity, createCommandArguments, getCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createDdCommand, createDdCommands, ddCommands } from "@poe-platform/safe-bash/dd";
import { createDdCommand as subpathCommand } from "@poe-platform/safe-bash/commands/dd";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(FsError === FileError, "dd canonical filesystem error");
  check(createDdCommand().runtimeIdentity === commandRuntimeIdentity && subpathCommand().runtimeIdentity === commandRuntimeIdentity, "dd runtime identity");
  check(JSON.stringify(createDdCommands().map(command => command.name)) === '["dd"]', "dd inventory");
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(ddCommands());
  try {
    await fs.writeFile("/input", Uint8Array.of(255, 254, 97, 98));
    await fs.writeFile("/copy.sh", new TextEncoder().encode('dd if="$1" bs=1 status=none | dd conv=ucase status=none'));
    const result = await shell.exec("sh /copy.sh /input");
    check(result.exitCode === 0 && result.stderr === "" && JSON.stringify([...result.stdoutBytes]) === '[255,254,65,66]', "dd VFS script and binary pipeline");
    const invalid = await shell.exec("dd $'count=\\xff' status=none");
    check(invalid.exitCode === 1 && invalid.stderr.includes("invalid UTF-8"), "dd shell byte argv retains invalid UTF-8 rejection");
    const host = { commands: shell.commands, use() {}, registerFileSystem() {} };
    const original = shell.commands.get("dd");
    let collision;
    try { await ddCommands().setup(host); } catch (error) { collision = error; }
    check(collision && shell.commands.get("dd") === original, "dd collision preserves registration");
    await ddCommands({ replace: true }).setup(host);
    check(shell.commands.get("dd") !== original, "dd replacement");
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments([shellValueFromBytes(new TextEncoder().encode("status=none"))]);
  let output = [], diagnostics = "";
  const context = { command: "dd", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() { yield Uint8Array.of(255, 254); } }, signal: new AbortController().signal,
    stdout: { async write(chunk) { output.push(...chunk); } }, stderr: { async write(chunk) { diagnostics += new TextDecoder().decode(chunk); } } };
  for (const factory of [createDdCommand, subpathCommand]) {
    output = [];
    check((await factory().execute(context)).exitCode === 0 && JSON.stringify(output) === '[255,254]', "dd canonical carrier through public routes");
  }
  let identity;
  try { getCommandArguments({ ...context, args: [...carrier.args] }); } catch (error) { identity = error; }
  check(identity instanceof CommandArgumentIdentityError, "canonical argument negative control");
  const reason = new FsError("EIO", { path: "/input", message: "cancel dd" });
  const controller = new AbortController(); controller.abort(reason);
  let cancellation;
  try { await createDdCommand().execute({ ...context, signal: controller.signal }); } catch (error) { cancellation = error; }
  check(cancellation === reason, "dd cancellation identity");
  output = [];
  check((await createDdCommand({ limits: { maxTransferBytes: 1 } }).execute(context)).exitCode === 1 && output.length === 0, "dd explicit transfer limit");
  diagnostics = "";
  check((await createDdCommand({ openFile: async () => { throw new FsError("ENOENT", { path: "/missing" }); } }).execute(context)).exitCode === 1 && diagnostics.includes("No such file or directory"), "dd injected canonical filesystem error");
})();
