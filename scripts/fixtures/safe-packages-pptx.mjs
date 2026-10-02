import { Shell } from "@poe-platform/safe-bash";
import { MemoryFileSystem, FsError } from "@poe-platform/safe-fs/core";
import { FsError as ContractFsError } from "@poe-platform/safe-bash/contracts/errors";
import { createPptxCommand, createPptxCommands, pptxCommands } from "@poe-platform/safe-bash/commands/pptx";

function check(value, message) { if (!value) throw new Error(message); }
const encode = text => new TextEncoder().encode(text);
export const verification = (async () => {
  check(FsError === ContractFsError, "pptx uses canonical filesystem errors");
  check(createPptxCommand().name === "pptx" && createPptxCommands().length === 1, "pptx factory inventory");
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(pptxCommands());
  try {
    const help = await shell.exec("pptx --help");
    check(help.exitCode === 0 && help.stdout.includes("pptx"), "packed default engine discovery");
    const created = await shell.exec("pptx create --output /deck.pptx --json");
    check(created.exitCode === 0 && (await fs.readFile("/deck.pptx")).length > 0, "packed default engine publishes a presentation");
    const inspected = await shell.exec("pptx create --output - | pptx inspect - --json");
    check(inspected.exitCode === 0 && JSON.parse(inspected.stdout).ok === true, "packed presentation bytes survive a real engine pipeline");
    const original = shell.commands.get("pptx");
    let collision;
    try { pptxCommands().setup({ commands: shell.commands }); } catch (error) { collision = error; }
    check(collision && shell.commands.get("pptx") === original, "pptx collision retains owner");
    const args = [];
    shell.use(pptxCommands({ replace: true, engine: { async execute(request) {
      args.push([...request.args[0]]);
      return { exitCode: 0, stdout: await request.readInput("-", 8), stderr: new Uint8Array() };
    } } }));
    shell.register({ name: "relay", async execute(context) {
      for await (const bytes of context.stdin) await context.stdout.write(bytes);
      return { exitCode: 0 };
    } });
    await fs.writeFile("/run.sh", encode("pptx $'\\xff' | relay\npptx $'\\xfe'"));
    const run = await shell.exec("sh /run.sh", { stdin: Uint8Array.of(0, 255, 254) });
    check(run.exitCode === 0 && JSON.stringify(args) === "[[255],[254]]", "pptx VFS script preserves distinct byte argv");
    check(run.stdoutBytes[0] === 0 && run.stdoutBytes[1] === 255, "pptx pipeline preserves binary stdin");
    let invoked = false;
    shell.use(pptxCommands({ replace: true, limits: { maxArgumentBytes: 1 }, engine: { async execute() {
      invoked = true; throw new Error("engine invoked before limit admission");
    } } }));
    check((await shell.exec("pptx aa")).exitCode !== 0 && !invoked, "pptx explicit argument limit");
    const controller = new AbortController();
    const reason = new FsError("EACCES");
    shell.use(pptxCommands({ replace: true, engine: { async execute(request) {
      controller.abort(reason); request.signal.throwIfAborted();
      throw new Error("abort was lost");
    } } }));
    let cancelled;
    try { await shell.exec("pptx --help", { signal: controller.signal }); } catch (error) { cancelled = error; }
    check(cancelled === reason, "pptx cancellation retains error identity");
  } finally { await shell.dispose(); }
})();
