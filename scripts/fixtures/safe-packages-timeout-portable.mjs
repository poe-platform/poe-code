import { Shell, createMemoryFileSystem, baseAgentCommands, createTimeoutCommand, FsError } from "@poe-platform/safe-bash";
import { createTimeoutCommand as subpathFactory } from "@poe-platform/safe-bash/commands/timeout";
import { getCommandArguments } from "@poe-platform/safe-bash/contracts";
import { FsError as contractError } from "@poe-platform/safe-bash/contracts/errors";

function check(value, message) { if (!value) throw new Error(message); }
export const verification = (async () => {
  check(createTimeoutCommand === subpathFactory && FsError === contractError, "timeout portable canonical exports");
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(baseAgentCommands());
  try {
    await fs.writeFile("/timeout.sh", new TextEncoder().encode("timeout 0 inspect-bytes $'\\xff' $'\\xfe' | cat"));
    let inspected = false;
    shell.commands.register({ name: "inspect-bytes", async execute(context) {
      const values = getCommandArguments(context);
      check(values.args === context.args && values.bytes(0)[0] === 255 && values.bytes(1)[0] === 254, "timeout portable byte identity");
      await context.stdout.write(Uint8Array.of(255, 0, 254));
      inspected = true;
      return { exitCode: 0 };
    } });
    const result = await shell.exec("sh /timeout.sh");
    check(inspected && result.exitCode === 0 && result.stderr === "" && [...result.stdoutBytes].join() === "255,0,254", `timeout portable script and pipe: ${JSON.stringify({ inspected, exitCode: result.exitCode, stderr: result.stderr, bytes: [...result.stdoutBytes] })}`);
    check((await shell.exec("timeout 0 sh -c 'exit 9'")).exitCode === 9, "timeout portable child status");
    const controller = new AbortController();
    const reason = new Error("portable cancellation");
    controller.abort(reason);
    let failure;
    try { await shell.exec("timeout 1 true", { signal: controller.signal }); } catch (error) { failure = error; }
    check(failure === reason, "timeout portable cancellation identity");
  } finally { await shell.dispose(); }
})();
