import { Shell, createMemoryFileSystem, agentCommands, FsError, createCmpCommand as rootFactory } from "@poe-platform/safe-bash";
import { createCmpCommand, cmpCommands } from "@poe-platform/safe-bash/commands/cmp";
import { createCmpCommand as legacyRoute } from "@poe-platform/safe-bash/cmp";
import { commandRuntimeIdentity, getCommandArguments } from "@poe-platform/safe-bash/contracts";
import { FsError as contractError } from "@poe-platform/safe-bash/contracts/errors";

function check(condition, message) { if (!condition) throw new Error(message); }
export async function verifyCmp({ portable = false } = {}) {
  check(FsError === contractError, "cmp canonical error constructor");
  check(rootFactory().runtimeIdentity === commandRuntimeIdentity, "cmp root runtime identity");
  check(createCmpCommand === legacyRoute, "cmp public route identity");
  check(createCmpCommand().runtimeIdentity === commandRuntimeIdentity, "cmp runtime identity");
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    await fs.writeFile("/left", Uint8Array.of(0, 10, 255));
    await fs.writeFile("/right", Uint8Array.of(0, 10, 254));
    await fs.writeFile("/block-left", new TextEncoder().encode("aaaaa"));
    await fs.writeFile("/block-right", new TextEncoder().encode("baaaa"));
    await fs.writeFile("/empty", new Uint8Array());
    await fs.writeFile("/compare.sh", new TextEncoder().encode("cat /left | cmp - /left"));
    for (const optional of [false, true]) {
      if (optional) {
        let collision = false;
        try { cmpCommands().setup({ commands: shell.commands }); } catch { collision = true; }
        check(collision, "cmp registration collision");
        cmpCommands({ replace: true, comparisonBlockBytes: 4 }).setup({ commands: shell.commands });
      }
      const block = await shell.exec("cmp -l /block-left /block-right");
      check(block.exitCode === (optional ? 0 : 1) && block.stdout === "1 141 142\n", "cmp distinct block status");
      const eof = await shell.exec("cmp /empty /left");
      check(eof.exitCode === 1 && eof.stderr === `cmp: EOF on ${optional ? "'/empty'" : "/empty"} which is empty\n`, "cmp distinct EOF diagnostics");
      for (const [script, status, stdout] of [
        ["sh /compare.sh", 0, ""],
        ["cmp -n2 /left /right", 0, ""],
        ["cmp -s /left /right", 1, ""],
        ["cmp -l /left /right", 1, "3 377 376\n"],
      ]) {
        const result = await shell.exec(script);
        check(result.exitCode === status && result.stdout === stdout && result.stderr === "", `cmp profile ${optional}: ${script}`);
      }
    }
    const definition = createCmpCommand();
    let inspected = false;
    shell.commands.register({ ...definition, async execute(context) {
      const carrier = getCommandArguments(context);
      check(carrier.args === context.args, "cmp paired carrier");
      check([...carrier.bytes(0)].join() === (portable ? "47,195,169" : "47,255"), "cmp raw argv identity");
      let rejected = false;
      try { getCommandArguments({ ...context, argumentValues: { ...carrier } }); } catch { rejected = true; }
      check(rejected, "cmp rejects forged carrier");
      inspected = true;
      return definition.execute(context);
    } }, { replace: true });
    // Portable shell syntax requires valid UTF-8; Node also admits raw invalid bytes.
    const raw = await shell.exec(portable ? "cmp $'/\\xc3\\xa9' /left" : "cmp $'/\\xff' /left");
    check(inspected && raw.exitCode === 2 && raw.stderrBytes.includes(portable ? 195 : 255), "cmp byte-valued argv diagnostic");
    cmpCommands({ replace: true }).setup({ commands: shell.commands });
    const missing = await shell.exec("cmp /missing /left");
    check(missing.exitCode === 2 && missing.stderr.length > 0, "cmp filesystem error");
    const controller = new AbortController();
    const reason = new Error("cmp cancellation");
    controller.abort(reason);
    let caught;
    try { await shell.exec("cmp /left /right", { signal: controller.signal }); } catch (error) { caught = error; }
    check(caught === reason, "cmp cancellation identity");
  } finally { await shell.dispose(); }
}
