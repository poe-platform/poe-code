import { Shell, createMemoryFileSystem, agentCommands, createCpCommand, FsError } from "@poe-platform/safe-bash";
import { createCpCommand as subpathFactory, cpCommands } from "@poe-platform/safe-bash/commands/cp";
import { commandRuntimeIdentity, getCommandArguments } from "@poe-platform/safe-bash/contracts";
import { FsError as contractError } from "@poe-platform/safe-bash/contracts/errors";

function check(condition, message) { if (!condition) throw new Error(message); }
export async function verifyCp() {
  check(FsError === contractError, "cp canonical error constructor");
  check(createCpCommand === subpathFactory, "cp root/subpath factory identity");
  check(subpathFactory().runtimeIdentity === commandRuntimeIdentity, "cp canonical runtime identity");
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    await fs.writeFile("/source", Uint8Array.of(255, 0, 254));
    await fs.writeFile("/copy.sh", new TextEncoder().encode("cp /source /copy; cat /copy | cat"));
    const result = await shell.exec("sh /copy.sh");
    check(result.exitCode === 0 && result.stderr === "" && [...result.stdoutBytes].join() === "255,0,254", "cp script/pipe bytes");
    let collision = false;
    try { cpCommands().setup({ commands: shell.commands }); } catch { collision = true; }
    check(collision, "cp registration collision");
    cpCommands({ replace: true }).setup({ commands: shell.commands });
    const definition = subpathFactory();
    let inspected = false;
    shell.commands.register({ ...definition, async execute(context) {
      const carrier = getCommandArguments(context);
      check(carrier.args === context.args, "cp paired argument carrier");
      check([...carrier.bytes(0)].join() === "47,255", "cp Shell-created byte value");
      let rejected = false;
      try { getCommandArguments({ ...context, argumentValues: { ...carrier } }); } catch { rejected = true; }
      check(rejected, "cp rejects forged argument brand");
      inspected = true;
      return definition.execute(context);
    } }, { replace: true });
    // cp retains the established string-path filesystem profile while the
    // surrounding invocation keeps the original byte-valued shell argument.
    await fs.writeFile("/\ufffd", Uint8Array.of(42));
    const raw = await shell.exec("cp $'/\\xff' /raw-copy");
    check(inspected && raw.exitCode === 0 && (await fs.readFile("/raw-copy"))[0] === 42, "cp byte argv invocation");
    cpCommands({ replace: true }).setup({ commands: shell.commands });
    const missing = await shell.exec("cp /missing /never-created");
    check(missing.exitCode === 1 && missing.stderr.includes("no such file or directory"), "cp canonical filesystem error");
    const controller = new AbortController();
    const reason = new Error("cp cancellation");
    controller.abort(reason);
    let cancelled;
    try { await shell.exec("cp /source /cancelled", { signal: controller.signal }); } catch (error) { cancelled = error; }
    check(cancelled === reason, "cp Shell cancellation identity");
  } finally { await shell.dispose(); }
}
