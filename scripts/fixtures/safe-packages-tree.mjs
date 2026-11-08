import { Shell, createTreeCommand as rootCommand, treeCommands as rootPlugin } from "@poe-platform/safe-bash";
import { MemoryFileSystem, FsError as CanonicalFsError } from "@poe-platform/safe-fs/core";
import { createCommandArguments, getCommandArguments, CommandArgumentIdentityError } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createTreeCommand, createTreeCommands, treeCommands } from "@poe-platform/safe-bash/commands/tree";

function check(condition, message) { if (!condition) throw new Error(message); }
export const verification = (async () => {
  check(rootCommand === createTreeCommand && rootPlugin === treeCommands, "tree public factory identity");
  check(FsError === CanonicalFsError, "tree canonical filesystem errors");
  check(JSON.stringify(createTreeCommands().map(command => command.name)) === '["tree"]', "tree inventory");
  const fs = new MemoryFileSystem();
  const encoder = new TextEncoder();
  await fs.mkdir("/input");
  for (const file of ["v10", "v2", ".hidden"]) await fs.writeFile(`/input/${file}`, new Uint8Array());
  await fs.symlink("v2", "/input/link");
  await fs.writeFile("/run.sh", encoder.encode('tree -iv --noreport /input | relay "$1"\n'));
  const shell = new Shell({ fs }).use(treeCommands());
  shell.commands.register({ name: "relay", async execute(context) {
    const args = getCommandArguments(context);
    await context.stdout.write(args.bytes(0));
    for await (const bytes of context.stdin) await context.stdout.write(bytes);
    return { exitCode: 0 };
  } });
  try {
    for (const byte of [255, 254]) {
      const result = await shell.exec(`sh /run.sh $'\\x${byte.toString(16)}'`);
      check(result.exitCode === 0 && result.stdoutBytes[0] === byte && result.stderr === "", "tree VFS script, pipe and canonical byte argv");
      check(new TextDecoder().decode(result.stdoutBytes.slice(1)) === "/input\nlink -> v2\nv2\nv10\n", "tree deterministic version ordering and symlink rendering");
    }
    const json = await shell.exec("tree -Ji -I link /input");
    check(json.exitCode === 0 && JSON.stringify(JSON.parse(json.stdout)) === '[{"type":"directory","name":"/input","contents":[{"type":"file","name":"v10"},{"type":"file","name":"v2"}]},{"type":"report","directories":1,"files":2}]', "tree JSON filtering, name ordering and counts");
    const missing = await shell.exec("tree /absent");
    check(missing.exitCode === 1 && missing.stdout.includes("/absent"), "tree missing-path behavior");
    const original = shell.commands.get("tree");
    let collision;
    try { await treeCommands().setup(shell); } catch (error) { collision = error; }
    check(collision && shell.commands.get("tree") === original, "tree collision preserves registration");
    await treeCommands({ replace: true, limits: { maxDirectoryEntries: 1 } }).setup(shell);
    const limited = await shell.exec("tree /input");
    check(limited.exitCode !== 0 && limited.stderr.includes("limit"), "tree explicit directory limit");
    const controller = new AbortController();
    const reason = Object.freeze({ cancelled: "tree" });
    controller.abort(reason);
    let cancelled;
    try { await shell.exec("tree /input", { signal: controller.signal }); } catch (error) { cancelled = error; }
    check(cancelled === reason, "tree cancellation identity");
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments([shellValueFromBytes(encoder.encode("--help"))]);
  let output = "";
  const context = { command: "tree", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() {} }, signal: new AbortController().signal,
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } }, stderr: { async write() {} } };
  check((await createTreeCommand().execute(context)).exitCode === 0 && output.includes("tree"), "tree canonical byte-valued argument");
  const limitedCarrier = createCommandArguments(["/input"]);
  let limitError;
  try {
    await createTreeCommand({ limits: { maxDirectoryEntries: 1 } }).execute({ ...context,
      args: limitedCarrier.args, argumentValues: limitedCarrier });
  } catch (error) { limitError = error; }
  check(limitError instanceof FsError && limitError.code === "EFBIG", "tree limit error crosses canonical boundary");
  const pendingController = new AbortController();
  const pendingReason = Object.freeze({ cancelled: "tree filesystem wait" });
  const pendingFs = new Proxy(fs, { get(target, key) {
    if (key === "lstat") return () => {
      pendingController.abort(pendingReason);
      return new Promise(() => {});
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let pendingError;
  try {
    await createTreeCommand().execute({ ...context, args: limitedCarrier.args,
      argumentValues: limitedCarrier, fs: pendingFs, signal: pendingController.signal });
  } catch (error) { pendingError = error; }
  check(pendingError === pendingReason, "tree pending filesystem cancellation identity");
  let identity;
  try { getCommandArguments({ ...context, args: [...carrier.args] }); } catch (error) { identity = error; }
  check(identity instanceof CommandArgumentIdentityError, "tree canonical carrier negative control");
})();
