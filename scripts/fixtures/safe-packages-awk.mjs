import assert from "node:assert/strict";
import { Shell, agentCommands, createMemoryFileSystem, createTextProgramCommands } from "@poe-platform/safe-bash";
import { createAwkCommand, createAwkCommands, awkCommands } from "@poe-platform/safe-bash/commands/awk";
import { FsError, getCommandArguments, commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts";
import { shellValueBytes } from "@poe-platform/safe-bash/contracts/value";
import { FsError as directError } from "@poe-platform/safe-bash/contracts/errors";

assert.equal(FsError, directError);
assert.deepEqual(createAwkCommands().map(command => command.name), ["awk"]);
assert.deepEqual(createTextProgramCommands().map(command => command.name), ["sed", "awk"]);
const fs = createMemoryFileSystem();
const encode = value => new TextEncoder().encode(value);
await fs.writeFile("/data", encode("left 2\nright 3\n"));
await fs.writeFile("/program", encode("{ sum += $2 } END { print sum }"));
await fs.writeFile("/script.sh", encode("awk -f /program /data | awk '{ print $1 * 2 }'"));
const shell = new Shell({ fs }).use(agentCommands());
let paired = false;
const command = createAwkCommand();
shell.use({ name: "awk-boundary-witness", setup(host) {
  host.commands.register({ ...command, runtimeIdentity: commandRuntimeIdentity, execute(context) {
    if (context.args[0] === "-v") {
      const arguments_ = getCommandArguments(context);
      assert.equal(arguments_, context.argumentValues);
      assert.deepEqual(arguments_.bytes(1), Uint8Array.of(120, 61, 255));
      assert.deepEqual(shellValueBytes(arguments_.values[1]), Uint8Array.of(120, 61, 255));
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
  assert.equal(result.stdout, "10\n");
  const raw = await shell.exec(`awk -v x="$(raw-byte)" 'BEGIN { print length(x) }'`);
  assert.equal(raw.exitCode, 0, raw.stderr);
  assert.ok(paired);
  const missing = await shell.exec("awk '{print}' /missing");
  assert.notEqual(missing.exitCode, 0);
  assert.ok(missing.stderr.includes("ENOENT"));
  shell.use(awkCommands({ replace: true, maxSteps: 2 }));
  const bounded = await shell.exec(`awk 'BEGIN { for (i=0;i<100;i++) x++ }'`);
  assert.notEqual(bounded.exitCode, 0);
  assert.ok(bounded.stderr.includes("step"));
} finally { await shell.dispose(); }
const collision = new Shell({ fs }).use(agentCommands()).use(awkCommands());
try { await assert.rejects(collision.exec(":"), /already registered/i); }
finally { await collision.dispose(); }
const controller = new AbortController();
const reason = new Error("packed awk cancellation");
controller.abort(reason);
await assert.rejects(async () => createAwkCommand().execute({ command: "awk", args: ["{print}"], fs, cwd: "/", env: {},
  signal: controller.signal, stdin: (async function* () {})(),
  stdout: { async write() { assert.fail("cancelled output"); } },
  stderr: { async write() { assert.fail("cancelled diagnostic"); } },
}), error => error === reason);
console.log("Installed awk: scripts, pipes, byte carriers, errors, registration, limits and cancellation passed");
