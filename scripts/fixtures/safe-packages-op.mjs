import { Shell } from "@poe-platform/safe-bash";
import { MemoryFileSystem, FsError } from "@poe-platform/safe-fs/core";
import { FsError as ContractFsError } from "@poe-platform/safe-bash/contracts/errors";
import { getCommandArguments } from "@poe-platform/safe-bash/contracts/command";
import { createOpCommand, createOpCommands, createObjectBackend, opCommands } from "@poe-platform/safe-bash/commands/op";

function check(condition, message) { if (!condition) throw new Error(message); }
const encode = value => new TextEncoder().encode(value);
const backend = () => createObjectBackend({ vaults: [{ id: "vault", name: "Team" }], items: [{ id: "item", title: "Login", vault: { id: "vault" }, fields: [{ id: "password", type: "CONCEALED", value: "secret" }] }] });
export const verification = (async () => {
  check(FsError === ContractFsError, "op canonical filesystem errors");
  check(createOpCommand().name === "op" && createOpCommands().length === 1, "op factory inventory");
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { TOKEN: "op://Team/Login/password" } });
  try {
    check((await shell.exec("op --version")).exitCode !== 0, "op requires registration");
    shell.use(opCommands({ backend: backend(), authorize: () => "allow" }));
    check((await shell.exec("op --version")).exitCode === 0, "op registration");
    const original = shell.commands.get("op");
    let collision;
    try { opCommands().setup({ commands: shell.commands }); } catch (error) { collision = error; }
    check(collision && shell.commands.get("op") === original, "op collision preserves owner");
    shell.use(opCommands({ backend: backend(), authorize: () => "allow", replace: true }));
    check((await shell.exec("op --version")).exitCode === 0 && shell.commands.get("op") !== original, "op explicit replacement");
    shell.register({ name: "relay", async execute(context) {
      for await (const chunk of context.stdin) await context.stdout.write(chunk);
      return { exitCode: 0 };
    } });
    await fs.writeFile("/read.sh", encode('op read "$TOKEN" | relay'));
    const read = await shell.exec("sh /read.sh");
    check(read.exitCode === 0 && read.stdout === "secret\n", "op VFS script, expansion and pipeline");
    shell.register({ name: "capture", async execute(context) {
      check(context.env.TOKEN === "secret", "op resolved child environment");
      check(getCommandArguments(context).args[0] === "a b", "op canonical child argv");
      for await (const chunk of context.stdin) await context.stdout.write(chunk);
      return { exitCode: 7 };
    } });
    const run = await shell.exec("op run -- capture 'a b'", { stdin: Uint8Array.of(255, 0, 254) });
    check(run.exitCode === 7 && JSON.stringify([...run.stdoutBytes]) === "[255,0,254]", "op child status and byte values");
    shell.register({ name: "environment", execute(context) {
      check(context.env.TOKEN === "op://Team/Login/password", "op child environment isolation");
      return { exitCode: 0 };
    } });
    check((await shell.exec("environment")).exitCode === 0, "op parent environment");
    const stages = [];
    shell.use(opCommands({ replace: true, backend: backend(), authorize: () => "ask", authorizeResolution: () => { stages.push("resolve"); return true; }, approveResolved: () => { stages.push("approve"); return true; } }));
    const approved = await shell.exec("op read op://Team/Login/password --out-file /secret");
    check(approved.exitCode === 0 && stages.join(",") === "resolve,approve", "op resolved approval stages");
    check(new TextDecoder().decode(await fs.readFile("/secret")) === "secret" && ((await fs.stat("/secret")).mode & 0o777) === 0o600, "op VFS output and private mode");
    let acquired = false;
    shell.use(opCommands({ replace: true, backend: { async execute() { acquired = true; } }, authorize: () => "deny" }));
    check((await shell.exec("op vault list")).exitCode !== 0 && !acquired, "op denied backend stays untouched");
    shell.use(opCommands({ replace: true, backend: backend(), limits: { maxInputBytes: 2 } }));
    check((await shell.exec("op inject", { stdin: "abc" })).exitCode !== 0, "op explicit input limit");
    const controller = new AbortController();
    const reason = new FsError("EIO", "/backend", "packed cancellation");
    shell.use(opCommands({ replace: true, backend: { async execute(_request, context) { controller.abort(reason); context.signal.throwIfAborted(); } }, authorize: () => "allow" }));
    let cancelled;
    try { await shell.exec("op vault list", { signal: controller.signal }); } catch (error) { cancelled = error; }
    check(cancelled === reason, "op cancellation identity");
  } finally { await shell.dispose(); }
})();
