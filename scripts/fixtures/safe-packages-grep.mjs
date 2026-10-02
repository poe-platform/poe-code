import assert from "node:assert/strict";
import { Shell, agentCommands, createMemoryFileSystem, createGrepCommand as rootFactory } from "@poe-platform/safe-bash";
import { createGrepCommand, createGrepCommands, grepCommands } from "@poe-platform/safe-bash/commands/grep";
import { createGrepAliasCommands } from "@poe-platform/safe-bash/commands/grep-aliases";
import { FsError, getCommandArguments, commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts";
import { FsError as directError } from "@poe-platform/safe-bash/contracts/errors";
import { shellValueBytes } from "@poe-platform/safe-bash/contracts/value";
assert.equal(FsError, directError);
assert.equal(rootFactory, createGrepCommand);
assert.deepEqual(createGrepCommands().map(command => command.name), ["grep"]);
assert.deepEqual(createGrepAliasCommands().map(command => command.name), ["egrep", "fgrep"]);
const fs = createMemoryFileSystem();
const encode = value => new TextEncoder().encode(value);
await fs.writeFile("/data", encode("before\nalpha\nafter\nbeta\n"));
await fs.writeFile("/script.sh", encode("grep -A1 alpha /data | egrep 'alpha|after' | fgrep after"));
const shell = new Shell({ fs }).use(agentCommands());
const command = createGrepCommand();
let paired = false;
shell.use({ name: "grep-contract-witness", setup(host) {
  host.commands.register({ ...command, runtimeIdentity: commandRuntimeIdentity, execute(context) {
    if (context.args[0] === "-F") {
      const argv = getCommandArguments(context);
      assert.equal(argv, context.argumentValues);
      assert.deepEqual(argv.bytes(1), Uint8Array.of(255));
      assert.deepEqual(shellValueBytes(argv.values[1]), Uint8Array.of(255));
      paired = true;
    }
    return command.execute(context);
  } }, { replace: true });
  host.commands.register({ name: "raw-byte", async execute(context) {
    await context.stdout.write(Uint8Array.of(255));
    return { exitCode: 0 };
  } });
} });
try {
  const result = await shell.exec("sh /script.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "after\n");
  const raw = await shell.exec('grep -F "$(raw-byte)" /data');
  assert.equal(raw.exitCode, 1, raw.stderr);
  assert.ok(paired);
  const missing = await shell.exec("grep alpha /missing");
  assert.equal(missing.exitCode, 2);
  assert.ok(missing.stderr.includes("ENOENT"));
  shell.use(grepCommands({ replace: true, maxLineBytes: 3 }));
  const bounded = await shell.exec("grep alpha /data");
  assert.equal(bounded.exitCode, 2);
  assert.ok(bounded.stderr.includes("limit"));
} finally { await shell.dispose(); }
const collision = new Shell({ fs }).use(agentCommands()).use(grepCommands());
try { await assert.rejects(collision.exec(":"), /already registered/i); }
finally { await collision.dispose(); }
const controller = new AbortController();
const reason = new Error("packed grep cancellation");
controller.abort(reason);
await assert.rejects(() => createGrepCommand().execute({ command: "grep", args: ["alpha"], fs, cwd: "/", env: {},
  signal: controller.signal, stdin: (async function* () {})(),
  stdout: { async write() { assert.fail("cancelled output"); } },
  stderr: { async write() { assert.fail("cancelled diagnostic"); } },
}), error => error === reason);
console.log("Installed grep: scripts, pipes, aliases, contracts, limits, registration and cancellation passed");
