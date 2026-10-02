import { Shell, createXqCommand as rootCommand, createXqCommands as rootCommands, xqCommands as rootPlugin } from "@poe-platform/safe-bash";
import { MemoryFileSystem, FsError as CanonicalFsError } from "@poe-platform/safe-fs/core";
import { createCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createXqCommand, createXqCommands, xqCommands } from "@poe-platform/safe-bash/commands/xq";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(rootCommand === createXqCommand && rootCommands === createXqCommands && rootPlugin === xqCommands, "xq public factory identity");
  check(FsError === CanonicalFsError, "xq canonical filesystem errors");
  check(JSON.stringify(createXqCommands().map(command => command.name)) === '["xq"]', "xq inventory");
  const fs = new MemoryFileSystem();
  const encoder = new TextEncoder();
  await fs.writeFile("/input", encoder.encode("<root><item>one</item><item>two</item></root>"));
  await fs.writeFile("/run.sh", encoder.encode('relay < /input | xq -r "$1"\n'));
  const shell = new Shell({ fs }).use(xqCommands());
  shell.commands.register({ name: "relay", async execute(context) {
    for await (const chunk of context.stdin) await context.stdout.write(chunk);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("sh /run.sh '.root.item[]'");
    check(result.exitCode === 0 && result.stdout === "one\ntwo\n" && result.stderr === "", "xq VFS script and pipeline");
    for (const byte of ["ff", "fe"]) {
      const invalid = await shell.exec(`sh /run.sh $'\\x${byte}'`);
      check(invalid.exitCode === 2 && invalid.stdout === "" && invalid.stderr.includes("valid UTF-8"), "xq Shell byte argv remains lossless");
    }
    const original = shell.commands.get("xq");
    let collision;
    try { await xqCommands().setup(shell); } catch (error) { collision = error; }
    check(collision && shell.commands.get("xq") === original, "xq collision preserves registration");
    await xqCommands({ replace: true, limits: { maxInputBytes: 4 } }).setup(shell);
    check((await shell.exec("xq . /input")).exitCode === 5, "xq explicit input limit");
    await xqCommands({ replace: true }).setup(shell);
    const controller = new AbortController();
    const reason = Object.freeze({ cancelled: "packed xq" });
    let closed = false;
    const stdin = (async function* () {
      try { yield encoder.encode("<root>"); controller.abort(reason); yield encoder.encode("</root>"); }
      finally { closed = true; }
    })();
    let cancellation;
    try { await shell.exec("xq .", { stdin, signal: controller.signal }); } catch (error) { cancellation = error; }
    check(cancellation === reason && closed, "xq cancellation identity and stream retirement");
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments([shellValueFromBytes(encoder.encode(".root"))]);
  const context = { command: "xq", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() { yield encoder.encode("<root>ok</root>"); } },
    signal: new AbortController().signal, stdout: { async write() {} }, stderr: { async write() {} } };
  check((await createXqCommand().execute(context)).exitCode === 0, "xq canonical byte value and argv");
  let identity;
  try { await createXqCommand().execute({ ...context, args: [...carrier.args] }); } catch (error) { identity = error; }
  check(identity instanceof CommandArgumentIdentityError, "xq canonical carrier negative control");
  const reason = new FsError("EIO", "/output", "packed sink failure");
  let failure;
  try { await createXqCommand().execute({ ...context, stdout: { async write() { throw reason; } } }); } catch (error) { failure = error; }
  check(failure === reason && failure instanceof FsError, "xq output error identity");
})();
